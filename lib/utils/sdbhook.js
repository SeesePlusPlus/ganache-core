var uuidv4 = require("uuid/v4");
var events = require("events");
var net = require("net");
var TCP = process.binding('tcp_wrap').TCP;
var CircularJSON = require("circular-json");

function SdbHook(options, callback) {
  var self = this;

  options = options || {};

  this.options = options;
  this.logger = options.logger || console;

  this.sdbPort = options.sdbPort || "8455"; // TODO: should we have two default port definitions?

  this.socket = new TCP();

  this.connected = false;
  this.connection = null;

  this.internalEventEmitter = new events.EventEmitter();
  
  this.disconnectedResponse = { // TODO: better place to put this?
    "status": "error",
    "data": "disconnected"
  };

  this.connectedCallback = callback;

  this.initialize();
  this.listenForDebugger();
};

SdbHook.prototype.initialize = function() {
  var self = this;

  // bind to port, error/exit if we cant?
  self.socket.bind("127.0.0.1", 8455); // TODO: I doubt we want to bind on all interfaces?
};

SdbHook.prototype.listenForDebugger = function() {
  var self = this;

  var server = net.createServer((conn) => {
    // handle connection
    if (self.connected) {
      // we're already connected
      conn.end("already connected"); // TODO: error?
    }
    else {
      console.log("connected to debugger");
      self.connected = true;
      self.connection = conn;
      self.connectedCallback();
      self.connection.on("data", (data) => { // TODO: verify args
        self.internalEventEmitter.emit("data", data);
      });
      self.connection.on("end", () => {});
      self.connection.on("error", () => {});
      self.connection.on("timeout", () => {});
    }
  }).listen(self.socket);
};

SdbHook.prototype.disconnectDebugger = function() {
  var self = this;

  self.connected = false;
  self.connection.end("bye\n"); // TODO: better sign off
  self.connection = null;
}

SdbHook.prototype.isConnected = function() {
  var self = this;

  return self.connected;
}

SdbHook.prototype.trigger = function(type, jsonData, callback) {
  var self = this;

  if (self.connected && self.connection != null) {
    const msgId = uuidv4();
    const jsonPayload = {
      "id": msgId,
      "type": "request",
      "content": jsonData
    };
    self.connection.write(CircularJSON.stringify(jsonPayload));

    self.internalEventEmitter.on("data", function handler(data) {
      data = CircularJSON.parse(data);
      if (data.id == msgId && data.type == "response") {
        self.internalEventEmitter.removeListener("data", handler)
        callback(data.content); // TODO: add some extra stuff to standardize the format of this content
      }
    });
  }
  else {
    callback(self.disconnectedResponse);
  }
}

module.exports = SdbHook;