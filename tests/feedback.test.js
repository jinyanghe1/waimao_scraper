import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  parseGitRemote,
  parseRemoteUrl,
  submitFeedback,
  buildIssuePayload,
  appendLocalQueue,
  getEnvInfo,
} from '../src/feedback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- parseRemoteUrl / parseGitRemote ----------

describe('parseRemoteUrl', () => {
  test('解析 https + token 形式', () => {
    const r = parseRemoteUrl('https://user:ghp_abc123@github.com/owner/repo.git');
    assert.deepEqual(r, { owner: 'owner', repo: 'repo', token: 'ghp_abc123' });
  });

  test('解析 https + token（无 .git 后缀）', () => {
    const r = parseRemoteUrl('https://user:ghp_xyz@github.com/foo/bar');
    assert.deepEqual(r, { owner: 'foo', repo: 'bar', token: 'ghp_xyz' });
  });

  test('ssh 形式返回 null', () => {
    assert.equal(parseRemoteUrl('git@github.com:owner/repo.git'), null);
  });

  test('https 无 token 返回 null', () => {
    assert.equal(parseRemoteUrl('https://github.com/owner/repo.git'), null);
  });

  test('非 GitHub 地址返回 null', () => {
    assert.equal(parseRemoteUrl('https://user:tok@gitlab.com/owner/repo.git'), null);
  });

  test('空值/非法输入返回 null', () => {
    assert.equal(parseRemoteUrl(''), null);
    assert.equal(parseRemoteUrl(null), null);
    assert.equal(parseRemoteUrl(undefined), null);
  });
});

describe('parseGitRemote', () => {
  test('从真实 git remote 读取（若配置了 https+token 应解析成功）', () => {
    // 不强制断言结果非空（取决于当前环境），但接口必须返回对象或 null
    const r = parseGitRemote();
    assert.ok(r === null || (typeof r === 'object' && r.owner && r.repo && r.token));
  });

  test('可注入自定义 cwd / exec 函数（mock 场景）', () => {
    const mockExec = () => 'https://u:t0k3n@github.com/alice/wonderland.git\n';
    const r = parseGitRemote({ exec: mockExec });
    assert.deepEqual(r, { owner: 'alice', repo: 'wonderland', token: 't0k3n' });
  });

  test('git 命令失败时返回 null', () => {
    const mockExec = () => { throw new Error('not a git repo'); };
    assert.equal(parseGitRemote({ exec: mockExec }), null);
  });
});

// ---------- buildIssuePayload / getEnvInfo ----------

describe('buildIssuePayload', () => {
  test('title 加 [{type}] 前缀，labels 含 type 与 user-feedback', () => {
    const p = buildIssuePayload({
      type: 'bug',
      title: '联系人采集卡死',
      detail: '跑到第5家就不动了',
      env: { platform: 'darwin', node: 'v22.22.2', skillVersion: 'abc1234', time: '2026-09-09T00:00:00Z' },
    });
    assert.equal(p.title, '[bug] 联系人采集卡死');
    assert.deepEqual(p.labels, ['bug', 'user-feedback']);
    assert.match(p.body, /跑到第5家就不动了/);
    assert.match(p.body, /darwin/);
    assert.match(p.body, /v22\.22\.2/);
    assert.match(p.body, /abc1234/);
    assert.match(p.body, /2026-09-09/);
  });

  test('feature / suggestion 类型也正确打 label', () => {
    const p1 = buildIssuePayload({ type: 'feature', title: 't', detail: 'd', env: {} });
    assert.deepEqual(p1.labels, ['feature', 'user-feedback']);
    const p2 = buildIssuePayload({ type: 'suggestion', title: 't', detail: 'd', env: {} });
    assert.deepEqual(p2.labels, ['suggestion', 'user-feedback']);
  });
});

describe('getEnvInfo', () => {
  test('包含 platform / node / time，可选 skillVersion', () => {
    const env = getEnvInfo();
    assert.ok(env.platform);
    assert.ok(env.node);
    assert.ok(env.time);
    // skillVersion 可能为 null（非 git 仓库），但字段要存在
    assert.ok('skillVersion' in env);
  });
});

// ---------- appendLocalQueue ----------

