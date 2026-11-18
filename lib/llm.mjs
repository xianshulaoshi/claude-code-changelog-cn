// Anthropic Messages API 兼容的 LLM 调用（支持自定义网关，失败时退回 curl）
import { spawn } from 'node:child_process';

export function resolveLLMConfig({ baseUrl, apiKey, model } = {}) {
  const url = (baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const key = apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
  const m =
    model ||
    process.env.CHANGELOG_TRANSLATOR_MODEL ||
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
    'claude-haiku-4-5';
  return { baseUrl: url, apiKey: key, model: m };
}

/** 单次对话。返回 { text, stopReason }（自动拼接多个 text 内容块，跳过 thinking 块）。 */
export async function chat({
  baseUrl, apiKey, model, system, user,
  maxTokens = 16384, timeoutMs = 300000, temperature = 0.2, disableThinking = true,
}) {
  const url = `${baseUrl}/v1/messages`;
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    authorization: `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
  };
  const payload = {
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (disableThinking) payload.thinking = { type: 'disabled' };

  let raw;
  try {
    raw = await postJson(url, headers, JSON.stringify(payload), timeoutMs);
  } catch (e) {
    // 个别网关不认识 thinking 字段：去掉后重试一次
    if (disableThinking && /thinking/i.test(e.message || '')) {
      delete payload.thinking;
      raw = await postJson(url, headers, JSON.stringify(payload), timeoutMs);
    } else {
      throw e;
    }
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`LLM 返回非 JSON: ${String(raw).slice(0, 200)}`);
  }
  if (data?.error) throw new Error(`LLM 错误: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
  const text = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('LLM 返回为空');
  return { text, stopReason: data?.stop_reason || '' };
}

async function postJson(url, headers, body, timeoutMs) {
  // 优先 Node fetch
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (res.ok) return text;
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  } catch (e) {
    // 退回 curl（自动遵循代理环境变量；stdin 传 body）
    return await curlPostJson(url, headers, body, timeoutMs, e);
  }
}

function curlPostJson(url, headers, body, timeoutMs, firstErr) {
  return new Promise((resolve, reject) => {
    const args = [
      '-s', '--max-time', String(Math.ceil(timeoutMs / 1000)),
      '-X', 'POST', url,
      ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]),
      '--data-binary', '@-',
      '-w', '\n%{http_code}',
    ];
    const p = spawn('curl', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => reject(firstErr));
    p.on('close', () => {
      const idx = out.lastIndexOf('\n');
      const code = out.slice(idx + 1).trim();
      const resBody = out.slice(0, idx);
      if (code === '200') resolve(resBody);
      else reject(new Error(`HTTP ${code || 'unknown'}: ${resBody.slice(0, 300)}`));
    });
    p.stdin.on('error', () => {});
    p.stdin.end(body);
  });
}

/** 从 LLM 回复中提取 JSON 对象（容忍 ```json 围栏、前后杂文字与非法转义）。 */
export function extractJSON(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('回复中未找到 JSON 对象');
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // 常见修复：模型把反斜杠原样写入 JSON 字符串（如 Windows 路径 .\scripts）
    const repaired = slice.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(`JSON 解析失败: ${slice.slice(0, 120)}…`);
    }
  }
}

/** 简单并发池。 */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
