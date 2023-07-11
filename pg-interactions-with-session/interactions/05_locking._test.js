import test from 'ava'

for (const completionType of ['completed', 'failed', 'cancelled'])
  test.serial(`5.1 При любом update, полю lock присваивается значение now() [${completionType}]`, async t => {

    const {'interactions': dataInteractions, postgres} = t.context.manager.services;

    const inter = await dataInteractions.create({
      sessionId: t.context.session.id,
      bot: t.context.session.bot,
      fromService: 'test',
      toService: `testSvc`,
      action: `doSomething`,
      args: {a: 12, b: `test`}
    });

    const r1 = await postgres.exec({statement: `update interaction set lock = (now()::timestamp + interval '5000 ms') where id = ${inter.id} returning *;`});

    t.is(r1.rows[0].lock.toJSON(), `1970-01-01T00:00:05.000Z`);

    t.context.clock.tick(100);

    await dataInteractions._update({...inter, ...{[completionType]: true}});

    const r2 = await postgres.exec({statement: `select * from interaction where id = ${inter.id}`});

    t.is(r2.rows[0].lock.toJSON(), `1970-01-01T00:00:00.100Z`);

  });

test.serial.todo(`5.2 Блокировка элемента на время обработки. И разблокировка после.`);

test.serial(`5.3 Продление блокировки если обработка затянулась`, async t => {

  const {'interactions': dataInteractions, postgres} = t.context.manager.services;

  let callCount = 0;
  const processFinished = [];

  const stopProcess = dataInteractions.process({
    toService: 'testSvc',
    maxInParaller: 1,
    regularCheckPeriod: 100,
    lockPeriod: 500,
    relockPeriod: 300,
    processor: async (interaction, testProcessFinished) => {
      ++callCount;
      processFinished.push(testProcessFinished);
    }
  });

  const ia = await dataInteractions.create({
      sessionId: t.context.session.id,
      fromService: 'test',
      toService: `testSvc`,
      action: `do1`
    });

  t.context.clock.tick(100); // 100 ms
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs()); // должен сработать первый nextProcess(), и поставить следующий nextProcess в тестовую очередь
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs()); // должен сработать первый nextProcess(), и поставить следующий nextProcess в тестовую очередь

  t.is(callCount, 1);
  t.is((await postgres.exec({statement: `select * from interaction where id = ${ia.id};`})).rows[0].lock.toJSON(), `1970-01-01T00:00:00.600Z`);

  t.context.clock.tick(100); // 200 ms
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());
  t.is(callCount, 1);
  t.is((await postgres.exec({statement: `select * from interaction where id = ${ia.id};`})).rows[0].lock.toJSON(), `1970-01-01T00:00:00.600Z`);

  t.context.clock.tick(100); // 300 ms
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());
  t.is(callCount, 1);
  t.is((await postgres.exec({statement: `select * from interaction where id = ${ia.id};`})).rows[0].lock.toJSON(), `1970-01-01T00:00:00.600Z`);

  t.context.clock.tick(100); // 400 ms - прошло 300ms, так что надо продлить блокировку ещё на 500ms
  await t.context.awaitWithTimeout(dataInteractions._process._runAndAwaitAsyncs());
  t.is(callCount, 1);
  t.is((await postgres.exec({statement: `select * from interaction where id = ${ia.id};`})).rows[0].lock.toJSON(), `1970-01-01T00:00:00.900Z`);

});

test.serial.todo(`5.4 Прекращение блокировки по времени, если она не была снята`);
