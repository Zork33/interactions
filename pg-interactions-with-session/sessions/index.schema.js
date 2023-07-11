import {validate, VType} from '../../../common/validation'
import prettyPrint from '../../../common/utils/prettyPrint'

const hasOwnProperty = Object.prototype.hasOwnProperty;

export const Session = {
  id: {type: VType.Int()},
  bot: {type: VType.String()},
  channel: {type: VType.String()},
  userId: {type: VType.String()},
  lastSeeing: {type: VType.String().iso8601()},
  active: {type: VType.Boolean()},
  _final: false,
};

export const DEFAULT_LOCK_PERIOD = require('../interactions/index.schema').DEFAULT_LOCK_PERIOD;
export const DEFAULT_RELOCK_PERIOD = require('../interactions/index.schema').DEFAULT_RELOCK_PERIOD;
export const DEFAULT_LOCK_CHECK_PERIOD = 300;

export const get_args = validate.method.this('args', {
  id: {required: true, type: VType.String()},
});

export const lock_args = validate.method.this('args', {
  context: {type: VType.String()},
  id: {type: VType.Int()},
  bot: {type: VType.String()},
  channel: {type: VType.String()},
  userId: {type: VType.String()},
  lockPeriod: {type: VType.Int().positive()}, // default: 5 sec (5 000 ms)
  relockPeriod: {type: VType.Int().positive()}, // default: 3 sec (3 000 ms)
  lockCheckPeriod: {type: VType.Int().positive()}, // default: 300ms
  shouldCompleteSession: {type: VType.Function()}, // метод, который проверяет не пора ли закрыть сессию, перед тем как с сессией продолжают работать
  processor: {required: true, type: VType.Function()}, // метод работающий с сессией.  на момент обработки сессия эксклюзино залочена
  lockAttemptFailed: {type: VType.Function()}, // вызывается каждый раз, когда не удается заблокировать существующую сессию.  нужно для тестов
  lockExtended: {type: VType.Function()}, // вызывается, если было добавлено время к времени блокировки.  нужно для тестов
  useEvents: {type: VType.Boolean()}, // если true, то используются механизм postgres pg_notification, чтоб сообщать ожидающим процессам, что ia изменился и что сессия разблокированна
  _final: true,
  _validate: (context, value, message, validateOptions) => {
    if (!message) {
      if (hasOwnProperty.call(value, 'id') ^ !hasOwnProperty.call(value, 'channel'))
        return [`Must be either 'id' or 'channel', but not both: ${prettyPrint(value)}`];
      if (hasOwnProperty.call(value, 'channel') && !(hasOwnProperty.call(value, 'bot') && hasOwnProperty.call(value, 'userId')))
        return [`With 'channel' must be specified 'bot' and 'userId': ${prettyPrint(value)}`]
    }
  }
});
