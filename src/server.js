// 本地 Web 控制台：可视化控制采集参数，仅监听 127.0.0.1，无任何外传
// 用法: node src/server.js  →  浏览器打开 http://127.0.0.1:17890
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 17890;
const HOST = '127.0.0.1'; // 仅本地，不监听外部

// 当前运行中的任务
let currentJob = null;

function listData() {
  const dir = path.join(ROOT, 'data');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    const lines = fs.readFileSync(path.join(dir, f), 'utf-8').split('\n').filter((l) => l.trim()).length - 1;
    return { name: f, size: st.size, rows: Math.max(0, lines), mtime: st.mtime.toISOString() };
  }).sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function readCsvPreview(name, limit = 100) {
  const fp = path.join(ROOT, 'data', path.basename(name)); // 防目录穿越
  if (!fs.existsSync(fp)) return null;
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter((l) => l.trim());
  const parse = (line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
  return { header: parse(lines[0].replace(/^﻿/, '')), rows: lines.slice(1, limit + 1).map(parse) };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const send = (code, data, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  };

  // 静态首页
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(200, fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf-8'), 'text/html');
  }
  // 状态
  if (url.pathname === '/api/status') {
    return send(200, { job: currentJob ? { running: true, ...currentJob.log.slice(-1)[0] && { lastLog: currentJob.log[currentJob.log.length - 1] }, logs: currentJob.log.slice(-30) } : { running: false }, files: listData() });
  }
  // 启动采集
  if (url.pathname === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { mode, keyword, pages, topX, companies } = JSON.parse(body || '{}');
        if (currentJob) return send(409, { error: '已有任务运行中' });
        const kw = String(keyword || 'cargo').replace(/[^\w一-龥-]/g, '').slice(0, 30) || 'cargo';
        let args;
        if (mode === 'contacts') args = ['src/contacts.js', kw, String(Math.min(+companies || 10, 50)), String(Math.min(+topX || 3, 10))];
        else args = ['src/index.js', kw, String(Math.min(+pages || 2, 30))];
        const child = spawn(process.execPath, args, { cwd: ROOT });
        currentJob = { mode, keyword: kw, start: Date.now(), log: [] };
        child.stdout.on('data', (d) => currentJob.log.push(...String(d).split('\n').filter(Boolean)));
        child.stderr.on('data', (d) => currentJob.log.push('[err] ' + String(d).trim()));
        child.on('close', () => { currentJob.log.push('--- 任务结束 ---'); setTimeout(() => { currentJob = null; }, 5000); });
        send(200, { ok: true, args });
      } catch (e) { send(400, { error: e.message }); }
    });
    return;
  }
  // 预览 CSV
  if (url.pathname === '/api/preview') {
    const data = readCsvPreview(url.searchParams.get('file') || '');
    return data ? send(200, data) : send(404, { error: 'not found' });
  }
  // 下载 CSV
  if (url.pathname === '/api/download') {
    const fp = path.join(ROOT, 'data', path.basename(url.searchParams.get('file') || ''));
    if (!fs.existsSync(fp)) return send(404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(fp)}"` });
    return fs.createReadStream(fp).pipe(res);
  }
  send(404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`✅ 本地控制台已启动: http://${HOST}:${PORT}`);
  console.log('   仅监听 127.0.0.1，不对外。采集前请确保 Chrome 以 9222 调试端口运行并已登录外贸通。');
});
