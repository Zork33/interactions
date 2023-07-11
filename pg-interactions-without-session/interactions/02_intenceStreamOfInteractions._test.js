import test from 'ava'
import {IN_PROGRESS, COMPLETED, FAILED, CANCELLED} from './_states'

test.serial(
  `2.1 В тестовом режиме проверяем что next обрабатывает следующий interaction в очереди, ` +
  `который ещё не completed или cancelled, и у которых next_processing не в будущем`, async t => {

    const {interactions} = t.context.manager.services;

    const activeInter1 = await interactions.create({
      fromService: 'test',
      toService: `testSvc`,
      action: `do1`
    });

    t.context.clock.tick(100); // чтобы modified был разные, и interaction'ы были обработаны в той последовательности, в которой они созданы

    const activeInter2 = await interactions.create({
      fromService: 'test',
      toService: `testSvc`,
      action: `do2`
    });

    t.context.clock.tick(100);

    const activeInter3 = await interactions.create({
      fromService: 'test',
      toService: `testSvc`,
      action: `do3`
    });

    let callCount = 0;

    interactions.process({
      toService: 'testSvc',
      maxInParaller: 1, // обрабатываем по одному за раз
      regularCheckPeriod: 100,
      processor: async (interaction, testProcessFinished) => {
        ++callCount;
        switch (interaction.id) {
          case activeInter1.id:
            interaction.completed = true;
            break;
          case activeInter2.id:
            interaction.error = new Error('an error');
            break;
          case activeInter3.id:
            interaction.cancelled = true;
            break;
        }
        testProcessFinished();
      }
    });

    // три раза, чтоб обработались все три interaction'а
    t.context.clock.tick(100);
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.is(callCount, 1);

    t.context.clock.tick(100);
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.is(callCount, 2);

    t.context.clock.tick(100);
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.is(callCount, 3);

    t.deepEqual(
      await interactions.get({id: activeInter1.id}),
      {
        ...activeInter1,
        state: COMPLETED,
        modified: `1970-01-01T00:00:00.300Z`,
        _time: `1970-01-01T00:00:00.300Z`,
      });

    t.context.clock.tick(100);
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.deepEqual(
      await interactions.get({id: activeInter2.id}),
      {
        ...activeInter2,
        state: FAILED,
        error: `Error: an error`,
        modified: `1970-01-01T00:00:00.400Z`,
        _time: `1970-01-01T00:00:00.400Z`,
      });

    t.context.clock.tick(100);
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.deepEqual(
      await interactions.get({id: activeInter3.id}),
      {
        ...activeInter3,
        state: CANCELLED,
        modified: `1970-01-01T00:00:00.500Z`,
        _time: `1970-01-01T00:00:00.500Z`,
      });

    t.is(callCount, 3);
  });

test.serial.todo(
  `2.2 Если обработка успешная, то next_processing = null.  Если ошибка то completed и failed true и ` +
  `поле error содержит причину.  Обработка в результате признаков completed, error и признаки repeate_at и repeate_in`);

test.serial(`2.3 Проверяем что работает ограничение на количество обработок в единицу времени`, async t => {

  const {interactions} = t.context.manager.services;

  let callCount = 0;
  const processFinished = [];

  interactions.process({
    toService: 'testSvc',
    maxInParaller: 2,
    regularCheckPeriod: 100,
    interval: 1000,
    maxPerInterval: 2,
    processor: async (interaction, testProcessFinished) => {
      ++callCount;
      processFinished.push(testProcessFinished);
    }
  });

  // герерируем очередь ia на обработку, при этом не больше трех одновременно
  for (let i = 0; i < 10; i++) {
    await interactions.create({
      fromService: 'test',
      toService: `testSvc`,
      action: `do1`
    });
  }

  t.context.clock.tick(100); // 100ms
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать первый nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.context.clock.tick(100); // 200ms
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // плюс один вызов, который не должен добавить ещё один process, так как уже два в работе

  t.is(callCount, 2); // не больше двух в секунду

  t.context.clock.tick(500); // 700ms

  processFinished.pop()();
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // ожидаем, окончания завершения process

  t.context.clock.tick(200); // 800ms
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать первый nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.is(callCount, 2); // секунда ещё не закончилась

  t.context.clock.tick(300); // 1100ms - прошла секунда с запуска первого process
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.is(callCount, 3); // в начале второй секунды запустилась ещё одна обработка

  t.context.clock.tick(500); // 1500ms
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.is(callCount, 3); // пока два processor в работе

  t.context.clock.tick(500); // 2000ms
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь

  processFinished.pop()(); // завершаем сразу два processor
  processFinished.pop()();
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // ожидаем, окончания завершения process

  t.context.clock.tick(100); // 2100ms
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // плюс один вызов, который не должен добавить ещё один process, так как уже два в работе

  t.is(callCount, 5); // пока два processor в работе

});

test.serial(`2.4 Проверяем что работает ограничение на количество одновременно обрабатываемых элементов`, async t => {

  const {interactions} = t.context.manager.services;

  let callCount = 0;
  const processFinished = [];

  interactions.process({
    toService: 'testSvc',
    maxInParaller: 3,
    regularCheckPeriod: 100,
    processor: async (interaction, testProcessFinished) => {
      ++callCount;
      processFinished.push(testProcessFinished);
    }
  });

  // герерируем очередь ia на обработку, при этом не больше трех одновременно
  for (let i = 0; i < 10; i++) {
    await interactions.create({
      fromService: 'test',
      toService: `testSvc`,
      action: `do1`
    });
  }

  t.context.clock.tick(100); // прошло 100ms, время проверять наличие сообщений в очереди

  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать первый nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // плюс один вызов, который не должен добавить ещё один process, так как уже три в работе

  t.is(callCount, 3);

  t.context.clock.tick(100); // пока не один не завершился

  t.is(callCount, 3);

  processFinished.pop()(); // завершаем один process - точнее, запускаем начало завершения
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // ожидаем, окончания завершения process

  t.context.clock.tick(100); // прошло 100ms, время проверять наличие сообщений в очереди
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.is(callCount, 4);

  processFinished.pop()(); // теперь завершаем сразу два процесса
  processFinished.pop()();
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // ожидаем, окончания завершения process'ов

  t.context.clock.tick(100); // прошло 100ms, время проверять наличие сообщений в очереди
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.is(callCount, 6);

  processFinished.pop()(); // теперь завершаем сразу три процесса
  processFinished.pop()();
  processFinished.pop()();
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // ожидаем, окончания завершения process'ов

  t.context.clock.tick(100); // прошло 100ms, время проверять наличие сообщений в очереди
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(interactions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.is(callCount, 9);

});
