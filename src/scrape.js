// 生产级采集器：关键词 + 筛选(采购地区/供应地区/HScode) + 翻页 + 联系人(邮箱)
// 用法: node src/scrape.js --keyword cargo --buy-country 美国 --supply-country 中国 --hscode 1234 --pages 5 --contacts --topx 3
// 所有筛选通过 UI 驱动（设置筛选器→搜索→翻页→逐公司抓联系人），数据只存本地
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseListData, parseContactPage } from './parser.js';
import { escapeCsv } from './csv.js';
import { RateLimiter } from './ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 解析参数
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const OPT = {
  keyword: arg('keyword', 'cargo'),
  buyCountry: arg('buy-country', ''),      // 采购地区（买家/收货地）
  supplyCountry: arg('supply-country', ''), // 供应地区（卖家/发货地）
  hscode: arg('hscode', ''),
  pages: Math.min(parseInt(arg('pages', '5'), 10), 30),
  withContacts: process.argv.includes('--contacts'),
  topX: Math.min(parseInt(arg('topx', '3'), 10), 10),
  maxCompaniesContact: parseInt(arg('contact-companies', '100'), 10),
};
const RUN_TAG = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const LEADS_CSV = path.join(ROOT, 'data', `leads_${OPT.keyword}_${RUN_TAG}.csv`);
const CONTACTS_CSV = path.join(ROOT, 'data', `contacts_${OPT.keyword}_${RUN_TAG}.csv`);
console.log('[配置]', JSON.stringify(OPT));

const rl = new RateLimiter({ minMs: 3000, maxMs: 6500, dailyPageCap: 30, dailyItemCap: 800 });

// CSV 初始化
const LEADS_HEADER = ['公司名', '国家', '域名', '邮箱数', '电话数', '联系人总数', '有联系方式', '交易次数', '交易金额USD', '主营产品', '最近交易', '关键词', '采集时间'];
const CONTACTS_HEADER = ['公司名', '国家', '联系人', '职位', '类型', '邮箱', '电话', 'LinkedIn', '来源', '有邮箱', '关键词', '采集时间'];
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(LEADS_CSV, '﻿' + LEADS_HEADER.join(',') + '\n', 'utf-8');
const LEADS_KEYS = ['company_name', 'country', 'domain', 'email_count', 'phone_count', 'contact_count', 'has_contact', 'transactions', 'value_usd', 'top_product', 'last_tx_date', 'keyword', 'scraped_at'];
const CONTACTS_KEYS = ['company_name', 'country', 'contact_name', 'contact_title', 'contact_type', 'email', 'phone', 'linkedin', 'contact_origin', 'has_email', 'keyword', 'scraped_at'];
if (OPT.withContacts) fs.writeFileSync(CONTACTS_CSV, '﻿' + CONTACTS_HEADER.join(',') + '\n', 'utf-8');
const appendLeads = (r) => fs.appendFileSync(LEADS_CSV, LEADS_KEYS.map((k) => escapeCsv(r[k])).join(',') + '\n', 'utf-8');
const appendContact = (r) => fs.appendFileSync(CONTACTS_CSV, CONTACTS_KEYS.map((k) => escapeCsv(r[k])).join(',') + '\n', 'utf-8');

// 连接浏览器
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('waimao.office.163.com'));
if (!page) { console.error('❌ 未找到外贸通标签页'); process.exit(1); }
await page.bringToFront().catch(() => {});

// 登录态检查
const bodyTxt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
if (/\/login/.test(page.url()) || /密码登录|扫码登录|立即登录/.test(bodyTxt.slice(0, 400))) {
  console.error('❌ 登录态失效，请先运行: node src/login.js'); process.exit(1);
}
console.log('[登录态] OK');

// 拦截器
let pendingList = null, pendingContact = null;
page.on('response', async (res) => {
  if (res.url().includes('/list/buyers/async') && res.status() === 200 && pendingList) {
    try { const j = await res.json(); if (j?.data?.records) { const r = pendingList; pendingList = null; r(j.data); } } catch {}
  }
  if (res.url().includes('/getContactPage') && res.status() === 200 && pendingContact) {
    try { const j = await res.json(); if (j?.data) { const r = pendingContact; pendingContact = null; r(j.data); } } catch {}
  }
});
const waitList = (t = 25000) => new Promise((res) => { pendingList = res; setTimeout(() => { if (pendingList) { pendingList = null; res(null); } }, t); });
const waitContact = (t = 18000) => new Promise((res) => { pendingContact = res; setTimeout(() => { if (pendingContact) { pendingContact = null; res(null); } }, t); });

