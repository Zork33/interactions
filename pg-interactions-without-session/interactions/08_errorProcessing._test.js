import test from 'ava'

test.serial(`8.1 При возникновении ошибки, ia ставится на повторную обработку через onErrorProcessingDelay`, async t => {

  const {interactions} = t.context.manager.services;

  let callCount = 0;

  interactions.process({
    toService: 'testSvc',
    regularCheckPeriod: 100,
    processor: async (interaction, testProcessFinished) => {
      ++callCount;
      testProcessFinished(new Error(`An error`)); // вариант для тестов, завершить обработку с ошибкой
    }
  });

  await interactions.create({
    fromService: 'test',
    toService: `testSvc`,
    action: `do1`
  });

  // три раза, чтоб обработались все три interaction'а
  t.context.clock.tick(100); // 100ms
  await interactions._process._runAndAwaitAsyncs(); // запуск processNext
  await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

  t.is(callCount, 1);

  t.context.clock.tick(1000); // 1100ms
  await interactions._process._runAndAwaitAsyncs(); // запуск processNext
  await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

  t.is(callCount, 1);

  t.context.clock.tick(1000); // 2100ms
  await interactions._process._runAndAwaitAsyncs(); // запуск processNext
  await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

  t.is(callCount, 2);

});

test.todo(`8.2 Ограничение по времени, на обработку interaction, с последующим cancel его promise.  Время в конфигурации`);

