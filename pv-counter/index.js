// cc-pv：极简 PV 计数云函数（腾讯云 SCF + COS，零依赖）
// API 网关集成响应：GET → 计数 +1 并返回 {pv}；OPTIONS → CORS 预检
// 环境变量：COS_BUCKET / COS_REGION / COS_SID / COS_SKEY
const crypto = require('crypto');
const https = require('https');

const KEY = 'pv.json';
const Bucket = process.env.COS_BUCKET; // 如 cc-changelog-pv-1451971551
const Region = process.env.COS_REGION || 'ap-guangzhou';
const Sid = process.env.COS_SID;
const Skey = process.env.COS_SKEY;

/* ---------- COS XML API 签名（按官方算法手写，免 SDK） ---------- */
function sha1hex(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
function hmacSha1hex(key, s) { return crypto.createHmac('sha1', key).update(s).digest('hex'); }

/**
 * @param method 大写 HTTP 方法
 * @param pathname URL 路径（已编码，如 /pv.json）
 * @param headers 参与签名的 header（key 小写）；会原样发送
 * @param params 参与签名的 query（key 小写）
 */
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

/* ---------- 计数：GET → +1 → PUT（If-Match 防并发丢计数） ---------- */
async function bump() {
  for (let i = 0; i < 3; i++) {
    const cur = await cosRequest('GET', {});
    let n = 0;
    let etag;
    if (cur.status === 200) {
      etag = cur.etag;
      try { n = parseInt(JSON.parse(cur.body).n, 10) || 0; } catch { n = 0; }
    } else if (cur.status !== 404) {
      throw new Error(`COS GET ${cur.status}: ${cur.body.slice(0, 200)}`);
    }
    const next = JSON.stringify({ n: n + 1, t: Date.now() });
    const put = await cosRequest('PUT', etag ? { 'if-match': etag, 'content-length': Buffer.byteLength(next) } : { 'content-length': Buffer.byteLength(next) }, next);
    if (put.status === 200 || put.status === 204) return n + 1;
    if (put.status !== 412) throw new Error(`COS PUT ${put.status}: ${put.body.slice(0, 200)}`);
    // 412 = 并发冲突，重试
  }
  throw new Error('COS PUT 连续 412');
}

/* ---------- 入口 ---------- */
exports.main_handler = async (event) => {
  const cors = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'cache-control': 'no-store' };
  if (String(event?.httpMethod || event?.method || '').toUpperCase() === 'OPTIONS') {
    return { isBase64Encoded: false, statusCode: 204, headers: cors, body: '' };
  }
  try {
    const pv = await bump();
    return { isBase64Encoded: false, statusCode: 200, headers: cors, body: JSON.stringify({ pv }) };
  } catch (e) {
    return { isBase64Encoded: false, statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
