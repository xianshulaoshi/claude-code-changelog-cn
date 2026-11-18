// cc-pv：PV 计数云函数（腾讯云 SCF + COS，零依赖）
// 防刷四层：来源校验 / IP+UA 指纹去重窗口 / 每日总量封顶 / 有界指纹表
// API 网关集成响应：GET → 按策略计数并返回 {pv}；OPTIONS → CORS 预检
// 环境变量：COS_BUCKET / COS_REGION / COS_SID / COS_SKEY
//           SITE_SUFFIX（放行的来源域后缀，默认 xianshulaoshi.github.io）
//           DEDUP_HOURS（指纹去重窗口小时数，默认 6）
//           DAILY_MAX（每日计数上限，默认 2000）
const crypto = require('crypto');
const https = require('https');

const KEY = 'pv.json';
const Bucket = process.env.COS_BUCKET; // 如 cc-changelog-pv-1451971551
const Region = process.env.COS_REGION || 'ap-guangzhou';
const Sid = process.env.COS_SID;
const Skey = process.env.COS_SKEY;
const SITE_SUFFIX = process.env.SITE_SUFFIX || 'xianshulaoshi.github.io';
const DEDUP_MS = (parseFloat(process.env.DEDUP_HOURS) || 6) * 3600 * 1000;
const DAILY_MAX = parseInt(process.env.DAILY_MAX, 10) || 2000;
const FP_SOFT_CAP = 20000; // 指纹表软上限，超过后裁剪到 10000（最旧优先）

/* ---------- COS XML API 签名（按官方算法手写，免 SDK） ---------- */
function sha1hex(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
function hmacSha1hex(key, s) { return crypto.createHmac('sha1', key).update(s).digest('hex'); }

function cosAuth(method, pathname, headers, params, ttlSec = 600) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + ttlSec}`;
  // 规范化串中的 k=v 需对 key/value 做 URL 编码（如 if-match 的引号 → %22）
  const sorted = (obj) => Object.keys(obj).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`).join('&');
  const list = (obj) => Object.keys(obj).sort().join(';');
  const httpString = `${method.toLowerCase()}\n${pathname}\n${sorted(params)}\n${sorted(headers)}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1hex(httpString)}\n`;
  const signKey = hmacSha1hex(Skey, keyTime);
  const signature = hmacSha1hex(signKey, stringToSign);
  return (
    `q-sign-algorithm=sha1&q-ak=${Sid}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=${list(headers)}&q-url-param-list=${list(params)}&q-signature=${signature}`
  );
}

