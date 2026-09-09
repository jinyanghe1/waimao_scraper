// 腾讯文档智能表格降级通道测试（全 mock，不真调腾讯文档 API）
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  loadFeedbackConfig,
  buildTencentDocsRecord,
  buildTencentDocsAddRecordsArgs,
  submitFeedback,
} from '../src/feedback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- loadFeedbackConfig ----------

describe('loadFeedbackConfig', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-cfg-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('配置文件不存在时返回内置默认值，含真实 file_id / sheet_id', () => {
    const cfg = loadFeedbackConfig({ configFile: path.join(tmpDir, 'nope.json') });
    assert.equal(cfg.tencentDocs.enabled, true);
    assert.equal(cfg.tencentDocs.fileId, 'WWJNwfJLdUem');
    assert.equal(cfg.tencentDocs.sheetId, 't00i2h');
    assert.match(cfg.tencentDocs.url, /^https:\/\/docs\.qq\.com\//);
  });

  test('读取用户提供的 feedback_config.json 覆盖默认值', () => {
    const file = path.join(tmpDir, 'feedback_config.json');
    fs.writeFileSync(file, JSON.stringify({
      tencentDocs: { fileId: 'CUSTOM_FILE', sheetId: 'CUSTOM_SHEET', enabled: false },
    }), 'utf-8');
    const cfg = loadFeedbackConfig({ configFile: file });
    assert.equal(cfg.tencentDocs.fileId, 'CUSTOM_FILE');
    assert.equal(cfg.tencentDocs.sheetId, 'CUSTOM_SHEET');
    assert.equal(cfg.tencentDocs.enabled, false);
  });

  test('部分字段缺失时回落到默认值', () => {
    const file = path.join(tmpDir, 'feedback_config.json');
    fs.writeFileSync(file, JSON.stringify({ tencentDocs: { enabled: false } }), 'utf-8');
    const cfg = loadFeedbackConfig({ configFile: file });
    assert.equal(cfg.tencentDocs.enabled, false);
    assert.equal(cfg.tencentDocs.fileId, 'WWJNwfJLdUem');
    assert.equal(cfg.tencentDocs.sheetId, 't00i2h');
  });

  test('配置文件损坏（非 JSON）时返回默认值', () => {
    const file = path.join(tmpDir, 'feedback_config.json');
    fs.writeFileSync(file, 'not-json!!', 'utf-8');
    const cfg = loadFeedbackConfig({ configFile: file });
    assert.equal(cfg.tencentDocs.enabled, true);
    assert.equal(cfg.tencentDocs.fileId, 'WWJNwfJLdUem');
  });
});

// ---------- buildTencentDocsRecord ----------

