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

- `out/CHANGELOG.zh-CN.md` — Markdown 中文版
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

- `docs/` 为站点目录（`index.html` + `CHANGELOG.zh-CN.md`），由 `.github/workflows/deploy.yml` 在 push 后自动发布到 GitHub Pages
- 一键更新部署：`./deploy.sh [N]`（默认收录最近 10 个版本，如 `./deploy.sh 30`）——增量翻译 → 拷贝到 `docs/` → 提交推送，Actions 自动上线

本地自动定时更新并部署（crontab，每天 10:00）：

```cron
0 10 * * * cd /path/to/claude-code-changelog && ./deploy.sh >> out/run.log 2>&1
```

> 注意：翻译依赖本机的 LLM 网关（`ANTHROPIC_BASE_URL` 等），因此更新动作在本机执行；GitHub 侧只负责发布静态页面。

## 定时自动更新

crontab 示例（每天 10:00 自动增量更新，日志写入 out/run.log）：

```cron
0 10 * * * cd /path/to/claude-code-changelog && /usr/local/bin/node cli.mjs >> out/run.log 2>&1
```

launchd 示例（`~/Library/LaunchAgents/com.myspace.claude-changelog.plist`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.myspace.claude-changelog</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/claude-code-changelog/cli.mjs</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>EnvironmentVariables</key><dict>
    <key>ANTHROPIC_BASE_URL</key><string>你的网关地址</string>
    <key>ANTHROPIC_AUTH_TOKEN</key><string>你的令牌</string>
  </dict>
</dict></plist>
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
渲染 out/CHANGELOG.zh-CN.md（每版本顶部亮点 + 完整中文明细）
        ↓
渲染 out/CHANGELOG.zh-CN.html（单文件网页：搜索 / 导航 / 折叠 / 明暗主题）
```

- 亮点提炼基于该版本**全部英文原文**（信息最全），翻译与提炼互不影响。
- 各版本**发布时间**取自 npm registry 的 `time` 字段（`@anthropic-ai/claude-code` 发布时间戳，UTC 日期），本地缓存 24 小时；极少数未发布到 npm 的内测版本不带日期。
- **明细归类**为纯规则实现（`lib/categorize.mjs`）：按英文原文的动词前缀（Added/Improved/Changed/Fixed…，自动剥离 `VSCode:`、`[VSCode]` 等作用域前缀）归类，再 1:1 映射回中文条目——无需 LLM、全量版本即时生效，未命中规则的约 2% 落入「📌 其他」。
- 翻译失败的单个版本会在输出中保留英文原文并标记，不影响其他版本。
- 网络请求优先用 Node 内置 fetch，失败自动退回 curl（自动遵循代理环境变量）。
