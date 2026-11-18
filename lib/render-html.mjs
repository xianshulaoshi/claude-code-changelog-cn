// 渲染自包含单文件 HTML（内嵌数据；每版本单独一页，侧边栏/按钮/键盘/hash 切换；支持搜索与明暗主题）
import { groupByCategory } from './categorize.mjs';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(s) { return esc(s); }

const CHIP = {
  feature: { cls: 'chip-feature', label: '🚀 新功能' },
  improvement: { cls: 'chip-improve', label: '🔧 改进' },
  fix: { cls: 'chip-fix', label: '🐛 关键修复' },
  other: { cls: 'chip-other', label: '⭐ 亮点' },
};
// 明细分组标题（与亮点区分：修复不带「关键」、其他用 📌）
const GROUP_CHIP = {
  feature: CHIP.feature,
  improvement: CHIP.improvement,
  change: { cls: 'chip-change', label: '🔄 变更' },
  fix: { cls: 'chip-fix', label: '🐛 修复' },
  other: { cls: 'chip-other', label: '📌 其他' },
};

function fmtText(s, B = '`') {
  return esc(s).replace(new RegExp(B + '([^' + B + ']+)' + B, 'g'), '<code>$1</code>');
}

export function renderHtml({ versions, translated, latestNpm, generatedAt = new Date(), source }) {
  const data = versions.map((v) => {
    const t = translated[v.version];
    const ok = !!(t && Array.isArray(t.entries) && t.entries.length);
    const entries = ok ? t.entries : v.entries;
    return {
      version: v.version,
      date: v.date || null,
      highlights: (t?.highlights || []).filter((h) => h.text),
      entries,
      // 用英文原文归类，1:1 映射回展示条目（未翻译版本直接按英文归类）
      groups: groupByCategory(v.entries, entries),
      translated: ok,
      total: v.entries.length,
    };
  });

  const totalEntries = data.reduce((a, d) => a + d.entries.length, 0);
  const totalHighlights = data.reduce((a, d) => a + d.highlights.length, 0);
  const fmt = (d) => {
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const toc = data
    .map(
      (d) =>
        `        <li><a href="#${escAttr(d.version)}" title="${escAttr(d.date ? d.version + ' · ' + d.date + ' · ' + d.total + ' 条' : d.version + ' · ' + d.total + ' 条')}"><span class="toc-v">${esc(d.version)}</span><span class="toc-n">${d.date ? `<span class="toc-date">${esc(d.date)}</span>` : ''}<span class="toc-cnt">${d.total}</span></span></a></li>`
    )
    .join('\n');

  const options = data.map((d) => `          <option value="${escAttr(d.version)}">${esc(d.version)}（${d.total} 条）</option>`).join('\n');

  const sections = data
    .map((d, i) => {
      const hl = d.highlights.length
        ? `        <div class="highlights">
          <h3>✨ 本版亮点</h3>
          <ul>
${d.highlights
  .map((h) => {
    const c = CHIP[h.type] || CHIP.other;
    return `            <li class="hl-${c.cls}"><span class="chip ${c.cls}">${c.label}</span><span class="hl-text" data-text="${escAttr(h.text)}">${fmtText(h.text)}</span></li>`;
  })
  .join('\n')}
          </ul>
        </div>`
        : '';

      const open = false; // 明细默认收起

      const prev = data[i - 1];
      const next = data[i + 1];

      return `      <section class="version${d.translated ? '' : ' untranslated'}" data-version="${escAttr(d.version)}" data-idx="${i}">
        <header class="vhead">
          <h2>${esc(d.version)}</h2>
          ${d.date ? `<span class="vdate">🗓 ${esc(d.date)}</span>` : ''}
          <div class="vmeta">
            <span class="pill">${d.total} 条明细</span>
            <span class="pill">${d.highlights.length} 条亮点</span>
            <span class="pill">${i + 1} / ${data.length} 版</span>
            ${d.translated ? '' : '<span class="pill pill-warn">未翻译 · 保留原文</span>'}
          </div>
          <button class="btn toggle" type="button">展开明细 ▾</button>
        </header>
${hl}
        <div class="details${open ? ' open' : ''}">
          <h3>📋 更新明细 <span class="muted">（共 ${d.entries.length} 条，按类别归组）</span></h3>
${d.groups
  .map(
    (g) => {
      const c = GROUP_CHIP[g.key] || GROUP_CHIP.other;
      return `          <div class="group" data-cat="${escAttr(g.key)}">
            <h4><span class="chip ${c.cls}">${c.label}</span><span class="muted">${g.count} 条</span></h4>
            <ul class="entries">
${g.entries.map((e) => `              <li data-text="${escAttr(e)}">${fmtText(e)}</li>`).join('\n')}
            </ul>
          </div>`;
    }
  )
  .join('\n')}
        </div>
        <div class="pn">
          <button class="btn pn-btn" data-go="${i - 1}"${prev ? '' : ' disabled'}>${prev ? '← ' + esc(prev.version) : '← 已是最早版本'}</button>
          <button class="btn pn-btn" data-go="${i + 1}"${next ? '' : ' disabled'}>${next ? esc(next.version) + ' →' : '已是最新版本 →'}</button>
        </div>
      </section>`;
    })
    .join('\n');

  const payload = {
    latest: data[0]?.version || '',
    latestNpm,
    generatedAt: fmt(generatedAt),
    counts: { versions: data.length, entries: totalEntries, highlights: totalHighlights },
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Code 更新日志（中文版）</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
<style>
:root{
  --bg:#f6f6f7;--card:#ffffff;--text:#1b1b1f;--muted:#6e6e78;--border:#e4e4e9;
  --accent:#c96442;--soft:#faf8f6;
  --mark:#fde68a;--mark-text:#1b1b1f;
  --shadow:0 1px 2px rgba(20,20,25,.04),0 4px 16px rgba(20,20,25,.05);
}
html.dark{
  --bg:#141416;--card:#1e1e22;--text:#ececf1;--muted:#9b9ba6;--border:#2c2c33;
  --accent:#e08463;--soft:#232328;
  --mark:#8a5a17;--mark-text:#fdf6e3;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:15px;line-height:1.65;transition:background .2s,color .2s}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;
  background:var(--soft);border:1px solid var(--border);border-radius:5px;padding:1px 5px;word-break:break-all}
mark{background:var(--mark);color:var(--mark-text);border-radius:3px;padding:0 1px}
a{color:var(--accent)}
.muted{color:var(--muted);font-weight:400}

/* ---- 顶部 ---- */
.top{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 82%,transparent);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--border)}
.top-inner{max-width:1160px;margin:0 auto;padding:14px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.top h1{font-size:19px;margin:0;letter-spacing:.2px;white-space:nowrap}
.top h1 .em{color:var(--accent)}
.meta{font-size:12.5px;color:var(--muted);width:100%;display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:-4px}
.spacer{flex:1}
.search{position:relative;flex:0 1 320px;min-width:180px}
.search input{width:100%;padding:8px 32px 8px 34px;border:1px solid var(--border);border-radius:10px;
  background:var(--card);color:var(--text);font-size:13.5px;outline:none;transition:border .15s}
.search input:focus{border-color:var(--accent)}
.search .icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:13px;pointer-events:none}
.search .clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:none;
  color:var(--muted);cursor:pointer;font-size:15px;padding:2px 6px;border-radius:6px;display:none}
