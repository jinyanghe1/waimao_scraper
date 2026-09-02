// 限速器：拟人节奏 + 失败退避 + 日上限熔断
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
    if (this.consecutiveFailures >= 3) this.tripped = true;
    return Math.min(2000 * 2 ** (this.consecutiveFailures - 1), 30000); // 2s/4s/8s...封顶30s
  }
  recordSuccess() { this.consecutiveFailures = 0; }

  canContinue() {
    return !this.tripped && this.pagesToday < this.dailyPageCap && this.itemsToday < this.dailyItemCap;
  }

  // 触发风控（滑块/429）→ 立即熔断
  tripCircuit() { this.tripped = true; }
}
