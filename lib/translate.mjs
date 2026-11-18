// 核心：用 LLM 翻译单个版本的更新明细，并提炼「亮点」
import { chat, extractJSON, runPool } from './llm.mjs';

const SYSTEM = `你是 Claude Code 官方更新日志（Changelog）的中文本地化专家，负责翻译与提炼。

翻译规则：
1. 译成简体中文，语气专业、简洁、面向开发者。
2. 保持与英文条目一一对应：不合并、不拆分、不增删条目，保持原顺序。
3. 专有名词保留英文原样：命令与斜杠命令（/plugin、claude mcp add）、设置项（attributionProject）、工具名（Edit、Grep、WebFetch、Bash）、产品名（Claude Code、Claude、VS Code、JetBrains、Remote Control、macOS、Windows、Linux、tmux）、快捷键（Esc、Ctrl+C、Tab）等。行内代码（反引号）内容一律不改。
4. 表述自然流畅，不要逐词直译。

提炼规则（highlights）：
- 从该版本全部条目中挑出最值得用户关注的 2~5 条亮点。
- type 取值：feature（新功能/新命令/新能力）、improvement（改进/优化/体验变化）、fix（影响较大的关键 bug 修复）。
- 按重要性从高到低排序；每条不超过 60 个字，突出对用户的价值，不写实现细节。
- 若该版本以修复为主，则提炼影响面最大的关键修复；不要把琐碎修复硬凑成亮点。

输出：严格的 JSON（不含任何其他文字、不含注释、不含 markdown 围栏）。`;

const HIGHLIGHT_TYPES = new Set(['feature', 'improvement', 'fix']);
// 单次调用条目上限与分块大小（条目多时分块并发翻译）
const SINGLE_CALL_MAX = 100;
const CHUNK_SIZE = 50;
const CHUNK_CONCURRENCY = 3;

function numbered(entries) {
  return entries.map((e, i) => `${i + 1}. ${e}`).join('\n');
}

function normalizeHighlights(list) {
  return (Array.isArray(list) ? list : [])
    .map((h) => ({
      type: HIGHLIGHT_TYPES.has(h?.type) ? h.type : 'other',
      text: cleanText(h?.text),
    }))
    .filter((h) => h.text)
    .slice(0, 6);
}

/** 清洗解码后的文本：把误当 JSON 转义的退格/换页符还原为字面反斜杠写法。 */
function cleanText(x) {
  return String(x ?? '')
    .replace(/\u0008/g, '\\b')
    .replace(/\u000c/g, '\\f')
    .trim();
}

function validateEntries(parsed, expectedCount) {
  if (!Array.isArray(parsed?.entries)) throw new Error('缺少 entries 数组');
  const out = parsed.entries.map(cleanText);
  if (out.length !== expectedCount) throw new Error(`条目数不匹配（期望 ${expectedCount}，实得 ${out.length}）`);
  if (out.some((x) => !x)) throw new Error('存在空翻译条目');
  return out;
}

/**
 * 翻译一个版本。
 * - 条目少：一次调用完成（翻译 + 亮点）
 * - 条目多（>SINGLE_CALL_MAX）或单次调用截断：分块并发翻译 + 并行提炼亮点
 */
export async function translateVersion({ version, entries, llm, log = () => {} }) {
  if (!entries.length) return { highlights: [], entries: [] };

  if (entries.length <= SINGLE_CALL_MAX) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { text, stopReason } = await chat({
          ...llm,
          system: SYSTEM,
          user: `Claude Code ${version} 版本更新日志（共 ${entries.length} 条，按顺序）：

${numbered(entries)}

请翻译全部条目并提炼亮点，输出 JSON：
{
  "highlights": [
    { "type": "feature", "text": "一句话中文亮点" },
    { "type": "improvement", "text": "..." },
    { "type": "fix", "text": "..." }
  ],
  "entries": ["第 1 条的中文翻译", "第 2 条的中文翻译", "…与上面条目顺序、数量完全一致"]
}`,
          maxTokens: 24000,
        });
        if (stopReason === 'max_tokens') break; // 截断 → 分块
        const parsed = extractJSON(text);
        return {
          highlights: normalizeHighlights(parsed.highlights),
          entries: validateEntries(parsed, entries.length),
        };
      } catch (e) {
        log(`  ${version} 第 ${attempt} 次尝试失败: ${e.message}`);
        if (attempt === 2) log(`  ${version} 退化为分块翻译`);
      }
    }
  }
  return await translateChunked({ version, entries, llm, log });
}

