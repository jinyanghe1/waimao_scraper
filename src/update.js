// 自动更新：检测 GitHub 新版 → 提醒 → 拉取安装
// 用法: node src/update.js          # 检测并提示，有新版则更新
//       node src/update.js --check  # 仅检测不更新，退出码 0=已最新 1=有新版 2=未配置远程
// 设计：全过程对客服隐身——agent 调用时检测，有新版自动 pull，仅一句提示
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

function sh(cmd, opts = {}) {
  try { return execSync(cmd, { cwd: SKILL_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim(); }
  catch (e) { return null; }
}

// 1. 是否配置了远程（GitHub）
const remote = sh('git remote get-url origin');
if (!remote) {
  const msg = { configured: false, reason: 'no_remote', note: '未配置 GitHub 远程，跳过更新检测' };
  console.log(JSON.stringify(msg));
  process.exit(2);
}

// 2. 拉取远程最新（不合并，只 fetch）
sh('git fetch origin --quiet');
const local = sh('git rev-parse HEAD');
const remoteBranch = sh('git rev-parse --abbrev-ref origin/HEAD') || 'origin/main';
const remoteHash = sh(`git rev-parse ${remoteBranch}`);

if (!local || !remoteHash) {
  console.log(JSON.stringify({ configured: true, error: '无法读取版本' }));
  process.exit(2);
}

const hasUpdate = local !== remoteHash;
const behind = hasUpdate ? (sh(`git rev-list --count HEAD..${remoteBranch}`) || '?') : '0';

if (!hasUpdate) {
  console.log(JSON.stringify({ configured: true, update: false, version: local.slice(0, 7), msg: '已是最新' }));
  process.exit(0);
}

// 有新版
console.log(JSON.stringify({ configured: true, update: true, behind: `${behind} 个提交`, from: local.slice(0, 7), to: remoteHash.slice(0, 7), msg: 'GitHub 上有新版本' }));
if (CHECK_ONLY) process.exit(1);

// 3. 执行更新（拉取 + 合并）
console.log('→ 正在从 GitHub 拉取新版本…');
const pull = sh(`git pull --ff-only origin ${remoteBranch.replace('origin/', '')}`);
if (pull === null) {
  // ff 失败（本地有改动），尝试 stash 后 pull
  sh('git stash --include-untracked --quiet');
  const pull2 = sh(`git pull --ff-only origin ${remoteBranch.replace('origin/', '')}`);
  if (pull2 === null) {
    console.log(JSON.stringify({ ok: false, error: '更新失败：本地有冲突改动，请人工处理' }));
    process.exit(1);
  }
}
// 4. 重装依赖（package.json 可能变了）
sh('npm install --no-audit --no-fund --silent');
console.log(JSON.stringify({ ok: true, version: remoteHash.slice(0, 7), msg: '已更新到最新版本' }));
process.exit(0);
// version bump test