function cosRequest(method, extraHeaders, body) {
  const pathname = `/${KEY}`;
  const headers = { host: `${Bucket}.cos.${Region}.myqcloud.com`, ...extraHeaders };
  for (const k of Object.keys(headers)) if (headers[k] === undefined) delete headers[k];
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: headers.host,
        path: pathname,
        method,
        headers: { ...headers, authorization: cosAuth(method, pathname, headers, {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ---------- 请求上下文：来源与指纹 ---------- */
/* 大小写不敏感取 header（函数 URL 事件保留原始键名大小写） */
function hget(headers, name) {
  if (!headers) return undefined;
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

/** 是否像真实页面发来的请求：Origin/Referer 命中站点后缀（本地 file:// 的 Origin:null 也放行） */
function isPageLike(headers) {
  const origin = String(hget(headers, 'origin') || '');
  if (origin === 'null') return true; // 双击打开的本地文件
  const referer = String(hget(headers, 'referer') || '');
  const src = origin || referer;
  if (!src) return false;
  try { return new URL(src).hostname === SITE_SUFFIX; } catch { return false; }
}

/** 访客指纹：客户端 IP + UA */
function fingerprint(event, headers) {
  const ip =
    event?.requestContext?.identity?.sourceIp ||
    String(hget(headers, 'x-forwarded-for') || '').split(',')[0].trim() ||
    hget(headers, 'x-real-ip') || '0.0.0.0';
  const ua = hget(headers, 'user-agent') || '';
  return sha1hex(`${ip}|${ua}`).slice(0, 16);
}

/* ---------- 状态机：pv.json = { n, day, dc, v:{fp:ts} } ---------- */
function loadState(body) {
  let s = {};
  try { s = JSON.parse(body) || {}; } catch { /* 损坏则重建 */ }
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today) { s.day = today; s.dc = 0; } // 跨天重置当日计数
  s.v = (s.v && typeof s.v === 'object') ? s.v : {};
  return s;
}

function pruneFingerprints(v, now) {
  for (const fp of Object.keys(v)) {
    if (now - v[fp] > DEDUP_MS) delete v[fp]; // 窗口外过期
  }
  const keys = Object.keys(v);
  if (keys.length > FP_SOFT_CAP) {
    keys.sort((a, b) => v[a] - v[b]).slice(0, keys.length - FP_SOFT_CAP / 2).forEach((k) => delete v[k]);
  }
}

/** 读-改-写（If-Match 防并发丢更新）。返回新状态；inc=false 时零写入。 */
async function updateState(fp, inc) {
  for (let i = 0; i < 3; i++) {
    const cur = await cosRequest('GET', {});
    let etag;
    const s = { n: 0 };
    if (cur.status === 200) {
      etag = cur.etag;
      Object.assign(s, loadState(cur.body));
    } else if (cur.status !== 404) {
      throw new Error(`COS GET ${cur.status}: ${cur.body.slice(0, 200)}`);
    }
    const now = Date.now();
    pruneFingerprints(s.v, now);
    let counted = false;
    if (inc && s.dc < DAILY_MAX && !(fp in s.v)) {
      s.n += 1; s.dc += 1; s.v[fp] = now;
      counted = true;
    }
    if (!counted) return { n: s.n, counted, reason: !inc ? 'readonly' : s.dc >= DAILY_MAX ? 'daily-cap' : 'dedup' };
    const body = JSON.stringify(s);
    const headers = { 'content-length': Buffer.byteLength(body) };
    if (etag) headers['if-match'] = etag;
    const put = await cosRequest('PUT', headers, body);
    if (put.status === 200 || put.status === 204) return { n: s.n, counted, reason: 'ok' };
    if (put.status !== 412) throw new Error(`COS PUT ${put.status}: ${put.body.slice(0, 200)}`);
    // 412 = 并发冲突，重试
  }
  throw new Error('COS PUT 连续 412');
}

// 只读请求的实例内短缓存，抵抗无脑 GET 洪水对 COS 读的放大
let roCache = { n: 0, at: 0 };
const RO_TTL = 30 * 1000;

/* ---------- 入口 ---------- */
exports.main_handler = async (event) => {
  const cors = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'cache-control': 'no-store' };
  const headers = event?.headers || {};
  if (String(event?.httpMethod || event?.method || '').toUpperCase() === 'OPTIONS') {
    return { isBase64Encoded: false, statusCode: 204, headers: cors, body: '' };
  }
  try {
    const pageLike = isPageLike(headers);
    if (!pageLike) {
      // 非页面来源（裸 curl/扫描器）：走缓存只读，不计数、不写 COS
      if (Date.now() - roCache.at < RO_TTL) return { isBase64Encoded: false, statusCode: 200, headers: cors, body: JSON.stringify({ pv: roCache.n }) };
      const cur = await cosRequest('GET', {});
      const n = cur.status === 200 ? (loadState(cur.body).n || 0) : roCache.n;
      roCache = { n, at: Date.now() };
      return { isBase64Encoded: false, statusCode: 200, headers: cors, body: JSON.stringify({ pv: n }) };
    }
    const fp = fingerprint(event, headers);
    const r = await updateState(fp, true);
    roCache = { n: r.n, at: Date.now() };
    return { isBase64Encoded: false, statusCode: 200, headers: cors, body: JSON.stringify({ pv: r.n }) };
  } catch (e) {
    return { isBase64Encoded: false, statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
