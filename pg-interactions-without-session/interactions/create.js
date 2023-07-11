import {missingService} from '../../common/services'
import buildFullErrorMessage from '../../common/utils/buildFullErrorMessage'
import rowToInteraction from './_rowToInteraction'
import fixServiceName from './_fixServiceName'

const schema = require('./index.schema');

export default function (services) {

  const {
    bus = missingService('bus'),
    postgres = missingService('postgres'),
  } = services;

  return async function create(args) {
    schema.create_args(args);

    const {context} = args;
    let {name, parentId, fromService, toService, action, singleton, innerAction, messageId, completed, error, cancelled, processAt, processIn, wait, ...options} = args;

    fromService = fixServiceName(fromService);
    toService = fixServiceName(toService);

    if (cancelled) completed = true;

    const isError = error !== undefined && typeof error !== null;
    if (isError) {
      completed = true;
      options.error =
        (typeof error === 'object' && error != null && hasOwnProperty.call(error, 'message') && hasOwnProperty.call(error, 'stack')) ? // через duck-type проверяем что это Error объект
          buildFullErrorMessage(error) : error;
    }

    let newInteraction;
    const connection = await postgres.connection({context});
    try {

      if (singleton) {
        const r = await postgres.exec({
          statement: `select * from interaction where to_service = $1 and action = $2 and not completed;`,
          params: [
            toService,
            action,
          ],
        });
        if (r.rowCount > 0) { // такой ia уже есть - новый создавать не нужно
          return;
        }
      }

      const fields = ['from_service', 'to_service', 'action', 'options', 'completed', 'failed', 'created', 'modified'];
      const params = [fromService, toService, action, options];
      let values = ['$1', '$2', '$3', '$4', `${!!completed}`, `${isError}`, 'now()', 'now()'];

      if (parentId) {
        fields.push('parent_id', 'name');
        values.push(`$${params.length + 1}`, `$${params.length + 2}`);
        params.push(parentId, name);
      }

      if (innerAction !== undefined) {
        fields.push('inner_action');
        values.push(`$${params.length + 1}`);
        params.push(innerAction);
      }

      if (messageId !== undefined) {
        fields.push('message_id');
        values.push(`$${params.length + 1}`);
        params.push(messageId);
      }

      if (cancelled) {
        fields.push('cancelled');
        values.push(`true`);
      } else if (processAt !== undefined) {
        fields.push('next_processing');
        values.push(`$${params.length + 1}`);
        params.push(new Date(processAt));
      } else if (processIn !== undefined) {
        fields.push('next_processing');
        values.push(`now()::timestamp + (${processIn} * interval '1 ms')`);
      } else if (typeof wait === 'boolean' && wait) {
        fields.push('next_processing');
        values.push('null');
      } else if (!completed) {
        fields.push('next_processing');
        values.push('now()::timestamp');
      }

      const r = await connection.exec({
        context,
        statement: `insert into interaction (${fields.join()}) values (${values.join()}) returning *;`,
        params
      });

      newInteraction = rowToInteraction(r.rows[0]);

      const row = r.rows[0];
      const parentIdNew = row.parent_id;
      // если interaction завершен (успешно или нет - не важно) и у него есть parent interaction, то переводим parent interaction в активный через поле next_processing
      if (completed && parentIdNew != null && !row.cancelled) {
        await connection.exec({
          context,
          statement: `update interaction set next_processing = now() where id = $1`,
          params: [
            parentIdNew,
          ]
        })
      }

    } finally {
      await connection.end({context});
    }

    // отправляем событие в bus
    const ev = Object.create(null);
    ev.service = this._service.name;
    ev.type = 'ia.new';
    ev.ia = newInteraction;
    bus.event(ev);

    return newInteraction;
  }
}
