#!/usr/bin/env node
// 本地快速重建 index.html：复用 out/raw/CHANGELOG.md + out/cache.json，不抓取、不调 LLM
// 用法: node scripts/rebuild-html.mjs [--out out]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseChangelog } from '../lib/parse.mjs';
import { renderHtml } from '../lib/render-html.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const outDir = values.out || 'out';

const rawMd = fs.readFileSync(path.join(outDir, 'raw', 'CHANGELOG.md'), 'utf8');
const versions = parseChangelog(rawMd);
let npmTimes = {};
try { npmTimes = JSON.parse(fs.readFileSync(path.join(outDir, 'npm-times.json'), 'utf8')); } catch {}
for (const v of versions) v.date = npmTimes[v.version] || null;

const cache = JSON.parse(fs.readFileSync(path.join(outDir, 'cache.json'), 'utf8'));
const html = renderHtml({ versions, translated: cache, latestNpm: versions[0]?.version, generatedAt: new Date() });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`重建完成: ${versions.length} 个版本 → ${path.join(outDir, 'index.html')} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
