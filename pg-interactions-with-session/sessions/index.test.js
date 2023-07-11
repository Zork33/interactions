import path from 'path'
import test from 'ava'
import sinon from 'sinon'
import {createDb, rebuildDbSchema} from './createDb._test'

/**
 * Метод, возвращающий новый promise и методы корыми его можно перевести в состояния resolved или rejected.  Метод reject
 * обернут, чтобы его можно было вставлять в catch, и при этом результирующий promise тоже получал ошибку.
 */
function testPromise() {
  let resolve, reject;
  const promise = new Promise(function (_resolve, _reject) {
    resolve = _resolve;
    reject = _reject;
  });
  return {
    promise, resolve, reject: (err) => {
      reject(err);
      return Promise.rejected(err);
    }
  };
}

// 1. переходим на логическое время
// 2. создаем новую пустую схему БД
// 3. регистрируем события из файлов .events.js
// 4. создаем тестовую инстанцию сервиса data/interactions (см. testMode = true), чтобы при работе с БД использовалось логическое время
test.beforeEach(async t => {

  // использование sinon.useFakeTimers вырубает .timeout(...) в Promise и для ava тестов, потому нужен собственный метод, который работает с настоящим setTimeout
  // и за одно создаем t.context.promiseErrorHandler, который надо добавлять в виде .catch(t.context.promiseErrorHandler) в вызовы async методов, которые вызываются без await
  const realSetTimeout = setTimeout;
  const realClearTimeout = clearTimeout;
  const {promise: errorPromise, resolve: errorResolve} = testPromise();
  t.context.promiseErrorHandler = errorResolve;
  t.context.awaitWithTimeout = (promise) => {
    return new Promise((resolve, reject) => {
      const timer = realSetTimeout(() => {
        reject(new Error('too long'));
      }, 3000);
      const onError = (err) => {
        realClearTimeout(timer);
        reject(err)
      };
      errorPromise.then(onError);
      promise.then((res) => {
        realClearTimeout(timer);
        resolve(res);
      }, onError);
    });
  };

  t.context.clock = sinon.useFakeTimers();

  // await createDb();
  await rebuildDbSchema();

  const consoleAndBusServicesOnly = Object.create(null);
  consoleAndBusServicesOnly.testMode = {postgres: true, session: true};
  consoleAndBusServicesOnly.console = t.context.testConsole = new (require('../../../common/utils/testConsole').default)();
  const bus = consoleAndBusServicesOnly.bus = new (require('../../../common/events').Bus(consoleAndBusServicesOnly))({nodeName: 'test'});

  const eventLoader = require('../../../common/services/defineEvents').default(consoleAndBusServicesOnly);
  await eventLoader(path.join(process.cwd(), 'src'));

  const manager = t.context.manager = new (require('../../../common/services').NodeManager(consoleAndBusServicesOnly))({
    name: 'test',
    services: [
      require('../../postgres'),
      require('./index'),
    ],
  });

  await manager.started;
});

test.afterEach(t => {
  t.context.clock.restore();
});

test.serial(`Создание новой сессии`, async t => {

  const {'data/sessions': dataSessions} = t.context.manager.services;

  let _session;

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
      _session = session;
    }
  }));

  dataSessions._runAndAwaitAsyncs();

  t.deepEqual(_session, {
    _time: '1970-01-01T00:00:00.000Z',
    id: _session.id,
    bot: 'testBot',
    channel: 'web',
    userId: 'clientId',
    active: true,
    created: '1970-01-01T00:00:00.000Z',
    lastSeeing: '1970-01-01T00:00:00.000Z',
  });

});

test.serial(`Измененеие с блокировкой, существующей сесиии`, async t => {

  const {'data/sessions': dataSessions} = t.context.manager.services;

  let _session;

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
      session.key = '123';
      _session = session;
      t.context.clock.tick(100);
    }
  }));

  t.context.clock.tick(100);
  // dataSessions._runAndAwaitAsyncs(); - process() срабатывает в рамках превой попытки в .lock()

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
      t.is(session.key, '123');
      t.deepEqual(session, {..._session, lastSeeing: '1970-01-01T00:00:00.100Z', _time: '1970-01-01T00:00:00.200Z'});
      session.messages = ['Hi!'];
      _session = session;
      t.context.clock.tick(100);
    }
  }));

  t.context.clock.tick(100);

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
      t.deepEqual(session, {..._session, lastSeeing: '1970-01-01T00:00:00.300Z', _time: '1970-01-01T00:00:00.400Z'});
    }
  }));
});

