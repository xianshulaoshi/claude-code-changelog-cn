#!/usr/bin/env bash
# 定时增量更新（供腾讯云等服务器 cron 或本机手动使用，GitHub Actions 方案的等价替代）
#
# 流程：拉取远端 → 检测新版本 → 翻译（增量，读 out/cache.json 缓存）→ 同步 docs → 提交推送
# 推送后 GitHub Actions (deploy.yml) 自动发布 Pages。
#
# LLM 配置（三选一）：
#   1. 环境变量：ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / CHANGELOG_TRANSLATOR_MODEL
#   2. 本目录下 update.env 文件（已 gitignore，模板见 update.env.example）
#   3. 命令行覆盖：./update.sh --base-url ... --api-key ... --model ...
#
# 用法：./update.sh [--dry-run] [-- 额外参数原样传给 cli.mjs]
#   --dry-run   只翻译渲染，不提交不推送
set -euo pipefail
cd "$(dirname "$0")"

# 加载本地密钥配置（不进仓库）
[ -f update.env ] && . ./update.env

DRY_RUN=0
EXTRA=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    *) EXTRA+=("$a") ;;
  esac
done

# 防止上一次运行未结束就启动下一次（cron 重叠）；macOS 无 flock 时跳过（手动场景可接受）
mkdir -p out
if command -v flock >/dev/null 2>&1; then
  exec 9>out/.update.lock
  flock -n 9 || { echo "[update] 上一次更新仍在运行，本次跳过"; exit 0; }
fi

fail() { echo "[update] 失败: $1" >&2; exit 1; }

# 1. 同步远端（服务器与本地都可能推过提交）
git pull --rebase --autostash origin main || fail "git pull --rebase 失败，请手动处理"

# 2. 门禁：没有新版本直接结束（退出码 1 = 已最新）
GATE=0
node scripts/check-new.mjs || GATE=$?
[ "$GATE" -eq 2 ] && fail "版本检测失败（数据源不可达？）"
if [ "$GATE" -eq 1 ]; then echo "[update] 已是最新，无需更新"; exit 0; fi

# 3. 翻译 + 渲染（--all 全量收录，已翻译版本走缓存，只为新版本调 LLM）
node cli.mjs --all --quiet "${EXTRA[@]+"${EXTRA[@]}"}" || fail "cli.mjs 退出非 0（存在翻译失败版本，本次不部署，下次重试）"

# 4. 同步到 docs
mkdir -p docs
cp out/index.html docs/index.html
rm -rf docs/versions
cp -R out/versions docs/versions

# 5. 提交推送
git add docs out/cache.json
if git diff --cached --quiet; then echo "[update] 渲染结果无变化，跳过提交"; exit 0; fi
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[update] dry-run：有变更待提交，但不推送。预览："
  git diff --cached --stat | tail -5
  exit 0
fi

LATEST=$(ls docs/versions | sed 's/\.md$//' | sort -V | tail -1)
[ -n "${GIT_AUTHOR_NAME:-}" ] || git config user.name >/dev/null 2>&1 || git config user.name "claude-changelog-bot"
[ -n "${GIT_AUTHOR_EMAIL:-}" ] || git config user.email >/dev/null 2>&1 || git config user.email "xianshulaoshi@users.noreply.github.com"
git commit -m "docs: 自动更新至 v${LATEST}（$(date '+%Y-%m-%d %H:%M')）"
git push origin main
echo "[update] 已推送 v${LATEST}，GitHub Actions 将自动发布 Pages"
