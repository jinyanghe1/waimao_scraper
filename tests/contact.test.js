import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContact, parseContactPage, contactType } from '../src/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, '..', 'fixtures');
const contactFixture = JSON.parse(fs.readFileSync(path.join(FIX, 'pc_01.json'), 'utf-8')).body.data;

const company = { company_name: 'Michelin Peru', country: 'Peru', domain: 'michelin.com.pe', keyword: 'cargo' };

test('contactType：类型映射', () => {
  assert.equal(contactType('LEADERS'), '高管');
  assert.equal(contactType('MANAGER'), '经理');
  assert.equal(contactType('COMMON'), '普通');
  assert.equal(contactType('X'), 'X');
});

test('parseContact：姓名/职位/LinkedIn提取', () => {
  const c = contactFixture.content.find((x) => x.name === 'Fernando Romero');
  const row = parseContact(c, company);
  assert.equal(row.contact_name, 'Fernando Romero');
  assert.equal(row.contact_title, 'Jefe de Contabilidad');
  assert.equal(row.contact_type, '高管');
  assert.ok(row.linkedin.includes('linkedin.com'));
  assert.equal(row.has_email, '0'); // emails 为空
  assert.equal(row.company_name, 'Michelin Peru');
});

test('parseContact：有电话的联系人（大数据挖掘来源）', () => {
  const c = contactFixture.content.find((x) => x.phone);
  const row = parseContact(c, company);
  assert.equal(row.phone, '(51)511611200');
  assert.equal(row.contact_origin, '大数据挖掘');
});

test('parseContactPage：截断 topX 生效', () => {
  const all = parseContactPage(contactFixture, company, 99);
  assert.equal(all.length, 7);
  const top3 = parseContactPage(contactFixture, company, 3);
  assert.equal(top3.length, 3);
  const top1 = parseContactPage(contactFixture, company, 1);
  assert.equal(top1.length, 1);
  assert.equal(top1[0].contact_name, 'Fernando Romero');
});

test('parseContactPage：非法输入返回空数组', () => {
  assert.deepEqual(parseContactPage(null, company), []);
  assert.deepEqual(parseContactPage({}, company), []);
});

test('parseContact：空值不抛错', () => {
  assert.equal(parseContact(null, company), null);
  assert.doesNotThrow(() => parseContact({}, company));
});
