// 采集器 v2：列表翻页 + 详情电话/社媒 + 限速 + CSV + 断点续传
// 用法: node src/index.js [keyword] [maxPages] [--detail]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseListData } from './parser.js';
import { CsvWriter } from './csv.js';
import { RateLimiter } from './ratelimit.js';
import { ProgressStore } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYWORD = process.argv[2] || 'cargo';
const MAX_PAGES = parseInt(process.argv[3] || '2', 10);
const WITH_DETAIL = process.argv.includes('--detail');
const RUN_TAG = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const CSV_PATH = path.join(ROOT, 'data', `leads_${KEYWORD}_${RUN_TAG}.csv`);
const PROGRESS_PATH = path.join(ROOT, 'data', 'progress.json');

const rl = new RateLimiter({ minMs: 2500, maxMs: 6000, dailyPageCap: 30, dailyItemCap: 500 });
const csv = new CsvWriter(CSV_PATH);
const progress = new ProgressStore(PROGRESS_PATH);
console.log(`[启动] 关键词=${KEYWORD} 页数=${MAX_PAGES} 详情=${WITH_DETAIL} 输出=${path.basename(CSV_PATH)}`);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('waimao.office.163.com'));
if (!page) { console.error('❌ 未找到外贸通标签页'); process.exit(1); }
await page.bringToFront().catch(() => {});

const bodyTxt = await page.evaluate(() => document.body?.innerText || '');
if (/\/login/.test(page.url()) || /密码登录|扫码登录|立即登录/.test(bodyTxt.slice(0, 400))) {
  console.error('❌ 登录态失效'); process.exit(1);
}
console.log('[登录态] OK');

// 列表响应拦截
let pendingList = null;
page.on('response', async (res) => {
  if (res.url().includes('/list/buyers/async') && res.status() === 200 && pendingList) {
    try { const j = await res.json(); if (j?.data?.records) { const r = pendingList; pendingList = null; r(j.data); } } catch {}
  }
});
const waitList = (t = 20000) => new Promise((res, rej) => {
  pendingList = res;
  setTimeout(() => { if (pendingList) { pendingList = null; rej(new Error('列表响应超时')); } }, t);
});

// 详情响应拦截（detail/new）
let pendingDetail = null;
page.on('response', async (res) => {
  if (res.url().includes('/globalSearch/v1/detail/new') && res.status() === 200 && pendingDetail) {
    try { const j = await res.json(); if (j?.data) { const r = pendingDetail; pendingDetail = null; r(j.data); } } catch {}
  }
});
const waitDetail = (t = 15000) => new Promise((res) => {
  pendingDetail = res;
  setTimeout(() => { if (pendingDetail) { pendingDetail = null; res(null); } }, t); // 超时返回 null 不抛错
});

// 关弹窗
await page.evaluate(() => {
  document.querySelectorAll('.ant-modal-wrap').forEach((m) => { const c = m.querySelector('.ant-modal-close'); if (c) c.click(); else m.style.display = 'none'; });
});

let totalWritten = 0;
const allRows = [];

// 详情采集：点当前列表第 rowIndex 行的公司名开抽屉，抓 detail/new，再关闭
async function fetchDetail(rowIndex, companyName) {
  try {
    const p = waitDetail(15000);
    // 精确点击表格中匹配公司名的链接（表格外文本不点）
    const opened = await page.evaluate((name) => {
      const first = (name || '').split(' ')[0].toLowerCase();
      const cells = [...document.querySelectorAll('table a, table [class*=company], tbody a, [class*=table] a')];
      const target = cells.find((e) => {
        const t = (e.innerText || '').trim().toLowerCase();
        return t && first && t.includes(first) && e.offsetParent;
      });
      if (target) { target.click(); return (target.innerText || '').trim(); }
      return null;
    }, companyName);
    if (!opened) return null;
    const d = await p; // 超时返回 null
    // 关闭抽屉/弹窗
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      document.querySelectorAll('.ant-drawer-close, .ant-modal-close').forEach((c) => c.click());
      // 回到列表
      const back = [...document.querySelectorAll('span,div,a')].find((e) => /^返回|^关闭/.test((e.innerText || '').trim()) && e.offsetParent);
      if (back) back.click();
    });
    await sleep(500);
    return d;
  } catch { return null; }
}

