import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNumbers, mergeSavedFields } from '../src/web/public/form-utils.js';

test('numeric settings reject empty, fractional and out-of-range values', () => {
  for (const value of ['', '-1', '2.5', 'Infinity', '86401']) {
    assert.ok(checkNumbers([{path:'leveling.xpMin',type:'number',value}]));
  }
  assert.equal(checkNumbers([{path:'leveling.xpMin',type:'number',value:'15'}]),null);
});
test('level ranges and starboard limits are checked before any save', () => {
  assert.ok(checkNumbers([{path:'leveling.xpMin',type:'number',value:'30'},{path:'leveling.xpMax',type:'number',value:'20'}]).order);
  assert.ok(checkNumbers([{path:'starboard.threshold',type:'number',value:'51'}]));
  assert.equal(checkNumbers([{path:'starboard.threshold',type:'number',value:'3'}]),null);
});
test('saving one section preserves the baseline of unrelated drafts', () => {
  const baseline = [['welcome.message','old'],['leveling.xpMin','15']];
  assert.deepEqual(mergeSavedFields(baseline,[['welcome.message','new']]),[['welcome.message','new'],['leveling.xpMin','15']]);
  assert.deepEqual(baseline,[['welcome.message','old'],['leveling.xpMin','15']]);
});
