# Zork Open Source — Projects

Overview of the repositories in this workspace. They form a stack: a declarative document model
(`hope`), a service framework (`common`), reference implementations (`interactions`), and two
applications built on the same ideas (`DSCommon`, `webprofy-rms`).

| Project | GitHub | Tech | Status |
|---|---|---|---|
| [common](#common) | [innervate-ru/common](https://github.com/innervate-ru/common) | Node.js (ES modules) | active |
| [hope](#hope) | [delightsoft/hope](https://github.com/delightsoft/hope) | CoffeeScript 2 / JS | active |
| [interactions](#interactions) | [Zork33/interactions](https://github.com/Zork33/interactions) | Node.js, PostgreSQL / MongoDB | reference |
| [DSCommon](#dscommon) | [delightsoft/DSCommon](https://github.com/delightsoft/DSCommon) | Java, Play Framework 1.x, AngularJS | legacy |
| [webprofy-rms](#webprofy-rms) | [Zork33/webprofy-rms](https://github.com/Zork33/webprofy-rms) | CoffeeScript, AngularJS 1.3, Gulp | legacy |

---

## common

**https://github.com/innervate-ru/common**

Shared Node.js runtime library for the Zork service platform — dropped into a host project at
`src/common/`. Provides a service container with a lifecycle state machine and dependency
injection, a typed event bus with Graylog logging, a document/ORM layer (`hope/`) over
PostgreSQL, GraphQL schema builders, database connectors (PG, MsSql, Dgraph, SOAP), JWT session
auth, Express/HTTP plumbing, monitoring counters and health endpoints, a SQL migration runner
(`evolutions`), runtime validators and misc utilities.

No `package.json` by design — dependencies come from the host project.
See [common/README.md](common/README.md) and [common/README.detailed.md](common/README.detailed.md).

## hope

**https://github.com/delightsoft/hope**

Declarative document-model framework for JavaScript data layers, written in CoffeeScript 2.
You declare the business domain once (plain JSON/JS structures) and the library compiles it into
an immutable, deeply frozen runtime config with generated methods attached to every field
collection: `$$new`, `$$fix`/`$$get`/`$$set`, `$$access`/`$$rights` (per-user permission masks),
`$$validate`, `$$calc` (tag-based field queries). Programmer mistakes throw; data mistakes are
collected as messages in a universal `Result` object. The compiled config is serializable, so the
same model can run on a server and in a browser.

`common/hope/` is the service-layer integration of this framework.

## interactions

**https://github.com/Zork33/interactions**

Reference implementations of an *interaction* — a durable, schedulable unit of work — for
distributed services built on the `common` framework. An interaction is a database row meaning
"service A asks service B to do action X at time T"; rows form parent/child trees, are leased
with row locks so many nodes can consume one queue safely, report lifecycle on the event bus and
survive restarts.

Three independent variants: `pg-interactions-without-session` (core, PostgreSQL),
`pg-interactions-with-session` (+ `session` table and per-user `sessions.lock()`), and
`mongo-interactions-as-tasks` (standalone Mongoose engine). Extracted from production as
examples; tests double as the specification.

## DSCommon

**https://github.com/delightsoft/DSCommon**

Library and Play Framework 1.x plugin providing reusable document and workflow functionality:
declarative document types, fields, actions, roles and messages defined in YAML; JPA/Hibernate
persistence with versioning; a document HTTP API; configurable access control; and an AngularJS
client (CoffeeScript) with reusable forms, tables and field widgets. Dev-mode tooling at
`/@docflow` and `/@sql`.

The Java/CoffeeScript predecessor of the `hope` + `common` stack.

## webprofy-rms

**https://github.com/Zork33/webprofy-rms**

Resource Management System — a single-page app for resource and workload planning on top of
[Teamwork PM](https://www.teamwork.com/). Visualises people, projects and tasks over a calendar,
supports drag-and-drop scheduling, time tracking with undo of pending edits, and Excel export.
Client-only: no backend of its own, state lives in `localStorage`/IndexedDB. CoffeeScript +
Gulp/Browserify, Jade templates, Sass, AngularJS 1.3. Live instance:
[rms.webprofy.ru](http://rms.webprofy.ru).

---

### Relationship between the projects

```
hope (document model core)
  └─ common (services, bus, HTTP, connectors; embeds hope integration)
       └─ interactions (durable work units on top of common)

DSCommon (Play 1.x + AngularJS original) ── inspired ──► hope / common
webprofy-rms (AngularJS 1.3 app)         ── same era/stack as DSCommon client ──
```
