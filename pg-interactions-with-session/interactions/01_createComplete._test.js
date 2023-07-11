import test from 'ava'
import {IN_PROGRESS, COMPLETED, FAILED, CANCELLED} from './_states'

test.serial(`1.1 Создание interaction`, async t => {

  const {'interactions': dataInteractions} = t.context.manager.services;

  const inter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  // TODO: Check bus

  t.deepEqual(inter, {
    id: inter.id,
    sessionId: t.context.session.id,
    bot: t.context.session.bot,
    userId: '123',
    channel: 'webChat',
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`},
    state: IN_PROGRESS,
    created: `1970-01-01T00:00:00.000Z`,
    modified: `1970-01-01T00:00:00.000Z`,
  });
});

test.serial(`1.2 Создание child interaction, с указанием parent и name`, async t => {

  const {'interactions': dataInteractions} = t.context.manager.services;

  const parent = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  // TODO: Добавить в тест, когда сделаю поддержку _validate для вложенных структур
  // t.throws(() => dataInteractions.create({interaction: {parent, toService: `testSvc`, action: `doSomething`, args: {a: 12, b: `test`}}})).error(``);

  const child = await dataInteractions.create({
    sessionId: t.context.session.id,
    parentId: parent.id,
    name: 'todo',
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  // TODO: Check bus

  t.deepEqual(child, {
    sessionId: t.context.session.id,
    bot: t.context.session.bot,
    userId: '123',
    channel: 'webChat',
    parentId: parent.id,
    name: 'todo',
    id: child.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`},
    state: IN_PROGRESS,
    created: `1970-01-01T00:00:00.000Z`,
    modified: `1970-01-01T00:00:00.000Z`,
  });

});

test.serial(`1.3 Успешное завершение interaction`, async t => {

  const {'interactions': dataInteractions} = t.context.manager.services;

  const inter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  t.context.clock.tick(100);

  await dataInteractions._update({...inter, ...{completed: true}});

  const updatedInter = await dataInteractions.get({id: inter.id});

  t.deepEqual(updatedInter, {
    ...inter,
    state: COMPLETED,
    modified: `1970-01-01T00:00:00.100Z`,
  });

  // создание сразу завершенного interaction'а - удобно для тестирования, может пригодиться в жкзотических сценариях

  const inter2 = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    completed: true,
    args: {a: 12, b: `test`}
  });

  t.deepEqual(inter2, {
    ...inter,
    id: inter2.id,
    state: COMPLETED,
    created: `1970-01-01T00:00:00.100Z`,
    modified: `1970-01-01T00:00:00.100Z`,
  });
});

test.serial(`1.4 Завершение с ошибкой`, async t => {

  const {'interactions': dataInteractions} = t.context.manager.services;

  const inter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  t.context.clock.tick(100);

  await dataInteractions._update({...inter, ...{error: new Error('some error')}});

  const updatedInter = await dataInteractions.get({id: inter.id});

  t.deepEqual(updatedInter, {
    ...inter,
    state: FAILED,
    error: `Error: some error`,
    modified: `1970-01-01T00:00:00.100Z`,
  });

  // создание сразу с ошибкой

  const inter2 = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`},
    error: new Error('some error')
  });

  t.deepEqual(inter2, {
    ...inter,
    id: inter2.id,
    state: FAILED,
    error: `Error: some error`,
    created: `1970-01-01T00:00:00.100Z`,
    modified: `1970-01-01T00:00:00.100Z`,
  });

});

test.serial(`1.5 Отмена действия (cancel)`, async t => {

  const {'interactions': dataInteractions} = t.context.manager.services;

  const inter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  t.context.clock.tick(100);

  await dataInteractions._update({...inter, ...{cancelled: true}});

  const updatedInter = await dataInteractions.get({id: inter.id});

  t.deepEqual(updatedInter, {
    ...inter,
    state: CANCELLED,
    modified: `1970-01-01T00:00:00.100Z`,
  });

  // создание сразу в состоянии cancelled

  const inter2 = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`},
    cancelled: true
  });

  t.deepEqual(inter2, {
    ...inter,
    id: inter2.id,
    state: CANCELLED,
    created: `1970-01-01T00:00:00.100Z`,
    modified: `1970-01-01T00:00:00.100Z`,
  });

});

test.serial(`1.6 Перенос действия на определенное время (processAt)`, async t => {

  const {'interactions': dataInteractions, postgres} = t.context.manager.services;

  const inter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  t.context.clock.tick(100);

  await dataInteractions._update({...inter, ...{processAt: `1970-01-01T00:50:00.000Z`}});

  const r = await postgres.exec({statement: `select * from interaction where id = ${inter.id}`});

  t.is(r.rows[0].next_processing.toJSON(), `1970-01-01T00:50:00.000Z`);

  const updatedInter = await dataInteractions.get({id: inter.id});

  t.deepEqual(updatedInter, {
    ...inter,
    state: IN_PROGRESS,
    modified: `1970-01-01T00:00:00.100Z`,
  });

  // создание сразу с указанием времени когда выполнить

  const inter2 = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`},
    processAt: `1970-01-01T00:50:00.000Z`
  });

  const r2 = await postgres.exec({statement: `select * from interaction where id = ${inter2.id}`});

  t.is(r2.rows[0].next_processing.toJSON(), `1970-01-01T00:50:00.000Z`);

  const updatedInter2 = await dataInteractions.get({id: inter2.id});

  t.deepEqual(updatedInter2, {
    ...inter,
    id: inter2.id,
    state: IN_PROGRESS,
    created: `1970-01-01T00:00:00.100Z`,
    modified: `1970-01-01T00:00:00.100Z`,
  });

});

test.serial(`1.7 Перенос действия на указанный интервал времени (processIn)`, async t => {

  const {'interactions': dataInteractions, postgres} = t.context.manager.services;

  const inter = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`}
  });

  t.context.clock.tick(100);

  await dataInteractions._update({...inter, ...{processIn: 30 * 1000}});

  const r = await postgres.exec({statement: `select * from interaction where id = ${inter.id}`});

  t.is(r.rows[0].next_processing.toJSON(), `1970-01-01T00:00:30.100Z`);

  const updatedInter = await dataInteractions.get({id: inter.id});

  t.deepEqual(updatedInter, {
    ...inter,
    state: IN_PROGRESS,
    modified: `1970-01-01T00:00:00.100Z`,
  });

  // создание сразу с указанием через какой интервал времени выполнить

  const inter2 = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    args: {a: 12, b: `test`},
    processIn: 30 * 1000
  });

  const r2 = await postgres.exec({statement: `select * from interaction where id = ${inter2.id}`});

  t.is(r2.rows[0].next_processing.toJSON(), `1970-01-01T00:00:30.100Z`);

  const updatedInter2 = await dataInteractions.get({id: inter2.id});

  t.deepEqual(updatedInter2, {
    ...inter,
    id: inter2.id,
    state: IN_PROGRESS,
    created: `1970-01-01T00:00:00.100Z`,
    modified: `1970-01-01T00:00:00.100Z`,
  });

});
