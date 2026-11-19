# claude-code-changelog — Claude Code 更新日志中文版生成器

**🌐 在线预览：<https://xianshulaoshi.github.io/claude-code-changelog-cn/>**（GitHub Pages 自动发布，含最近若干版本）

自动抓取 Claude Code 官方 Changelog，用 LLM 翻译成中文，并在**每个版本最上方**提炼「✨ 本版亮点」（🚀 新功能 / 🔧 改进 / 🐛 关键修复），下方保留该版本**全部更新明细**的中文翻译，并按类别归组（🚀 新功能 / 🔧 改进 / 🔄 变更 / 🐛 修复，组内保持官方原顺序）。

零依赖，仅需 Node.js ≥ 18 和一个 Anthropic 兼容的 LLM API。

## 快速开始

```bash
node cli.mjs              # 抓取并翻译最近 10 个版本
node cli.mjs --latest     # 只要最新 1 个版本
node cli.mjs --all        # 全部 440+ 个版本（量大，慎用）
node cli.mjs --since 2.1.320   # 从 2.1.320 到最新
node cli.mjs --versions 2.1.327,2.1.325   # 指定版本
```

每次运行产出两个文件（`--no-html` 可跳过网页）：

- `out/versions/<版本号>.md` — Markdown 中文版，**每个版本一个独立文件**
- `out/index.html` — **单文件网页版**（双击即开，无需服务器）：每版亮点置顶 + 完整明细按类别分组折叠展开、关键词搜索（明细 + 亮点 + 版本号，命中高亮，无命中的分组自动隐藏）、版本侧边导航（滚动联动高亮）、明暗主题自适应（可手动切换）、支持打印

再次运行时自动**增量更新**：已翻译过的版本直接读缓存（`out/cache.json`），只为新版本调用 LLM。

## 输出示例

```markdown
## 2.1.327

**✨ 本版亮点**

- 🚀 **新功能**：新增 claude mcp add-json 从 stdin 读取服务器配置，令牌不再出现在命令行中
- 🔧 **改进**：显著提升会话首条 Bash 命令、Windows 启动及 PowerShell 工具的速度
- 🐛 **关键修复**：修复远程 MCP 服务器在 VPN 中断等长时间故障后无法重连的问题

**📋 更新明细**（共 173 条，按类别归组）

**🚀 新功能**（N 条）

- 新增 `claude mcp add-json <name> -`，可从 stdin 读取服务器 JSON……
- 在 `/status` 中增加列表，显示损坏的 agent、skill、command……
- [VSCode] 在资源管理器右键菜单中新增 "Claude Code: Add to Chat"……

**🔧 改进**（N 条）

- 提升会话首条 Bash 命令的速度：shell 启动文件现在可提前运行……

**🔄 变更**（N 条）

- 变更 `ExitWorktree`：移除可能包含未保存工作的 worktree 前会先询问……

**🐛 修复**（N 条）

- 修复较长时间断网（如 VPN 断开）后远程 MCP 服务器保持断连的问题……
```

## LLM 配置

按以下优先级取值（也可用命令行参数覆盖）：

| 命令行参数 | 环境变量 | 默认值 |
|---|---|---|
| `--base-url` | `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| `--api-key` | `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` | —（必填） |
| `--model` | `CHANGELOG_TRANSLATOR_MODEL` 或 `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `claude-haiku-4-5` |

任何 Anthropic Messages API 兼容网关均可使用（如 Claude Code 代理、公司内部 LLM 网关等）。

示例：

```bash
# 用官方 API
node cli.mjs --base-url https://api.anthropic.com --api-key sk-ant-xxx

# 用其他模型
node cli.mjs --model glm-4.7
```

## 全部参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--limit <N>` | 翻译/输出最近 N 个版本 | 10 |
| `--all` | 输出全部版本 | — |
| `--latest` | 仅最新 1 个版本 | — |
| `--versions <v1,v2>` | 指定版本列表 | — |
| `--since <x.y.z>` | 从该版本到最新 | — |
| `--concurrency <N>` | 版本间并发翻译数 | 3 |
| `--source <url>` | 自定义 changelog URL（可多次） | GitHub raw + jsDelivr ×2 |
| `--out <dir>` | 输出目录 | `./out` |
| `--no-html` | 不生成网页版 | 默认生成 |
| `--force` | 忽略缓存全部重翻 | — |
| `--stdout` | 输出到标准输出（不写文件） | — |
| `--quiet` | 静默模式 | — |

