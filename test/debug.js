var Web3 = require('web3');
var assert = require('assert');
var TestRPC = require("../index.js");
var fs = require("fs");
var path = require("path");
var solc = require("solc");
const async = require("async");

// Thanks solc. At least this works!
// This removes solc's overzealous uncaughtException event handler.
process.removeAllListeners("uncaughtException");

describe("Debug", function() {
  var provider;
  var web3 = new Web3();
  var accounts;
  var DebugContract;
  var debugContract;
  var sourcePath = path.join(__dirname, "DebugContract.sol");
  var source = fs.readFileSync(sourcePath, "utf8");
  var hashToTrace = null;
  var expectedValueBeforeTrace = 1234;

  before("set provider", function(done) {
    this.timeout(60000);
    async.series([
      (callback) => {
        provider = TestRPC.provider({
          "debug": true,
          "sdb": true
        }, callback);
      },

      (callback) => {
        web3.setProvider(provider);
        callback();
      }
    ], (err) => {
      if(err) throw err;

      done();
    })
  });

  before("get accounts", function(done) {
    web3.eth.getAccounts(function(err, accs) {
      if (err) return done(err);
      accounts = accs;
      done();
    });
  });

  before("compile source", function(done) {
    this.timeout(10000);
    var result = solc.compile({sources: {"DebugContract.sol": source}}, 1);

    var sourceName = "DebugContract.sol";
    var contractName = "DebugContract";
    var contractKey = sourceName + ":" + contractName;
    var sourceMap = result.contracts[contractKey].srcmapRuntime;
    var code = "0x" + result.contracts[contractKey].bytecode;
    var abi = JSON.parse(result.contracts[contractKey].interface);
    var functionHashes = result.contracts[contractKey].functionHashes;

    DebugContract = web3.eth.contract(abi);
    DebugContract._code = code;
    DebugContract.new({data: code, from: accounts[0], gas: 3141592}, function(err, instance) {
      if (err) return done(err);
      if (!instance.address) return;

      debugContract = instance;
      if (provider.manager.state.sdbHook) {
        // We need to do this to know which addresses have which source maps
        provider.manager.state.sdbHook.linkDebugSymbols(sourceName, contractName, instance.address, sourcePath, result);
      }

      done();
    });
  });

  before("set up transaction that should be traced", function(done) {
    // This should execute immediately.
    this.timeout(360000);
    debugContract.setValue(26, {from: accounts[0], gas: 3141592}, function(err, tx) {
      if (err) return done(err);

      // Check the value first to make sure it's 26
      debugContract.value({from: accounts[0], gas: 3141592}, function(err, value) {
        if (err) return done(err);

        assert.equal(value, 26);

        // Set the hash to trace to the transaction we made, so we know preconditions
        // are set correctly.
        hashToTrace = tx;

        done();
      });
    });
  });

  before("change state of contract to ensure trace doesn't overwrite data", function(done) {
    // This should execute immediately.
    debugContract.setValue(expectedValueBeforeTrace, {from: accounts[0], gas: 3141592}, function(err, tx) {
      if (err) return done(err);

      // Make sure we set it right.
      debugContract.value({from: accounts[0], gas: 3141592}, function(err, value) {
        if (err) return done(err);

        // Now that it's 85, we can trace the transaction that set it to 26.
        assert.equal(value, expectedValueBeforeTrace);

        done();
      });
    });
  });

  it("should trace a successful transaction without changing state", function(done) {
    // We want to trace the transaction that sets the value to 26
    provider.sendAsync({
      jsonrpc: "2.0",
      method: "debug_traceTransaction",
      params: [hashToTrace, []],
      id: new Date().getTime()
    }, function(err, response) {
      if (err) return done(err);

      var result = response.result;

      // To at least assert SOMETHING, let's assert the last opcode
      assert(result.structLogs.length > 0);

      var lastop = result.structLogs[result.structLogs.length - 1];

      assert.equal(lastop.op, "STOP");
      assert.equal(lastop.gasCost, 1);
      assert.equal(lastop.pc, 131);

      // Now let's make sure rerunning this transaction trace didn't change state
      debugContract.value({from: accounts[0], gas: 3141592}, function(err, value) {
        if (err) return done(err);

        // Did it change state?
        assert.equal(value, expectedValueBeforeTrace);

        // It didn't!
        done();
      });
    });
  });
})