test.serial.todo(`Выбор из нескольких сессий только активной.  На случай сбоя, ту которую меняли последней`);

for (const existingSession of [true, false])
  test.serial(`Ожидание новой сессии, которая уже заблокированна [existingSession: ${existingSession}]`, async t => {

    const {'data/sessions': dataSessions, postgres} = t.context.manager.services;

    if (existingSession) // просто создаем сессию, а дальше та же пользовательская логика, как для новой сессии
      await t.context.awaitWithTimeout(dataSessions.lock({
        bot: 'testBot',
        channel: `web`,
        userId: `clientId`,
        lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
        processor: async(session) => {
        }
      }));

    const {promise: processResultPromise, resolve: processResultPromiseResolve} = testPromise(); // пока не будет вызван этот метод, первый вызов lock() будет в процессе ожидания когда processor() завершит работу
    const {promise: processStartedPromise, resolve: processStartedResolve} = testPromise();

    let _session;

    let {promise: lockExtendedPromise, resolve: lockExtendedPromiseResolve} = testPromise();

    const firstLockPromise = dataSessions.lock({
      bot: 'testBot',
      channel: `web`,
      userId: `clientId`,
      lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
      async processor(session) {
        _session = session;
        processStartedResolve();
        session.num = 12;
        return processResultPromise;
      },
      lockExtended() {
        lockExtendedPromiseResolve();
      }

    }).catch(t.context.promiseErrorHandler);

    await t.context.awaitWithTimeout(processStartedPromise); // ждем когда сессия будет созданна и заблокированна ...или произойдет ошибка

    // Заблокированно на 1000ms, продление блокировки в через 600ms
    t.is((await t.context.awaitWithTimeout(postgres.exec({statement: `select * from session where id = '${_session.id}';`}))).rows[0].lock.toJSON(), `1970-01-01T00:00:01.000Z`);

    let failedLockCount = 0, gotSession = false;
    const {promise: successLockPromise, resolve: successLockPromiseResolve} = testPromise();
    let {promise: failedLockPromise, resolve: failedLockPromiseResolve} = testPromise();

    const secondLockPromise = dataSessions.lock({ // пробуем параллельно получить доступ к сессии, когда она заблокированна
      bot: 'testBot',
      channel: `web`,
      userId: `clientId`,
      lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
      async processor(session) {
        gotSession = true;
        successLockPromiseResolve();
        t.is(session.num, 12);
      },
      lockAttemptFailed() {
        failedLockCount++;
        failedLockPromiseResolve();
      },
    })
      .catch(t.context.promiseErrorHandler);

    await t.context.awaitWithTimeout(failedLockPromise);
    ({promise: failedLockPromise, resolve: failedLockPromiseResolve} = testPromise());

    t.context.clock.tick(100); // 100ms: lockCheckPeriod: 100 - проверка каждые 100ms
    t.false(gotSession);
    t.is(failedLockCount, 1);

    await t.context.awaitWithTimeout(failedLockPromise);
    ({promise: failedLockPromise, resolve: failedLockPromiseResolve} = testPromise());

    t.context.clock.tick(500); // 600ms
    t.false(gotSession);
    t.is(failedLockCount, 2);

    await t.context.awaitWithTimeout(lockExtendedPromise);
    ({promise: lockExtendedPromise, resolve: lockExtendedPromiseResolve} = testPromise());

    // Заблокированно до 1600ms (600 + 1000), следующее продление блокировки в через 600ms
    t.is((await t.context.awaitWithTimeout(postgres.exec({statement: `select * from session where id = '${_session.id}';`}))).rows[0].lock.toJSON(), `1970-01-01T00:00:01.600Z`);

    t.context.clock.tick(600);
    t.false(gotSession);
    t.is(failedLockCount, 3);

    await t.context.awaitWithTimeout(lockExtendedPromise);
    ({promise: lockExtendedPromise, resolve: lockExtendedPromiseResolve} = testPromise());

    // Заблокированно до 2200ms (600 + 1600), следующее продление блокировки в через 600ms
    t.is((await t.context.awaitWithTimeout(postgres.exec({statement: `select * from session where id = '${_session.id}';`}))).rows[0].lock.toJSON(), `1970-01-01T00:00:02.200Z`);

    processResultPromiseResolve(); // завершаем блокировку из начала теста
    await t.context.awaitWithTimeout(firstLockPromise); // ждем когда метод lock доработает ...или ошибку

    // блокировка снята - lock равен текущему времени
    t.is((await t.context.awaitWithTimeout(postgres.exec({statement: `select * from session where id = '${_session.id}';`}))).rows[0].lock.toJSON(), `1970-01-01T00:00:01.200Z`);

    t.context.clock.tick(100); // повторяем попытку ещё раз заблокировать.  теперь должно быть успешно
    t.false(gotSession);
    t.is(failedLockCount, 4);

    await t.context.awaitWithTimeout(successLockPromise); // ждем когда сработает метод processor у второй попытки заблокировать

    await secondLockPromise; // ждем когда вторая блокировка закончит работу
  });

