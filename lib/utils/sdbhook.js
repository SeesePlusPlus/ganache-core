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

  this.addressNotMonitoredResponse = {
    "status": "error",
    "data": "addressNotMonitored"
  };

  this.connectedCallback = callback;

  this.compilationResult = {};

  this.initialize();
  this.listenForDebugger();
};

SdbHook.prototype.initialize = function() {
  var self = this;

  // bind to port, error/exit if we cant?
  self.socket.bind("127.0.0.1", self.sdbPort); // TODO: I doubt we want to bind on all interfaces?
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
    if (type == "step") {
      /*if (!(jsonData.address.toString("hex") in self.monitoredContracts)) {
        // we're not monitoring this address, we're not going to send it to the debugger
        callback(null, self.addressNotMonitoredResponse);
        return;
      }*/
    }

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

      self.connection.write(CircularJSON.stringify(jsonPayload));

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

      self.connection.write(CircularJSON.stringify(jsonPayload));
    }
  }
  else {
    callback(null, self.disconnectedResponse);
  }
}

SdbHook.prototype.monitorContract = function(address, code) {
  var self = this;

  /*const cleanedAddress = address.replace("0x", "");

  if (cleanedAddress in self.monitoredContracts) {
    self.monitoredContracts[cleanedAddress].bytecode = code;
  }
  else {
    self.monitoredContracts[cleanedAddress] = {
      "bytecode": code.replace("0x", ""),
      "sourceName": null,
      "sourceMap": null,
      "sourcePath": null,
      "lineBreaks": null,
      "functionHashes": null
    };
  }

  self.trigger("monitoredContractsChanged", self.monitoredContracts, (err, responseContent) => {
    if (responseContent && "status" in responseContent && responseContent.status == "error") {
      console.log("cant send addresses because debugger isnt connected");
    }
    else {
      console.log("new contract addresses received");
    }
  });*/
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