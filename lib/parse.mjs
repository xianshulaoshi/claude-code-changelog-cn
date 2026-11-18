// 解析 changelog markdown 为 [{version, entries[]}] 结构
const VERSION_RE = /^##\s+(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.+-]+)?)\s*$/;

/**
 * 解析官方 changelog markdown。
 * - `## x.y.z` 开启一个版本
 * - 顶格 `- ` 是一条更新明细
 * - 缩进的子条目（`  - `）合并进上一条，渲染为「 ‣ 」分隔
 */
export function parseChangelog(md) {
  const lines = String(md).split(/\r?\n/);
  const versions = [];
  let cur = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line) continue;

    const m = line.match(VERSION_RE);
    if (m) {
      cur = { version: m[1], entries: [] };
      versions.push(cur);
      continue;
    }
    if (!cur) continue; // 版本号之前的内容（如 `# Changelog` 标题）

    if (/^-\s+/.test(line)) {
      cur.entries.push(line.replace(/^-\s+/, '').trim());
    } else if (/^\s+-\s+/.test(line) && cur.entries.length) {
      cur.entries[cur.entries.length - 1] += ' ‣ ' + line.trim().replace(/^-\s+/, '');
    }
    // 其余非列表内容（偶发说明文字）忽略，保证输出结构干净
  }
  return versions.filter((v) => v.version);
}

/** 简单的 semver 比较，用于排序/判断（仅处理数字段与常见 pre-release 后缀）。 */
export function cmpVersion(a, b) {
  const pa = splitVer(a);
  const pb = splitVer(b);
  for (let i = 0; i < 3; i++) {
    if (pa.n[i] !== pb.n[i]) return (pa.n[i] || 0) - (pb.n[i] || 0);
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1; // 无后缀 > 有后缀
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

function splitVer(v) {
  const [core, pre] = String(v).split('-', 2);
  const n = core.split('.').map((x) => parseInt(x, 10) || 0);
  return { n, pre: pre ?? null };
}
