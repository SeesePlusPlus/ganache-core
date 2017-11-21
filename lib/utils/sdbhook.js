var uuidv4 = require("uuid/v4");
var events = require("events");
var net = require("net");
var TCP = process.binding('tcp_wrap').TCP;

function SdbHook(options) {
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
};

SdbHook.prototype.initialize = function() {
  // bind to port, error/exit if we cant?
  self.socket.bind("0.0.0.0", self.sdbPort); // TODO: I doubt we want to bind on all interfaces?
};

SdbHook.prototype.listenForDebugger = function() {
  var server = net.createServer((conn) => {
    // handle connection
    if (self.connected) {
      // we're already connected
      conn.end("already connected"); // TODO: error?
    }
    else {
      self.connected = true;
      self.connection = conn;
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
  self.connected = false;
  self.connection.end("bye\n"); // TODO: better sign off
  self.connection = null;
}

SdbHook.prototype.isConnectied = function() {
  return self.connected;
}

SdbHook.prototype.trigger = function(type, jsonData, callback) {
  if (self.connected && self.connection != null) {
    const msgId = uuidv4();
    const jsonPayload = {
      "id": msgId,
      "type": "request",
      "content": jsonData
    };
    self.connection.write(JSON.stringify(jsonPayload));

    self.internalEventEmitter.on("data", function handler(data) {
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