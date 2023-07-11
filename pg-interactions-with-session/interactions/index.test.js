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
      }, 5000);
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
  consoleAndBusServicesOnly.testMode = {postgres: true, interaction: true};
  consoleAndBusServicesOnly.console = t.context.testConsole = new (require('../../../common/utils/testConsole').default)();
  const bus = consoleAndBusServicesOnly.bus = new (require('../../../common/events').Bus(consoleAndBusServicesOnly))({nodeName: 'test'});

  const eventLoader = require('../../../common/services/defineEvents').default(consoleAndBusServicesOnly);
  await eventLoader(path.join(process.cwd(), 'src'));

  const manager = t.context.manager = new (require('../../../common/services').NodeManager(consoleAndBusServicesOnly))({
    name: 'test',
    services: [
      require('../../postgres'),
      require('../sessions'),
      require('./index'),
    ],
  });

  await t.context.awaitWithTimeout(manager.started);

  const {'data/sessions': dataSessions} = manager.services;

  await t.context.awaitWithTimeout(dataSessions.lock({
    bot: 'testBot',
    channel: 'webChat',
    userId: '123',
    processor: session => {
      t.context.session = session;
    }
  }));

});

test.afterEach(t => {
  t.context.clock.restore();
});

require('./01_createComplete._test');
require('./02_intenceStreamOfInteractions._test');
require('./03_awaitForInteractions._test');
require('./04_postgresPubSub._test');
require('./05_locking._test');
require('./06_parentChildInteractions._test');
require('./07_stopProcessing._test');
require('./08_errorProcessing._test');
require('./09_reportToBus._test');
require('./10_messageId._test');