// 清理遮罩
const cleanup = async () => {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll('.ant-drawer-close, .ant-modal-close').forEach((c) => c.click());
    document.querySelectorAll('.ant-drawer-open, .ant-modal-open').forEach((m) => (m.style.display = 'none'));
    document.body.classList.remove('ant-scrolling-effect'); document.body.style.overflow = '';
  });
};

// === 步骤1: 导航 + 搜索 + 应用筛选 ===
console.log('→ 进入海关数据页');
await page.goto('https://waimao.office.163.com/#wmData?page=customs', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(5000);
await cleanup();
await page.waitForTimeout(500);

// 输入关键词
const input = page.locator('input[placeholder*="产品名称"]').first();
await input.click({ force: true });
await input.fill(OPT.keyword);

// 应用筛选（通过 UI 设置筛选器）
if (OPT.buyCountry) {
  console.log('→ 设置采购地区:', OPT.buyCountry);
  await setRegionFilter(page, 0, OPT.buyCountry);
}
if (OPT.supplyCountry) {
  console.log('→ 设置供应地区:', OPT.supplyCountry);
  await setRegionFilter(page, 1, OPT.supplyCountry);
}
if (OPT.hscode) {
  console.log('→ 设置HSCode:', OPT.hscode);
  await setInputFilter(page, /HSCode/i, OPT.hscode);
}

// 触发搜索
const firstList = waitList();
await page.locator('button:has-text("搜索")').first().click({ force: true });
const firstData = await firstList;
let allLeads = [];
if (firstData && firstData.records) {
  const rows = parseListData(firstData, { keyword: OPT.keyword, sourceUrl: page.url() });
  rows.forEach((r) => { appendLeads(r); allLeads.push(r); });
  console.log(`[第1页] +${rows.length} 条 (total=${firstData.total})`);
} else {
  console.log('⚠️ 首次搜索未返回，尝试翻页补齐');
}

// === 步骤2: 翻页采集（带重试）===
let emptyRetries = 0;
for (let p = 2; p <= OPT.pages; p++) {
  if (!rl.canContinue()) { console.warn('[熔断] 停止'); break; }
  await sleep(rl.nextDelayMs());
  let data = null;
  // 翻页最多重试 2 次
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    if (attempt > 0) { console.log(`  [第${p}页] 重试 ${attempt}…`); await sleep(3000); }
    const wp = waitList(20000);
    const clicked = await page.evaluate(() => {
      const next = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, li.ant-pagination-next:not(.ant-pagination-disabled)');
      if (next) { next.click(); return true; } return false;
    });
    if (!clicked) { console.log('[翻页] 无下一页'); break; }
    data = await wp;
  }
  if (!data || !data.records || !data.records.length) {
    emptyRetries++;
    console.log(`[第${p}页] 空/超时 (${emptyRetries}次)`);
    if (emptyRetries >= 2) { console.log('[翻页] 连续空页，停止'); break; }
    continue;
  }
  emptyRetries = 0;
  rl.recordSuccess(); rl.recordPage();
  const rows = parseListData(data, { keyword: OPT.keyword, sourceUrl: page.url() });
  rows.forEach((r) => { appendLeads(r); allLeads.push(r); });
  rl.recordItems(rows.length);
  console.log(`[第${p}页] +${rows.length} 累计 ${allLeads.length}`);
}

console.log(`\n[列表完成] 共 ${allLeads.length} 条公司线索 → ${path.basename(LEADS_CSV)}`);

