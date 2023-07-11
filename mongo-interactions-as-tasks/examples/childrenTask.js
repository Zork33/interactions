const path = require("path");

childrenTask.script = path.relative(process.cwd(), __filename).replace(/\\/g, "/");

async function childrenTask(attemptNumber) {

  console.info(`Children task #${this.n}`);

  if (this.n === 0) {

    return {done: true};
  }

  if (this.q === undefined) {

    this.q = true;

    return {runInNSeconds: 1};
  }

  return {done: true};
}

module.exports = childrenTask;
