import test from 'ava'

test.serial(`7.1 Завершение работы конкретной очереди обработки в сервисе data/interactions.  ожидание завершения через promise`, async t => {

  const {'interactions': dataInteractions} = t.context.manager.services;

  let callCount = 0;
  const processFinished = [];

  const stopProcess = dataInteractions.process({
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
    await dataInteractions.create({
      sessionId: t.context.session.id,
      fromService: 'test',
      toService: `testSvc`,
      action: `do1`
    });
  }

  t.context.clock.tick(100); // прошло 100ms, время проверять наличие сообщений в очереди

  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs()); // должен сработать первый nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs()); // должен сработать nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs()); // плюс один вызов, который не должен добавить ещё один process, так как уже три в работе

  t.is(callCount, 3);

  const stopProcessPromise = stopProcess();

  t.context.clock.tick(100);
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());

  t.is(callCount, 3); // пока все process в работе
  t.false(stopProcessPromise.isFulfilled());

  processFinished.pop()(); // завершаем 1ый
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());
  t.context.clock.tick(100);
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());

  t.is(callCount, 3); // при этом новые process в работу не берутся
  t.false(stopProcessPromise.isFulfilled());

  processFinished.pop()(); // завершаем 2ой
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());
  t.context.clock.tick(100);
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());

  t.is(callCount, 3); // при этом новые process в работу не берутся
  t.false(stopProcessPromise.isFulfilled());

  processFinished.pop()(); // завершаем 1ый
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());
  t.context.clock.tick(100);
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());

  t.is(callCount, 3); // при этом новые process в работу не берутся
  t.true(stopProcessPromise.isFulfilled()); // остановка обработки завершилась

});
