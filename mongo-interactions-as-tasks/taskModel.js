const mongoose = require("mongoose");
const tasksConnection = require("./tasksConnection");

const taskSchema = new mongoose.Schema({
    script: { // relative path to the script performing the task
      type: String,
      required: true,
    },
    parent: { // the task that created this task and the task that will be activated after this task is completed
      type: mongoose.Schema.Types.ObjectId,
      index: true,
      ref: "Task",
    },
    runAt: { // the time after which the task must be performed
      type: Date,
      default: Date.now,
    },
    locked_till: { // the time until which the task is blocked from being taken over by another task runner
      type: Date,
    },
    arguments: { // initial version of state. kept untouched so every retry starts from the same state
      type: Object,
      require: true,
    },
    state: { // the stored state of the task, available to the program code when the code is run and retained until the next time the code is run
      type: Object,
      require: true,
    },
    started: { // task attempt start time
      type: Date,
    },
    done: { // present if the task is completed
      type: Date,
    },
    error: { // an error occurring during the performance of a task, if it has occurred
      type: Object,
    },
    attempts: {
      type: [new mongoose.Schema({ // ?? exists only there were more than one attempt
        state: {
          type: Object,
        },
        started: { // task attempt start time
          type: Date,
        },
        done: { // task attempt end time
          type: Date,
        },
        error: { // an error occurring during the attempt
          type: Object,
        },
      }, {_id: false})],
      default: undefined, // attempts field does not exist if there was no retries
    },
  }, {timestamps: true, versionKey: false}
);

// delete after 7 days. it MUST be more then one day to do not delete scheduleRegularTasks
taskSchema.index({updatedAt: 1}, {expireAfterSeconds: 36 * 60 * 60});

// this index suppose to improve selection of next task to process by runner
taskSchema.index({done: 1, runAt: 1, locked_till: 1, updatedAt: 1});

module.exports = tasksConnection.model("Task", taskSchema, "taskV1");
