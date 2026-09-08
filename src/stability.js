// 稳定性工具：登录态预警 / 失败重试 / 风控冷却建议
// 独立模块，不依赖 playwright（通过传入 page 对象便于测试）

// 登录态预警：检测当前 page 是否处于已登录且未触发风控状态
// 返回 { ok, reason, action }
export async function checkSessionHealth(page) {
  let url = '';
  let txt = '';
  try {
    url = String(page?.url?.() || '');
  } catch { /* 忽略 */ }
  try {
    const t = await page.evaluate(() => document.body?.innerText || '');
    txt = String(t || '');
  } catch (e) {
    return { ok: false, reason: 'page_error', action: '页面不可用：' + (e?.message || '').slice(0, 50) };
  }

  const head = txt.slice(0, 400);
  if (/\/login/.test(url) || /密码登录|扫码登录|手机验证|立即登录/.test(head)) {
    return { ok: false, reason: 'login_expired', action: '请重新登录' };
  }
  if (/操作频繁|稍后再试|访问过于频繁|请求过于频繁|too many/i.test(txt)) {
    return { ok: false, reason: 'rate_limited', action: '触发限流' };
  }
  if (/滑块|拖动滑块|安全验证|人机验证|captcha/i.test(txt)) {
    return { ok: false, reason: 'captcha', action: '出现验证码/滑块，请人工处理' };
  }
  return { ok: true, reason: 'ok', action: '正常' };
}

// 失败自动重试（指数退避）
// fn 成功后返回结果；全部失败抛最后一次错误
export async function withRetry(fn, { retries = 2, backoffMs = 2000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        if (typeof onRetry === 'function') {
          try { onRetry(attempt + 1, err); } catch { /* 回调异常不影响重试 */ }
        }
        const wait = backoffMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// 风控冷却时间提示：根据触发原因返回建议文案
// 返回字符串
export function cooldownAdvice(tripReason, { now = () => Date.now() } = {}) {
  const fmt = (ts) => {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };
  const reason = String(tripReason || '');

  if (/触发限流|操作频繁|频繁|too many/i.test(reason)) {
    const minutes = 60;
    const resumeAt = fmt(now() + minutes * 60 * 1000);
    return `触发限流，建议冷却 ${minutes} 分钟后再试（约 ${resumeAt} 后恢复）。期间请勿操作采集或登录页。`;
  }
  if (/登录态失效|登录过期|login/i.test(reason)) {
    return '登录态失效：请立即重新登录（运行 node src/login.js），登录成功后再启动采集。';
  }
  if (/验证码|滑块|captcha/i.test(reason)) {
    return '出现验证码/滑块：请在浏览器中人工完成滑块验证后再继续采集；如频繁出现，请冷却 30 分钟。';
  }
  // 通用
  const minutes = 15;
  const resumeAt = fmt(now() + minutes * 60 * 1000);
  return `已熔断（${reason || '未知原因'}），建议冷却 ${minutes} 分钟后再试（约 ${resumeAt} 后恢复）。`;
}
