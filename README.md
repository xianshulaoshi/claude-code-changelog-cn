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
- `out/index.html` — **单文件网页版**（双击即开，无需服务器）：每版亮点置顶 + 完整明细按类别分组折叠展开、关键词搜索（明细 + 亮点 + 版本号，命中高亮，无命中的分组自动隐藏）、版本侧边导航（滚动联动高亮）、明暗主题自适应（可手动切换）、支持打印；移动端专门优化（紧凑吸顶两行、下滚自动收起顶栏、左右滑动切换版本、安全区适配）

再次运行时自动**增量更新**：已翻译过的版本直接读缓存（`out/cache.json`），只为新版本调用 LLM。

只改了网页样式想本地重渲（不抓取、不调 LLM）：

```bash
node scripts/rebuild-html.mjs   # 复用 out/raw/CHANGELOG.md + out/cache.json 重建 out/index.html
```

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

### 方案 A：SCF 定时触发 + GitHub Actions 执行（推荐，零服务器常驻）

执行链路：**腾讯云函数（香港区，每半小时）→ `workflow_dispatch` 触发 `update.yml` → 检测新版本 → GLM 翻译 → 提交推送 → `deploy.yml` 自动发布 Pages**。翻译走智谱 Anthropic 兼容网关（`https://open.bigmodel.cn/api/anthropic` + `glm-5.3`），每版本约 1~5 次调用，成本不到一分钱；云函数每月花费约 ¥0.1。

**为什么需要云函数当闹钟**：GitHub Actions 的 `schedule` 能用，但稀疏又不准时。2026-11-19 首日观察约 4 小时一窗未发，当时按「不派发」处理；2026-11-24 复查更正——那只是新注册 schedule 的早期延迟。复查数据（`gh api repos/xianshulaoshi/claude-code-changelog-cn/actions/runs?event=schedule`）：cron `13,43 * * * *` 每天应跑 48 班，实际 4.5 天只跑了 16 班（约 3.6 班/天），相邻两班间隔 4～12 小时（中位约 7 小时），没有一班落在 :13/:43。也就是说，只靠 schedule 的话，新版本从发布到被检测到平均要等 3～4 小时，最长 12 小时。云函数每半小时一班，把检测延迟压到 30 分钟以内；而且它门禁里的线上探测，是目前唯一会在部署失败后自动补派发的环节（见下文「部署失败自愈」）——schedule 触发的 `update.yml` 只做仓库侧检测。另一现实约束：手头的腾讯云 CVM 出不了境（直连不了 `api.github.com`），本机又非常开——香港区云函数同时满足「网络可达 + 不依赖任何常开机器」。`update.yml` 里保留的 schedule cron 作为备份，与云函数的派发共用同一个 `concurrency` 组，不会冲突。若不想使用腾讯云，cron-job.org 等境外免费定时服务同样可行（支持 POST + 自定义 Header，PAT 会存于第三方，务必只用最小权限细粒度 PAT）。

云函数真实代码在 [`scf-trigger/`](scf-trigger/)（`index.py` + `deploy.sh`，部署模式同 `pv-counter/`），每次执行三步：

1. **门禁**（`GATE=0` 可关）：对比 npm 最新版、仓库 `docs` 与线上站点，判定本次做什么——
   - npm 有新版本、或缺发布日期 → 触发 `update.yml`（重新翻译）；
   - 仓库已最新，但线上站点的最新版本页缺失、或与仓库内容不一致 → 只触发 `deploy.yml`（补部署，见下）；
   - 仓库与线上都已是最新 → 零成本跳过（省 ~95% 无效 runner 启动）。

   任一查询失败一律放行触发（fail-open，宁多跑不漏更新）。
2. **自愈 enable**：幂等 `PUT /repos/.../actions/workflows/<目标 workflow>/enable`——防 GitHub 对 60 天无仓库活动的 workflow 整体自动禁用（含 `workflow_dispatch`），导致 dispatch 403。
3. **dispatch**：`POST .../dispatches`（`ref=main`），非 204 主动抛错，配合云监控告警即可发现断链。

**部署失败自愈（两层）**：更新链路的两级门禁（云函数、`check-new.mjs`）原本只看仓库，`deploy.yml` 一旦失败，仓库已经是「最新」，就再没有东西会重试部署——2026-11-23 的 v2.1.331 就是这样：翻译推送成功，链式部署却在 `actions/deploy-pages` 报 `No artifacts named "github-pages"`（GitHub 侧瞬时故障），站点在 2.1.330 卡了 4 个多小时。现在有两层兜底：

