import test from 'ava'
import {IN_PROGRESS, COMPLETED, FAILED, CANCELLED} from './_states'

test.serial(`6.1 При завершении child interaction, устанавливаем next_processing parent, если есть в now()`, async t => {
  const {'interactions': dataInteractions} = t.context.manager.services;

  const parentInter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `do1`
  });

  let callCount = 0, callCount2 = 0;

  dataInteractions.process({
    toService: 'testSvc',
    maxInParaller: 1, // обрабатываем по одному за раз
    regularCheckPeriod: 100,
    errorHandler: t.context.promiseErrorHandler,
    processor: async(interaction, testProcessFinished) => {
      ++callCount;
      const children = await dataInteractions.getChildren({parentId: interaction.id, name: 'subaction'});
      if (children.length === 0) {
        await dataInteractions.create({
          sessionId: t.context.session.id,
          fromService: 'test',
          toService: 'testSvc2',
          parentId: interaction.id,
          name: 'subaction',
          action: 'do1a',
          innerAction: true,
        });
        interaction.processIn = 60 * 1000;
      } else {
        if (children[0].state === COMPLETED)
          interaction.completed = true;
      }
      testProcessFinished();
    },
  });

  t.context.clock.tick(100);
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());

  t.is(callCount, 1);

  dataInteractions.process({
    toService: 'testSvc2',
    maxInParaller: 1, // обрабатываем по одному за раз
    regularCheckPeriod: 100,
    errorHandler: t.context.promiseErrorHandler,
    processor: async(interaction, testProcessFinished) => {
      ++callCount2;
      t.is(interaction.parentId, parentInter.id);
      interaction.completed = true;
      interaction.processIn = 0; // иначе, ia перейдет в состояние wait
      testProcessFinished();
    }
  });

  t.context.clock.tick(100);
  await dataInteractions._process._runAndAwaitAsyncs(); // запуск processNext
  await dataInteractions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

  t.is(callCount2, 1);

  t.context.clock.tick(100);
  await dataInteractions._process._runAndAwaitAsyncs(); // запуск processNext
  await dataInteractions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

  t.is(callCount, 2);

});

test.serial.skip(`6.2 При завершении interaction, переводим не завершенные child interaction в cancelled`, async t => {


});

test.serial.skip(`6.3 Получение child interaction по имени. Если несколько, то последний созданный.`, async t => {


});

test.serial.skip(`6.4 Получение child interactions по имени. Список отсортированный по возрастанию created.`, async t => {


});

test.serial(`6.5 Если создается child interaction сразу в состоянии completed, то parent interaction ставится в очередь на обработку.`, async t => {
  const {postgres, 'interactions': dataInteractions} = t.context.manager.services;

  const parentInter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `do1`
  });

  let callCount = 0, callCount2 = 0;
  let f = async(ia) => {
    ++callCount;
  };

  dataInteractions.process({
    toService: 'testSvc',
    maxInParaller: 1, // обрабатываем по одному за раз
    regularCheckPeriod: 100,
    errorHandler: t.context.promiseErrorHandler,
    processor: /*async*/ (ia, testProcessFinished) => {
      f(ia);
      testProcessFinished();
    },
  });

  t.context.clock.tick(100);
  await dataInteractions._process._runAndAwaitAsyncs(); // запуск processNext
  await dataInteractions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

  t.is(callCount, 1);
  const row = (await postgres.exec({statement: `select * from interaction where id = ${parentInter.id}`})).rows[0];
  t.is(row.next_processing, null);

  const childInter = await dataInteractions.create({ // создаем child interaction, сразу с признаком completed
    sessionId: t.context.session.id,
    parentId: parentInter.id,
    name: 'name1',
    fromService: 'test',
    toService: `testSvc2`,
    action: `do2`,
    completed: true,
    args: {n: 12}
  });

  f = async(ia) => {
    ++callCount;
    t.is(ia.id, parentInter.id);
    const children = await dataInteractions.getChildren({parentId: ia.id});
    t.is(children[0].id, childInter.id);
  };

  t.context.clock.tick(100);
  await dataInteractions._process._runAndAwaitAsyncs(); // запуск processNext
  await dataInteractions._process._runAndAwaitAsyncs(); // завершение processNext, после вызова testProcessFinished() в processor

  t.is(callCount, 2); // был ещё один вызов, так как
});