.search .clear:hover{color:var(--text);background:var(--soft)}
.sel{display:none;border:1px solid var(--border);background:var(--card);color:var(--text);
  border-radius:10px;padding:7px 10px;font-size:13px;max-width:46vw}
@media(max-width:999px){.sel{display:block}}
.btn{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:10px;
  padding:8px 13px;font-size:13px;cursor:pointer;transition:.15s;white-space:nowrap}
.btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.btn:disabled{opacity:.45;cursor:default}
.search-info{display:none;padding:7px 20px;font-size:12.5px;color:var(--muted);
  max-width:1160px;margin:0 auto;flex-wrap:wrap;gap:6px;align-items:center}
body.searching .search-info{display:flex}
.chip-btn{border:1px solid var(--border);background:var(--card);color:var(--accent);border-radius:999px;
  font-size:12px;padding:2px 10px;cursor:pointer}
.chip-btn:hover{border-color:var(--accent)}
.chip-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}

/* ---- 布局 ---- */
.layout{max-width:1160px;margin:24px auto 80px;padding:0 20px;display:grid;grid-template-columns:1fr;gap:28px}
@media(min-width:1000px){.layout{grid-template-columns:230px minmax(0,1fr)}}
.sidebar{display:none}
@media(min-width:1000px){.sidebar{display:block;position:sticky;top:118px;align-self:start;max-height:calc(100vh - 140px);overflow:auto}}
.sidebar h4{margin:2px 0 8px;font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.5px}
.toc{list-style:none;margin:0;padding:0}
.toc a{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 10px;
  border-radius:8px;text-decoration:none;color:var(--muted);font-size:13px;border-left:2px solid transparent;cursor:pointer}
