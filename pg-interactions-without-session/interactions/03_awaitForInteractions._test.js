import test from 'ava'

// zork: наверное такого делать не будем - это дублирует, при чем не полностью, работу через события из postgres
test.todo(`3.1 Если ничего нет, со смотрим есть ли в очереди элементы назначенные на определенное время`);

test.serial(
  `3.2 Если нечего обрабатывать, то проверяем не появилось ли работа через интервал ` +
  `времени из конфигурации, или если он меньше интервал до следующей ожидаемой работы`, async t => {

    const {interactions} = t.context.manager.services;

    const activeInter = await interactions.create({
      fromService: 'test',
      toService: `testSvc`,
      action: `do1`,
      processAt: `1970-01-01T00:00:10.000Z`
    });

    let callCount = 0;

    interactions.process({
      toService: 'testSvc',
      regularCheckPeriod: 2000,
      processor: (interaction, testProcessFinished) => {
        ++callCount;
        interaction.processIn = 10000;
        testProcessFinished();
      }
    });
    await interactions._process._runAndAwaitAsyncs();

    t.is(callCount, 0);

    // zork: тут скорее тест получился на processAt и processIn
    t.context.clock.tick(5000);
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.is(callCount, 0);

    t.context.clock.tick(5000); // 10 sec
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.is(callCount, 1);

    t.context.clock.tick(5000); // 15 sec
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.is(callCount, 1);

    t.context.clock.tick(5000); // 20 sec
    await interactions._process._runAndAwaitAsyncs(); // запуск processNext
    await interactions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

    t.is(callCount, 2);

  });