test.serial(`Завершение сессии через метод shouldComleteSession`, async t => {

  const {'data/sessions': dataSessions, postgres} = t.context.manager.services;

  let _session;

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
      _session = session;
    }
  }));

  let callCount = 0;
  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    shouldCompleteSession: async (session) => {
      return true;
    },
    processor: async(session) => {
      ++callCount;
      t.not(session, _session);
    }
  }));

  t.is(callCount, 1);
});

test.serial(`Завершение сессии через возврат признака active = false из метода processor`, async t => {

  const {'data/sessions': dataSessions, postgres} = t.context.manager.services;

  let _session;

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
      _session = session;
      session.active = false;
    }
  }));

  let callCount = 0;
  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    shouldCompleteSession: async (session) => {
      return true;
    },
    processor: async(session) => {
      ++callCount;
      t.not(session, _session);
    }
  }));

  t.is(callCount, 1);
});

test.serial(`Сессию можно прочитать через dataSessions.get без блокировки`, async t => {

  const {'data/sessions': dataSessions, postgres} = t.context.manager.services;

  let _session;

  const {promise: processResultPromise, resolve: processResultPromiseResolve} = testPromise();
  const {promise: processStartedPromise, resolve: processStartedResolve} = testPromise();

  const firstLockPromise = dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    async processor(session) {
      _session = session;
      processStartedResolve();
      return processResultPromise;
    },
  }).catch(t.context.promiseErrorHandler);

  await t.context.awaitWithTimeout(processStartedPromise); // ждем когда сессия будет созданна и заблокированна ...или произойдет ошибка

  const s1 = await dataSessions.get({id: _session.id}); // можно выполнить get когда сессия заблокированна другими процессом

  t.not(s1, _session);
  t.deepEqual(s1, _session);

  processResultPromiseResolve();
  await t.context.awaitWithTimeout(firstLockPromise); // разблокируем

  const s2 = await dataSessions.get({id: _session.id}); // можно выполнить get когде сессия не заблокированна.  и она при этом не блокируется.

  t.not(s2, s1);
  t.deepEqual(s1, s2);

});

test.serial(`Правильно проверять сколько прошло с момента последнего использования сессии, используя session._time`, async t => {

  const {'data/sessions': dataSessions} = t.context.manager.services;

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
    }
  }));

  dataSessions._runAndAwaitAsyncs();

  t.context.clock.tick(10000); // 100ms: lockCheckPeriod: 100 - проверка каждые 100ms

  let _session;
  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: `web`,
    userId: `clientId`,
    lockPeriod: 1000, relockPeriod: 600, lockCheckPeriod: 100,
    processor: async(session) => {
      _session = session;
    }
  }));

  dataSessions._runAndAwaitAsyncs();

  t.is(new Date(_session._time).getTime() - new Date(_session.lastSeeing).getTime(), 10000);

});