.toc a:hover{background:var(--soft);color:var(--text)}
.toc a.active{color:var(--accent);border-left-color:var(--accent);background:var(--soft);font-weight:600}
.toc-v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.toc-n{display:flex;align-items:center;gap:6px;flex-shrink:0}
.toc-date{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;font-weight:600;color:var(--text);opacity:.85}
.toc-cnt{font-size:10px;line-height:1.5;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:0 6px;white-space:nowrap}

/* ---- 版本卡片（单页显示） ---- */
.version{display:none;background:var(--card);border:1px solid var(--border);border-radius:16px;
  padding:24px 26px;margin-bottom:26px;box-shadow:var(--shadow)}
.version.current{display:block}
.vhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 14px;margin-bottom:6px}
.vhead h2{margin:0;font-size:24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.5px}
.vhead h2::before{content:'v';color:var(--accent);font-weight:400;margin-right:1px}
.vdate{font-size:13.5px;color:var(--text);font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.3px}
.vhead .toggle{margin-left:auto;align-self:center;flex-shrink:0}
.vmeta{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pill{font-size:11px;color:var(--muted);font-weight:400;border:1px solid var(--border);background:var(--soft);border-radius:999px;padding:1.5px 9px;white-space:nowrap}
.pill-warn{color:#b45309;border-color:#f59e0b66}
html.dark .pill-warn{color:#fbbf24}
.version h3{font-size:14px;margin:18px 0 10px;color:var(--muted);font-weight:600;letter-spacing:.3px}
.highlights ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.highlights li{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-radius:10px;
  background:var(--soft);border:1px solid var(--border)}
.hl-text{flex:1;font-size:14.5px}
.chip{flex-shrink:0;font-size:12px;font-weight:600;border-radius:7px;padding:2px 9px;margin-top:1px;white-space:nowrap}
.chip-feature{color:#0e9f6e;background:rgba(14,159,110,.1)}
.chip-improve{color:#2563eb;background:rgba(37,99,235,.1)}
.chip-fix{color:#dc2626;background:rgba(220,38,38,.1)}
.chip-change{color:#b45309;background:rgba(180,83,9,.1)}
.chip-other{color:#7c3aed;background:rgba(124,58,237,.1)}

/* ---- 明细分组 ---- */
.group{margin-top:4px}
.group h4{display:flex;align-items:center;gap:8px;margin:16px 0 2px;font-size:13px;font-weight:600}
.group h4 .muted{font-size:11.5px;font-weight:400}

.details .entries{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}
.details:not(.open) .entries, .details:not(.open) .group{display:none}
.entries li{position:relative;padding:5px 0 5px 20px;font-size:13.8px;color:var(--text)}
.entries li::before{content:'';position:absolute;left:4px;top:14px;width:5px;height:5px;border-radius:50%;
  background:var(--border)}
.version.untranslated .entries li{color:var(--muted)}
body.searching .details .entries{display:flex}
body.searching .details .group{display:block}
body.searching .details .group:not(:has(.entries li.hit)){display:none}
body.searching .version.current .entries li:not(.hit){display:none}
.entries li:has(> mark){background:linear-gradient(transparent 62%,var(--mark) 62%)}

.pn{display:flex;justify-content:space-between;gap:10px;margin-top:20px;flex-wrap:wrap}
.pn-btn{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px}

/* ---- 其他 ---- */
.empty{display:none;text-align:center;color:var(--muted);padding:26px 0 6px;font-size:14px}
body.searching.empty-on .empty{display:block}
.top-btn{position:fixed;right:22px;bottom:26px;width:42px;height:42px;border-radius:12px;z-index:60;
  border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:17px;cursor:pointer;
  box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:.2s}
.top-btn.show{opacity:1;pointer-events:auto}
.top-btn:hover{color:var(--accent);border-color:var(--accent)}
.kbd-hint{font-size:11.5px;color:var(--muted)}
footer{text-align:center;color:var(--muted);font-size:12.5px;padding:0 20px 40px}
@media print{.top,.sidebar,.top-btn,.toggle,.pn{display:none!important}.details .entries{display:flex!important}.details .group{display:block!important}.version{display:none}.version.current{display:block;box-shadow:none}}
</style>
</head>
<body>
<header class="top">
  <div class="top-inner">
    <h1><span class="em">Claude Code</span> 更新日志 · 中文版</h1>
    <div class="spacer"></div>
    <select class="sel" id="sel" title="切换版本"></select>
    <div class="search">
      <span class="icon">🔍</span>
      <input id="q" type="search" placeholder="搜索本版更新内容…" autocomplete="off">
      <button class="clear" id="qc" type="button" title="清空">✕</button>
    </div>
    <button class="btn" id="theme" type="button" title="切换明暗主题">🌙</button>
    <div class="meta" id="meta"></div>
  </div>
  <div class="search-info" id="searchInfo"></div>
</header>

<div class="layout">
  <aside class="sidebar">
    <h4>版本导航 <span class="kbd-hint">← → 切换</span></h4>
    <ol class="toc" id="toc">
${toc}
    </ol>
  </aside>
  <main id="main">
${sections}
    <div class="empty" id="empty"></div>
  </main>
</div>

<button class="top-btn" id="topBtn" type="button" title="回到顶部">↑</button>
<footer>由 claude-code-changelog 自动生成 · 原文：<a href="https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md" target="_blank" rel="noopener">anthropics/claude-code CHANGELOG.md</a></footer>

<script id="page-data" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
(function(){
  'use strict';
  var data = {};
  try { data = JSON.parse(document.getElementById('page-data').textContent); } catch (e) {}

  /* ---------- 主题 ---------- */
  var themeBtn = document.getElementById('theme');
  function applyTheme(t){
    document.documentElement.classList.toggle('dark', t === 'dark');
    themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem('ccch-theme', t); } catch (e) {}
  }
  var saved = null;
  try { saved = localStorage.getItem('ccch-theme'); } catch (e) {}
  applyTheme(saved || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  themeBtn.addEventListener('click', function(){
    applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  });

  /* ---------- 头部信息 ---------- */
  function escH(s){
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  var c = data.counts || {};
  var metaEl = document.getElementById('meta');
  if (metaEl) {
    var parts = [];
    if (data.latest) parts.push('最新版本 <b>' + escH(data.latest) + '</b>');
    if (data.latestNpm) parts.push('npm 最新 <b>' + escH(data.latestNpm) + '</b>');
    parts.push('共 <b>' + (c.versions || 0) + '</b> 个版本');
    parts.push((c.entries || 0) + ' 条明细');
    parts.push((c.highlights || 0) + ' 条亮点');
    if (data.generatedAt) parts.push('生成于 ' + escH(data.generatedAt));
    metaEl.innerHTML = parts.join(' · ');
  }

  var BT = String.fromCharCode(96);
  function fmt(text, query){
    var t = escH(text);
    if (query) {
      var qe = escH(query).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      t = t.replace(new RegExp('(' + qe + ')', 'gi'), '<mark>$1</mark>');
    }
    return t.replace(new RegExp(BT + '([^' + BT + ']+' + BT + ')', 'g'), '<code>$1</code>');
  }

  /* ---------- 单版本分页 ---------- */
  var secs = Array.prototype.slice.call(document.querySelectorAll('.version'));
  var idx = 0;

  var sel = document.getElementById('sel');
  secs.forEach(function(s, i){
    var o = document.createElement('option');
    o.value = s.getAttribute('data-version');
    o.textContent = s.getAttribute('data-version') + '（' + s.querySelectorAll('.entries li').length + ' 条）';
    sel.appendChild(o);
  });

  function setCurrent(i, pushHash){
    if (i < 0) i = 0;
    if (i > secs.length - 1) i = secs.length - 1;
    idx = i;
    secs.forEach(function(s, j){ s.classList.toggle('current', j === idx); });
    sel.value = secs[idx].getAttribute('data-version');
    document.querySelectorAll('.toc a').forEach(function(a, j){
      a.classList.toggle('active', j === idx);
      if (j === idx && a.scrollIntoView) { try { a.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    });
    var q = document.getElementById('q');
    if (q && q.value.trim()) run(); else window.scrollTo({ top: 0 });
    if (pushHash !== false) {
      if (location.hash.slice(1) !== secs[idx].getAttribute('data-version')) {
        location.hash = secs[idx].getAttribute('data-version');
      }
    }
    document.title = 'v' + secs[idx].getAttribute('data-version') + ' · Claude Code 更新日志（中文版）';
  }

  function idxOfVersion(v){
    for (var i = 0; i < secs.length; i++) if (secs[i].getAttribute('data-version') === v) return i;
    return -1;
  }

  /* hash 路由：#2.1.327 直达 / 浏览器前进后退 */
  function applyHash(){
    var v = decodeURIComponent(location.hash.slice(1));
    var i = v ? idxOfVersion(v) : 0;
    setCurrent(i < 0 ? 0 : i, false);
  }
  window.addEventListener('hashchange', applyHash);

  /* 侧边栏与下拉切换 */
  document.querySelectorAll('.toc a').forEach(function(a, i){
    a.addEventListener('click', function(e){ e.preventDefault(); setCurrent(i); });
  });
  sel.addEventListener('change', function(){
    var i = idxOfVersion(sel.value);
    if (i >= 0) setCurrent(i);
  });

  /* 上一版 / 下一版按钮 */
  document.querySelectorAll('.pn-btn').forEach(function(b){
    b.addEventListener('click', function(){ setCurrent(parseInt(b.getAttribute('data-go'), 10)); });
  });

  /* 键盘 ← →（输入框聚焦时忽略） */
  document.addEventListener('keydown', function(e){
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft') setCurrent(idx - 1);
    if (e.key === 'ArrowRight') setCurrent(idx + 1);
  });

  /* ---------- 明细折叠（按钮在版本标题行） ---------- */
  secs.forEach(function(sec){
    var d = sec.querySelector('.details');
    var btn = sec.querySelector('.toggle');
    if (!d || !btn) return;
    function sync(){ btn.textContent = d.classList.contains('open') ? '收起明细 ▴' : '展开明细 ▾'; }
    sync();
    btn.addEventListener('click', function(){ d.classList.toggle('open'); sync(); });
  });

  /* ---------- 搜索（本版过滤 + 跨版本命中提示） ---------- */
  var input = document.getElementById('q');
  var clearBtn = document.getElementById('qc');
  var info = document.getElementById('searchInfo');
  var empty = document.getElementById('empty');
  var timer = null;

  function hitsIn(sec, lq){
    var ver = (sec.getAttribute('data-version') || '').toLowerCase();
    if (ver.indexOf(lq) !== -1) return sec.querySelectorAll('.entries li').length;
    var n = 0;
    sec.querySelectorAll('.entries li').forEach(function(li){
      var raw = li.getAttribute('data-text') || '';
      if (raw.toLowerCase().indexOf(lq) !== -1) n++;
    });
    return n;
  }

  function run(){
    var query = input.value.trim();
    clearBtn.style.display = query ? 'block' : 'none';
    document.body.classList.toggle('searching', !!query);
    empty.classList.remove('empty-on');
    if (!query) {
      secs.forEach(function(sec){
        sec.querySelectorAll('.entries li').forEach(function(li){
          li.classList.remove('hit'); li.style.display = '';
          li.innerHTML = fmt(li.getAttribute('data-text') || li.textContent, '');
        });
        sec.querySelectorAll('.hl-text').forEach(function(el){
          el.innerHTML = fmt(el.getAttribute('data-text') || el.textContent, '');
        });
      });
      info.textContent = '';
      return;
    }
    var lq = query.toLowerCase();
    var cur = secs[idx];
    var curVer = (cur.getAttribute('data-version') || '').toLowerCase();
    var verMatch = curVer.indexOf(lq) !== -1;
    var hits = 0;
    cur.querySelectorAll('.entries li').forEach(function(li){
      var raw = li.getAttribute('data-text') || '';
      var hit = verMatch || raw.toLowerCase().indexOf(lq) !== -1;
      li.classList.toggle('hit', hit);
      li.style.display = hit ? '' : 'none';
      if (hit) { li.innerHTML = fmt(raw, verMatch ? '' : query); hits++; }
    });
    cur.querySelectorAll('.hl-text').forEach(function(el){
      var raw = el.getAttribute('data-text') || '';
      var hit = verMatch || raw.toLowerCase().indexOf(lq) !== -1;
      el.innerHTML = fmt(raw, hit && !verMatch ? query : '');
    });

    info.textContent = '';
    while (info.firstChild) info.removeChild(info.firstChild);
    function txt(t){ var s = document.createElement('span'); s.textContent = t; return s; }

    /* 所有命中版本生成筛选标签；当前版本始终保留并高亮 */
    var all = [];
    secs.forEach(function(sec, i){
      all.push({ i: i, v: sec.getAttribute('data-version'), n: i === idx ? hits : hitsIn(sec, lq) });
    });
    var show = all.filter(function(a){ return a.n > 0 || a.i === idx; });
    var CAP = 15;
    var list = show.slice(0, CAP);
    var rest = show.length - list.length;
    var curInList = list.some(function(a){ return a.i === idx; });
    if (!curInList && idx >= 0) { list.push(all[idx]); rest = Math.max(0, rest - 1); }

    if (!show.length) {
      info.textContent = '没有匹配 “' + query + '” 的内容';
    } else {
      var hitVers = show.filter(function(a){ return a.n > 0; }).length;
      info.appendChild(txt(hitVers + ' 个版本命中，当前：'));
      list.forEach(function(a){
        var b = document.createElement('button');
        b.className = 'chip-btn' + (a.i === idx ? ' active' : '');
        b.type = 'button';
        b.textContent = a.v + (a.n ? ' · ' + a.n + ' 条' : ' · 0 条');
        if (a.i === idx) b.title = '当前版本';
        b.addEventListener('click', function(){ setCurrent(a.i); });
        info.appendChild(b);
      });
      if (rest > 0) info.appendChild(txt('…另有 ' + rest + ' 个版本（← → 切换查看）'));
    }
    if (!hits) {
      empty.textContent = show.length > 1 ? '本版没有匹配，点击上方其他版本的标签切换' : '没有匹配 “' + query + '” 的内容';
      empty.classList.add('empty-on');
    }
  }
  input.addEventListener('input', function(){
    clearTimeout(timer); timer = setTimeout(run, 140);
  });
  input.addEventListener('keydown', function(e){
    if (e.key === 'Enter') { clearTimeout(timer); run(); }
  });
  clearBtn.addEventListener('click', function(){
    input.value = ''; run(); input.focus();
  });

  /* ---------- 回到顶部 ---------- */
  var topBtn = document.getElementById('topBtn');
  window.addEventListener('scroll', function(){
    topBtn.classList.toggle('show', window.scrollY > 600);
  }, { passive: true });
  topBtn.addEventListener('click', function(){
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* 初始化 */
  applyHash();
})();
</script>
</body>
</html>
`;
}