- **就地重试**：`deploy.yml` 的部署步骤最多尝试 3 次、间隔 30s，某次成功后其余尝试跳过，全部失败才让 job 失败。
- **定时补派发**：云函数门禁发现线上没跟上，就直接派发 `deploy.yml`（重复部署幂等）。探测方式是比对线上 `/versions/<最新版本>.md` 与仓库同名文件是否逐字节一致。**只覆盖最新版本页**——只改了 `index.html`、版本文件没变的提交（如手动改样式）不在兜底范围内，这类提交请留意 push 触发的那次部署是否成功。

部署（需 [tccli](https://cloud.tencent.com/document/product/440/34065)，`TX_*` 建议用仅授权 SCF 的子账号密钥）：

```bash
cd scf-trigger
TX_SID=xxx TX_SKEY=yyy ./deploy.sh                          # 仅更新代码（保留线上已有 GH_PAT）
GH_PAT=github_pat_xxx TX_SID=xxx TX_SKEY=yyy ./deploy.sh    # 首次创建 / 轮换 PAT
```

或在控制台手建（腾讯云控制台 → 云函数 SCF → 中国香港）：

| 项 | 值 |
|---|---|
| 函数名 / 运行环境 | `changelog-trigger` / Python 3.13（控制台可选运行时；代码零依赖、兼容 3.6+） |
| 入口 / 规格 | `index.main_handler` / 128MB、超时 60s |
| 触发器 | 定时触发 `every-30min`（每半小时，北京时间 :00/:30） |
| 环境变量 | `GH_PAT` = GitHub 细粒度 PAT（本仓库 Actions 读写 +（建议）Contents 只读）；`REPO` / `WORKFLOW` / `BRANCH` / `GATE` / `DEPLOY_WORKFLOW` / `SITE` 可选，默认见 `index.py` 头注 |

一次性配置：① 仓库 **Settings → Secrets → Actions** 添加 `GLM_API_KEY`（智谱 API Key）；② GitHub 建细粒度 PAT（仅本仓库、Actions 读写，建议再勾 Contents:只读——npm 门禁靠它比对 docs 版本，缺了门禁退化为每次必触发；有效期创建时自选——预设 7/30/60/90 天，可自定义最长 366 天，个人仓库可不设过期，本文按 90 天示例，到期 regenerate 后更新云函数环境变量）；③ 部署云函数（上节一条命令）。如需换模型/网关，改 workflow 里的环境变量即可。方案 A **不使用** `update.env`——密钥存于 GitHub Secret（只写不可读）与云函数环境变量；注意后者是**明文存储**：控制台「函数配置」和 `GetFunction` 接口都能直接看到 `GH_PAT`，别给他人开这台函数的查看权限，PAT 务必保持最小授权。

**失效可见性（重要）**：本链路唯一的告警源就是云函数自身——PAT 到期、账号欠费、触发器误删时，每次 dispatch 得到 401/403 却不留痕（不产生 GitHub run、不发通知）。两个低成本兜底：给函数配**云监控告警**（SCF 控制台 → 告警配置，对「调用错误」告警；`index.py` 对非 204 会主动抛错）；站点页眉的「生成于 <时间>」就是肉眼 canary，几天不动即链路已断。部署环节是例外，它失败得并不安静：`deploy.yml` 三次重试都没过时，云函数每半小时会补派发一次，Actions 页上就会持续出现红色的 `deploy.yml`（事件 `workflow_dispatch`）运行记录，线上恢复后自动消失。

### 方案 B：服务器 cron（不想碰云函数/PAT 的替代，需一台能连 GitHub 与 LLM 网关的常开机器）

```bash
# 服务器上（需 Node ≥ 18、git 推送权限）：
git clone git@github.com:xianshulaoshi/claude-code-changelog-cn.git
cd claude-code-changelog-cn
cp update.env.example update.env && vim update.env    # 填 ANTHROPIC_AUTH_TOKEN 等

# crontab -e：每小时检测一次，日志落 out/update.log
0 * * * * cd /path/to/claude-code-changelog-cn && ./update.sh >> out/update.log 2>&1
```

`update.sh`：拉取远端 → 门禁检测 → `cli.mjs --all` 增量翻译 → 同步 `docs/` → 提交推送。自带 flock 防重叠、翻译失败不部署（下次自动重试）、`--dry-run` 演练模式。

**关于 `update.env`**：cron 没有交互终端，没法手动 `export`，所以用这个本地文件承载 LLM 密钥配置（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `CHANGELOG_TRANSLATOR_MODEL`），`update.sh` 启动时自动加载。它已被 `.gitignore` 覆盖，**永远不会进仓库**；仓库里只有占位符模板 `update.env.example`。同一套配置在方案 A 中的等价物是 GitHub Secret `GLM_API_KEY`。本机手动跑 `./update.sh` 时若嫌每次敲环境变量麻烦，也可以创建一份。

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