async function translateChunked({ version, entries, llm, log }) {
  const chunks = [];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) chunks.push(entries.slice(i, i + CHUNK_SIZE));

  // 分块翻译与亮点提炼并行
  const [translatedChunks, highlightsResult] = await Promise.all([
    runPool(chunks, CHUNK_CONCURRENCY, (chunk) => translateEntries({ version, entries: chunk, llm, log })),
    extractHighlights({ version, entries, llm }).then(
      (h) => ({ highlights: h }),
      (e) => ({ error: e })
    ),
  ]);

  const outEntries = translatedChunks.flat();

  let highlights;
  if (highlightsResult?.error) {
    log(`  ${version} 亮点提炼失败（取前 3 条明细代替）: ${highlightsResult.error.message}`);
    highlights = outEntries.slice(0, 3).map((text) => ({ type: 'other', text }));
  } else {
    highlights = highlightsResult.highlights;
  }
  return { highlights, entries: outEntries };
}

/**
 * 翻译一组条目（要求一一对应）。
 * 截断 → 条目多则对半拆分递归；条目少则加倍输出预算重试（上限 32000）。
 */
async function translateEntries({ version, entries, llm, log, maxTokens = 12288 }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, stopReason } = await chat({
        ...llm,
        system: SYSTEM,
        user: `Claude Code ${version} 版本更新日志片段（共 ${entries.length} 条）：

${numbered(entries)}

只翻译这些条目，输出 JSON：
{ "entries": ["第 1 条中文", "第 2 条中文", "…"] }`,
        maxTokens,
      });
      if (stopReason === 'max_tokens') {
        lastErr = new Error('输出被 max_tokens 截断');
        break; // 同参数重试无意义，直接走拆分/加预算
      }
      return validateEntries(extractJSON(text), entries.length);
    } catch (e) {
      lastErr = e;
      if (attempt === 2) break;
      log(`  ${version} 片段（${entries.length} 条）第 ${attempt} 次失败: ${e.message}`);
    }
  }

  if (entries.length > 15) {
    const mid = Math.ceil(entries.length / 2);
    log(`  ${version} 片段（${entries.length} 条）对半拆分重试`);
    const [a, b] = await Promise.all([
      translateEntries({ version, entries: entries.slice(0, mid), llm, log, maxTokens }),
      translateEntries({ version, entries: entries.slice(mid), llm, log, maxTokens }),
    ]);
    return [...a, ...b];
  }
  if (maxTokens < 32000) {
    return translateEntries({ version, entries, llm, log, maxTokens: maxTokens * 2 });
  }
  throw lastErr || new Error('翻译失败');
}

/** 单独提炼亮点（用英文原文，信息最全）。 */
async function extractHighlights({ version, entries, llm }) {
  let maxTokens = 4096;
  for (let i = 0; i < 2; i++) {
    const { text, stopReason } = await chat({
      ...llm,
      system: SYSTEM,
      user: `Claude Code ${version} 版本更新日志（英文原文，共 ${entries.length} 条）：

${numbered(entries)}

只提炼 highlights，输出 JSON：
{ "highlights": [ { "type": "feature", "text": "中文亮点" } ] }`,
      maxTokens,
    });
    if (stopReason !== 'max_tokens') {
      return normalizeHighlights(extractJSON(text)?.highlights);
    }
    maxTokens = 8192;
  }
  return [];
}
