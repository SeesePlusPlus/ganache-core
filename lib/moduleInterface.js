
const AsyncEventEmitter = require("async-eventemitter");

function ModuleInterface(options) {
  this.options = options;
  this.vm = null;
  this.initalized = false;
}

ModuleInterface.prototype = Object.create(AsyncEventEmitter.prototype);
ModuleInterface.prototype.constructor = Provider;

ModuleInterface.prototype.initialize = function(vm) {
  this.initalized = true;
  this.vm = vm;

  this.registerListeners();
}

ModuleInterface.prototype.registerListeners = function() {
  if (this.initalized && this.vm !== null) {
    this.vm.on("step", function(data, callback) {
      this.emit("vm.step", data, callback);
    });

    this.vm.on("newContract", function(data, callback) {
      this.emit("vm.newContract", data, callback);
    });

    this.vm.on("beforeBlock", function(data, callback) {
      this.emit("vm.beforeBlock", data, callback);
    });

    this.vm.on("afterBlock", function(data, callback) {
      this.emit("vm.afterBlock", data, callback);
    });

    this.vm.on("beforeTx", function(data, callback) {
      this.emit("vm.beforeTx", data, callback);
    });

    this.vm.on("afterTx", function(data, callback) {
      this.emit("vm.afterTx", data, callback);
    });
  }
}

module.exports = ModuleInterface;
