const path = require("path");

demoTask.script = path.relative(process.cwd(), __filename).replace(/\\/g, "/");

demoTask.shouldRetry = (error, attemptNumber) => { // optional

  // if (attemptNumber == 3) return {retry: false};
  return {retry: !!(error.code || error.response)};
  // return {retryInNSeconds: 30};
  // return {retryAtTime: new Date()};
}

async function demoTask(attemptNumber) {

  this.n = (this.n || 0) + 1;

  // await new Promise((resolve) => {
  //   setTimeout(resolve, 20 * 1000);
  // })

  return {
    done: true,
  };

  // if (this.n === 3) {
  //   if (attemptNumber === 3) {
  //     return {
  //       done: true,
  //     };
  //   } else {
  //     throw new Error(`n: ${this.n}`);
  //   }
  // }

// this.go = 21;

// throw new Error("test");

  return {
    runInNSeconds: 2,
    // runAtTime: new Date(),
    // done: true,
    // waitForChildTask: true,
  }


}

module.exports = demoTask;
