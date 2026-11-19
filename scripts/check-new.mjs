#!/usr/bin/env node
// 检测是否有新版本需要翻译（自动化更新的门禁，供 GitHub Actions 与服务器 cron 共用）
//
// 判断依据（满足任一即需要更新）：
//   1. 上游 changelog 出现了 docs/versions 里还没有的版本
//   2. npm 最新版 > 本地版本（此时 changelog 可能刚更新）
//   3. 本地最新版本缺发布日期（npm 时间数据滞后，需要补全自愈）
//
// 退出码：0 = 需要更新；1 = 已是最新；2 = 检查失败（网络等）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChangelog, fetchLatestNpmVersion, DEFAULT_SOURCES } from '../lib/source.mjs';
import { parseChangelog, cmpVersion } from '../lib/parse.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, process.argv[2] || 'docs/versions');

function localLatest() {
  if (!fs.existsSync(docsDir)) return null;
  const versions = fs
    .readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
  if (!versions.length) return null;
  return versions.reduce((a, b) => (cmpVersion(b, a) > 0 ? b : a));
}

try {
  const { text } = await fetchChangelog({ sources: DEFAULT_SOURCES, outDir: path.join(root, 'out') });
  const upstream = parseChangelog(text)[0]?.version;
  if (!upstream) throw new Error('上游 changelog 解析不到版本号');

  const local = localLatest();
  if (!local) {
    console.log(`NEED_UPDATE docs/versions 为空，需要全量生成`);
    process.exit(0);
  }

  const npm = await fetchLatestNpmVersion();
  const reasons = [];
  if (cmpVersion(upstream, local) > 0) reasons.push(`上游新版本 ${upstream} > 本地 ${local}`);
  if (npm && cmpVersion(npm, local) > 0) reasons.push(`npm 新版本 ${npm} > 本地 ${local}`);
  try {
    const md = fs.readFileSync(path.join(docsDir, `${local}.md`), 'utf8');
    if (!md.includes('🗓')) reasons.push(`本地最新 ${local} 缺发布日期，待补全`);
  } catch { /* 读不到文件不作为更新理由 */ }

  if (reasons.length) {
    console.log(`NEED_UPDATE ${reasons.join('；')}`);
    process.exit(0);
  }
  console.log(`UP_TO_DATE 本地 ${local} = 上游 ${upstream}${npm ? ` = npm ${npm}` : ''}`);
  process.exit(1);
} catch (e) {
  console.error(`CHECK_FAILED ${e.message}`);
  process.exit(2);
}
