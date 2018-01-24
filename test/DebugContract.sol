pragma solidity ^0.4.2;

// Changes to this file will make tests fail.
contract DebugContract {
  uint public value = 5;

  function setValue(uint _val) {
    uint256 newVal = 108;
    uint256 nextVal = newVal / 2;
    newVal += 1;
    uint256 priorVal = nextVal * _val;
    value = calcValue(priorVal);
  }

  function calcValue(uint _val) returns (uint256) {
    uint nextVal = _val * 2;
    return nextVal;
  }
}
