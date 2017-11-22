var Provider = require("./lib/provider");
var Server = require("./lib/server");

// This interface exists so as not to cause breaking changes.
module.exports = {
  server: function(options) {
    return Server.create(options);
  },
  provider: function(options, callback) {
    return new Provider(options, callback);
  }
};
