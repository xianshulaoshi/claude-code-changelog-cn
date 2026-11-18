// 抓取 Claude Code 官方 Changelog：多源尝试 + 本地缓存兜底
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const DEFAULT_SOURCES = [
  'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md',
  'https://cdn.jsdelivr.net/gh/anthropics/claude-code@main/CHANGELOG.md',
  'https://fastly.jsdelivr.net/gh/anthropics/claude-code@main/CHANGELOG.md',
];

const UA = 'claude-code-changelog-cn/1.0';

/** GET 文本。优先 Node fetch；失败时退回 curl（自动读取代理环境变量）。 */
export async function httpGetText(url, timeoutMs = 30000) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    const secs = String(Math.ceil(timeoutMs / 1000));
    const { stdout } = await execFileP(
      'curl',
      ['-sL', '--max-time', secs, '-A', UA, '-w', '\n%{http_code}', url],
      { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs + 5000 }
    );
    const idx = stdout.lastIndexOf('\n');
    const code = stdout.slice(idx + 1).trim();
    const body = stdout.slice(0, idx);
    if (code === '200' && body) return body;
    throw new Error(`HTTP ${code || 'unknown'}`);
  }
}

/** GET JSON。 */
export async function httpGetJson(url, timeoutMs = 15000) {
  const text = await httpGetText(url, timeoutMs);
  return JSON.parse(text);
}

function looksLikeChangelog(text) {
  return typeof text === 'string' && /^#\s+changelog/i.test(text.trim()) && /^##\s+\d/m.test(text);
}

/** 依次尝试多个源抓取 changelog，成功后写入本地缓存；全部失败时读上次缓存。 */
export async function fetchChangelog({ sources = DEFAULT_SOURCES, outDir = 'out', log = () => {} } = {}) {
  const errors = [];
  for (const url of sources) {
    try {
      log(`抓取: ${url}`);
      const text = await httpGetText(url, 30000);
      if (!looksLikeChangelog(text)) throw new Error('返回内容不是有效的 Changelog');
      try {
        fs.mkdirSync(path.join(outDir, 'raw'), { recursive: true });
        fs.writeFileSync(path.join(outDir, 'raw', 'CHANGELOG.md'), text);
      } catch { /* 缓存写入失败不影响主流程 */ }
      return { text, source: url };
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  // 兜底：使用上次抓取的本地缓存
  const cachePath = path.join(outDir, 'raw', 'CHANGELOG.md');
  if (fs.existsSync(cachePath)) {
    const text = fs.readFileSync(cachePath, 'utf8');
    if (looksLikeChangelog(text)) {
      log('所有在线源均失败，使用本地缓存的 changelog');
      return { text, source: cachePath };
    }
  }
  throw new Error(`所有数据源抓取失败:\n  ${errors.join('\n  ')}`);
}

/** 查询 npm 上 @anthropic-ai/claude-code 的最新版本号（用于标注，失败不影响主流程）。 */
export async function fetchLatestNpmVersion() {
  try {
    const data = await httpGetJson('https://registry.npmjs.org/@anthropic-ai/claude-code/latest', 15000);
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/** 获取各版本 npm 发布时间（YYYY-MM-DD）。本地缓存 24h，ETag 304 复用，失败回退旧缓存。 */
export async function fetchNpmTimes({ outDir = 'out', log = () => {} } = {}) {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const cachePath = pathMod.join(outDir, 'npm-times.json');
  const TTL = 24 * 3600 * 1000;
  let cache = null;
  try { cache = JSON.parse(fsMod.readFileSync(cachePath, 'utf8')); } catch { /* 无缓存 */ }

  const fresh = cache && Date.now() - new Date(cache.fetchedAt).getTime() < TTL;
  if (fresh) return cache.time || {};

  const url = 'https://registry.npmjs.org/@anthropic-ai/claude-code';
  try {
    const headers = { accept: 'application/vnd.npm+json' };
    if (cache?.etag) headers['if-none-match'] = cache.etag;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
    if (res.status === 304 && cache) {
      const out = { fetchedAt: new Date().toISOString(), etag: cache.etag, time: cache.time };
      try { fsMod.writeFileSync(cachePath, JSON.stringify(out)); } catch {}
      return out.time;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const etag = res.headers.get('etag') || '';
    const doc = await res.json();
    const time = {};
    for (const [ver, iso] of Object.entries(doc?.time || {})) {
      if (ver === 'created' || ver === 'modified') continue;
      time[ver] = String(iso).slice(0, 10); // ISO → YYYY-MM-DD (UTC)
    }
    try {
      fsMod.mkdirSync(outDir, { recursive: true });
      fsMod.writeFileSync(cachePath, JSON.stringify({ fetchedAt: new Date().toISOString(), etag, time }));
    } catch { /* 缓存写失败不影响 */ }
    return time;
  } catch (e) {
    log(`npm 发布时间获取失败（${e.message}）${cache ? '，使用旧缓存' : ''}`);
    return cache?.time || {};
  }
}
