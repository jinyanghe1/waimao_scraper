// 用户反馈闭环：客服本地一键把建议/bug 同步到 GitHub Issue
// 用法: node src/feedback.js --type bug --title "联系人采集卡死" --detail "跑到第5家就不动了"
// 设计：token 不落盘，从 .git/config 的 remote URL（https://user:TOKEN@github.com/owner/repo.git）提取；
//       调用失败时降级写入本地 data/feedback_queue.json，待后续重发。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const DEFAULT_QUEUE_FILE = path.join(SKILL_DIR, 'data', 'feedback_queue.json');

const VALID_TYPES = ['bug', 'feature', 'suggestion'];

// ---------- 解析 remote URL ----------
// 支持: https://user:TOKEN@github.com/owner/repo.git → { owner, repo, token }
// 其他形式（ssh、无 token、非 GitHub、空值）一律返回 null
export function parseRemoteUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.trim().match(/^https?:\/\/([^:/@]+):([^@/]+)@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const [, , token, owner, repo] = m;
  if (!token || !owner || !repo) return null;
  return { owner, repo, token };
}

// 从 git remote 解析 { owner, repo, token }；任何失败返回 null
export function parseGitRemote(opts = {}) {
  const exec = opts.exec || ((cmd) => execSync(cmd, { cwd: opts.cwd || SKILL_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  try {
    const url = exec('git remote get-url origin');
    return parseRemoteUrl(url);
  } catch {
    return null;
  }
}

// ---------- 环境信息 ----------
export function getEnvInfo(opts = {}) {
  const exec = opts.exec || ((cmd) => execSync(cmd, { cwd: opts.cwd || SKILL_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  let skillVersion = null;
  try { skillVersion = exec('git rev-parse --short HEAD').trim(); } catch { /* 非 git 仓库时忽略 */ }
  return {
    platform: process.platform,
    node: process.version,
    skillVersion,
    time: new Date().toISOString(),
  };
}

// ---------- 构造 Issue 请求体 ----------
export function buildIssuePayload({ type, title, detail, env = {} }) {
  const envLines = [
    '',
    '---',
    '**环境信息**',
    `- 平台: ${env.platform ?? 'unknown'}`,
    `- Node: ${env.node ?? 'unknown'}`,
    `- Skill 版本: ${env.skillVersion ?? 'unknown'}`,
    `- 时间: ${env.time ?? new Date().toISOString()}`,
  ].join('\n');
  return {
    title: `[${type}] ${title}`,
    body: `${detail ?? ''}${envLines}`,
    labels: [type, 'user-feedback'],
  };
}

// ---------- 本地降级队列 ----------
export function appendLocalQueue(item, opts = {}) {
  const queueFile = opts.queueFile || DEFAULT_QUEUE_FILE;
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  let arr = [];
  try {
    if (fs.existsSync(queueFile)) {
      const parsed = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
      if (Array.isArray(parsed)) arr = parsed;
    }
  } catch {
    arr = []; // 文件损坏时重置，避免持续失败
  }
  arr.push({ ...item, queuedAt: new Date().toISOString() });
  fs.writeFileSync(queueFile, JSON.stringify(arr, null, 2), 'utf-8');
  return queueFile;
}

// ---------- 提交反馈 ----------
export async function submitFeedback(input, opts = {}) {
  const { type, title, detail } = input || {};

  // 校验
  if (!VALID_TYPES.includes(type)) {
    return { ok: false, url: null, error: `invalid type: ${type}（应为 ${VALID_TYPES.join('|')}）` };
  }
  if (!title) {
    return { ok: false, url: null, error: 'missing title' };
  }

  const env = input.env || getEnvInfo(opts);
  const payload = buildIssuePayload({ type, title, detail, env });
  const queueFile = opts.queueFile || DEFAULT_QUEUE_FILE;

  // 解析 remote；无 token 直接降级，不发请求
  const remote = parseGitRemote(opts);
  if (!remote) {
    appendLocalQueue({ type, title, detail, env }, { queueFile });
    return { ok: false, url: null, error: 'no_remote_or_token（已写入本地队列）' };
  }

  const fetchImpl = opts.fetch || globalThis.fetch;
  const apiUrl = `https://api.github.com/repos/${remote.owner}/${remote.repo}/issues`;

  try {
    const res = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${remote.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'waimao-scraper-feedback',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data && data.message) msg += `: ${data.message}`;
      } catch { /* 忽略 body 解析失败 */ }
      appendLocalQueue({ type, title, detail, env }, { queueFile });
      return { ok: false, url: null, error: msg };
    }

    const data = await res.json();
    return { ok: true, url: data.html_url || null, error: null };
  } catch (e) {
    appendLocalQueue({ type, title, detail, env }, { queueFile });
    return { ok: false, url: null, error: String(e && e.message ? e.message : e) };
  }
}

// ---------- CLI ----------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.type || !args.title) {
    console.error('用法: node src/feedback.js --type bug|feature|suggestion --title "标题" --detail "详情"');
    process.exit(2);
  }
  const res = await submitFeedback({
    type: args.type,
    title: args.title,
    detail: args.detail || '',
  });
  if (res.ok) {
    console.log(`✓ 已提交反馈: ${res.url || '(已创建)'}`);
    process.exit(0);
  } else {
    console.error(`✗ 提交失败: ${res.error}`);
    console.error('  已降级写入本地队列 data/feedback_queue.json，待后续重发。');
    process.exit(1);
  }
}

// 仅当作为脚本直接运行时执行 main
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
