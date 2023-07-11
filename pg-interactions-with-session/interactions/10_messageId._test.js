import test from 'ava'

test.serial(`1.1 Создание interaction`, async t => {

  const {'interactions': dataInteractions} = t.context.manager.services;

  const inter1 = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    messageId: '123',
    args: {a: 12, b: `test`}
  });

  t.context.clock.tick(100);

  const inter2 = await dataInteractions.create({
    sessionId: t.context.session.id,
    fromService: 'test',
    toService: `testSvc`,
    action: `doSomething`,
    messageId: '123',
    args: {a: 12, b: `test`}
  });

  const found = await dataInteractions.getByMessageId({messageId: '123'});

  t.not(inter1, found);
  t.not(inter2, found);

  t.deepEqual(found, inter1);
  t.notDeepEqual(found, inter2);

});
