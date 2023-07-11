const mongoose = require("mongoose");

module.exports = mongoose.createConnection(

  process.env.MONGODSN_TASKS || process.env.MONGODSN,

  {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
  }
);
