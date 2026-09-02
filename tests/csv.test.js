import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CsvWriter, escapeCsv, rowToLine } from '../src/csv.js';
import { ProgressStore } from '../src/state.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wmtest-'));

test('escapeCsv：含逗号/引号/换行需转义', () => {
  assert.equal(escapeCsv('abc'), 'abc');
  assert.equal(escapeCsv('a,b'), '"a,b"');
  assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsv('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCsv(null), '');
  assert.equal(escapeCsv(undefined), '');
});

test('CsvWriter：写表头 + 追加行 + 计数', () => {
  const f = path.join(tmp(), 'leads.csv');
  const w = new CsvWriter(f);
  w.append({ company_name: 'ACME, Inc.', country: '美国', email: 'a@b.com', phone: '+1-555' });
  w.append({ company_name: 'Beta GmbH', country: '德国', contact_name: 'Hans "Boss" Müller' });
  assert.equal(w.count(), 2);
  const content = fs.readFileSync(f, 'utf-8');
  assert.match(content, /公司名/); // 表头中文
  assert.match(content, /"ACME, Inc\."/); // 逗号转义
  assert.match(content, /"Hans ""Boss"" Müller"/); // 引号转义
});

test('CsvWriter：文件已存在时不重复写表头', () => {
  const f = path.join(tmp(), 'leads.csv');
  new CsvWriter(f).append({ company_name: 'X' });
  const w2 = new CsvWriter(f); // 重新打开
  w2.append({ company_name: 'Y' });
  assert.equal(w2.count(), 2); // 不重复表头
});

test('ProgressStore：断点标记与持久化', () => {
  const f = path.join(tmp(), 'progress.json');
  const p = new ProgressStore(f);
  assert.equal(p.isDone('cargo', 1), false);
  p.markDone('cargo', 1);
  assert.equal(p.isDone('cargo', 1), true);
  const p2 = new ProgressStore(f); // 重新加载
  assert.equal(p2.isDone('cargo', 1), true);
  assert.equal(p2.isDone('cargo', 2), false);
});
