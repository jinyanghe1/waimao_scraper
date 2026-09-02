// CSV 落盘：增量写入、断点续传、字段转义
import fs from 'node:fs';
import path from 'node:path';

export const COLUMNS = [
  ['company_name', '公司名'],
  ['country', '国家'],
  ['domain', '域名'],
  ['contact_name', '联系人'],
  ['contact_title', '职位'],
  ['phone', '电话'],
  ['email', '邮箱'],
  ['email_count', '邮箱数'],
  ['phone_count', '电话数'],
  ['contact_count', '联系人总数'],
  ['has_contact', '有联系方式'],
  ['transactions', '交易次数'],
  ['value_usd', '交易金额USD'],
  ['top_product', '主营产品'],
  ['last_tx_date', '最近交易'],
  ['keyword', '关键词'],
  ['source_url', '来源/LinkedIn'],
  ['scraped_at', '采集时间'],
];

export function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function rowToLine(record) {
  return COLUMNS.map(([key]) => escapeCsv(record[key])).join(',');
}

export class CsvWriter {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // 文件不存在则写表头（含 BOM 便于 Excel 打开中文）
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '﻿' + COLUMNS.map(([, label]) => label).join(',') + '\n', 'utf-8');
    }
  }
  append(record) {
    fs.appendFileSync(this.filePath, rowToLine(record) + '\n', 'utf-8');
  }
  count() {
    const lines = fs.readFileSync(this.filePath, 'utf-8').split('\n').filter((l) => l.trim());
    return Math.max(0, lines.length - 1); // 减表头
  }
}
