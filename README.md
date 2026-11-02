# Interactions

Reference implementations of an **interaction** — a durable, schedulable unit of work — for distributed services built on top of the [innervate-ru/common](https://github.com/innervate-ru/common) service framework.

An *interaction* (abbreviated `ia` in the code) is a row in a database that says: *"service A asks service B to perform action X, with these arguments, and it should be processed now / at time T / in N milliseconds"*. Interactions form parent/child trees, are leased with row locks so many nodes can safely consume the same queue, report their lifecycle on the event bus, and survive process restarts because their state lives in the database.

This repository contains **three independent variants** of the same idea:

| Directory | Storage | Sessions | Description |
|---|---|---|---|
| [`pg-interactions-without-session/`](pg-interactions-without-session/) | PostgreSQL | no | The core implementation: a single `interaction` table plus a processing loop. |
| [`pg-interactions-with-session/`](pg-interactions-with-session/) | PostgreSQL | yes | The same interaction engine, plus a `session` table and a `sessions.lock()` API that serializes work per user/bot/channel. |
| [`mongo-interactions-as-tasks/`](mongo-interactions-as-tasks/) | MongoDB | no | A standalone Mongoose-based "interactions as tasks" engine with script files, retries and a parent/child task graph. |

---

## Repository status

This is an **extract from a production codebase**, published as a reference/example:

- There is no `package.json` — the code is meant to be dropped into a host application that already provides the `common` framework, the `postgres` service, the `bus`, `config`, `ava`, `sinon`, etc.
- The PG variants import `../../common/...` (services, validation, events, error handling) which is **not part of this repository** — it comes from [`innervate-ru/common`](https://github.com/innervate-ru/common).
- Tests are real [`ava`](https://github.com/avajs/ava) specs and require a running PostgreSQL configured through the `config` package (`postgres` and `node` keys).
- The test suites double as the **specification**: `interactions/README.md` in each PG variant contains the original numbered requirement list (in Russian) that the `01_...`–`10_...` test files implement.

---

## Concept and domain model

### States

The database stores three booleans (`completed`, `failed`, `cancelled`); the API exposes a single derived `state` (`interactions/_states.js`):

| `state` | Derived from |
|---|---|
| `in_progress` | `completed = false` |
| `completed` | `completed = true`, no error, not cancelled |
| `failed` | `completed = true` and `failed = true` |
| `cancelled` | `completed = true` and `cancelled = true` |

Cancelling an interaction implicitly marks it completed; supplying an `error` implicitly marks it completed + failed, and an `Error` object is flattened to a string via `buildFullErrorMessage`.

### Scheduling

Every interaction has a `next_processing` timestamp:

- `NULL` — nothing to do (finished, or deliberately waiting);
- `<= now()` — ready to be picked up by a processing loop;
- `> now()` — scheduled for the future.

You schedule work with `processAt` (absolute ISO-8601 UTC) or `processIn` (relative milliseconds), both at creation and on update. Passing `wait: true` at creation stores `next_processing = NULL`, i.e. an interaction that only becomes processable when something else (usually a child) wakes it up.

### Parent / child interactions

An interaction may have a `parentId` and a `name` (its name *for that parent*). This gives a tree of dependent steps:

- creating a **completed** child immediately re-queues the parent (`next_processing = now()`);
- completing a child through `update()` does the same, but only when the child was created with `innerAction: true`;
- `getChildren({parentId, name})` reads children back (optionally filtered by name, ordered by `modified DESC`, optional `limit`).

> Cancelling unfinished children when the parent finishes is specified (requirement 6.2) but **not yet implemented** — there is an explicit `TODO` in `update.js`.

### Leasing / locking

The `lock` column is a lease, not a mutex held for the whole processing run:

1. Claiming a row (`_buildNext` in `process.js`) does `UPDATE ... SET lock = now() + lockPeriod` over a `SELECT ... FOR UPDATE` subquery, so only one worker gets it.
2. While the processor runs, a timer extends the lease every `relockPeriod` ms.
3. If the lease extension finds the lease already expired (`lockleft <= 0`), an `ia.error {kind: 'extendLock'}` event is emitted — another worker may have taken the row over.
4. Rows whose `lock > now()` are invisible to claimers, so a crashed worker's rows become available again automatically after `lockPeriod`.

Every `update()` resets `lock = now()` (i.e. releases it) and bumps `modified`.

### Event bus

The service publishes (`interactions/index.events.js`):

| Event | Kind | When |
|---|---|---|
| `ia.new` | event | an interaction was created |
| `ia.process` | event | a processing loop was started |
| `ia.start` | event | a worker started processing an interaction |
| `ia.end` | event | processing finished (includes `duration`) |
| `ia.error` | error | `kind` is `general`, `extendLock` or `tooLong` |
| `ia.extendLock` | debug | lease-extension diagnostics (only with `debug: true`) |
| `ia.tooLong` | error | processing exceeded `maxProcessingTime` |
| `session.new` / `session.update` | event | session lifecycle (session variant only) |

---

## Variant 1 — `pg-interactions-without-session`

### Database schema (`001 create interaction.sql`)

```sql
CREATE TABLE interaction (
  id               SERIAL PRIMARY KEY,
  parent_id        INTEGER,          -- self FK, DEFERRABLE
  name             VARCHAR(100),     -- child's name for its parent
  from_service     VARCHAR(100) NOT NULL,
  to_service       VARCHAR(100) NOT NULL,
  action           VARCHAR(100) NOT NULL,
  inner_action     BOOLEAN NOT NULL DEFAULT false,
  message_id       VARCHAR(100),     -- channel message id (telegram/emby)
  next_processing  TIMESTAMP,        -- NULL = nothing to do
  completed        BOOLEAN NOT NULL DEFAULT false,
  failed           BOOLEAN NOT NULL DEFAULT false,
  cancelled        BOOLEAN NOT NULL DEFAULT false,
  lock             TIMESTAMP NOT NULL DEFAULT to_timestamp(0),
  options          JSONB,            -- all extra create/update props, incl. `error`
  created          TIMESTAMP NOT NULL,
  modified         TIMESTAMP NOT NULL
);
```

Indexes cover every hot path: `(parent_id, name)`, `message_id`, `completed`, `failed`, `lock`, `next_processing`, `from_service`, `to_service`.

### Service API (`interactions/index.js`)

The module exports a service (name derived from the file path) that depends on `postgres`:

#### `create(args)` → `Promise<interaction>`

| Argument | Type | Notes |
|---|---|---|
| `context` | string | logging/tracing context |
| `fromService`, `toService`, `action` | string (required) | routing triple; prefixed with the node name (see below) |
| `parentId`, `name` | int / string | attach as a child |
| `innerAction` | boolean | child completion re-queues the parent |
| `messageId` | string | link to an external channel message |
| `completed`, `cancelled`, `error` | boolean / any | create pre-finished |
| `processAt` / `processIn` | ISO date / ms | schedule |
| `wait` | boolean | `next_processing = NULL` |
| `singleton` | boolean | if an unfinished interaction with the same `toService` + `action` exists, return without creating a new one |
| *anything else* | — | stored in `options` JSONB and merged back into the returned object |

Creates the row, re-queues the parent if the new interaction is already completed, emits `ia.new`.

#### Read API

- `get({id})` → `Promise<interaction | null>`
- `getChildren({parentId, name?, limit?})` → `Promise<interaction[]>`
- `getByMessageId({messageId})` → `Promise<interaction | null>` — returns the **earliest** interaction with that message id.

#### `_update(args)` → `Promise<void>`

Internal method (the leading underscore is deliberate). Accepts `id` plus any of `completed`, `cancelled`, `error`, `processAt`, `processIn`, `parentId`, `messageId` and arbitrary extra props (rewritten into `options`). It releases the lock, and — for completed `innerAction` children — re-queues the parent.

#### `process(args)` → `stopProcess()`

Starts a processing loop for one queue and returns an async `stopProcess()` that resolves only after all in-flight handlers finish.

| Argument | Default | Meaning |
|---|---|---|
| `toService` (required) | — | queue to consume (optionally narrowed by `action`) |
| `processor` (required) | — | `async (interaction) => {...}` — mutate `interaction.completed`, `.error`, `.processIn`, … |
| `interval` | `1000` | ms window for `maxPerInterval` |
| `maxPerInterval` | — | rate limit: max claims per `interval` |
| `maxInParaller` | `4` | max concurrent handlers (the misspelling is part of the public API) |
| `lockPeriod` | `30000` | lease duration, ms (must be `> relockPeriod`) |
| `relockPeriod` | `15000` | lease-extension period, ms |
| `regularCheckPeriod` | `500` | idle polling period, ms — temporarily lowered from `20000` until Postgres push notifications are wired up |
| `maxProcessingTime` | `300000` | emit `ia.tooLong` if a handler runs longer, ms |
| `errorHandler`, `debug` | — | extra error hook / verbose lease logging |

Loop behaviour:

1. Claim the oldest ready, unlocked, unfinished row for `toService` (and `action`) — a single atomic `UPDATE ... WHERE id = (SELECT ... FOR UPDATE) RETURNING *`.
2. Immediately try to claim another row (pipelining up to `maxInParaller`).
3. Run the handler, then persist via `_update` and emit `ia.start` / `ia.end`.
4. On handler error: report to `bus.error` and the optional `errorHandler` — the error never crashes the loop.
5. When nothing is claimable, arm `regularCheckPeriodTimer` and wake up later.
6. `stopProcess()` stops new claims but lets running handlers drain.

Service-name prefixing: in this variant every `fromService` / `toService` is rewritten by `_fixServiceName.js` to `` `${config.node}/${name}` ``, so queues are namespaced per node/deployment.

### Test-mode hooks

With `testMode.interaction = true` the loop exposes `process._runAndAwaitAsyncs()`, which drains a queue of pending async steps; handlers then receive a second `testProcessFinished(err?)` callback. Together with `sinon.useFakeTimers()` and a Postgres wrapper that follows the fake clock, this makes the whole scheduling/locking behaviour deterministically testable.

---

## Variant 2 — `pg-interactions-with-session`

Everything from variant 1, plus **sessions**: a persistent, exclusively-locked conversation context per user.

### Schema

- `001 Create Session.sql` — `session(id nanoid PK, bot, channel, user_id, created, last_seeing, active, lock, options JSONB)` with indexes on `(channel, user_id)`, `last_seeing`, `active`.
- `002 Create Interaction.sql` — the same interaction table **plus `session_id`** with a DEFERRABLE FK to `session` and an extra index on it.

### Differences from variant 1

| Aspect | without-session | with-session |
|---|---|---|
| Session | — | `sessionId` is **required** in `create()`; every interaction belongs to a session |
| Returned interaction | base fields | also `sessionId`, `bot`, `channel`, `userId` (joined from `session`) |
| `create()` | supports `singleton` | no `singleton`; inserts through a CTE that joins the session |
| Service names | prefixed via `_fixServiceName` (`node/name`) | used as-is |
| `context` | passed through | generated as `nanoid()` per processing run |
| Claim query | `UPDATE ... RETURNING *` | CTE that also returns `s.bot, s.channel, s.user_id, now() AS _time` |
| Extra service | — | `sessions` (see below) |

### `sessions` service (`sessions/index.js`)

#### `get({id})` → session or `null`

#### `lock(args)` → `Promise`

Resolves when `processor(session)` completes. Either **`id`** *or* **`bot` + `channel` + `userId`** must be given (the schema enforces XOR):

1. Find the session `FOR UPDATE` (by id, or the most recently seen *active* session for `bot/channel/userId`).
2. If it does not exist — create it (`nanoid()` id) — unless an explicit `id` was requested (then throw).
3. If it is locked by someone else, call `lockAttemptFailed()` and retry every `lockCheckPeriod` ms (default `300`).
4. Once acquired: `lock = now() + lockPeriod`, then run `processor(session)` **outside** the DB transaction while a timer re-extends the lease every `relockPeriod` ms (`lockExtended()` fires on each extension).
5. If `shouldCompleteSession(session)` returns true (and no explicit `id` given), mark the session `active = false` and start a fresh one.
6. On completion: persist `options` (+ `active` if flipped), refresh `last_seeing`, release the lock, resolve.

Defaults are shared with the interaction engine: `lockPeriod = 30000`, `relockPeriod = 15000`, `lockCheckPeriod = 300`. The same fake-clock test hooks exist (`testMode.session`, `_runAndAwaitAsyncs()`).

> Note: `useEvents` is declared in `lock_args` (intended for `pg_notification` wake-ups) but is **not implemented yet** — waiters currently poll.

---

## Variant 3 — `mongo-interactions-as-tasks`

A self-contained MongoDB implementation of the same concept, where an interaction is a **task** whose behaviour is a JavaScript file.

### Task model (`taskModel.js`, collection `taskV1`)

| Field | Meaning |
|---|---|
| `script` | relative path to the module implementing the task |
| `parent` | task that created this one; re-queued (`runAt = now + 1ms`) when this task completes |
| `runAt` | earliest next run; absent = nothing to do |
| `locked_till` | lease expiry — the runner only claims tasks where it is not in the future |
| `arguments` | immutable initial state (every retry starts from it) |
| `state` | mutable state carried between runs and handed to the code as `this` |
| `started` / `done` / `error` | attempt bookkeeping |
| `attempts[]` | history of failed attempts (state, timings, error); only present after a retry |

Indexes: a TTL index on `updatedAt` (**36 hours** — the code comment says "7 days", but `expireAfterSeconds: 36 * 60 * 60`) and a compound `{done, runAt, locked_till, updatedAt}` index for the claim query. Connection comes from `MONGODSN_TASKS` or `MONGODSN` (`tasksConnection.js`).

### Task contract

```js
// examples/demoTask.js
const path = require('path');

demoTask.script = path.relative(process.cwd(), __filename).replace(/\\/g, '/');

demoTask.shouldRetry = (error, attemptNumber) => ({
  retry: !!(error.code || error.response),   // or retryInNSeconds / retryAtTime
});

async function demoTask(attemptNumber) {
  this.n = (this.n || 0) + 1;   // `this` is the persisted task state
  return {done: true};
}
module.exports = demoTask;
```

The return value is validated with Joi and must be **exactly one of**:

| Result | Effect |
|---|---|
| `{done: true}` | task finished (`done` set, `runAt` removed) |
| `{runInNSeconds: n}` | reschedule relative to now |
| `{runAtTime: Date}` | reschedule at an absolute time |
| `{waitForChildTask: true}` | clear `runAt` and wait to be woken by a completing child |

On a thrown error, `shouldRetry(error, attemptNumber)` decides: `{retry}` / `{retryInNSeconds}` / `{retryAtTime}` (Joi `xor`). A retry archives the current attempt into `attempts[]` and **resets `state` to `arguments`**; giving up stores a serializable `error` (message / code / status / method / url / stack) on the task.

### Runner (`runner.js`)

- Spawns up to `MAX_TASK_RUNNERS` child processes (1 when `NODE_ENV` is set, otherwise 2) and respawns them if they die; can also be started from the CLI (`node runner.js`).
- `MAX_PARALLEL_TASKS` concurrent handlers per runner (4 in an environment, 8 otherwise).
- Claim: `findOneAndUpdate({runAt <= now, locked_till not in future, done: {$exists: 0}}, {$set: {locked_till: now + LEASING_PERIOD}}, {sort: {updatedAt: 1}})` — oldest task first, so its resources are likely still cached. Must run with **primary read preference** to avoid reading stale replica-set data.
- Lease: `LEASING_PERIOD = 15s`, extended every `LOCK_AHEAD_PERIOD = 7s` while the handler runs; idle poll `REGULAR_CHECK_PERIOD = 3s`.
- Handlers are `require()`d from disk and invoked as `task.call(state, attemptNumber)`.
- After each step the update is guarded with `{_id, runAt: taskRecord.runAt}` — a compare-and-set so a child that just woke the parent is not overwritten. If the CAS matches nothing, the update is retried without touching `runAt`.
- When a task with a `parent` completes, the parent is re-queued at `now + 1ms`.
- Errors are logged via `utils/log` and never kill the loop.

### Examples (`examples/`)

- `demoTask.js` — minimal task plus `shouldRetry` variants.
- `parentTask.js` + `childrenTask.js` — a fan-out/fan-in workflow: the parent spawns 6 children, returns `{waitForChildTask: true}`, then on each wake-up checks whether all children are `done` before finishing itself.
- `nextUTCTime.js` (at the variant root) — helper returning the next occurrence of a UTC wall-clock time (for daily jobs).

---

## Tests

The PG suites (`interactions/index.test.js`) use **ava + sinon fake timers** against a real PostgreSQL database. `beforeEach` rebuilds the schema, registers bus events, and boots a `NodeManager` with `testMode: {postgres: true, interaction: true}` (or `session: true`) so that DB time follows the fake clock.

Numbered files map 1:1 to the requirement list in `interactions/README.md`:

| File | Covers |
|---|---|
| `01_createComplete` | create / complete / fail / cancel / `processAt` / `processIn` (1.1–1.7) |
| `02_intenceStreamOfInteractions` | ordered draining, `maxInParaller`, `maxPerInterval` (2.x) |
| `03_awaitForInteractions` | idle loop + `regularCheckPeriod` wake-ups (3.x) |
| `04_postgresPubSub` | *(empty — push notifications not implemented)* |
| `05_locking` | lease take-over, extension, expiry (5.x) |
| `06_parentChildInteractions` | parent re-queue on child completion (6.1, 6.5; **6.2–6.4 skipped**) |
| `07_stopProcessing` | graceful `stopProcess()` drain (7.1) |
| `08_errorProcessing` | retry after handler error (8.1; **8.2 is `todo`**) |
| `09_reportToBus` | *(empty)* |
| `10_messageId` | `getByMessageId` returns the earliest match |

The `sessions` suite covers session creation, mutation under lock, lock contention (`lockAttemptFailed`, `lockExtended`), lease extension and expiry.

> These tests cannot run from this repository alone: they import the external `common` framework, a `postgres` service wrapper and `config` settings that belong to the host application.

---

## Known limitations & backlog

Taken from `TODO`s, skipped tests and comments in the code:

**Postgres variants**

- No Postgres push notifications yet (`pg_notification` / triggers): `regularCheckPeriod` is pinned to `500 ms` instead of `20 s`, `04_postgresPubSub._test.js` is empty, and `sessions.lock({useEvents})` is a no-op.
- Cancelling a parent does not cascade to unfinished children (6.2), child lookup ordering guarantees (6.3–6.4), bus-reporting tests (9.x) and the processing-timeout cancel (8.2) are unimplemented/skipped.
- Refactoring backlog (see `interactions/README.md`): flatten `create()` parameters, add a "source" field so messages can be gathered per branch, rename `channel`/`userId` in DB + code, finish validation of nested structures.
- Small code smells worth knowing about: `typeof error !== null` is always `true` (should be `error !== null`), the session variant's `_reportError` references an undefined `err` when the error is not an `Error` instance, and `maxInParaller` is misspelled throughout the public API.

**Mongo variant**

- No transactions: the code comments document a real race where a failed update can leave a task in an inconsistent state (neither `runAt` nor `done`); the compare-and-set on `runAt` is a partial mitigation.
- The TTL comment ("7 days") does not match the actual 36-hour expiry.
- Parent wake-up assumes `now + 1ms` is enough to change `runAt` — an acknowledged hack.

---

## Layout

```
interactions/
├── pg-interactions-without-session/
│   ├── 001 create interaction.sql        # schema (Up/Down migrations)
│   ├── README.md                         # numbered requirement list (RU)
│   └── interactions/
│       ├── index.js                      # service assembly
│       ├── index.schema.js               # validation + tunable defaults
│       ├── index.events.js               # bus event registration
│       ├── create.js / update.js         # write paths
│       ├── get.js / getChildren.js / getByMessageId.js
│       ├── process.js                    # leasing processing loop
│       ├── _rowToInteraction.js          # DB row → API object
│       ├── _states.js / _defaults.js / _fixServiceName.js
│       └── 01..10 *_test.js, index.test.js, createDb._test.js
├── pg-interactions-with-session/
│   ├── 001 Create Session.sql
│   ├── 002 Create Interaction.sql
│   ├── sessions/                         # sessions service (lock/get) + tests
│   └── interactions/                     # interaction engine (session-aware)
└── mongo-interactions-as-tasks/
    ├── taskModel.js                      # Mongoose schema + indexes
    ├── runner.js                         # claim/lease/retry/parent-wake loop
    ├── tasksConnection.js                # mongoose connection
    ├── nextUTCTime.js                    # daily-schedule helper
    └── examples/                         # demoTask, parentTask, childrenTask
```

---

## Further reading

- [`innervate-ru/common`](https://github.com/innervate-ru/common) — the service framework (`services`, `bus`, `validation`, `events`, `NodeManager`) these implementations are built on.
- `pg-interactions-*/interactions/README.md` — the original numbered behavioural specification (Russian) that the tests implement.
