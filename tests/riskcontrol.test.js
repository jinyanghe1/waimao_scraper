import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/ratelimit.js';

test('熔断带原因', () => {
  const rl = new RateLimiter();
  rl.tripCircuit('触发限流');
  assert.equal(rl.tripped, true);
  assert.equal(rl.tripReason, '触发限流');
  assert.equal(rl.canContinue(), false);
});

test('连续失败3次自动熔断并带原因', () => {
  const rl = new RateLimiter();
  rl.recordFailure(); rl.recordFailure(); rl.recordFailure();
  assert.equal(rl.tripped, true);
  assert.match(rl.tripReason, /连续失败/);
});
