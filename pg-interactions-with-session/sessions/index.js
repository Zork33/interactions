import {oncePerServices, missingService} from '../../../common/services'
import {nanoid} from 'nanoid'

export const name = require('../../../common/services/serviceName').default(__filename);

const schema = require('./index.schema');

export default oncePerServices(function (services) {

  const {
    postgres = missingService('postgres'),
    testMode,
  } = services;

  const isTestMode = testMode && testMode.session;
  let testAsyncQueue = [];

  const testAwait = !isTestMode ?
    function (asyncStep) {
      return asyncStep();
    }
    : /*async*/ function (asyncStep) {
    // в отладочном режиме, возвращаем promise, который выполнится только когда метод выполняемый в asyncStep будет выполнен в <service>._runAndAwaitAsyncs
    return new Promise(function (resolve, reject) {
      testAsyncQueue.push(
        /*async*/ function () {
          return asyncStep().then(resolve, (err) => {
            reject(err);
            return Promise.rejected(err);
          });
        }
      )
    });
  };

  class DataSession {

    async get(args) {
      schema.get_args(args);

      const r = await postgres.exec({
        statement: `select *, now()::timestamp as _time from session where id = $1;`,
        params: [args.id]
      });

      return r.rowCount === 0 ? null : rowToSession(r.rows[0]);
    }

    async lock(args) {
      schema.lock_args(args);

      const {
        id,
        bot,
        channel, userId,
        lockPeriod = schema.DEFAULT_LOCK_PERIOD,
        relockPeriod = schema.DEFAULT_RELOCK_PERIOD,
        lockCheckPeriod = schema.DEFAULT_LOCK_CHECK_PERIOD,
        shouldCompleteSession,
        processor,
        lockAttemptFailed,
        lockExtended,
        created,
        lastSeeing,
        ...options
      } = args;
      let resolved, rejected, timer = null, relockTimer;

      // TODO: Сделать setTimeout для сервиса, который умеет обрабатывать ошибки и отправлять их в bus
      // TODO: Сделать при запуске .lock, чтоб process начинался по setTimeout 0, и тогда тест разблокируется

      // функции работающие по setTimeout часть логики этого метода, и соотвественно если в них происходит ошибка, то её надо вернуть как ошибку этого метода

      // const serviceSetTimeout = (method, timeout) => setTimeout(() => method().catch(rejected), timeout);

      const serviceSetTimeout = (method, timeout) => {
        return setTimeout(() => {
          method().catch(rejected);
        }, timeout);
      };

      async function process() {

        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        let connection = await postgres.connection();
        let session;
        try {
          const r = await findSessionForUpdate(connection, {id, bot, channel, userId});
          if (r) {
            if (r.locked) {
              if (lockAttemptFailed) lockAttemptFailed();
              timer = serviceSetTimeout(process, lockCheckPeriod);
              return;
            }
            session = await lockAttempt(connection, r.id, lockPeriod);
            if (!session) {
              timer = serviceSetTimeout(process, lockCheckPeriod);
              return;
            }

            // если не указан явно id сессии и наступил момент завершения сессии, то завершаем сессию,
            // и начинаем новую - вызываем process()
            if (!id && shouldCompleteSession && await shouldCompleteSession(session)) {
              await completeSession(connection, session.id);
              await process();
              return;
            }
          } else {
            if (id !== undefined) {
              throw new Error(`Session with id ${id} not found`);
            } else {
              session = await createNewSession(connection, {bot, channel, userId}, lockPeriod);
            }
          }

          // ставим таймер на продление блокировки
          async function extendLockTime() {
            await extendLock(postgres, session.id, lockPeriod);
            relockTimer = serviceSetTimeout(extendLockTime, relockPeriod);
            if (lockExtended) lockExtended();
          }

          relockTimer = serviceSetTimeout(extendLockTime, relockPeriod);

          await connection.end();
          connection = null;

          // работаем с логически заблокированной сессией, без блокировки записи в БД
          await processor(session);

          clearTimeout(relockTimer);
          relockTimer = null;

          connection = await postgres.connection();

          await saveAndUnlockSession(connection, session);

          resolved();

        } finally {
          if (connection && session) await unlockSession(connection, session.id);
          if (relockTimer != null) clearTimeout(relockTimer);
          if (connection) await connection.end();
        }
      }

      const resultPromise = new Promise(function (_resolved, _rejected) {
        resolved = _resolved;
        rejected = _rejected;
      });

      await process(); // запускаем первый шаг

      return resultPromise;
    }
  }

  const service = new (require('../../../common/services').Service(services)(DataSession))(name, {dependsOn: [postgres]});

  if (isTestMode) {
    // ожидаем выполнение всех ранее добавленных в очередь testAsyncQueue операций
    service._runAndAwaitAsyncs = async () => {
      if (testAsyncQueue.length === 0) return;
      const promises = testAsyncQueue.map(f => f());
      const r = await Promise.all(promises);
      testAsyncQueue = [];
      return r;
    }
  }

  return service;
})

