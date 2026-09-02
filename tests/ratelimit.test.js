import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/ratelimit.js';

test('限速器：延时时长在 [minMs, maxMs] 区间', () => {
  const rl = new RateLimiter({ minMs: 2000, maxMs: 5000 });
  for (let i = 0; i < 100; i++) {
    const d = rl.nextDelayMs();
    assert.ok(d >= 2000 && d <= 5000, `delay ${d} 应在区间内`);
  }
});

test('限速器：达到日页数上限后 canContinue=false', () => {
  const rl = new RateLimiter({ dailyPageCap: 3 });
  assert.equal(rl.recordPage(), false);
  assert.equal(rl.recordPage(), false);
  assert.equal(rl.recordPage(), true); // 触顶
  assert.equal(rl.canContinue(), false);
});

test('限速器：达到日条目上限后熔断', () => {
  const rl = new RateLimiter({ dailyItemCap: 5 });
  rl.recordItems(5);
  assert.equal(rl.canContinue(), false);
});

test('限速器：失败退避指数增长且连续3次触发熔断', () => {
  const rl = new RateLimiter();
  assert.equal(rl.recordFailure(), 2000);
  assert.equal(rl.recordFailure(), 4000);
  rl.recordFailure();
  assert.equal(rl.tripped, true);
  assert.equal(rl.canContinue(), false);
});

test('限速器：成功后重置连续失败计数', () => {
  const rl = new RateLimiter();
  rl.recordFailure(); rl.recordFailure();
  rl.recordSuccess();
  assert.equal(rl.consecutiveFailures, 0);
  assert.equal(rl.tripped, false);
});

test('限速器：tripCircuit 立即熔断', () => {
  const rl = new RateLimiter();
  rl.tripCircuit();
  assert.equal(rl.canContinue(), false);
});
