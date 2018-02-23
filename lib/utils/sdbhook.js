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

  this.vm;

  this.messageQueue = {};

  this.breakpoints = [];

  this.variableDeclarations = {};

  this.fastStep = true;

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
    if (typeof self.connectedCallback == "function") {
      self.connectedCallback();
    }
  });

  self.ws.on("message", (message) => {
    self.handleMessage(message);
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

SdbHook.prototype.handleMessage = function(message) {
  var self = this;

  const data = CircularJSON.parse(message);
  if (data.id in self.messageQueue && data.messageType === "response") {
    if (typeof data.content === 'object' && data.content !== null && "fastStep" in data.content) {
      if (!self.fastStep && data.content.fastStep) {
        console.log('switching to fast');
      }
      self.fastStep = data.content.fastStep;
    }
    if (typeof self.messageQueue[data.id] === "function") {
      self.messageQueue[data.id](null, data); // TODO: add some extra stuff to standardize the format of this content
    }
    delete self.messageQueue[data.id];
  }
  else if (data.messageType === "request") {
    this.messageQueue[data.id] = null; // no need for a callback here?

    if (typeof data.content === 'object' && data.content !== null) {
      switch (data.content.type) {
        case "injectNewCode":
          // debugger wants to upload new code
          let m = "";
          if (self.vm) {
            const content = data.content;
            content.cb = self.messageQueue[content.stepId] || function() {};
            self.vm.emit("injectNewCode", content);
            if (content.stepId in self.messageQueue) {
              delete self.messageQueue[content.stepId];
            }
            m = "Code Injected";
          }
          else {
            m = "Error: sdbhook.vm is undefined";
          }
          self.trigger("response", {
            "id": data.id,
            "messageType": "response",
            "triggerType": "response",
            "content": {
              "message": m
            }
          });
          break;
        case "getStorage":
          if (self.vm) {
            self.vm.stateManager.getContractStorage(data.content.address, data.content.position.data, (err, value) => {
              let m = "Retrieved Storage Value";
              if (err) {
                m = "Error Retrieving Storage Value"
              }

              self.trigger("response", {
                "id": data.id,
                "messageType": "response",
                "triggerType": "response",
                "content": {
                  "message": m,
                  "value": value
                }
              });
            });
          }
          else {
            self.trigger("response", {
              "id": data.id,
              "messageType": "response",
              "triggerType": "response",
              "content": {
                "message": "Error: sdbhook.vm is undefined"
              }
            });
          }

          break;
        case "sendBreakpoint":
          if (data.content.enabled) {
            // add breakpoint if it doesnt exist
            let i;
            for (i = 0; i < self.breakpoints.length; i++) {
              if (self.breakpoints[i].id === data.content.id) {
                break;
              }
            }
            if (i >= self.breakpoints.length) {
              // doesn't exist, add it
              self.breakpoints.push({
                "id": data.content.id,
                "address": data.content.address,
                "pc": data.content.pc
              });
            }
          }
          else {
            // remove breakpoint
            for (let i = 0; i < self.breakpoints.length; i++) {
              if (self.breakpoints[i].id === data.content.id) {
                self.breakpoints.splice(i, 1);
                break;
              }
            }
          }
          self.trigger("response", {
            "id": data.id,
            "messageType": "response",
            "triggerType": "response",
            "content": {
              "message": "ok"
            }
          });
          break;
        case "sendDeclarations":
          self.variableDeclarations[data.content.address] = data.content.declarations;
          self.trigger("response", {
            "id": data.id,
            "messageType": "response",
            "triggerType": "response",
            "content": {
              "message": "ok"
            }
          });
          break;
        default:
          // we havent implemented this type yet
          callback();
          break;
      }
    }
  }
}

SdbHook.prototype.trigger = function(type, jsonData, callback) {
  var self = this;

  if (self.connected) {
    let jsonPayload;
    const messageType = type === "response" ? "response" : "request";
    if (messageType === "request") {
      let sendMessage = false;
      if (type === "step") {
        const pc = jsonData.pc;
        const address = jsonData.address.toString("hex").toLowerCase();

        if (address in self.variableDeclarations && self.variableDeclarations[address].indexOf(pc) >= 0) {
          // debugger needs to know about declarations, send it along
          sendMessage = true;
        }

        if (!sendMessage && self.fastStep) { // haven't already decided to send message, so lets see if we're at a breakpoint
          let i;
          for (i = 0; i < self.breakpoints.length; i++) {
            if (self.breakpoints[i].pc === pc && self.breakpoints[i].address === address) {
              sendMessage = true;
              break;
            }
          }
          if (i >= self.breakpoints.length) {
            // didn't hit a breakpoint, so let's continue
            sendMessage = false;
          }
        }
        else if (!self.fastStep) {
          sendMessage = true;
        }
      }
      else {
        sendMessage = true;
      }

      if (sendMessage) {
        const msgId = uuidv4();
        jsonPayload = {
          "id": msgId,
          "messageType": messageType,
          "triggerType": type,
          "content": jsonData
        };

        const message = CircularJSON.stringify(jsonPayload);
        this.messageQueue[msgId] = callback;
        self.ws.send(message);
      }
      else {
        callback();
      }
    }
    else {
      jsonPayload = jsonData;

      const message = CircularJSON.stringify(jsonPayload);
      self.ws.send(message);

      if (jsonPayload.id in self.messageQueue) {
        // can ignore calling the callback as the sending of the message is the callback
        // just delete it from the queue
        delete self.messageQueue[jsonPayload.id];
      }
    }
  }
  else {
    callback(null, self.disconnectedResponse);
  }
}

SdbHook.prototype.linkCompilerOutput = function(sourceRootPath, compilationResult, callback) {
  var self = this;

  const data = {
    sourceRootPath,
    compilationResult
  };

  self.trigger("linkCompilerOutput", data, (err, responseContent) => {
    if (responseContent && "status" in responseContent && responseContent.status == "error") {
      console.log("cant send compilation results because debugger isnt connected");
    }
    else {
      console.log("compilation results received");
    }
    callback();
  });
}

SdbHook.prototype.linkContractAddress = function(contractName, address, callback) {
  var self = this;

  const cleanedAddress = address.replace(/0x/gi, "");
  const data = {
    contractName,
    "address": cleanedAddress
  };

  self.trigger("linkContractAddress", data, (err, responseContent) => {
    if (responseContent && "status" in responseContent && responseContent.status == "error") {
      console.log("cant send contract address (" + contractName + ", " + address + ") results because debugger isnt connected");
    }
    else {
      console.log("contract address (" + contractName + ", " + address + ") received");
    }
    callback();
  });
}

module.exports = SdbHook;