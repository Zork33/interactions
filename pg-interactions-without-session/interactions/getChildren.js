import {missingService} from '../../common/services'
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
  return async function getChildren(args) {

    schema.getChild_args(args);
    const {context, parentId, name, limit} = args;

    let extra = '';
    const params = [parentId];

    if (name) {
      extra = ` and ia.name = $2`;
      params.push(name);
    }

    const r = await postgres.exec({
      context,
      statement: `select ia.* from interaction ia where ia.parent_id = $1${extra} order by modified desc${limit ? ` limit ${limit}` : ''};`,
      params,
    });

    return r.rows.map(v => rowToInteraction(v));
  }
}
