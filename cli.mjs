#!/usr/bin/env node
// Claude Code Changelog 中文版生成器
// 用法: node cli.mjs [--limit N | --all | --latest | --versions v1,v2 | --since x.y.z] [选项]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fetchChangelog, fetchLatestNpmVersion, fetchNpmTimes, DEFAULT_SOURCES } from './lib/source.mjs';
import { parseChangelog, cmpVersion } from './lib/parse.mjs';
import { resolveLLMConfig, runPool } from './lib/llm.mjs';
import { translateVersion } from './lib/translate.mjs';
import { renderMarkdown } from './lib/render.mjs';
import { renderHtml } from './lib/render-html.mjs';

const TTY = process.stdout.isTTY;
const c = {
  dim: (s) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  cyan: (s) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
};
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

function log(msg) { console.log(`${c.dim(`[${ts()}]`)} ${msg}`); }

function usage() {
  console.log(`
Claude Code Changelog 中文版生成器

用法:
  node cli.mjs [选项]

版本范围:
  --limit <N>       翻译/输出最近 N 个版本（默认 10；已有缓存的版本直接复用，不重复调用 LLM）
  --all             输出全部版本
  --latest          仅最新 1 个版本
  --versions <列表>  指定版本，逗号分隔，如 2.1.327,2.1.326
  --since <版本>     输出从该版本（含）到最新的所有版本

LLM 配置（翻译与亮点提炼）:
  --base-url <url>  Anthropic 兼容网关地址（默认取 ANTHROPIC_BASE_URL，或 https://api.anthropic.com）
  --api-key <key>   API Key（默认取 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN）
  --model <name>    模型名（默认取 CHANGELOG_TRANSLATOR_MODEL / ANTHROPIC_DEFAULT_HAIKU_MODEL / claude-haiku-4-5）

其他:
  --source <url>    自定义 changelog 数据源 URL（可多次出现；默认 GitHub raw + jsDelivr）
  --concurrency <N> 并发翻译数（默认 3）
  --out <dir>       输出目录（默认 ./out）
  --force           忽略缓存，全部重新翻译
  --stdout          只把 Markdown 打到标准输出，不写文件
  --quiet           静默模式
  -h, --help        帮助
`.trim());
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string' },
      all: { type: 'boolean' },
      latest: { type: 'boolean' },
      versions: { type: 'string' },
      since: { type: 'string' },
      'base-url': { type: 'string' },
      'api-key': { type: 'string' },
      model: { type: 'string' },
      source: { type: 'string', multiple: true },
      concurrency: { type: 'string' },
      out: { type: 'string' },
      force: { type: 'boolean' },
      stdout: { type: 'boolean' },
      'no-html': { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean' },
      h: { type: 'boolean' },
    },
  });
  if (values.help || values.h) return usage();

  const quiet = values.quiet;
  const vlog = (msg) => { if (!quiet) log(msg); };
  const outDir = values.out || 'out';
  const concurrency = Math.max(1, parseInt(values.concurrency || '3', 10) || 3);

  // 1. LLM 配置
  const llm = resolveLLMConfig({ baseUrl: values['base-url'], apiKey: values['api-key'], model: values.model });
  if (!llm.apiKey) {
    console.error(c.red('缺少 API Key：请设置 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN，或用 --api-key 指定。'));
    process.exitCode = 1;
    return;
  }

  // 2. 抓取 + 解析
  const { text: rawMd, source } = await fetchChangelog({
    sources: values.source?.length ? values.source : DEFAULT_SOURCES,
    outDir,
    log: vlog,
  });
  const allVersions = parseChangelog(rawMd);
  if (!allVersions.length) throw new Error('changelog 解析结果为空');

  // 各版本 npm 发布时间（日期）
  const npmTimes = await fetchNpmTimes({ outDir, log: vlog });
  const withDate = Object.keys(npmTimes).length;
  if (withDate) vlog(`已获取 ${withDate} 个版本的 npm 发布时间`);
  for (const v of allVersions) v.date = npmTimes[v.version] || null;
  vlog(`解析到 ${allVersions.length} 个版本，最新为 ${c.cyan(allVersions[0].version)}`);

  // 3. 选择版本范围
  let selected = selectVersions(allVersions, values);
  if (!selected.length) throw new Error('所选版本范围内没有匹配的版本');

  // 4. 缓存
  const cachePath = path.join(outDir, 'cache.json');
  const cache = readCache(cachePath);
  const todo = selected.filter((v) => values.force || !cache[v.version]?.entries?.length);
  const cached = selected.length - todo.length;
  if (cached) vlog(`缓存命中 ${c.green(cached)} 个版本，需翻译 ${c.yellow(todo.length)} 个`);

  // 5. 并发翻译
  const llmWithLog = { ...llm };
  let done = 0;
  const failures = [];
  if (todo.length) {
    vlog(`开始翻译（模型 ${c.cyan(llm.model)}，并发 ${concurrency}）`);
    await runPool(todo, concurrency, async (v) => {
      try {
        const t0 = Date.now();
        const t = await translateVersion({
          version: v.version, entries: v.entries, llm: llmWithLog, log: vlog,
        });
        cache[v.version] = { ...t, translatedAt: new Date().toISOString(), model: llm.model };
        writeCache(cachePath, cache); // 每个版本完成即落盘，可随时中断
        done++;
        vlog(`${c.green('✓')} ${v.version}（${v.entries.length} 条明细，${t.highlights.length} 条亮点，${((Date.now() - t0) / 1000).toFixed(1)}s）[${done}/${todo.length}]`);
      } catch (e) {
        failures.push({ version: v.version, error: e.message });
        vlog(`${c.red('✗')} ${v.version}: ${e.message}`);
      }
    });
  }

  // 6. 渲染输出
  const latestNpm = await fetchLatestNpmVersion();
  if (latestNpm) vlog(`npm 最新版本: ${c.cyan(latestNpm)}`);
  const md = renderMarkdown({
    versions: selected,
    translated: cache,
    latestNpm,
    source,
  });
  if (values.stdout) {
    process.stdout.write(md);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'CHANGELOG.zh-CN.md');
    fs.writeFileSync(outFile, md);
    vlog(`已写入 ${c.cyan(path.relative(process.cwd(), outFile) || outFile)}`);
    if (!values['no-html']) {
      const htmlFile = path.join(outDir, 'index.html');
      fs.writeFileSync(htmlFile, renderHtml({ versions: selected, translated: cache, latestNpm, generatedAt: new Date(), source }));
      vlog(`已写入 ${c.cyan(path.relative(process.cwd(), htmlFile) || htmlFile)}（双击或在浏览器打开查看）`);
    }
  }

  // 7. 摘要
  if (!values.stdout) {
    const top = selected[0];
    const t = cache[top.version];
    console.log('');
    console.log(c.green('完成。') + ` 共 ${selected.length} 个版本` + (failures.length ? c.red(`，${failures.length} 个翻译失败（明细保留英文原文）`) : ''));
    if (t?.highlights?.length) {
      console.log('');
      console.log(c.cyan(`最新版本 ${top.version} 亮点预览:`));
      for (const h of t.highlights) console.log(`  · ${h.text}`);
    }
    if (failures.length && !quiet) {
      console.log('');
      for (const f of failures) console.log(c.red(`  失败 ${f.version}: ${f.error}`));
    }
  }
  if (failures.length && !values.stdout) process.exitCode = 1;
}

function selectVersions(all, values) {
  // 源文件本身即按新→旧排列
  if (values.latest) return all.slice(0, 1);
  if (values.versions) {
    const want = new Set(values.versions.split(',').map((s) => s.trim()).filter(Boolean));
    return all.filter((v) => want.has(v.version));
  }
  if (values.since) {
    const since = values.since.trim();
    const out = [];
    for (const v of all) {
      out.push(v);
      if (v.version === since) return out;
    }
    // 精确匹配失败则按版本号比较
    return all.filter((v) => cmpVersion(v.version, since) >= 0);
  }
  if (values.all) return all;
  const n = Math.max(1, parseInt(values.limit || '10', 10) || 10);
  return all.slice(0, n);
}

function readCache(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeCache(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

main().catch((e) => {
  console.error(c.red(`运行失败: ${e.message}`));
  if (process.env.DEBUG) console.error(e.stack);
  process.exitCode = 1;
});
