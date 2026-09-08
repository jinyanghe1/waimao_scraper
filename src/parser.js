// 解析器：buyers 列表/详情 JSON → 结构化线索记录
// 输入为接口原始 data（含 records），输出为扁平化 CSV 行对象

/** 数值字段去千分位 */
export function parseUsd(s) {
  if (s === null || s === undefined || s === '') return '';
  const n = String(s).replace(/[,$\s]/g, '');
  return n;
}

/** 单条买家记录 → 标准线索行 */
export function parseBuyer(rec, { keyword = '', sourceUrl = '' } = {}) {
  if (!rec || typeof rec !== 'object') return null;
  const company = rec.showCompanyName || rec.companyName || rec.originCompanyName || '';
  return {
    company_name: company,
    country: rec.standardCountry || rec.country || '',
    contact_name: '', // 详情挖掘后填
    contact_title: '',
    phone: '',        // 真实电话，详情挖掘后填
    email: '',        // 真实邮箱，详情挖掘后填
    email_count: rec.emailCount ?? '',   // 邮箱数量
    phone_count: rec.phoneCount ?? '',   // 电话数量
    keyword,
    source_url: sourceUrl,
    scraped_at: new Date().toISOString(),
    // 扩展字段
    domain: rec.globalId || '',
    transactions: rec.totalTransactions ?? '',
    value_usd: parseUsd(rec.valueOfGoodsUSD),
    contact_count: rec.contactCount ?? '',
    has_contact: rec.hasContact === true ? '1' : '0',
    last_tx_date: rec.lastTransactionDate || '',
    top_product: rec.topProductDesc || '',
  };
}

/** 列表响应 data → 线索行数组 */
export function parseListData(data, opts = {}) {
  if (!data || !Array.isArray(data.records)) return [];
  return data.records.map((r) => parseBuyer(r, opts)).filter(Boolean);
}

/** 详情 base 响应 → 补充联系方式到已有行 */
export function mergeDetail(row, baseData) {
  if (!row || !baseData) return row;
  const ex = baseData.excavatedCompanyInfo || {};
  return {
    ...row,
    contact_name: ex.contactPerson || ex.name || row.contact_name || '',
    phone: ex.phone || row.phone,
    email: ex.email || row.email,
    source_url: baseData.linkedin || ex.linkedin || row.source_url,
  };
}

/** 邮箱数组 → { email, valid } 列表；emailStatus===1 视为有效 */
export function parseEmails(emailArr) {
  if (!Array.isArray(emailArr)) return [];
  return emailArr
    .map((x) => {
      if (typeof x === 'string') return { email: x, valid: true };
      const email = x?.email || '';
      if (!email) return null;
      return { email, valid: x?.emailStatus === 1 };
    })
    .filter(Boolean);
}

/** 联系人类型 → 中文 */
export function contactType(t) {
  return { LEADERS: '高管', MANAGER: '经理', COMMON: '普通' }[t] || t || '';
}

/** 单个联系人 → 扁平行（挂到公司） */
export function parseContact(contact, company) {
  if (!contact || typeof contact !== 'object') return null;
  // emails/phones 是对象数组 [{email, emailStatus, ...}] 或字符串
  const normList = (arr, key) => {
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => (typeof x === 'string' ? x : x?.[key] || x?.email || x?.phone || '')).filter(Boolean);
  };
  const emails = normList(contact.emails, 'email');
  if (contact.email && !emails.length) emails.push(contact.email);
  const phones = normList(contact.phones, 'phone');
  if (contact.phone && !phones.length) phones.push(contact.phone);
  const hasEmail = emails.length > 0;
  // 有效邮箱：emailStatus===1；字符串邮箱视为有效
  const validEmails = parseEmails(contact.emails)
    .filter((e) => e.valid)
    .map((e) => e.email);
  // 若 emails 为空但顶层有 email 字段，顶层视为有效
  if (!validEmails.length && contact.email && emails.length && emails[0] === contact.email) {
    validEmails.push(contact.email);
  }
  return {
    company_name: company.company_name || '',
    // 国家以「公司」为准；联系人自带的 companyCountry 可能是联系人国籍，仅作兜底
    country: company.country || '',
    domain: company.domain || '',
    contact_name: contact.name || '',
    contact_title: contact.jobTitle || '',
    contact_type: contactType(contact.type),
    email: emails.join('; '),
    email_valid: validEmails.join('; '),
    phone: phones.join('; '),
    linkedin: contact.linkedinUrl || '',
    contact_origin: contact.origin || '', // 社交网站 / 大数据挖掘
    has_email: hasEmail ? '1' : '0',
    keyword: company.keyword || '',
    scraped_at: new Date().toISOString(),
  };
}

/** 公司去重：按 domain（不区分大小写）保留 value_usd 最高的一条；domain 为空的全部保留 */
export function dedupeLeads(rows) {
  if (!Array.isArray(rows)) return [];
  const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[,$\s]/g, ''));
    return Number.isFinite(n) ? n : -Infinity;
  };
  const best = new Map(); // key = lowercased domain
  const noDomain = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const d = (r.domain || '').toLowerCase();
    if (!d) {
      noDomain.push(r);
      continue;
    }
    const prev = best.get(d);
    if (!prev || num(r.value_usd) > num(prev.value_usd)) best.set(d, r);
  }
  return [...best.values(), ...noDomain];
}

/** 联系人质量排序：有邮箱优先；同级时 LEADERS > MANAGER > COMMON。返回新数组。 */
export function rankContacts(contacts) {
  if (!Array.isArray(contacts)) return [];
  const typeRank = { LEADERS: 0, MANAGER: 1, COMMON: 2 };
  const hasEmail = (c) => {
    if (!c) return false;
    if (Array.isArray(c.emails) && c.emails.length > 0) return true;
    if (c.email) return true;
    return false;
  };
  return [...contacts].sort((a, b) => {
    const ea = hasEmail(a) ? 0 : 1;
    const eb = hasEmail(b) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    const ta = typeRank[a?.type] ?? 3;
    const tb = typeRank[b?.type] ?? 3;
    return ta - tb;
  });
}

/** getContactPage 响应 data → 联系人行数组（先按质量排序，再截断 topX） */
export function parseContactPage(data, company, topX = 5) {
  if (!data || !Array.isArray(data.content)) return [];
  return rankContacts(data.content)
    .slice(0, topX)
    .map((c) => parseContact(c, company))
    .filter(Boolean);
}
