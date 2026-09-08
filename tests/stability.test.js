import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSessionHealth, withRetry, cooldownAdvice } from '../src/stability.js';
import { RateLimiter } from '../src/ratelimit.js';

// ============ 功能 1：checkSessionHealth ============

test('checkSessionHealth：正常已登录页面 → ok:true', async () => {
  const mockPage = {
    url: () => 'https://waimao.office.163.com/#wmData',
    evaluate: async () => '工作台 客户发现',
  };
  const r = await checkSessionHealth(mockPage);
  assert.equal(r.ok, true);
});

test('checkSessionHealth：登录页 URL → ok:false, reason:login_expired', async () => {
  const loginPage = {
    url: () => 'https://waimao.office.163.com/login/',
    evaluate: async () => '扫码登录',
  };
  const r = await checkSessionHealth(loginPage);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'login_expired');
  assert.equal(r.action, '请重新登录');
});

test('checkSessionHealth：页面文本含登录提示 → login_expired', async () => {
  const page = {
    url: () => 'https://waimao.office.163.com/#wmData',
    evaluate: async () => '密码登录 手机验证 立即登录',
  };
  const r = await checkSessionHealth(page);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'login_expired');
});

test('checkSessionHealth：页面提示操作频繁 → rate_limited', async () => {
  const page = {
    url: () => 'https://waimao.office.163.com/#wmData',
    evaluate: async () => '操作频繁，请稍后再试',
  };
  const r = await checkSessionHealth(page);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rate_limited');
  assert.equal(r.action, '触发限流');
});

test('checkSessionHealth：evaluate 抛错时不应崩溃，返回 ok:false', async () => {
  const page = {
    url: () => 'https://waimao.office.163.com/#wmData',
    evaluate: async () => { throw new Error('detached'); },
  };
  const r = await checkSessionHealth(page);
  assert.equal(typeof r.ok, 'boolean');
});

// ============ 功能 2：withRetry ============

test('withRetry：前两次失败后第三次成功，返回结果', async () => {
  let n = 0;
  const r = await withRetry(
    async () => { n++; if (n < 3) throw new Error('x'); return 'ok'; },
    { retries: 3, backoffMs: 10 },
  );
  assert.equal(r, 'ok');
  assert.equal(n, 3);
});

test('withRetry：一直失败抛最后一次错误', async () => {
  let n = 0;
  await assert.rejects(
    withRetry(
      async () => { n++; throw new Error('always'); },
      { retries: 2, backoffMs: 10 },
    ),
    /always/,
  );
  assert.equal(n, 3); // 1 次原始 + 2 次重试
});

test('withRetry：默认参数 retries=2 backoffMs=2000', async () => {
  let n = 0;
  await assert.rejects(
    withRetry(async () => { n++; throw new Error('x'); }, { backoffMs: 1 }),
  );
  assert.equal(n, 3); // 默认 retries=2 → 共 3 次尝试
});

test('withRetry：onRetry 回调被触发', async () => {
  const calls = [];
  await assert.rejects(
    withRetry(
      async () => { throw new Error('boom'); },
      { retries: 2, backoffMs: 1, onRetry: (attempt, err) => calls.push([attempt, err.message]) },
    ),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 1);
  assert.equal(calls[0][1], 'boom');
  assert.equal(calls[1][0], 2);
});

test('withRetry：首次成功不调用 onRetry', async () => {
  const calls = [];
  const r = await withRetry(async () => 'fine', {
    retries: 3,
    backoffMs: 1,
    onRetry: () => calls.push(1),
  });
  assert.equal(r, 'fine');
  assert.equal(calls.length, 0);
});

// ============ 功能 3：cooldownAdvice ============

test('cooldownAdvice：触发限流 → 含 分钟后 和具体时间', () => {
  const s = cooldownAdvice('触发限流');
  assert.equal(typeof s, 'string');
  assert.match(s, /分钟后/);
  assert.match(s, /\d{1,2}:\d{2}/); // 含具体时间
  assert.match(s, /60/);
});

test('cooldownAdvice：登录态失效 → 含 重新登录', () => {
  const s = cooldownAdvice('登录态失效');
  assert.match(s, /重新登录/);
});

test('cooldownAdvice：出现验证码/滑块 → 含 人工 / 滑块', () => {
  const s = cooldownAdvice('出现验证码/滑块');
  assert.match(s, /人工|滑块/);
});

test('cooldownAdvice：未知原因 → 返回通用冷却建议', () => {
  const s = cooldownAdvice('连续失败3次');
  assert.equal(typeof s, 'string');
  assert.ok(s.length > 0);
});

test('cooldownAdvice：tripReason 为空 → 仍返回字符串', () => {
  const s = cooldownAdvice();
  assert.equal(typeof s, 'string');
});

// ============ ratelimit.js 集成：trippedAt ============

test('RateLimiter.tripCircuit 记录 trippedAt 时间戳', () => {
  const rl = new RateLimiter();
  const before = Date.now();
  rl.tripCircuit('触发限流');
  const after = Date.now();
  assert.equal(typeof rl.trippedAt, 'number');
  assert.ok(rl.trippedAt >= before && rl.trippedAt <= after);
});
