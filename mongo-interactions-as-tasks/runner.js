require("dotenv").config();
require("../utils/joi.js/joiExtraTypes");
const {log, getContext, withContext} = require("../utils/log");
const joi = require("joi");

const MAX_TASK_RUNNERS = process.env.NODE_ENV ? 1 : 2; // make smaller so it would stand on stage server
const REGULAR_CHECK_PERIOD = 3 * 1000;
const LEASING_PERIOD = 15 * 1000;
const LOCK_AHEAD_PERIOD = 7 * 1000;
const MAX_PARALLEL_TASKS = process.env.NODE_ENV ? 4 : 8; // make smaller so it would stand on stage server

const path = require("path");
const {spawn} = require("child_process");
const mongoose = require("mongoose");

const taskModel = require("./taskModel");

const TASK_RESULT_SCHEMA = joi.object({
  runInNSeconds: joi.number().integer().allow(0).positive(),
  runAtTime: joi.date(),
  done: joi.boolean().valid(true),
  waitForChildTask: joi.boolean().valid(true),
}).xor("runInNSeconds", "runAtTime", "done", "waitForChildTask").required();

const TASK_SHOULD_RETURN_RESULT_SCHEMA = joi.object({
  retryInNSeconds: joi.number().integer().positive(),
  retryAtTime: joi.date(),
  retry: joi.boolean(),
}).xor("retryInNSeconds", "retryAtTime", "retry").required();

if (require.main === module)
  require("../utils/misc/startedFromCLI")({
    appTitle: `Task runner #${process.argv[2]}`,
    fn: async () => {
      await tasksRunner();
      return new Promise(() => {}); // never ending function
    },
  });

let taskRunnersCount = 0;
let taskRunnerNum = 0;

function startTaskRunnerProcesses() {

  const context = getContext();

  try {

    if (taskRunnersCount === MAX_TASK_RUNNERS) return;

    taskRunnersCount++;

    withContext(context, startTaskRunnerProcesses);

    const child = spawn(`node ${__filename} ${++taskRunnerNum}`, {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
      env: process.env,
    });

    child.on("exit", ((taskRunnerNum) => (code) => {
      log.info(context, `Task runner #${taskRunnerNum}: Exited (Code: ${code})`);
      taskRunnersCount--;
      withContext(context, startTaskRunnerProcesses);
    })(taskRunnerNum));

    child.on("error", ((taskRunnerNum) => (...args) => {
      log.info(context, `Task runner #${taskRunnerNum}: Error (Args: ${args})`);
      taskRunnersCount--;
      withContext(context, startTaskRunnerProcesses);
    })(taskRunnerNum));

  } catch (err) {

    log.error(context, err);
  }
}

