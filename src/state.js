// 断点/进度管理：记录已完成的 keyword+page，支持断点续传
import fs from 'node:fs';
import path from 'node:path';

export class ProgressStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.state = { done: {}, lastRun: null };
    if (fs.existsSync(filePath)) {
      try { this.state = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch {}
    }
  }
  _key(keyword, page) { return `${keyword}::${page}`; }
  isDone(keyword, page) { return !!this.state.done[this._key(keyword, page)]; }
  markDone(keyword, page) {
    this.state.done[this._key(keyword, page)] = new Date().toISOString();
    this.state.lastRun = new Date().toISOString();
    this.save();
  }
  save() { fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8'); }
}
