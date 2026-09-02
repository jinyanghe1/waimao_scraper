import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBuyer, parseListData, parseUsd, mergeDetail } from '../src/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, '..', 'fixtures');

const listFixture = JSON.parse(fs.readFileSync(path.join(FIX, 'p2_01.json'), 'utf-8')).body.data;
const baseFixture = JSON.parse(fs.readFileSync(path.join(FIX, 'p2_10.json'), 'utf-8')).body.data;

test('parseUsd：去千分位与符号', () => {
  assert.equal(parseUsd('5,524,400.00'), '5524400.00');
  assert.equal(parseUsd('$1,234'), '1234');
  assert.equal(parseUsd(''), '');
  assert.equal(parseUsd(null), '');
});

test('parseListData：真实 fixture 解析出 20 条', () => {
  const rows = parseListData(listFixture, { keyword: 'cargo' });
  assert.equal(rows.length, 20);
  assert.ok(rows.every((r) => r.company_name), '每条都应有公司名');
});

test('parseBuyer：核心字段提取正确', () => {
  const rec = listFixture.records.find((r) => r.companyName === 'Global Link Logistics');
  const row = parseBuyer(rec, { keyword: 'cargo', sourceUrl: 'https://x' });
  assert.equal(row.country, 'United States');
  assert.equal(row.email_count, 13);       // emailCount 数量
  assert.equal(row.phone_count, 5);        // phoneCount 数量
  assert.equal(row.email, '');             // 真实邮箱需详情挖掘，列表为空
  assert.equal(row.domain, 'globallinklogistics.com');
  assert.equal(row.value_usd, '5524400.00');
  assert.equal(row.has_contact, '1');
  assert.equal(row.keyword, 'cargo');
});

test('parseBuyer：空记录返回 null，空对象不抛错', () => {
  assert.equal(parseBuyer(null), null);
  assert.equal(parseBuyer(undefined), null);
  assert.doesNotThrow(() => parseBuyer({}));
  const empty = parseBuyer({});
  assert.equal(empty.company_name, '');
});

test('parseListData：非法输入返回空数组', () => {
  assert.deepEqual(parseListData(null), []);
  assert.deepEqual(parseListData({}), []);
  assert.deepEqual(parseListData({ records: 'x' }), []);
});

test('mergeDetail：详情补充联系方式', () => {
  const row = { company_name: 'Global Link Logistics', country: 'United States', phone: '', email: '', source_url: '' };
  const merged = mergeDetail(row, baseFixture);
  assert.ok(merged.source_url.includes('linkedin'), '应带入 linkedin');
});
