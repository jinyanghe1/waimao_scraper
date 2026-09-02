// Skill 安装引导：检测/安装依赖（Playwright + Chromium），跨平台自适应
// 用法: node install.js
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = __dirname;
const isWin = process.platform === 'win32';

function run(cmd, opts = {}) {
  try {
    const r = spawnSync(cmd, { shell: true, cwd: SKILL_DIR, encoding: 'utf-8', stdio: 'pipe', ...opts });
    return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
  } catch (e) { return { ok: false, out: String(e) }; }
}

const log = [];
const step = (ok, msg) => { log.push(`${ok ? '✅' : '❌'} ${msg}`); console.log(`${ok ? '✅' : '❌'} ${msg}`); };

console.log('=== 网易外贸通采集器 · 环境检测与安装 ===\n');
console.log(`平台: ${process.platform} (${os.arch()})`);

// 1. Node 检测
const nodeV = run('node --version');
step(nodeV.ok, `Node.js ${nodeV.out.trim()}`);
if (!nodeV.ok) {
  console.log('\n❌ 未检测到 Node.js。请先安装 Node 18+（WorkBuddy 通常自带，或用 nvm）');
  process.exit(1);
}

// 2. 安装依赖
console.log('\n→ 安装依赖 (playwright)…');
const hasNm = fs.existsSync(path.join(SKILL_DIR, 'node_modules', 'playwright'));
if (hasNm) {
  step(true, '依赖已存在，跳过 npm install');
} else {
  const inst = run('npm install --no-audit --no-fund', { timeout: 180000 });
  step(inst.ok, inst.ok ? 'npm 依赖安装完成' : 'npm install 失败: ' + inst.out.slice(0, 200));
  if (!inst.ok) process.exit(1);
}

// 3. 安装 Playwright Chromium 浏览器
console.log('\n→ 检测/安装 Chromium 浏览器…');
const chromiumCheck = run('node -e "require(\'playwright\').chromium.executablePath()"');
let browserOk = false;
if (chromiumCheck.ok) {
  const p = chromiumCheck.out.trim().split('\n').pop();
  browserOk = fs.existsSync(p);
}
if (!browserOk) {
  console.log('  下载 Chromium（约 100MB，首次需要）…');
  const inst = run('npx playwright install chromium', { timeout: 300000 });
  step(inst.ok, inst.ok ? 'Chromium 安装完成' : 'Chromium 安装失败: ' + inst.out.slice(0, 200));
} else {
  step(true, 'Chromium 已就绪');
}

// 4. 浏览器登录引导
console.log('\n→ 检测外贸通登录态…');
// 先检查 9222 是否有已登录的 Chrome
const cdpCheck = run(isWin
  ? 'curl -s --noproxy * http://127.0.0.1:9222/json/version'
  : "curl -s --noproxy '*' http://127.0.0.1:9222/json/version");
if (!cdpCheck.ok || !cdpCheck.out.includes('Chrome')) {
  console.log('  未检测到调试模式的 Chrome，正在启动登录引导…');
  const loginScript = isWin ? 'scripts\\start_chrome.bat' : 'bash scripts/start_chrome.sh';
  run(loginScript);
  console.log('  已在 Chrome 打开外贸通登录页');
}

console.log('\n=== 安装完成 ===');
console.log('\n下一步：在弹出的 Chrome 窗口登录网易外贸通，然后回到 WorkBuddy 说「开始采集」即可。');

// 输出安装报告（供 agent 读取生成 README）
fs.writeFileSync(path.join(SKILL_DIR, 'data', 'install_report.json'), JSON.stringify({
  platform: process.platform, node: nodeV.out.trim(), installedAt: new Date().toISOString(), ok: true,
}, null, 2));
process.exit(0);
