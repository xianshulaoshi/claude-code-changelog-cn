#!/usr/bin/env bash
# 一键部署：增量翻译最新 changelog → 生成站点 → 提交并推送到 GitHub（Actions 自动发布 Pages）
set -euo pipefail
cd "$(dirname "$0")"

LIMIT="${1:-10}"          # 默认收录最近 10 个版本：./deploy.sh 30 即收录 30 个
node cli.mjs --limit "$LIMIT"

mkdir -p docs
cp out/index.html docs/index.html
cp out/CHANGELOG.zh-CN.md docs/CHANGELOG.zh-CN.md

git add docs
if git diff --cached --quiet; then
  echo "没有变化，无需部署"
  exit 0
fi
git commit -m "docs: 更新中文 changelog 页面 ($(date '+%Y-%m-%d %H:%M'))"
git push
echo "已推送，GitHub Actions 将自动发布到 Pages"