describe('buildTencentDocsRecord', () => {
  test('返回标准记录对象：{类型,标题,详情,平台,Node版本,Skill版本,提交时间,状态}', () => {
    const r = buildTencentDocsRecord({
      type: 'bug',
      title: '联系人采集卡死',
      detail: '跑到第5家就不动了',
      env: {
        platform: 'darwin',
        node: 'v22.22.2',
        skillVersion: '115f32e',
        time: '2026-09-09T01:02:03.000Z',
      },
    });
    assert.equal(r['类型'], 'bug');
    assert.equal(r['标题'], '联系人采集卡死');
    assert.equal(r['详情'], '跑到第5家就不动了');
    assert.equal(r['平台'], 'darwin');
    assert.equal(r['Node版本'], 'v22.22.2');
    assert.equal(r['Skill版本'], '115f32e');
    assert.equal(r['提交时间'], '2026-09-09T01:02:03.000Z');
    assert.equal(r['状态'], '待处理');
  });

  test('env 缺字段时使用 unknown 兜底；缺 time 时自动生成 ISO 时间', () => {
    const r = buildTencentDocsRecord({ type: 'feature', title: 't', detail: 'd', env: {} });
    assert.equal(r['类型'], 'feature');
    assert.equal(r['平台'], 'unknown');
    assert.equal(r['Node版本'], 'unknown');
    assert.equal(r['Skill版本'], 'unknown');
    assert.match(r['提交时间'], /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(r['状态'], '待处理');
  });
});

// ---------- buildTencentDocsAddRecordsArgs ----------

describe('buildTencentDocsAddRecordsArgs', () => {
  test('返回 smartsheet.add_records 参数结构：file_id / sheet_id / records', () => {
    const record = {
      '类型': 'bug',
      '标题': 'T',
      '详情': 'D',
      '平台': 'darwin',
      'Node版本': 'v22.22.2',
      'Skill版本': 'abc',
      '提交时间': '2026-09-09T00:00:00Z',
      '状态': '待处理',
    };
    const args = buildTencentDocsAddRecordsArgs(record, {
      fileId: 'WWJNwfJLdUem',
      sheetId: 't00i2h',
    });
    assert.equal(args.file_id, 'WWJNwfJLdUem');
    assert.equal(args.sheet_id, 't00i2h');
    assert.ok(Array.isArray(args.records));
    assert.equal(args.records.length, 1);
    const fv = args.records[0].field_values;
    // 文本字段（智能表格文本类型用 [{type:'text',text:'...'}]）
    assert.deepEqual(fv['标题'], [{ type: 'text', text: 'T' }]);
    assert.deepEqual(fv['详情'], [{ type: 'text', text: 'D' }]);
    assert.deepEqual(fv['平台'], [{ type: 'text', text: 'darwin' }]);
    assert.deepEqual(fv['Node版本'], [{ type: 'text', text: 'v22.22.2' }]);
    assert.deepEqual(fv['Skill版本'], [{ type: 'text', text: 'abc' }]);
    assert.deepEqual(fv['提交时间'], [{ type: 'text', text: '2026-09-09T00:00:00Z' }]);
    // 单选字段（类型 / 状态）用字符串
    assert.equal(fv['类型'], 'bug');
    assert.equal(fv['状态'], '待处理');
  });

  test('缺 fileId/sheetId 时回落到默认常量', () => {
    const record = { '类型': 'bug', '标题': 't', '详情': 'd', '平台': 'x', 'Node版本': 'x', 'Skill版本': 'x', '提交时间': 'x', '状态': '待处理' };
    const args = buildTencentDocsAddRecordsArgs(record);
    assert.equal(args.file_id, 'WWJNwfJLdUem');
    assert.equal(args.sheet_id, 't00i2h');
  });
});

// ---------- submitFeedback 降级到腾讯文档 ----------

describe('submitFeedback → tencent-docs 降级', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-tdocs-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('无 token + 腾讯文档启用 → 返回 channel=tencent-docs，不写本地队列', async () => {
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return { ok: true, status: 201, json: async () => ({}) }; };
    const mockExec = () => { throw new Error('no remote'); };
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      {
        type: 'bug',
        title: '联系人采集卡死',
        detail: '第5家不动',
        env: { platform: 'darwin', node: 'v22.22.2', skillVersion: 'abc', time: '2026-09-09T00:00:00Z' },
      },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.equal(res.channel, 'tencent-docs');
    assert.ok(res.record, '应包含腾讯文档记录');
    assert.equal(res.record['类型'], 'bug');
    assert.equal(res.record['标题'], '联系人采集卡死');
    assert.equal(res.record['状态'], '待处理');
    assert.ok(res.addRecordsArgs, '应包含 add_records 参数');
    assert.equal(res.addRecordsArgs.file_id, 'WWJNwfJLdUem');
    assert.equal(res.addRecordsArgs.sheet_id, 't00i2h');
    assert.match(res.url, /^https:\/\/docs\.qq\.com\//);
    assert.equal(fetchCalled, false, '无 token 不应调 GitHub');
    assert.ok(!fs.existsSync(queueFile), '启用腾讯文档时不应写本地队列');
  });

  test('GitHub 调用失败 + 腾讯文档启用 → 返回 channel=tencent-docs，不写本地队列', async () => {
    const mockFetch = async () => ({
      ok: false, status: 500, json: async () => ({ message: 'server error' }),
    });
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'bug', title: 'T', detail: 'D', env: { platform: 'darwin', node: 'v22', skillVersion: 'x', time: '2026-09-09T00:00:00Z' } },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.equal(res.channel, 'tencent-docs');
    assert.match(String(res.error), /500|server error/);
    assert.ok(res.record && res.addRecordsArgs);
    assert.ok(!fs.existsSync(queueFile));
  });

  test('fetch 抛异常 + 腾讯文档启用 → 返回 channel=tencent-docs', async () => {
    const mockFetch = async () => { throw new Error('ENOTFOUND'); };
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'bug', title: 'T', detail: 'D', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.equal(res.channel, 'tencent-docs');
    assert.ok(res.record && res.addRecordsArgs);
    assert.ok(!fs.existsSync(queueFile));
  });

  test('无 token + 腾讯文档禁用 → 落本地队列（保持原行为）', async () => {
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return { ok: true, status: 201, json: async () => ({}) }; };
    const mockExec = () => { throw new Error('no remote'); };
    const queueFile = path.join(tmpDir, 'q.json');
    const configFile = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(configFile, JSON.stringify({ tencentDocs: { enabled: false } }), 'utf-8');

    const res = await submitFeedback(
      { type: 'bug', title: 'T', detail: 'D', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile, configFile }
    );

    assert.equal(res.ok, false);
    assert.equal(res.channel, undefined);
    assert.equal(fetchCalled, false);
    const arr = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
    assert.equal(arr.length, 1);
    assert.equal(arr[0].title, 'T');
  });

  test('GitHub 失败 + 腾讯文档禁用 → 落本地队列', async () => {
    const mockFetch = async () => ({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) });
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');
    const configFile = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(configFile, JSON.stringify({ tencentDocs: { enabled: false } }), 'utf-8');

    const res = await submitFeedback(
      { type: 'bug', title: 'T', detail: 'D', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile, configFile }
    );

    assert.equal(res.ok, false);
    assert.equal(res.channel, undefined);
    const arr = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
    assert.equal(arr.length, 1);
  });

  test('腾讯文档配置缺 fileId 时视为禁用，落本地队列', async () => {
    const mockFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');
    const configFile = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(configFile, JSON.stringify({ tencentDocs: { enabled: true, fileId: '', sheetId: '' } }), 'utf-8');

    const res = await submitFeedback(
      { type: 'bug', title: 'T', detail: 'D', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile, configFile }
    );

    assert.equal(res.ok, false);
    assert.equal(res.channel, undefined, 'fileId/sheetId 为空时不应走腾讯文档');
    const arr = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
    assert.equal(arr.length, 1);
  });

  test('非法 type 时直接报错，不走任何降级通道', async () => {
    const mockFetch = async () => ({ ok: true, status: 201, json: async () => ({}) });
    const mockExec = () => { throw new Error('no remote'); };
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'other', title: 'T', detail: 'D', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.match(String(res.error), /type/i);
    assert.equal(res.channel, undefined);
    assert.ok(!fs.existsSync(queueFile));
  });
});
