import {missingService} from '../../../common/services'
import rowToInteraction from './_rowToInteraction'

const schema = require('./index.schema');

export default function (services) {

  const {
    bus = missingService('bus'),
    postgres = missingService('postgres'),
  } = services;

  /**
   * Возвращает interaction по id.  Нужно, чтобы interation мог получить данные parent interaction по parentId.
   */
  return async function getByMessageId(args) {

    schema.getByMessageId_args(args);

    const {context, messageId} = args;

    const r = await postgres.exec({
      context,
      statement: `select ia.*, s.bot, s.channel, s.user_id from interaction ia join session s on s.id = ia.session_id where ia.message_id = $1 order by created limit 1;`,
      params: [messageId],
    });

    return r.rowCount === 0 ? null : rowToInteraction(r.rows[0]);
  }
}
