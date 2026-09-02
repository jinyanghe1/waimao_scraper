# 网易外贸通 海关数据 API 接口文档

> 探测时间：2026-09-02 | 域名：`waimao.office.163.com` | 登录态：✅ 已确认（CDP 接管）
> 数据模块：海关数据 → 买家搜索（buyers）

## 0. 关键结论

- **接口为明文 JSON**（非加密/非 protobuf），`POST` 为主，参数语义清晰 → **API 直连路线可行**
- **`sign` 参数为前端动态生成**（每次请求不同）→ 不能脱离浏览器纯 HTTP 调用，**必须在已登录页面上下文里通过 JS 调接口**（借用页面签名逻辑）。这是本项目核心架构决策。
- **翻页纯参数化**：改 `from`（偏移）+ `size` 即可，无需模拟点击
- **联系方式**：列表返回 `emailCount/phoneCount/contactCount/hasContact`，具体邮箱电话在「联系人挖掘」接口（懒加载，开发时动态探测）

## 1. 买家搜索列表（核心）

```
POST /customs/api/biz/customs/data/list/buyers?sign={sign}
POST /customs/api/biz/customs/data/list/buyers/async?sign={sign}   # 异步全量轮询
Content-Type: application/json
```

### 请求体
```json
{
  "type": "goodsShipped",
  "queryValue": "cargo",                  // 搜索关键词
  "relationCountryList": [],              // 贸易伙伴国筛选
  "countryList": [],                      // 国家筛选（买家所在国）
  "containsExpress": true,
  "excludeViewed": false,
  "hasEmail": false,                      // 只显示有邮箱的
  "timeRadius": ["2000-12-31T16:00:00.000Z", "..."],
  "beginDate": "2001-01-01",
  "endDate": "2026-09-02",
  "otherGoodsShipped": ["cargo", "carga"],
  "onlyContainsChina": false,             // 是否限定发货地含中国
  "from": 0,                              // 分页偏移 0,1,2...（页码）
  "size": 20,                             // 每页条数
  "groupByCountry": true,
  "exactlySearch": false,
  "async": true,
  "frontPoll": true
}
```

### 响应（`body.data`）
| 字段 | 类型 | 说明 |
|---|---|---|
| total | int | 当前可翻页总数（封顶 10000） |
| realTotalCount | int | 真实总结果数（如 405426） |
| records | array | **买家列表，每页 size 条** |
| asyncId | string | 异步任务 ID（轮询用） |
| canPoll / hasNext | bool | 翻页标志 |

### records[i] 单条买家字段（60+，核心如下）
| 字段 | 说明 |
|---|---|
| companyName / showCompanyName | 公司名 |
| country / standardCountry | 国家 |
| globalId | 公司域名（如 ups.com） |
| totalTransactions | 交易次数 |
| valueOfGoodsUSD | 交易金额（USD，字符串带千分位） |
| topProductDesc / topHsCode | 主营产品描述 / HS编码 |
| portOfLadings / portOfUnLadings | 装货港 / 卸货港 |
| lastTransactionDate | 最近交易日期 |
| **emailCount** | 邮箱数量 |
| **phoneCount** | 电话数量 |
| **contactCount** | 联系人总数 |
| hasContact / canExcavate | 是否有联系方式/可挖掘 |
| excavatedCompanyInfo | 已挖掘信息（含 linkedin、contactCount） |

## 2. 买家详情

```
POST /customs/api/biz/customs/data/v3/detail/buyers/base?sign={sign}        # 基础信息
POST /customs/api/biz/customs/data/v3/detail/buyers/statistics?sign={sign}  # 交易统计
POST /customs/api/biz/customs/data/v3/detail/buyers/timeline?sign={sign}    # 时间线
```

### base 请求体
```json
{ "companyName": "Global Link Logistics", "country": "United States",
  "groupByCountry": true, "sourceType": "customs",
  "beginDate": "2007-07-21", "endDate": "2026-08-28" }
```
### base 响应 data 关键字段
companyName, country, address, position, postalCode, totalImportOfUsd, importCount, lastImportTime,
**excavatedCompanyInfo: { name, country, phone, contactCount, linkedin }**

## 3. 联系方式挖掘（待开发期动态探测）

具体邮箱/电话列表接口为懒加载，点击详情页「联系人」时触发。开发期在页面上下文捕获。
列表接口已提供 emailCount/phoneCount，可作为是否深入挖掘的过滤条件。

## 4. 签名机制（sign）

- 每个请求 URL 带 `sign={32位大写hex}`，由前端 JS 根据请求参数实时计算
- **应对**：不复用 sign。在已登录页面里用 `page.evaluate(fetch)` 或直接调用页面内部请求函数，让浏览器自动带上正确签名与 Cookie
