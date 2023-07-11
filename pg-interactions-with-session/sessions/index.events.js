import {oncePerServices, missingService} from '../../../common/services'
import {VType, validateEventFactory, BaseEvent} from '../../../common/events'

export default oncePerServices(function defineEvents({bus = missingService('bus')}) {
  bus.registerEvent([
    {
      kind: 'event',
      type: 'session.new',
      validate: validateEventFactory({
        _extends: BaseEvent,
        session: {required: true, type: VType.Object()},
      }),
      toString: (ev) => `${ev.service}: session '${ev.session.channel}/${ev.session.userId}': new`,
    },
  ]);
  bus.registerEvent([
    {
      kind: 'event',
      type: 'session.update',
      validate: validateEventFactory({
        _extends: BaseEvent,
        session: {required: true, type: VType.Object()},
      }),
      toString: (ev) => `${ev.service}: session '${ev.session.channel}/${ev.session.userId}': update`,
    },
  ]);
})
