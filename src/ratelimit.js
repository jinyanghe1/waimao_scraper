// 限速器：拟人节奏 + 失败退避 + 日上限熔断 + 风控检测
export class RateLimiter {
  constructor({ minMs = 2000, maxMs = 5000, dailyPageCap = 10, dailyItemCap = 200, now = () => Date.now() } = {}) {
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.dailyPageCap = dailyPageCap;
    this.dailyItemCap = dailyItemCap;
    this.now = now;
    this.pagesToday = 0;
    this.itemsToday = 0;
    this.consecutiveFailures = 0;
    this.tripped = false; // 熔断标志
    this.tripReason = '';
  }

  // 随机拟人延时（均匀分布 + 简单抖动）
  nextDelayMs(rand = Math.random) {
    const span = this.maxMs - this.minMs;
    return Math.round(this.minMs + rand() * span);
  }

  // 记录一页/一条，返回是否触及日上限
  recordPage() { this.pagesToday++; return this.pagesToday >= this.dailyPageCap; }
  recordItems(n = 1) { this.itemsToday += n; return this.itemsToday >= this.dailyItemCap; }

  // 失败退避：返回本次应等待的毫秒数；连续失败 >=3 触发熔断
  recordFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) this.tripCircuit('连续失败3次');
    return Math.min(2000 * 2 ** (this.consecutiveFailures - 1), 30000);
  }
  recordSuccess() { this.consecutiveFailures = 0; }

  canContinue() {
    return !this.tripped && this.pagesToday < this.dailyPageCap && this.itemsToday < this.dailyItemCap;
  }

  // 触发风控（滑块/429/限流提示）→ 立即熔断
  tripCircuit(reason = '') { this.tripped = true; this.tripReason = reason; }
}

// 风控检测：页面是否出现限流/验证码/滑块
export async function detectRiskControl(page) {
  try {
    return await page.evaluate(() => {
      const t = document.body?.innerText || '';
      const url = location.href;
      if (/\/login/.test(url) || /密码登录|扫码登录|立即登录/.test(t.slice(0, 300))) return '登录态失效';
      if (/操作频繁|稍后再试|访问过于频繁|请求过于频繁|too many/i.test(t)) return '触发限流';
      if (/滑块|拖动滑块|安全验证|人机验证|captcha/i.test(t)) return '出现验证码/滑块';
      return null;
    });
  } catch { return null; }
}