// 搜索（若关键词变了）
const curInput = await page.inputValue('input[placeholder*="产品名称"]').catch(() => '');
if (curInput.trim().toLowerCase() !== KEYWORD.toLowerCase()) {
  console.log(`[搜索] ${KEYWORD}`);
  await page.click('input[placeholder*="产品名称"]', { force: true });
  await page.fill('input[placeholder*="产品名称"]', KEYWORD);
  const p = waitList();
  await page.click('button:has-text("搜索")');
  const data = await p.catch(() => null);
  if (data) {
    const rows = parseListData(data, { keyword: KEYWORD, sourceUrl: page.url() });
    rows.forEach((r) => { csv.append(r); allRows.push(r); });
    totalWritten += rows.length; progress.markDone(KEYWORD, 0);
    console.log(`[第1页] +${rows.length} 条 total=${data.total}`);
  }
} else {
  console.log('[跳过搜索] 当前页已是该关键词结果，从当前页继续');
}

// 翻页采集
for (let pageNo = 2; pageNo <= MAX_PAGES; pageNo++) {
  if (!rl.canContinue()) { console.warn('[熔断] 停止'); break; }
  if (progress.isDone(KEYWORD, pageNo - 1)) { console.log(`[跳过] 第${pageNo}页已采`); continue; }
  const delay = rl.nextDelayMs();
  console.log(`[限速] ${(delay / 1000).toFixed(1)}s → 第${pageNo}页`);
  await sleep(delay);
  try {
    const p = waitList();
    const clicked = await page.evaluate(() => {
      const next = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, li.ant-pagination-next:not(.ant-pagination-disabled)');
      if (next) { next.click(); return true; } return false;
    });
    if (!clicked) { console.log('[翻页] 无下一页'); break; }
    const data = await p;
    rl.recordSuccess();
    const rows = parseListData(data, { keyword: KEYWORD, sourceUrl: page.url() });
    if (!rows.length) { console.log('[翻页] 空结果'); break; }
    rows.forEach((r) => { csv.append(r); allRows.push(r); });
    rl.recordPage(); rl.recordItems(rows.length);
    progress.markDone(KEYWORD, pageNo - 1);
    totalWritten += rows.length;
    console.log(`[第${pageNo}页] +${rows.length} 累计 ${totalWritten}`);
  } catch (e) {
    const backoff = rl.recordFailure();
    console.error(`[错误] 第${pageNo}页 ${e.message} 退避${backoff / 1000}s`);
    if (rl.tripped) { console.error('[熔断] 连续失败'); break; }
    await sleep(backoff);
  }
}

// 详情采集（可选）：对有联系方式的前 N 条抓电话
if (WITH_DETAIL) {
  console.log('\n[详情] 开始采集电话/社媒（有联系方式的公司）…');
  const withContact = allRows.filter((r) => r.has_contact === '1').slice(0, 10);
  console.log(`[详情] 候选 ${withContact.length} 条`);
  for (let i = 0; i < withContact.length; i++) {
    if (!rl.canContinue()) break;
    const row = withContact[i];
    await sleep(rl.nextDelayMs());
    const d = await fetchDetail(i, row.company_name);
    if (d) {
      row.phone = d.phone || row.phone;
      row.source_url = d.linkedin || row.source_url;
      row.contact_count = d.contactCount ?? row.contact_count;
      console.log(`  [详情${i + 1}] ${row.company_name.slice(0, 25)} phone=${(d.phone || '').slice(0, 25)} linkedin=${d.linkedin ? '✓' : '✗'}`);
    }
  }
  // 重写 CSV（含详情）
  const csv2 = new CsvWriter(CSV_PATH.replace('.csv', '_detail.csv'));
  allRows.forEach((r) => csv2.append(r));
  console.log(`[详情] 已写 ${CSV_PATH.replace('.csv', '_detail.csv')}`);
}

console.log(`\n✅ 完成：${totalWritten} 条 → ${CSV_PATH}`);
process.exit(0);
