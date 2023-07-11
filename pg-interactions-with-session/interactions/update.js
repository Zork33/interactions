import {missingService} from '../../../common/services'
import buildFullErrorMessage from '../../../common/utils/buildFullErrorMessage'
import CircularJSON from 'circular-json'

const hasOwnProperty = Object.prototype.hasOwnProperty;

const schema = require('./index.schema');

export default function (services) {

  const {
    bus = missingService('bus'),
    postgres = missingService('postgres'),
  } = services;

  /**
   * - Обновляет interaction, но при этом не изменяет признак cancelled.
   * - При обновлении снимает lock
   * - Если interaction содержит поле error, то выставляет признаки completed и failed, а error, если это объекта типа Error, преобразуется в json форму, через prettyError?!
   * - Если interaction содерижт поле completed равное true, то выставляет признак completed
   * - Если после обновления, interaction completed и не cancelled, то взводит parent interaction next_processing в now()
   * - Если указанно свойство processAt типа дата-время, устанавливает next_processing на указанное время
   * - Если указанно свойство processIn типа period (timestamp), устанавливает next_processing на (now() + указанный период)
   * - Если interaction содерижт поле cancelled равное true, то выставляются признаки completed и cancelled.  Это сделано про запас, пока не понятно для какого сценария
   *
   * Важно: это внутрений метод сервиса, не предназначенный для использования за пределами сервиса.
   *
   */
  return async function update(args) {

    schema.update_args(args);

    let {context, process, id, sessionId, bot, channel, userId, name, parentId, fromService, toService, action, innerAction, messageId, state, created, modified, completed, error, cancelled, processAt, processIn, ...options} = args;

    if (cancelled) completed = true;

    const isError = error !== undefined && typeof error !== null;
    if (isError) {
      completed = true;
      options.error =
        (typeof error === 'object' && error != null && hasOwnProperty.call(error, 'message') && hasOwnProperty.call(error, 'stack')) ? // через duck-type проверяем что это Error объект
          buildFullErrorMessage(error) : error;
    }

    const connection = await postgres.connection({context});
    try {

      const params = [
        id,
        !!completed,
        isError,
        CircularJSON.stringify(options),
      ];

      let extra = '';

      if (messageId !== undefined) {
        params.push(messageId);
        extra += `, message_id = $${params.length}`;
      }

      if (cancelled) {
        extra += `, cancelled = true`;
      } else if (processAt !== undefined) {
        params.push(new Date(processAt)); // TODO: Get time from DB
        extra += `, next_processing = $${params.length}`;
      } else if (processIn !== undefined) {
        if (processIn === 0) {
          extra += `, next_processing = now()::timestamp`;
        } else {
          extra += `, next_processing = now()::timestamp + (${processIn} * interval '1 ms')`;
        }
      } else {
        extra += `, next_processing = null`;
      }

      if (typeof parentId === 'number') {
        params.push(parentId);
        extra += `, parent_id = $${params.length}`;
      }

      const r = await connection.exec({
        context,
        statement: `update interaction set completed = $2, failed = $3, options = $4${extra}, lock = now(), modified = now() where id = $1 returning *;`,
        params,
      });

      if (r.rowCount == 0) throw new Error(`interaction (id: ${id}) not found`);

      const row = r.rows[0];
      const parentIdNew = row.parent_id;

      // если interaction завершен (успешно или нет - не важно) и у него есть parent interaction, то переводим parent interaction в активный через поле next_processing
      if (completed && row.inner_action && parentIdNew != null && !row.cancelled) {
        await connection.exec({
          context,
          statement: `update interaction set next_processing = now() where id = $1 and completed = false`,
          params: [
            parentIdNew,
          ]
        })
      }

      // TODO: Если cancelled, то отменить все вложенные child interaction

      // Внимание: Этот код не возвращает новый вариант interaction, так как он не нужен

    } finally {
      await connection.end({context});
    }
  }
}