describe('appendLocalQueue', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('首次写入创建文件，后续追加不覆盖', () => {
    const file = path.join(tmpDir, 'feedback_queue.json');
    appendLocalQueue({ type: 'bug', title: 'a', detail: 'd1', env: {} }, { queueFile: file });
    appendLocalQueue({ type: 'feature', title: 'b', detail: 'd2', env: {} }, { queueFile: file });
    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(arr.length, 2);
    assert.equal(arr[0].title, 'a');
    assert.equal(arr[1].title, 'b');
    assert.ok(arr[0].queuedAt);
  });

  test('目录不存在时自动创建', () => {
    const file = path.join(tmpDir, 'nested', 'deep', 'feedback_queue.json');
    appendLocalQueue({ type: 'bug', title: 'x', detail: 'd', env: {} }, { queueFile: file });
    assert.ok(fs.existsSync(file));
  });

  test('既有文件损坏时重置为新数组而非崩溃', () => {
    const file = path.join(tmpDir, 'feedback_queue.json');
    fs.writeFileSync(file, 'not-json!!!', 'utf-8');
    appendLocalQueue({ type: 'bug', title: 'y', detail: 'd', env: {} }, { queueFile: file });
    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(arr.length, 1);
    assert.equal(arr[0].title, 'y');
  });
});

// ---------- submitFeedback ----------

describe('submitFeedback', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-submit-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('成功时调用 GitHub API 并返回 { ok: true, url }', async () => {
    const calls = [];
    const mockFetch = async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        status: 201,
        json: async () => ({ html_url: 'https://github.com/o/r/issues/42' }),
      };
    };
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'bug', title: 'T', detail: 'D', env: { platform: 'darwin' } },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, true);
    assert.equal(res.url, 'https://github.com/o/r/issues/42');
    assert.equal(calls.length, 1);

    const { url, opts } = calls[0];
    assert.equal(url, 'https://api.github.com/repos/o/r/issues');
    assert.equal(opts.method, 'POST');
    assert.match(opts.headers.Authorization, /^Bearer tok$/);
    assert.match(opts.headers['Content-Type'], /application\/json/);

    const body = JSON.parse(opts.body);
    assert.equal(body.title, '[bug] T');
    assert.deepEqual(body.labels, ['bug', 'user-feedback']);
    assert.match(body.body, /D/);
    assert.match(body.body, /darwin/);

    // 成功时不应写降级队列
    assert.ok(!fs.existsSync(queueFile));
  });

  test('GitHub 返回非 2xx 时降级写本地队列，返回 { ok: false, error }', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Forbidden' }),
    });
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'suggestion', title: '加个导出按钮', detail: '希望在列表页加导出', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.match(String(res.error), /403|Forbidden/);

    // 已写降级队列
    const arr = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
    assert.equal(arr.length, 1);
    assert.equal(arr[0].type, 'suggestion');
    assert.equal(arr[0].title, '加个导出按钮');
  });

  test('fetch 抛异常（断网）时降级写本地队列', async () => {
    const mockFetch = async () => { throw new Error('ENOTFOUND api.github.com'); };
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'bug', title: 'x', detail: 'y', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.match(String(res.error), /ENOTFOUND/);
    const arr = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
    assert.equal(arr.length, 1);
  });

  test('无 git remote / 无 token 时不发请求直接降级', async () => {
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return { ok: true, status: 201, json: async () => ({}) }; };
    const mockExec = () => { throw new Error('no remote'); };
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'bug', title: 'x', detail: 'y', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.equal(fetchCalled, false, '无 token 时不应调用 GitHub');
    assert.match(String(res.error), /no_remote|no remote|token/i);
    const arr = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
    assert.equal(arr.length, 1);
  });

  test('type 非法时直接报错，不发请求不入队', async () => {
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return { ok: true, status: 201, json: async () => ({}) }; };
    const mockExec = () => 'https://u:tok@github.com/o/r.git\n';
    const queueFile = path.join(tmpDir, 'q.json');

    const res = await submitFeedback(
      { type: 'other', title: 'x', detail: 'y', env: {} },
      { fetch: mockFetch, exec: mockExec, queueFile }
    );

    assert.equal(res.ok, false);
    assert.equal(fetchCalled, false);
    assert.match(String(res.error), /type/i);
    assert.ok(!fs.existsSync(queueFile), '非法输入不应入队');
  });
});
