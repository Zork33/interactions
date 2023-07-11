/**
 * Returns the nearest future time. That is, if this time has passed in the current 24 hours, it will return
 * the same time tomorrow. The time is specified in UTC 24 hour format.
 */
module.exports = function nextUTCTime(time, tomorrow) {
  const d = new Date();
  const t = new Date(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${time}Z`);
  if (t.getTime() < Date.now() || tomorrow) t.setDate(t.getDate() + 1);
  return t;
};
