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
  return async function get(args) {
    schema.get_args(args);
    const {context, id} = args;

    const r = await postgres.exec({
      context,
      statement: `select ia.*, s.bot, s.channel, s.user_id from interaction ia join session s on s.id = ia.session_id where ia.id = $1;`,
      params: [
        id,
      ]
    });

    return r.rowCount === 0 ? null : rowToInteraction(r.rows[0]);
  }
}
