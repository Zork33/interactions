import {IN_PROGRESS, FAILED, CANCELLED, COMPLETED} from './_states'

export default function rowToInteraction(row) {
  const {id, session_id, bot, channel, user_id, from_service, to_service, action, inner_action, message_id, parent_id, name: newName, next_processing, lock, completed, failed, cancelled, options, created, modified, _time} = row;

  const newInteraction = Object.create(null);
  newInteraction.id = id;
  newInteraction.sessionId = session_id;
  newInteraction.bot = bot;
  newInteraction.channel = channel;
  newInteraction.userId = user_id;
  newInteraction.fromService = from_service;
  newInteraction.toService = to_service;
  newInteraction.action = action;
  if (inner_action) newInteraction.innerAction = inner_action;
  if (message_id !== null) newInteraction.messageId = message_id;
  if (parent_id !== null) {
    newInteraction.parentId = parent_id;
    newInteraction.name = newName;
  }
  newInteraction.state = !completed ? IN_PROGRESS : failed ? FAILED : cancelled ? CANCELLED : COMPLETED;
  Object.assign(newInteraction, options);
  newInteraction.created = created.toJSON();
  newInteraction.modified = modified.toJSON();
  if (_time) newInteraction._time = _time.toJSON();

  return newInteraction;
}
