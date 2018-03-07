var uuidv4 = require("uuid/v4");

const CircularJSON = require("circular-json");

var LibSdbRuntime = require("solidity-debugger").LibSdbRuntime;

function SdbHook(options, callback) {
  var self = this;

  options = options || {};

  this.options = options;
  this.logger = options.logger || console;

  this.sdbPort = options.sdbPort ? options.sdbPort + "" : "8455"; // TODO: should we have two default port definitions?

  this.sdbRuntime;

  this.connected = false;
  
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

  this.jumpDestinations = {};

  this.fastStep = true;

  this.attachToDebugger();
};

SdbHook.prototype.attachToDebugger = function() {
  var self = this;

  self.sdbRuntime = new LibSdbRuntime();
  self.sdbRuntime._interface.serve("127.0.0.1", self.sdbPort, () => {
    self.connected = true;
    if (typeof self.connectedCallback == "function") {
      self.connectedCallback();
    }
    self.sdbRuntime._interface.evm = self;
    self.sdbRuntime.start();
  });
};

SdbHook.prototype.disconnectDebugger = function() {
  var self = this;

  self.connected = false;
}

SdbHook.prototype.isConnected = function() {
  var self = this;

  return self.connected;
}

SdbHook.prototype.ping = function(callback) {
  this.sdbRuntime._interface.ping(callback);
}

SdbHook.prototype.handleMessage = function(data) {
  var self = this;

  if (data.id in self.messageQueue && data.messageType === "response") {
    if (typeof data.content === 'object' && data.content !== null && "fastStep" in data.content) {
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
            self.vm.stateManager.getContractStorage(data.content.address, data.content.position, (err, value) => {
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
              if (self.breakpoints[i].id === data.content.id && self.breakpoints[i].address === data.content.address) {
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
        case "sendJumpDestinations":
          self.jumpDestinations[data.content.address] = data.content.jumpDestinations;
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
          self.trigger("response", {
            "id": data.id,
            "messageType": "response",
            "triggerType": "response",
            "content": {
              "message": "ok"
            }
          });
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
        jsonData.specialEvents = [];

        if (jsonData.opcode.name === "DELEGATECALL") {
          // need to know about callstack and vunction parameter locations
          sendMessage = true;
        }

        if (address in self.jumpDestinations && self.jumpDestinations[address].indexOf(pc) >= 0) {
          // debugger needs to know about declarations, send it along
          sendMessage = true;
          jsonData.specialEvents.push("fnJumpDestination");
        }
        else if (jsonData.opcode.name === "JUMP" || jsonData.opcode.name === "JUMPI" || jsonData.opcode.name === "JUMPDEST") {
          // need to know about callstack and vunction parameter locations
          sendMessage = true;
          jsonData.specialEvents.push("jump");
        }

        if (address in self.variableDeclarations && self.variableDeclarations[address].indexOf(pc) >= 0) {
          // debugger needs to know about declarations, send it along
          sendMessage = true;
          jsonData.specialEvents.push("declaration");
        }

        let i;
        for (i = 0; i < self.breakpoints.length; i++) {
          if (self.breakpoints[i].pc === pc && self.breakpoints[i].address === address) {
            sendMessage = true;
            jsonData.specialEvents.push("breakpoint");
            break;
          }
        }

        if (!self.fastStep) {
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

        this.messageQueue[msgId] = callback;
        self.sdbRuntime._interface.receiveFromEvm(jsonPayload);
      }
      else {
        callback();
      }
    }
    else {
      jsonPayload = jsonData;

      self.sdbRuntime._interface.receiveFromEvm(jsonPayload);

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