// 渲染最终中文 Markdown：每个版本一个独立 .md 文件（H1 标题 + 亮点 + 归类明细）
import { groupByCategory } from './categorize.mjs';

const TYPE_META = {
  feature: { icon: '🚀', label: '新功能' },
  improvement: { icon: '🔧', label: '改进' },
  fix: { icon: '🐛', label: '关键修复' },
  other: { icon: '⭐', label: '亮点' },
};

/** 单版本正文：亮点 + 归类明细（两种渲染共用） */
function renderBody(v, t) {
  const lines = [];

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
    const groups = groupByCategory(v.entries, display);
    lines.push(`**📋 更新明细**（共 ${display.length} 条，按类别归组${translatedOk ? '' : '，未翻译，保留原文'}）`, '');
    for (const g of groups) {
      lines.push(`**${g.icon} ${g.label}**（${g.count} 条）`, '');
      for (const e of g.entries) lines.push(`- ${e}`);
      lines.push('');
    }
  } else {
    lines.push('_该版本无公开明细。_', '');
  }
  return lines.join('\n');
}

/** 单版本独立页面（versions/<v>.md 的内容） */
export function renderVersionPage(v, t) {
  const translatedOk = !!(t && Array.isArray(t.entries) && t.entries.length);
  const total = (translatedOk ? t.entries : v.entries).length;
  const groups = total ? groupByCategory(v.entries, translatedOk ? t.entries : v.entries) : [];
  const statParts = [];
  if (v.date) statParts.push(`🗓 ${v.date} 发布`);
  if (total) statParts.push(`📋 ${total} 条更新（${groups.map((g) => `${g.icon} ${g.count}`).join(' · ')}）`);
  return [`# Claude Code v${v.version} 更新日志`, '', `> ${statParts.join(' · ') || '该版本无公开明细'}`, '', renderBody(v, t)].join('\n');
}
