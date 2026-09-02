// 登录态管理：检测 → 自动弹登录浏览器 → 保存会话
// 用法: node src/login.js
//   无参数: 检测当前会话是否有效，无效则弹窗引导登录
//   --check: 仅检测，不弹窗，退出码 0=有效 1=无效
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, '.profile');
const BASE = 'https://waimao.office.163.com';
const CHECK_ONLY = process.argv.includes('--check');

async function checkLoggedIn() {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find((p) => p.url().includes('waimao.office.163.com'));
    if (!page) return { ok: false, reason: 'no_page' };
    const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const onLogin = /\/login/.test(page.url()) || /密码登录|扫码登录|手机验证|立即登录/.test(txt.slice(0, 400));
    await browser.close().catch(() => {});
    return { ok: !onLogin, reason: onLogin ? 'login_page' : 'ok', url: page.url() };
  } catch (e) {
    return { ok: false, reason: 'no_cdp', error: e.message.slice(0, 50) };
  }
}

const status = await checkLoggedIn();
if (CHECK_ONLY) {
  console.log(JSON.stringify(status));
  process.exit(status.ok ? 0 : 1);
}

if (status.ok) {
  console.log('✅ 登录态有效，无需重新登录:', status.url);
  process.exit(0);
}

console.log('⚠️ 登录态无效 (' + status.reason + ')，启动登录引导…');
console.log('');
console.log('━━━ 请按以下步骤操作 ━━━');
console.log('1. 接下来会弹出一个浏览器窗口（网易外贸通登录页）');
console.log('2. 请在窗口里用外贸通账号登录（扫码或密码均可）');
console.log('3. 登录成功后窗口会自动检测并保存会话，然后自动关闭');
console.log('4. 如果窗口没有自动弹出，请检查任务栏/Dock');
console.log('');

// 启动持久化浏览器登录
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: null,
  args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.bringToFront().catch(() => {});

// 轮询检测登录成功
const deadline = Date.now() + 15 * 60 * 1000;
let ok = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const url = page.url();
  const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const onLogin = /\/login/.test(url) || /密码登录|扫码登录|手机验证/.test(txt.slice(0, 300));
  process.stdout.write(onLogin ? '.' : '!');
  if (!onLogin && url.startsWith(BASE)) { ok = true; break; }
}
console.log('');
if (ok) {
  await page.waitForTimeout(3000);
  console.log('✅ 登录成功！会话已保存。');
  console.log('   提示：会话保存在本地浏览器 profile 中，通常数天内有效。');
} else {
  console.log('❌ 登录超时（15分钟），请重试。');
}
await ctx.close();
process.exit(ok ? 0 : 1);
