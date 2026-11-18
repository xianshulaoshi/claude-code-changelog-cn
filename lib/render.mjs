// 渲染最终中文 Markdown：每版本顶部「本版亮点」，下方「更新明细」按类别归组
import { groupByCategory } from './categorize.mjs';

const TYPE_META = {
  feature: { icon: '🚀', label: '新功能' },
  improvement: { icon: '🔧', label: '改进' },
  fix: { icon: '🐛', label: '关键修复' },
  other: { icon: '⭐', label: '亮点' },
};

function fmtDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function renderVersion(v, t) {
  const lines = [];
  lines.push(`## ${v.version}${v.date ? `（${v.date} 发布）` : ''}`, '');

  const hs = (t?.highlights || []).filter((h) => h.text);
  if (hs.length) {
    lines.push('**✨ 本版亮点**', '');
    for (const h of hs) {
      const meta = TYPE_META[h.type] || TYPE_META.other;
      lines.push(`- ${meta.icon} **${meta.label}**：${h.text}`);
    }
    lines.push('');
  }

  const translatedOk = !!(t && Array.isArray(t.entries) && t.entries.length);
  const display = translatedOk ? t.entries : v.entries;
  if (display.length) {
    lines.push(`**📋 更新明细**（共 ${display.length} 条，按类别归组${translatedOk ? '' : '，未翻译，保留原文'}）`, '');
    for (const g of groupByCategory(v.entries, display)) {
      lines.push(`**${g.icon} ${g.label}**（${g.count} 条）`, '');
      for (const e of g.entries) lines.push(`- ${e}`);
      lines.push('');
    }
  } else {
    lines.push('_该版本无公开明细。_', '');
  }
  return lines.join('\n');
}

export function renderMarkdown({ versions, translated, latestNpm, generatedAt = new Date(), source }) {
  const okCount = versions.filter((v) => translated[v.version]?.entries?.length).length;
  const failCount = versions.length - okCount;

  const head = [
    '# Claude Code 更新日志（中文版）',
    '',
    `> 由程序自动抓取官方 Changelog 并翻译整理 · 生成时间：${fmtDate(generatedAt)} · 收录 ${versions.length} 个版本（已翻译 ${okCount}${failCount ? `，失败 ${failCount}` : ''}）`,
    `> 原文：[anthropics/claude-code CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)${latestNpm ? ` · npm 最新版本：\`${latestNpm}\`` : ''}${source ? ` · 数据源：${source}` : ''}`,
    '',
    '> 每个版本顶部为「✨ 本版亮点」（新功能 🚀 / 改进 🔧 / 关键修复 🐛），由 LLM 从该版本全部条目中提炼；下方为完整中文明细。',
    '',
    '---',
    '',
  ];

  const body = versions.map((v) => renderVersion(v, translated[v.version]));
  return head.concat(body.join('\n\n---\n\n'), '\n').join('\n');
}
