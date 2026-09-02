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
  return {
    company_name: company.company_name || '',
    // 国家以「公司」为准；联系人自带的 companyCountry 可能是联系人国籍，仅作兜底
    country: company.country || '',
    domain: company.domain || '',
    contact_name: contact.name || '',
    contact_title: contact.jobTitle || '',
    contact_type: contactType(contact.type),
    email: emails.join('; '),
    phone: phones.join('; '),
    linkedin: contact.linkedinUrl || '',
    contact_origin: contact.origin || '', // 社交网站 / 大数据挖掘
    has_email: hasEmail ? '1' : '0',
    keyword: company.keyword || '',
    scraped_at: new Date().toISOString(),
  };
}

/** getContactPage 响应 data → 联系人行数组（截断 topX） */
export function parseContactPage(data, company, topX = 5) {
  if (!data || !Array.isArray(data.content)) return [];
  return data.content
    .slice(0, topX)
    .map((c) => parseContact(c, company))
    .filter(Boolean);
}
