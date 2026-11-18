// 明细归类：基于英文原文的动词前缀规则 + 兜底启发式（不依赖 LLM，全部版本即时生效）
// 原理：官方 changelog 条目以动词开头（Fixed/Added/Improved/Changed…），
// 可能带作用域前缀（"VSCode:" / "[VSCode]" / "macOS:" / "Cloud sessions:"…）。
// 翻译后的中文条目与英文 1:1 对齐，因此用英文原文归类、映射回中文展示。

const VERB_RULES = [
  // 修复
  [/^(fix(es|ed|ing)?|bug\s?fix\w*)\b/i, 'fix'],
  // 新功能
  [/^add(s|ed|ing)?\b/i, 'feature'],
  [/^(new|introduc\w+|launch\w+)\b/i, 'feature'],
  // 改进
  [/^(improve(d|s|ments?)?|improving)\b/i, 'improvement'],
  [/^updat(e|es|ed|ing)\b/i, 'improvement'],
  [/^(reduc\w+|lower\w*|decreas\w+|shrink\w*)\b/i, 'improvement'],
  [/^(increas\w+|rais(e|ed|ing)|boost\w*)\b/i, 'improvement'],
  [/^(enhanc\w+|better\b|made\b|simplif\w+|streamlin\w+|optimi[sz]\w+|refin\w+|speed\w*|sped\b|faster\b|polish\w*|clarif\w+|expand\w+|extend\w+|upgrad\w+|tun(e|ed|ing)\b|reorder\w*|normali[sz]\w+|rebuilt\b|redesign\w*|revamp\w*|smoothing)\b/i, 'improvement'],
  [/^(restor\w+|hardened|strengthen\w+)\b/i, 'improvement'],
  // 变更（行为调整 / 移除 / 重命名 / 废弃）
  [/^(change(d|s)?|changing|renam\w+|remov\w+|deprecat\w+|drop(ped|s|ping)?\b|revert\w+|roll(ed|ing)?\s?back|mov(e|ed|es|ing)|replac\w+|split\b|merg\w+|unifi\w+|switch(ed|es|ing)?|disabl\w+|enabl\w+|turn(ed|ing)?\s+(off|on)|no\s+longer)\b/i, 'change'],
];

const STRIP_RE = [/^\[[^\]]+\]\s+/, /^[A-Za-z][A-Za-z0-9 .()&/'+,-]{0,40}:\s+/];

function matchVerb(text) {
  for (const [re, cat] of VERB_RULES) if (re.test(text)) return cat;
  return null;
}

export function categorizeEntry(en) {
  let text = String(en);
  // 先匹配动词；未中则剥一层作用域前缀再试，最多剥三层（如 "[VSCode] Foo: Fixed …"）
  for (let round = 0; round < 3; round++) {
    const cat = matchVerb(text);
    if (cat) return cat;
    let next = text;
    for (const re of STRIP_RE) {
      const t2 = next.replace(re, '');
      if (t2 !== next) { next = t2; break; }
    }
    if (next === text) break;
    text = next;
  }
  if (/revert|roll(ed)?\s?back/i.test(text)) return 'change';
  if (/\bnow\b/i.test(text)) return 'improvement';
  return 'other';
}

export const CATS = {
  feature: { icon: '🚀', label: '新功能' },
  improvement: { icon: '🔧', label: '改进' },
  change: { icon: '🔄', label: '变更' },
  fix: { icon: '🐛', label: '修复' },
  other: { icon: '📌', label: '其他' },
};
export const CAT_ORDER = ['feature', 'improvement', 'change', 'fix', 'other'];

/**
 * 将一个版本的明细按类别归组（组内保持原有顺序）。
 * @param {string[]} englishEntries 该版本英文原文条目（与展示条目 1:1 对齐）
 * @param {string[]} displayEntries 实际展示的条目（中文翻译；未翻译时即英文原文）
 */
export function groupByCategory(englishEntries, displayEntries) {
  const buckets = {};
  displayEntries.forEach((text, i) => {
    const cat = categorizeEntry(englishEntries[i] ?? text); // 对不齐时用展示文本兜底
    (buckets[cat] ||= []).push(text);
  });
  return CAT_ORDER
    .filter((k) => buckets[k]?.length)
    .map((k) => ({ key: k, ...CATS[k], count: buckets[k].length, entries: buckets[k] }));
}
