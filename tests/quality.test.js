import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmails, parseContact, dedupeLeads, rankContacts, parseContactPage } from '../src/parser.js';

const company = { company_name: 'ACME', country: 'US', domain: 'acme.com', keyword: 'cargo' };

// ========== 功能 1：邮箱有效性过滤 ==========

test('parseEmails：标注 valid 状态', () => {
  const out = parseEmails([
    { email: 'a@b.com', emailStatus: 1 },
    { email: 'c@d.com', emailStatus: 0 },
  ]);
  assert.deepEqual(out, [
    { email: 'a@b.com', valid: true },
    { email: 'c@d.com', valid: false },
  ]);
});

test('parseEmails：缺失 emailStatus 视为无效', () => {
  const out = parseEmails([{ email: 'x@y.com' }]);
  assert.deepEqual(out, [{ email: 'x@y.com', valid: false }]);
});

test('parseEmails：非数组/空输入返回空数组', () => {
  assert.deepEqual(parseEmails(null), []);
  assert.deepEqual(parseEmails(undefined), []);
  assert.deepEqual(parseEmails('x'), []);
  assert.deepEqual(parseEmails([]), []);
});

test('parseContact：新增 email_valid 字段，只含有效邮箱', () => {
  const c = {
    name: 'X',
    emails: [
      { email: 'a@b.com', emailStatus: 1 },
      { email: 'c@d.com', emailStatus: 0 },
    ],
  };
  const row = parseContact(c, company);
  assert.equal(row.email_valid, 'a@b.com');
  // 原 email 字段保留全部邮箱
  assert.equal(row.email, 'a@b.com; c@d.com');
});

test('parseContact：无有效邮箱时 email_valid 为空串', () => {
  const c = { name: 'Y', emails: [{ email: 'c@d.com', emailStatus: 0 }] };
  const row = parseContact(c, company);
  assert.equal(row.email_valid, '');
  assert.equal(row.email, 'c@d.com');
});

test('parseContact：字符串邮箱视为有效（无状态信息，保留）', () => {
  const c = { name: 'Z', emails: ['plain@x.com'] };
  const row = parseContact(c, company);
  assert.equal(row.email_valid, 'plain@x.com');
});

// ========== 功能 2：公司去重 ==========

test('dedupeLeads：按 domain 去重保留交易额最高', () => {
  const rows = [
    { company_name: 'A', domain: 'ups.com', value_usd: '100' },
    { company_name: 'A2', domain: 'ups.com', value_usd: '200' },
    { company_name: 'B', domain: 'fedex.com', value_usd: '50' },
    { company_name: 'C', domain: '', value_usd: '10' },
  ];
  const out = dedupeLeads(rows);
  assert.equal(out.length, 3);
  const ups = out.find((r) => r.domain === 'ups.com');
  assert.equal(ups.company_name, 'A2');
  assert.equal(ups.value_usd, '200');
  assert.ok(out.find((r) => r.company_name === 'B'));
  assert.ok(out.find((r) => r.company_name === 'C'));
});

test('dedupeLeads：不改原数组，返回新数组', () => {
  const rows = [
    { company_name: 'A', domain: 'ups.com', value_usd: '100' },
    { company_name: 'A2', domain: 'ups.com', value_usd: '200' },
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  const out = dedupeLeads(rows);
  assert.notEqual(out, rows);
  assert.deepEqual(rows, snapshot, '原数组不被修改');
});

test('dedupeLeads：domain 大小写不敏感', () => {
  const rows = [
    { company_name: 'A', domain: 'UPS.com', value_usd: '100' },
    { company_name: 'A2', domain: 'ups.com', value_usd: '200' },
  ];
  const out = dedupeLeads(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].company_name, 'A2');
});

test('dedupeLeads：value_usd 字符串数字比较正确（千分位/小数）', () => {
  const rows = [
    { company_name: 'A', domain: 'x.com', value_usd: '1,000.00' },
    { company_name: 'B', domain: 'x.com', value_usd: '900' },
  ];
  const out = dedupeLeads(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].company_name, 'A');
});

test('dedupeLeads：空/非法输入返回空数组', () => {
  assert.deepEqual(dedupeLeads(null), []);
  assert.deepEqual(dedupeLeads(undefined), []);
  assert.deepEqual(dedupeLeads([]), []);
  assert.deepEqual(dedupeLeads('x'), []);
});

test('dedupeLeads：value_usd 为空时排最低', () => {
  const rows = [
    { company_name: 'A', domain: 'x.com', value_usd: '' },
    { company_name: 'B', domain: 'x.com', value_usd: '50' },
  ];
  const out = dedupeLeads(rows);
  assert.equal(out[0].company_name, 'B');
});

// ========== 功能 3：联系人质量排序 ==========

test('rankContacts：有邮箱高管 > 无邮箱经理 > 无邮箱普通', () => {
  const out = rankContacts([
    { name: 'c1', type: 'COMMON', emails: [] },
    { name: 'c2', type: 'LEADERS', emails: [{ email: 'x@y.com', emailStatus: 1 }] },
    { name: 'c3', type: 'MANAGER', emails: [] },
  ]);
  assert.deepEqual(out.map((c) => c.name), ['c2', 'c3', 'c1']);
});

test('rankContacts：都有邮箱时按 LEADERS > MANAGER > COMMON', () => {
  const e = [{ email: 'x@y.com', emailStatus: 1 }];
  const out = rankContacts([
    { name: 'a', type: 'COMMON', emails: e },
    { name: 'b', type: 'LEADERS', emails: e },
    { name: 'c', type: 'MANAGER', emails: e },
  ]);
  assert.deepEqual(out.map((c) => c.name), ['b', 'c', 'a']);
});

test('rankContacts：有邮箱优先于无邮箱（无论职级）', () => {
  const e = [{ email: 'x@y.com', emailStatus: 1 }];
  const out = rankContacts([
    { name: 'noEmailLeader', type: 'LEADERS', emails: [] },
    { name: 'hasEmailCommon', type: 'COMMON', emails: e },
  ]);
  assert.deepEqual(out.map((c) => c.name), ['hasEmailCommon', 'noEmailLeader']);
});

test('rankContacts：不改原数组', () => {
  const arr = [
    { name: 'a', type: 'COMMON', emails: [] },
    { name: 'b', type: 'LEADERS,', emails: [{ email: 'x@y.com' }] },
  ];
  const snapshot = arr.map((c) => c.name);
  rankContacts(arr);
  assert.deepEqual(arr.map((c) => c.name), snapshot);
});

test('rankContacts：非法输入返回空数组', () => {
  assert.deepEqual(rankContacts(null), []);
  assert.deepEqual(rankContacts(undefined), []);
  assert.deepEqual(rankContacts('x'), []);
});

test('parseContactPage：截断前先按质量排序', () => {
  // 构造原始顺序：第1个无邮箱普通、第2个无邮箱经理、第3个有邮箱高管
  const data = {
    content: [
      { name: 'noEmailCommon', type: 'COMMON', emails: [] },
      { name: 'noEmailManager', type: 'MANAGER', emails: [] },
      { name: 'hasEmailLeader', type: 'LEADERS', emails: [{ email: 'x@y.com', emailStatus: 1 }] },
    ],
  };
  const top1 = parseContactPage(data, company, 1);
  assert.equal(top1.length, 1);
  assert.equal(top1[0].contact_name, 'hasEmailLeader');

  const top2 = parseContactPage(data, company, 2);
  assert.deepEqual(top2.map((r) => r.contact_name), ['hasEmailLeader', 'noEmailManager']);
});
