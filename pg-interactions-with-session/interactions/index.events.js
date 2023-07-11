import 'moment-duration-format'
import {missingService} from '../../../common/services'
import {VType, validateEventFactory, BaseEvent} from '../../../common/events'
import oncePerServices from '../../../common/services/oncePerServices'
import prettyPrint from '../../../common/utils/prettyPrint'

export default oncePerServices(function defineEvents({bus = missingService('bus'), testMode}) {
  bus.registerEvent([
      {
        kind: 'event',
        type: 'ia.new',
        validate: validateEventFactory({
          _extends: BaseEvent,
          ia: {fields: require('./index.schema').Interaction},
          _final: true,
        }),
        toString: (ev) => `${ev.service}: ia.new: ${prettyPrint(ev.ia, 1024)}`,
      },
      {
        kind: 'error',
        type: 'ia.error',
        validate: validateEventFactory({
          _extends: BaseEvent,
          ia: {fields: require('./index.schema').Interaction},
          error: {fields: require('../../../common/errors/error.schema').eventErrorSchema},
        }),
        toString: (ev) =>
          (testMode && testMode.service) ? `${ev.service}: error: '${ev.error.message}'` : // для testMode специальное сообщение, которое легко проверять и оно не содержит stack
            `${ev.service}: ia.error: ${ev.kind !== 'general' ? ev.kind : ev.error.stack}`,
      },
      {
        kind: 'debug',
        type: 'ia.extendLock',
        validate: validateEventFactory({
          _extends: BaseEvent,
          ia: {fields: require('./index.schema').Interaction},
        }),
        toString: (ev) =>
          (testMode && testMode.service) ? `${ev.service}: error: '${ev.error.message}'` : // для testMode специальное сообщение, которое легко проверять и оно не содержит stack
            `${ev.service}: ia.error: ${ev.kind !== 'general' ? ev.kind : ev.error.stack}`,
      },
      {
        kind: 'error',
        type: 'ia.tooLong', // Может сдлать вложенным полем - код ошибки
        validate: validateEventFactory({
          _extends: BaseEvent,
          ia: {required: true, fields: require('./index.schema').Interaction},
        }),
        toString: (ev) => `${ev.service}: ia.tooLong: ${prettyPrint(ev.ia, 1024)}`,
      },
      {
        kind: 'event',
        type: 'ia.process',
        validate: validateEventFactory({
          _extends: BaseEvent,
        }),
        toString: (ev) => `${ev.service}: ia.process: ${prettyPrint(ev, 1024)}`,
      },
      {
        kind: 'event',
        type: 'ia.start',
        validate: validateEventFactory({
          _extends: BaseEvent,
          ia: {required: true, fields: require('./index.schema').Interaction},
        }),
        toString: (ev) => `${ev.service}: ia.start: ${prettyPrint(ev.ia, 1024)}`,
      },
      {
        kind: 'event',
        type: 'ia.end',
        validate: validateEventFactory({
          _extends: BaseEvent,
          ia: {required: true, fields: require('./index.schema').Interaction},
        }),
        toString: (ev) => `${ev.service}: ia.end: ${prettyPrint(ev.ia, 1024)}`,
      },
    ]
  );
})