async function tasksRunner() {

  const context = getContext();

  let currentlyRunning = 0;
  let regularCheckPeriodTimer = null;

  let stopPromise;
  let stopResolve;
  runNextTask();

  return async function stopProcess() {
    if (!stopPromise) {
      stopPromise = new Promise(function (resolve, reject) {
        stopResolve = resolve;
      })
    }
    return stopPromise;
  };

  async function runNextTask() {

    try {

      if (stopResolve) {
        if (currentlyRunning === 0) {
          stopResolve();
        }
        return;
      }

      if (MAX_PARALLEL_TASKS && MAX_PARALLEL_TASKS <= currentlyRunning) return;

      if (regularCheckPeriodTimer !== null) {
        clearTimeout(regularCheckPeriodTimer);
        regularCheckPeriodTimer = null;
      }

      currentlyRunning++;

      // if there few applicable tasks then selected task created earlier, to improve the likely caching of
      // outer resources for those tasks

      // it is obligatory that the connection with tasks works in primary read preference
      // (https://www.mongodb.com/docs/manual/core/read-preference/), which is the default. so as not
      // to read the old version of the task in replica set mode

      const taskRecord = await taskModel.findOneAndUpdate({
        runAt: {$lte: new Date()},
        locked_till: {$not: {$gte: new Date()}},
        done: {$exists: 0},
      }, {
        $set: {
          locked_till: new Date(Date.now() + LEASING_PERIOD),
        },
      }, {
        projection: {
          runAt: 1,
          _root: 1,
          script: 1,
          parent: 1,
          started: 1,
          state: {$ifNull: ["$state", "$arguments", {}]},
          attemptsCount: {$size: [{$ifNull: ["$attempts", []]}]},
        },
        sort: {updatedAt: 1},
      }).lean();

      if (taskRecord === null) { // not found
        if (REGULAR_CHECK_PERIOD) regularCheckPeriodTimer = setTimeout(runNextTask, REGULAR_CHECK_PERIOD);
        currentlyRunning--;
        return;
      }

      if (!taskRecord.started) {
        await taskModel.updateOne({
          _id: taskRecord._id,
        }, {
          $set: {
            started: (taskRecord.started = new Date()),
          },
        });
      }

      setTimeout(runNextTask, 0); // try to start one more task

      let extendLockTimer;

      let finished = false;

      async function extendLock() {
        if (!finished) {
          try {

            await taskModel.updateOne({
              _id: taskRecord._id,
            }, {
              $set: {
                locked_till: new Date(Date.now() + LEASING_PERIOD),
              },
            });

          } catch (err) {
            log.error(context, err);
          }

          extendLockTimer = setTimeout(extendLock, LOCK_AHEAD_PERIOD);
        }
      }

      extendLockTimer = setTimeout(extendLock, LOCK_AHEAD_PERIOD);

      taskRecord.state._id = taskRecord._id;
      taskRecord.state._root = taskRecord._root;

      const fullScriptName = path.join(process.cwd(), taskRecord.script);

      let res, task;
      try {

        // drop require() cache so on dev was possible to update the task code at any time and on the next run
        // the new version of the code will be used

        // Note: This fails with mongoose: 'Cannot overwrite `XXX` model once compiled.'
        // if (!~["production", "staging"].indexOf(process.env.ENV)) {
        //   deleteRequireCache(require.resolve(fullScriptName));
        // }

        task = require(fullScriptName).task;

        res = await withContext(context, () => task.call(taskRecord.state, taskRecord.attemptsCount + 1));

        joi.assert(res, TASK_RESULT_SCHEMA, "task result");

      } catch (error) {

        res = {error};
      }

      delete taskRecord.state._id;
      delete taskRecord.state._root;

      const update = {
        $set: {
          state: taskRecord.state,
        },
        $unset: {
          locked_till: 1,
        }
      };

      if (res.runInNSeconds) {
        update.$set.runAt = new Date(Date.now() + res.runInNSeconds * 1000);
      } else if (res.runAtTime) {
        update.$set.runAt = res.runAtTime;
      } else if (res.done) {
        update.$set.done = new Date();
        update.$unset.runAt = 1;
      } else if (res.waitForChildTask) {
        // TODO: in version 2 make parent check children every 10 sec, since awake parent theoretically
        //       can fail due to mongo failure on parent runAt update
        update.$unset.runAt = 1;
      } else if (res.error) {

        if (task?.shouldRetry) {

          if (!(res.error.response || res.error.code)) {
            log.error(context, res.error); // most likely error in the code of task
          }

          let res2;
          try {
            res2 = task.shouldRetry.call(taskRecord.state, res.error, taskRecord.attemptsCount + 1);
          } catch (error) {
            res.error = error;
            res2.retry = false;
          }

          joi.assert(res2, TASK_SHOULD_RETURN_RESULT_SCHEMA, "task.shouldReturn() result");

          if (!res2?.retry) {

            update.$unset.runAt = 1;
            update.$set.done = new Date();
            update.$set.error = serializableError(res.error);

          } else {

            if (res2.retryInNSeconds) {
              update.$set.runAt = new Date(Date.now() + res2.retryInNSeconds * 1000);
            } else if (res2.retryAtTime) {
              update.$set.runAt = res2.retryAtTime;
            } else {
              update.$set.runAt = Date.now();
            }

            update.$unset.started = 1;
            update.$unset.state = 1;
            update.$push = {
              attempts: {
                $each: [{
                  started: taskRecord.started,
                  done: new Date(),
                  error: serializableError(res.error),
                  state: update.$set.state,
                }],
                $position: 0,
              },
            };
            delete update.$set.state;
          }
        } else {

          update.$unset.runAt = 1;
          update.$set.done = new Date();
          update.$set.error = serializableError(res.error);
        }
      }

      // To undestand: Below mechanisms solve the problem that when the parent task is working and
      //               at this time the child task finishes, it sets runAt on the parent task, and
      //               the parent task on completion can reset runAt. So the parent task resets runAt only
      //               if no one touches it. And the child task puts it at the current time plus 1ms, so it
      //               has exactly changed, as the parent task running can has runAt now or in the past


      // Below is AN EXAMPLE of the problem of missing transaction mechanism. Seems sometime 1st operation
      // performed ok, but the operation below had failed due to mongo load putting a task in an
      // inconsistent state (no runAt and is not done)

      // // TODO: in version 2 do this only if the task has started subtasks
      // if (update.$unset.runAt) {
      //   // remove runAt only if the child task did not set it
      //   await taskModel.updateOne({_id: taskRecord._id, runAt: taskRecord.runAt}, {$unset: {runAt: 1}});
      //   delete update.$unset.runAt;
      // }
      //
      // await taskModel.updateOne({_id: taskRecord._id}, update);

      // Seems everytime we do some update at the end of task step we set or clear runAt
      // if (update.$unset.runAt) {

      // TODO: in version 2 do this only if the task has started subtasks

      // clear runAt only if the child task did has not set it

      const r = await taskModel.updateOne({_id: taskRecord._id, runAt: taskRecord.runAt}, update);

      if (update.$set.error) {

        log.error(context, res, `Task._id: ${taskRecord._id}: ${res.error}`);
      }

      if (r.nModified === 0) {

        // same without touching runAt as it was
        delete update.$unset.runAt;
        await taskModel.updateOne({_id: taskRecord._id}, update);
      }
      // } else { // runAt
      //
      //   await taskModel.updateOne({_id: taskRecord._id}, update);
      // }

      // TODO: in version 2 do not awake parent if not 'all' or 'any' condition is met. in case of 'any' set ref to first result
      if (taskRecord.parent && update.$set.hasOwnProperty("done")) {
        // add 1ms to to make sure what runAt will not be the same as before even if on some powerful system
        // a task step will run in less then 1ms
        await taskModel.updateOne({_id: taskRecord.parent}, {$set: {runAt: new Date(Date.now() + 1)}});
      }

      finished = true;
      clearTimeout(extendLockTimer);

      if (--currentlyRunning === 0 && stopResolve) {
        stopResolve();
      } else if (regularCheckPeriodTimer === null) {
        setTimeout(runNextTask, 0);
      }
    } catch (err) {
      log.error(context, err);
    }
  }
}

function serializableError(err) {

  const r = {};

  r.messsage = err.message;
  if (err.code) r.code = err.code;
  if (err.response) r.status = err.response.status;
  if (err.config) {
    r.method = err.config.method;
    r.url = err.config.url;
  }
  r.stack = err.stack;

  return r;
}

function deleteRequireCache(id) {
  if (!id || ~id.indexOf('node_modules')) return;
  const m = require.cache[id];
  if (m !== undefined) {
    Object.keys(m.children).forEach(function (file) {
      deleteRequireCache(m.children[file].id);
    });
    delete require.cache[id];
  }
}


module.exports = startTaskRunnerProcesses;
module.exports.tasksRunner = tasksRunner;