function rowToSession(row) {
  const r = Object.assign(Object.create(null), row.options);
  r.id = row.id;
  r.bot = row.bot;
  r.channel = row.channel;
  r.userId = row.user_id;
  r.active = row.active;
  r.created = row.created.toJSON();
  r.lastSeeing = row.last_seeing.toJSON();
  r._time = row._time.toJSON();
  return r;
}

async function createNewSession(connection, {bot, channel, userId, options}, lockPeriod) {
  const r = await connection.exec({
    statement: `with s as (insert into session (id, bot, channel, user_id, options, lock, created, last_seeing) ` +
    `values ($1, $2, $3, $4, $5, now()::timestamp + (${lockPeriod} * interval '1 ms'), now()::timestamp, now()::timestamp) ` +
    `returning *) select s.*, now()::timestamp as _time from s;`,
    params: [nanoid(), bot, channel, userId, options],
  });
  return rowToSession(r.rows[0]);
}

async function saveAndUnlockSession(connection, session) {

  const {id, bot, channel, userId, active, created, lastSeeing, _time, ...options} = session;

  const params = [
    id,
    options,
  ];

  let extra = '';

  if (typeof active === 'boolean' && !active) {
    extra = ', active = false';
  }

  const r = await connection.exec({
    statement: `update session set options = $2${extra}, lock = now()::timestamp, last_seeing = now()::timestamp where id = $1;`,
    params,
  });
}

async function findSessionForUpdate(connection, {id, bot, channel, userId}) {
  let r;
  if (id !== undefined) {
    r = await connection.exec({
      statement: `select id, lock > now()::timestamp as locked from session where id = $1 for update;`,
      params: [id],
    });
  } else {
    r = await connection.exec({
      statement: `select id, lock > now()::timestamp as locked from session where bot = $1 and channel = $2 and user_id = $3 and active = true order by last_seeing for update;`,
      params: [bot, channel, userId],
    });
  }
  if (r.rowCount > 0) return {id: r.rows[0].id, locked: r.rows[0].locked};
}

async function lockAttempt(connection, sessionId, lockPeriod) {
  const r = await connection.exec({
    statement: `with s as (update session set lock = now()::timestamp + (${lockPeriod} * interval '1 ms') where id = $1 and lock <= now()::timestamp ` +
    `returning *) select s.*, now()::timestamp as _time from s;`,
    params: [sessionId],
  });
  if (r.rowCount > 0) return rowToSession(r.rows[0]);
}

/*async*/
function extendLock(postgres, sessionId, lockPeriod) {
  return postgres.exec({ // продление выполняется в отдельном соединении, чтобы не держать соединение и запись заблокированными
    statement: `update session set lock = now()::timestamp + (${lockPeriod} * interval '1 ms') where id = $1;`,
    params: [sessionId],
  });
}

/*async*/
function unlockSession(connection, sessionId) {
  return connection.exec({
    statement: `update session set lock = now()::timestamp  where id = $1;`,
    params: [sessionId],
  });
}

/*async*/
function completeSession(connection, sessionId) {
  return connection.exec({
    statement: `update session set active = false where id = $1;`,
    params: [sessionId]
  });
}
