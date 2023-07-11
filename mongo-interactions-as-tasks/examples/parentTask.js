const path = require("path");

const taskModel = require("../taskModel");
const childrenTask = require("./childrenTask");

parentTask.script = path.relative(process.cwd(), __filename).replace(/\\/g, "/");

async function parentTask(attemptNumber) {

  switch (this.step) {

    case undefined: {

      console.info("Parent started");

      for (let n = 0; n < 6; n++) {

        await (new taskModel({

          script: childrenTask.script,
          arguments: {n},

          parent: this._id,
          _root: this._root || this._id,

        })).save();
      }

      this.step = "two";
      return {waitForChildTask: true};
    }

    case "two": {

      if (await taskModel.findOne({parent: this._id, done: {$exists: 0}}, {_id: 1}).lean()) return {waitForChildTask: true}; // not all child were processed yet

      console.info("Parent finished");

      delete this.step;
      return {done: true};

    }
  }
}

module.exports = parentTask;
