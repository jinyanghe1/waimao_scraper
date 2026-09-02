// 联系人采集器 v2（纯 UI 驱动，稳健版）
// 流程：海关数据搜索关键词 → 逐行点公司名 → 详情抽屉 → 联系人Tab → 拦截 getContactPage → 截断topX → CSV
// 邮箱：有直接拿，无则留空（不深挖）
// 用法: node src/contacts.js [keyword] [maxCompanies] [topX]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContactPage } from './parser.js';
import { escapeCsv } from './csv.js';
import { RateLimiter } from './ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYWORD = process.argv[2] || 'cargo';
const MAX_COMPANIES = parseInt(process.argv[3] || '10', 10);
const TOP_X = parseInt(process.argv[4] || '3', 10);
const RUN_TAG = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const OUT_PATH = path.join(ROOT, 'data', `contacts_${KEYWORD}_${RUN_TAG}.csv`);
console.log(`[联系人] 关键词=${KEYWORD} 公司数=${MAX_COMPANIES} 每公司topX=${TOP_X}`);

const rl = new RateLimiter({ minMs: 4000, maxMs: 8000, dailyItemCap: 100 });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('waimao.office.163.com'));
if (!page) { console.error('❌ 未找到外贸通标签页'); process.exit(1); }
await page.bringToFront().catch(() => {});

// 拦截 getContactPage
let pending = null;
page.on('response', async (res) => {
  if (res.url().includes('/getContactPage') && res.status() === 200 && pending) {
    try { const j = await res.json(); if (j?.data) { const r = pending; pending = null; r(j.data); } } catch {}
  }
});
const waitContact = (t = 18000) => new Promise((res) => { pending = res; setTimeout(() => { if (pending) { pending = null; res(null); } }, t); });

const HEADER = ['公司名', '国家', '联系人', '职位', '类型', '邮箱', '电话', 'LinkedIn', '来源', '有邮箱', '关键词', '采集时间'];
// 追加模式：文件已存在则不重写表头，并跳过已采公司
const alreadyDone = new Set();
if (fs.existsSync(OUT_PATH)) {
  const existing = fs.readFileSync(OUT_PATH, 'utf-8').split('\n').slice(1);
  existing.forEach((line) => { const co = line.split(',')[0]; if (co) alreadyDone.add(co.trim()); });
  console.log(`[断点] 已有 ${alreadyDone.size} 家公司，跳过`);
} else {
  fs.writeFileSync(OUT_PATH, '﻿' + HEADER.join(',') + '\n', 'utf-8');
}
const KEYS = ['company_name', 'country', 'contact_name', 'contact_title', 'contact_type', 'email', 'phone', 'linkedin', 'contact_origin', 'has_email', 'keyword', 'scraped_at'];
const appendRow = (r) => fs.appendFileSync(OUT_PATH, KEYS.map((k) => escapeCsv(r[k])).join(',') + '\n', 'utf-8');

// 1. 导航海关数据页并搜索
console.log('→ 导航海关数据页 + 搜索', KEYWORD);
await page.goto('https://waimao.office.163.com/#wmData?page=customs', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(4000);
// 强制关闭所有抽屉/弹窗/遮罩（上次详情可能没关）
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  document.querySelectorAll('.ant-drawer-close, .ant-modal-close').forEach((c) => c.click());
  document.querySelectorAll('.ant-drawer-open, .ant-modal-open, .ant-modal-wrap').forEach((m) => { m.style.display = 'none'; });
  document.body.classList.remove('ant-scrolling-effect');
  document.body.style.overflow = '';
});
await page.waitForTimeout(1000);
const input = page.locator('input[placeholder*="产品名称"]').first();
await input.click({ force: true });
await input.fill(KEYWORD);
await page.locator('button:has-text("搜索")').first().click({ force: true });
await page.waitForTimeout(6000);

