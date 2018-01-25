var uuidv4 = require("uuid/v4");
var events = require("events");
var WebSocket = require("ws");
var TCP = process.binding('tcp_wrap').TCP;
var CircularJSON = require("circular-json");

function SdbHook(options, callback) {
  var self = this;

  options = options || {};

  this.options = options;
  this.logger = options.logger || console;

  this.sdbPort = options.sdbPort || "8455"; // TODO: should we have two default port definitions?

  this.ws = null;

  this.connected = false;

  this.internalEventEmitter = new events.EventEmitter();
  
  this.disconnectedResponse = { // TODO: better place to put this?
    "status": "error",
    "data": "disconnected"
  };

  this.addressNotMonitoredResponse = {
    "status": "error",
    "data": "addressNotMonitored"
  };

  this.connectedCallback = callback;

  this.compilationResult = {};

  this.attachToDebugger();
};

SdbHook.prototype.attachToDebugger = function() {
  var self = this;

  var url = "ws://" + "127.0.0.1" + ":" + self.sdbPort;
  self.ws = new WebSocket(url, {
    "handshakeTimeout": 10000
  });

  self.ws.on("open", () => {
    console.log("connected to debugger");
    self.connected = true;
    self.connectedCallback();
  });

  self.ws.on("message", (message) => {
    self.internalEventEmitter.emit("data", message);
  });
};

SdbHook.prototype.disconnectDebugger = function() {
  var self = this;

  self.connected = false;
  self.ws.close(); // TODO: better sign off
}

SdbHook.prototype.isConnected = function() {
  var self = this;

  return self.connected;
}

SdbHook.prototype.trigger = function(type, jsonData, callback) {
  var self = this;

  if (self.connected) {
    let jsonPayload;
    const messageType = type === "response" ? "response" : "request";
    if (messageType === "request") {
      const msgId = uuidv4();
      jsonPayload = {
        "id": msgId,
        "messageType": messageType,
        "triggerType": type,
        "content": jsonData
      };

      const message = CircularJSON.stringify(jsonPayload);
      self.ws.send(message);

      // only wait/listen for a resposne if we're requesting one, duh
      self.internalEventEmitter.on("data", function handler(data) {
        data = CircularJSON.parse(data);
        if (data.id === msgId && data.messageType === "response") {
          self.internalEventEmitter.removeListener("data", handler);
          callback(null, data); // TODO: add some extra stuff to standardize the format of this content
        }
        else if (data.messageType === "request") {
          callback(null, data);
        }
      });
    }
    else {
      jsonPayload = jsonData;

      const message = CircularJSON.stringify(jsonPayload);
      self.ws.send(message);
    }
  }
  else {
    callback(null, self.disconnectedResponse);
  }
}

SdbHook.prototype.linkCompilerOutput = function(compilationResult) {
  var self = this;

  self.trigger("linkCompilerOutput", compilationResult, (err, responseContent) => {
    if (responseContent && "status" in responseContent && responseContent.status == "error") {
      console.log("cant send compilation results because debugger isnt connected");
    }
    else {
      console.log("compilation results received");
    }
  });
}

SdbHook.prototype.linkContractAddress = function(sourcePath, contractName, address) {
  var self = this;

  const cleanedAddress = address.replace(/0x/gi, "");
  const data = {
    sourcePath,
    contractName,
    "address": cleanedAddress
  };

  self.trigger("linkContractAddress", data, (err, responseContent) => {
    if (responseContent && "status" in responseContent && responseContent.status == "error") {
      console.log("cant send contract address (" + sourcePath + ":" + contractName + ", " + address + ") results because debugger isnt connected");
    }
    else {
      console.log("contract address (" + sourcePath + ":" + contractName + ", " + address + ") received");
    }
  });
}

module.exports = SdbHook;