## 部署到 GitHub Pages

仓库：<https://github.com/xianshulaoshi/claude-code-changelog-cn>

- `docs/` 为站点目录（`index.html` + `versions/<版本号>.md` 每版本一档），由 `.github/workflows/deploy.yml` 在 push 后自动发布到 GitHub Pages

## 自动更新（新版本 → 翻译 → 发布，全自动）

翻译缓存 `out/cache.json` 随仓库提交：增量更新时**只对新版本调用 LLM**，历史 440+ 版本零成本复用。门禁脚本 `scripts/check-new.mjs` 对比「上游 changelog / npm / 本地 docs」，有新版本、或最新版本缺发布日期时才触发更新。

### 方案 A：GitHub Actions 全自动（推荐，零服务器）

`.github/workflows/update.yml` 每小时运行两次：检测新版本 → GLM 翻译 → 提交推送 → `deploy.yml` 自动发布 Pages。翻译走智谱 Anthropic 兼容网关（`https://open.bigmodel.cn/api/anthropic` + `glm-5.3`），每版本约 1~5 次调用，成本不到一分钱。

一次性配置：仓库 **Settings → Secrets and variables → Actions → New repository secret**，Name 填 `GLM_API_KEY`，Value 填智谱 API Key。如需换模型/网关，改 workflow 里的环境变量即可。

### 方案 B：服务器 cron（腾讯云等，GitHub 机房连不上网关时的替代）

```bash
# 服务器上（需 Node ≥ 18、git 推送权限）：
git clone git@github.com:xianshulaoshi/claude-code-changelog-cn.git
cd claude-code-changelog-cn
cp update.env.example update.env && vim update.env    # 填 ANTHROPIC_AUTH_TOKEN 等

# crontab -e：每小时检测一次，日志落 out/update.log
0 * * * * cd /path/to/claude-code-changelog-cn && ./update.sh >> out/update.log 2>&1
```

`update.sh`：拉取远端 → 门禁检测 → `cli.mjs --all` 增量翻译 → 同步 `docs/` → 提交推送。自带 flock 防重叠、翻译失败不部署（下次自动重试）、`--dry-run` 演练模式。

### 方案 C：本机手动

```bash
./update.sh        # 增量更新到最新版本并部署（全量收录）
./deploy.sh 30     # 手动收录最近 30 个版本并部署（注意：会把站点收录范围缩小到 N 个，下次 update.sh 恢复全量）
```

## 工作原理

```
GitHub raw / jsDelivr 抓取 CHANGELOG.md（多源容错 + 本地缓存兜底）
        ↓
解析为「版本 → 更新条目」结构（443 个版本 / 近万条）
        ↓
逐版本调用 LLM（并发 3）：
  · 条目 ≤ 100：一次调用完成翻译 + 亮点提炼
  · 条目 > 100：50 条一组并发分块翻译，并行单独提炼亮点
  · 容错：JSON 修复、截断自动对半拆分、失败重试
        ↓
缓存到 out/cache.json（逐版本落盘，可随时中断续跑）
        ↓
渲染 out/versions/<版本号>.md（每版本一个文件：顶部亮点 + 归类明细）
        ↓
渲染 out/CHANGELOG.zh-CN.html（单文件网页：搜索 / 导航 / 折叠 / 明暗主题）
```

- 亮点提炼基于该版本**全部英文原文**（信息最全），翻译与提炼互不影响。
- 各版本**发布时间**取自 npm registry 的 `time` 字段（`@anthropic-ai/claude-code` 发布时间戳，UTC 日期），本地缓存 24 小时；极少数未发布到 npm 的内测版本不带日期。
- **明细归类**为纯规则实现（`lib/categorize.mjs`）：按英文原文的动词前缀（Added/Improved/Changed/Fixed…，自动剥离 `VSCode:`、`[VSCode]` 等作用域前缀）归类，再 1:1 映射回中文条目——无需 LLM、全量版本即时生效，未命中规则的约 2% 落入「📌 其他」。
- 翻译失败的单个版本会在输出中保留英文原文并标记，不影响其他版本。
- 网络请求优先用 Node 内置 fetch，失败自动退回 curl（自动遵循代理环境变量）。
