# Web Archive API 接入指南

## 基础约定

**Base URL**: `https://web.l3j.icu`（或自部署地址）

**认证**: 所有 API 需在 Header 中携带 Token：
```
Authorization: Bearer <your-token>
```
> 首次请求时若数据库中无 Token，输入的值会被自动设为密码（长度 ≥ 8）。

**响应格式**:
```json
// 成功
{ "code": 200, "data": { ... }, "message": "success" }

// 失败
{ "code": 4xx/5xx, "message": "错误描述" }
```

---

## 核心接口

### 存档一个 URL

```
POST /api/pages/archive_by_url
```

**请求体**:
```json
{
  "url": "https://example.com",
  "folderId": 0,
  "titleOverride": "自定义标题（可选）",
  "pageDescOverride": "自定义描述（可选）",
  "bindTags": ["tag1", "tag2"],
  "isShowcased": false,
  "options": {
    "fetcherProvider": "firecrawl",
    "generateSummary": false,
    "captureScreenshot": false
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | ✅ | 要存档的页面 URL |
| `folderId` | number | ✅ | 目标文件夹 ID，`0` 为未分类 |
| `options.fetcherProvider` | string | ❌ | 指定抓取器，默认用全局配置 |

**响应**:
```json
// 新建成功
{ "code": 200, "data": { "status": "created", "pageId": 14, "title": "...", "pageDesc": "...", "fetcherUsed": "firecrawl" } }

// URL 已存在（幂等）
{ "code": 200, "data": { "status": "duplicate", "pageId": 5 } }
```

---

### 预览 URL（不存档）

```
POST /api/pages/preview_url
```

**请求体**:
```json
{
  "url": "https://example.com",
  "fetcherProvider": "raw-fetch"
}
```

**响应**:
```json
{
  "code": 200,
  "data": {
    "finalUrl": "https://example.com",
    "title": "Example Domain",
    "metaDescription": "...",
    "textSample": "前 2000 字符的正文...",
    "hasScreenshot": false,
    "fetcherUsed": "raw-fetch",
    "bytes": 1256,
    "fetchedAt": "2026-05-21T14:00:00.000Z"
  }
}
```

---

### 查询页面列表

```
POST /api/pages/query
```

**请求体**:
```json
{
  "folderId": 0,
  "keyword": "搜索关键词",
  "tagId": 1,
  "pageNumber": 1,
  "pageSize": 20
}
```

---

### 查询文件夹列表

```
GET /api/folders/all
```

---

### 获取/更新抓取器配置

```
GET  /api/config/url_archiver
POST /api/config/url_archiver
```

**配置示例（Firecrawl）**:
```json
{
  "provider": "firecrawl",
  "apiKey": "fc-xxx",
  "apiUrl": "https://api.firecrawl.dev",
  "generateSummaryByDefault": false,
  "generateTagsByDefault": false,
  "captureScreenshotByDefault": false,
  "aiSummary": { "type": "noop" }
}
```

> `apiKey` 在 GET 响应中会被脱敏为 `***`，POST 时传 `***` 表示保留原值不修改。

---

## 抓取器（fetcherProvider）

| 值 | 说明 | 需要配置 |
|----|------|----------|
| `auto` | 使用全局配置的抓取器 | — |
| `raw-fetch` | 直接 HTTP 请求，无外部依赖 | 无 |
| `jina-reader` | Jina AI Reader，适合复杂页面 | `apiKey`（可选，限速） |
| `firecrawl` | Firecrawl，支持 JS 渲染 | `apiKey` 必填 |
| `cf-browser-rendering` | Cloudflare Browser Rendering | CF 账号 |
| `noop` | 空实现，用于测试 | 无 |

---

## 错误码

| HTTP 状态 | 含义 |
|-----------|------|
| 400 | 参数错误（`INVALID_URL` 等） |
| 401 | Token 无效 |
| 404 | 目标页面返回 4xx |
| 413 | 页面超过 10 MiB 限制 |
| 501 | 功能未实现 |
| 502 | 上游抓取器失败 |
| 504 | 抓取超时（默认 25s） |

---

## 快速接入示例

```bash
# 1. 配置 Firecrawl
curl -X POST https://web.l3j.icu/api/config/url_archiver \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"firecrawl","apiKey":"fc-xxx","generateSummaryByDefault":false,"generateTagsByDefault":false,"captureScreenshotByDefault":false,"aiSummary":{"type":"noop"}}'

# 2. 存档页面
curl -X POST https://web.l3j.icu/api/pages/archive_by_url \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","folderId":0}'
```
