import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 跨平台/跨浏览器兼容回归测试：确保启动脚本与登录 UA 在多平台多浏览器下不退化

test('start_chrome.sh 支持 Chrome/Edge/Chromium 且不强杀浏览器', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'start_chrome.sh'), 'utf-8');
  // 覆盖三大浏览器
  assert.match(sh, /Microsoft Edge/, '应支持 macOS Edge');
  assert.match(sh, /microsoft-edge/, '应支持 Linux Edge');
  assert.match(sh, /chromium/i, '应支持 Chromium');
  // 复用 9222，不粗暴 pkill 用户浏览器
  assert.match(sh, /json\/version/, '应先探测 9222 复用');
  assert.ok(!/pkill -x "Google Chrome"/.test(sh), '不应再强杀 Chrome（避免丢用户未保存工作）');
});

test('start_chrome.bat 支持 Chrome/Edge 且不强杀浏览器', () => {
  const bat = fs.readFileSync(path.join(ROOT, 'scripts', 'start_chrome.bat'), 'utf-8');
  assert.match(bat, /msedge\.exe/, '应支持 Windows Edge');
  assert.match(bat, /chrome\.exe/, '应支持 Windows Chrome');
  assert.match(bat, /json\/version/, '应先探测 9222 复用');
  assert.ok(!/taskkill \/F \/IM chrome\.exe/i.test(bat), '不应再强杀 chrome 进程');
});

test('login.js 的 User-Agent 按平台动态生成，不写死 macOS', () => {
  const login = fs.readFileSync(path.join(ROOT, 'src', 'login.js'), 'utf-8');
  assert.match(login, /process\.platform/, '应读取平台');
  assert.match(login, /Windows NT 10\.0/, 'Windows 平台应有对应 UA');
  assert.match(login, /Linux x86_64/, 'Linux 平台应有对应 UA');
});

test('install.js 写报告前确保 data 目录存在（防 ENOENT）', () => {
  const inst = fs.readFileSync(path.join(ROOT, 'install.js'), 'utf-8');
  assert.match(inst, /mkdirSync\(.*recursive:\s*true/, '写 install_report 前应 mkdirSync data');
});

test('install.js 检测浏览器时识别 Edge/Chromium 而非仅 Chrome', () => {
  const inst = fs.readFileSync(path.join(ROOT, 'install.js'), 'utf-8');
  assert.match(inst, /Chrome\|Edge\|Chromium|Edge\|Chromium/, 'CDP 检测应兼容 Edge/Chromium');
});