// 从 leads CSV 读全量公司列表（若有），否则从页面读
let allCompanyNames = [];
const leadsCsv = OUT_PATH.replace(/contacts_/, 'leads_').replace(/_contacts/, '');
const leadsAlt = path.join(ROOT, 'data', `leads_${KEYWORD}_${RUN_TAG}.csv`);
// 找最新的 leads 文件
let leadsFile = null;
const leadsFiles = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^leads_.*\.csv$/.test(f) && f.includes(KEYWORD)).sort();
if (leadsFiles.length) leadsFile = path.join(ROOT, 'data', leadsFiles[leadsFiles.length - 1]);
if (leadsFile && fs.existsSync(leadsFile)) {
  const lines = fs.readFileSync(leadsFile, 'utf-8').split('\n').slice(1);
  const hdr = fs.readFileSync(leadsFile, 'utf-8').split('\n')[0].replace(/^﻿/, '').split(',');
  const nameIdx = hdr.indexOf('公司名');
  allCompanyNames = lines.map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[nameIdx]?.replace(/^"|"$/g, '').trim()).filter(Boolean);
  console.log(`→ 从 ${path.basename(leadsFile)} 读到 ${allCompanyNames.length} 家公司`);
} else {
  // 页面当前可见
  allCompanyNames = await page.evaluate(() => {
    const seen = new Set(); const out = [];
    document.querySelectorAll('[class*=companyNameText], [class*=company--]').forEach((el) => {
      const t = (el.innerText || '').trim().split('\n')[0];
      if (t && t.length > 3 && t.length < 60 && /[A-Za-z]/.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
    });
    return out;
  });
  console.log(`→ 当前页识别到 ${allCompanyNames.length} 个公司`);
}
// 过滤已采 + 限量
const targets = allCompanyNames.filter((n) => !alreadyDone.has(n)).slice(0, MAX_COMPANIES);
console.log(`→ 待采 ${targets.length} 家（已跳过 ${alreadyDone.size} 家）`);

let totalContacts = 0, doneCompanies = 0;
const targetSet = new Set(targets);
// 逐页遍历，每页处理命中的目标公司
let currentPage = 1;
const maxPageScan = Math.ceil(allCompanyNames.length / 20) + 2;
while (doneCompanies < targets.length && rl.canContinue() && currentPage <= maxPageScan) {
  // 当前页可见的公司名
  const visible = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[class*=companyNameText]').forEach((el) => {
      const t = (el.innerText || '').trim().split('\n')[0];
      if (t) out.push(t);
    });
    return out;
  });
  const toProcess = visible.filter((n) => targetSet.has(n) && !alreadyDone.has(n));
  for (const name of toProcess) {
    if (!rl.canContinue() || doneCompanies >= targets.length) break;
    await sleep(rl.nextDelayMs());
    try {
      const p = waitContact();
      const clicked = await page.evaluate((nm) => {
        const links = [...document.querySelectorAll('[class*=companyNameText]')].filter((e) => {
          const t = (e.innerText || '').trim();
          const r = e.getBoundingClientRect();
          return t === nm && r.width > 0 && r.top > 0;
        });
        if (links[0]) { links[0].click(); return true; } return false;
      }, name);
      if (!clicked) { continue; }
      await page.waitForTimeout(3500);
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.ant-tabs-tab, [role=tab]')].filter((e) => /^联系人$/.test((e.innerText || '').trim()) && e.offsetParent);
        const target = tabs[tabs.length - 1];
        if (target) target.click();
      });
      const data = await p;
      if (data && Array.isArray(data.content) && data.content.length) {
        const company = { company_name: name, country: '', domain: '', keyword: KEYWORD };
        const rows = parseContactPage(data, company, TOP_X);
        rows.forEach(appendRow);
        totalContacts += rows.length; doneCompanies++; alreadyDone.add(name);
        rl.recordSuccess(); rl.recordItems(1);
        const wm = rows.filter((r) => r.has_email === '1').length;
        console.log(`  [${doneCompanies}/${targets.length}] ${name.slice(0, 22)} → ${rows.length} 联系人 (${wm} 有邮箱)`);
      } else {
        console.log(`  [${doneCompanies + 1}] ${name.slice(0, 22)} 无联系人`);
        alreadyDone.add(name); doneCompanies++;
        rl.recordFailure(); if (rl.tripped) break;
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => {
        document.querySelectorAll('.ant-drawer-close, .ant-modal-close').forEach((c) => c.click());
        document.querySelectorAll('.ant-drawer-open, .ant-modal-open').forEach((m) => m.style.display = 'none');
        document.body.classList.remove('ant-scrolling-effect'); document.body.style.overflow = '';
      });
      await page.waitForTimeout(1200);
    } catch (e) {
      console.error(`  错误 ${name.slice(0, 20)}: ${e.message.slice(0, 50)}`);
      rl.recordFailure(); if (rl.tripped) break;
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  if (doneCompanies >= targets.length || !rl.canContinue()) break;
  // 翻页
  const hasNext = await page.evaluate(() => {
    const next = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, li.ant-pagination-next:not(.ant-pagination-disabled)');
    if (next) { next.click(); return true; } return false;
  });
  if (!hasNext) { console.log('[翻页] 到底'); break; }
  currentPage++;
  await page.waitForTimeout(4000);
}
console.log(`\n✅ 本次 ${doneCompanies} 家公司，${totalContacts} 个联系人 → ${OUT_PATH}`);
process.exit(0);