// === 步骤3: 联系人采集（可选）===
if (OPT.withContacts && allLeads.length) {
  console.log(`\n→ 开始联系人采集（最多 ${OPT.maxCompaniesContact} 家，每家 top ${OPT.topX}）`);
  // 回到第1页
  await cleanup(); await page.waitForTimeout(800);
  await page.evaluate(() => { const p1 = document.querySelector('.ant-pagination-item-1, [title="1"]'); if (p1) p1.click(); });
  await page.waitForTimeout(3000);

  let contactCount = 0, companiesDone = 0;
  const target = Math.min(allLeads.length, OPT.maxCompaniesContact);
  // 需要翻页覆盖所有公司：边翻页边点
  // 简化：处理当前可见页的公司，翻页继续
  let processedNames = new Set();
  while (companiesDone < target && rl.canContinue()) {
    const names = await page.evaluate(() => {
      const seen = new Set(); const out = [];
      document.querySelectorAll('[class*=companyNameText]').forEach((el) => {
        const t = (el.innerText || '').trim().split('\n')[0];
        if (t && t.length > 3 && /[A-Za-z]/.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
      });
      return out;
    });
    let anyNew = false;
    for (const name of names) {
      if (processedNames.has(name) || companiesDone >= target) continue;
      processedNames.add(name); anyNew = true;
      await sleep(rl.nextDelayMs());
      try {
        const wc = waitContact();
        const clicked = await page.evaluate((nm) => {
          const l = [...document.querySelectorAll('[class*=companyNameText]')].find((e) => (e.innerText || '').trim() === nm && e.getBoundingClientRect().width > 0);
          if (l) { l.click(); return true; } return false;
        }, name);
        if (!clicked) continue;
        await page.waitForTimeout(3200);
        await page.evaluate(() => {
          const tabs = [...document.querySelectorAll('.ant-tabs-tab, [role=tab]')].filter((e) => /^联系人$/.test((e.innerText || '').trim()) && e.offsetParent);
          if (tabs.length) tabs[tabs.length - 1].click();
        });
        const cdata = await wc;
        if (cdata && Array.isArray(cdata.content) && cdata.content.length) {
          const rows = parseContactPage(cdata, { company_name: name, country: '', domain: '', keyword: OPT.keyword }, OPT.topX);
          rows.forEach(appendContact);
          contactCount += rows.length; companiesDone++;
          rl.recordSuccess(); rl.recordItems(1);
          console.log(`  [${companiesDone}/${target}] ${name.slice(0, 20)} → ${rows.length} 联系人 (${rows.filter(r=>r.has_email==='1').length} 有邮箱)`);
        } else {
          console.log(`  [${companiesDone + 1}] ${name.slice(0, 20)} 无联系人`);
        }
        await cleanup(); await page.waitForTimeout(1000);
      } catch (e) {
        console.error(`  错误 ${name.slice(0, 15)}: ${e.message.slice(0, 40)}`);
        rl.recordFailure(); if (rl.tripped) break;
        await cleanup();
      }
    }
    if (companiesDone >= target || !rl.canContinue()) break;
    if (!anyNew) break; // 当前页都处理完
    // 翻到下一页继续
    const hasNext = await page.evaluate(() => {
      const next = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, li.ant-pagination-next:not(.ant-pagination-disabled)');
      if (next) { next.click(); return true; } return false;
    });
    if (!hasNext) break;
    await page.waitForTimeout(4000);
  }
  console.log(`\n[联系人完成] ${companiesDone} 家公司，${contactCount} 个联系人 → ${path.basename(CONTACTS_CSV)}`);
}

console.log(`\n✅ 全部完成`);
console.log(`   公司线索: ${LEADS_CSV}`);
if (OPT.withContacts) console.log(`   联系人: ${CONTACTS_CSV}`);
process.exit(0);

// === 筛选器操作辅助 ===
async function setRegionFilter(page, index, country) {
  // 打开第 index 个 countrySelectModal 下拉，搜索并选择国家
  const sel = page.locator('[class*=searchfilter] [class*=countrySelectModal], .searchfilter-module--container [class*=countrySelectModal]').nth(index);
  await sel.click({ force: true });
  await page.waitForTimeout(1200);
  // 输入国家名搜索
  const searchInput = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) input[type=search], [class*=dropdown] input').first();
  if (await searchInput.count()) {
    await searchInput.fill(country);
    await page.waitForTimeout(1200);
  }
  // 点击匹配选项
  await page.evaluate((c) => {
    const opt = [...document.querySelectorAll('.ant-select-item-option, [class*=option], [class*=item], li, label, .ant-checkbox-wrapper')]
      .find((e) => (e.innerText || '').trim().includes(c) && e.offsetParent);
    if (opt) opt.click();
  }, country);
  await page.waitForTimeout(600);
  // 关闭下拉（点确认或外部）
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll('button, span')].find((e) => /^(确定|确认|OK)$/i.test((e.innerText || '').trim()) && e.offsetParent);
    if (confirm) confirm.click();
  });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

async function setInputFilter(page, labelRe, value) {
  await page.evaluate(({ labelReSrc, val }) => {
    const re = new RegExp(labelReSrc, 'i');
    const label = [...document.querySelectorAll('label, [class*=label], span')].find((e) => re.test((e.innerText || '').trim()) && e.offsetParent);
    if (label) {
      const formItem = label.closest('.ant-form-item, [class*=form-item], [class*=filter]');
      const inp = formItem?.querySelector('input');
      if (inp) { inp.value = val; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }, { labelReSrc: labelRe.source, val: value });
}
