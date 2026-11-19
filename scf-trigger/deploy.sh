#!/usr/bin/env bash
# 部署/更新定时触发云函数（SCF 函数 changelog-trigger，默认香港区 ap-hongkong）
# 用法：TX_SID=xxx TX_SKEY=yyy ./deploy.sh               # 仅更新代码（保留线上已有 GH_PAT 等环境变量）
#       GH_PAT=xxx TX_SID=xxx TX_SKEY=yyy ./deploy.sh   # 首次创建 / 轮换 PAT / 透传其它环境变量
#   可选：REGION=ap-hongkong  RUNTIME=Python3.10  REPO/WORKFLOW/BRANCH/GATE（透传为函数环境变量）
# 依赖 tccli（pip3 install --user tccli）；TX_* 建议用仅授权 SCF 的子账号密钥。
# 注意：提供 GH_PAT 时会用它（及上述可选变量）整体覆盖函数环境变量；不提供则仅更新代码、环境变量不动。
set -euo pipefail
cd "$(dirname "$0")"

: "${TX_SID:?需要环境变量 TX_SID}"
: "${TX_SKEY:?需要环境变量 TX_SKEY}"
REGION="${REGION:-ap-hongkong}"
RUNTIME="${RUNTIME:-Python3.13}"   # 控制台实测可选（index.py 零依赖、兼容 3.6+）
FN=changelog-trigger

# 定位 tccli（PATH 优先，其次 pip --user 的常见位置）
TCCLI="$(command -v tccli || true)"
if [ -z "$TCCLI" ]; then
  for c in "$HOME"/Library/Python/*/bin/tccli "$HOME"/.local/bin/tccli; do
    [ -x "$c" ] && TCCLI="$c" && break
  done
fi
: "${TCCLI:?找不到 tccli，先安装：pip3 install --user tccli}"
TC() { "$TCCLI" "$@" --secretId "$TX_SID" --secretKey "$TX_SKEY" --region "$REGION"; }

# 1. 打包函数
zip -j -q /tmp/changelog-trigger.zip index.py
B64=$(base64 -i /tmp/changelog-trigger.zip | tr -d '\n')
# GH_PAT 未提供 → ENV 留空，走「仅更新代码」模式保留线上现有环境变量
ENV=""
if [ -n "${GH_PAT:-}" ]; then
  ENV="{\"Variables\":[{\"Key\":\"GH_PAT\",\"Value\":\"$GH_PAT\"}"
  [ -n "${REPO:-}" ]     && ENV="$ENV,{\"Key\":\"REPO\",\"Value\":\"$REPO\"}"
  [ -n "${WORKFLOW:-}" ] && ENV="$ENV,{\"Key\":\"WORKFLOW\",\"Value\":\"$WORKFLOW\"}"
  [ -n "${BRANCH:-}" ]   && ENV="$ENV,{\"Key\":\"BRANCH\",\"Value\":\"$BRANCH\"}"
  [ -n "${GATE:-}" ]     && ENV="$ENV,{\"Key\":\"GATE\",\"Value\":\"$GATE\"}"
  ENV="$ENV]}"
fi

# 2. 已存在 → 更新代码与配置；不存在 → 创建 + 挂定时触发器
if TC scf GetFunction --FunctionName "$FN" >/dev/null 2>&1; then
  TC scf UpdateFunctionCode --FunctionName "$FN" --Namespace default --ZipFile "$B64"
  if [ -n "$ENV" ]; then
    TC scf UpdateFunctionConfiguration --FunctionName "$FN" --Namespace default \
      --Runtime "$RUNTIME" --Timeout 60 --MemorySize 128 --Environment "$ENV"
  else
    echo "GH_PAT 未提供：仅更新代码，线上环境变量与运行时配置原样保留。"
  fi
else
  : "${GH_PAT:?函数不存在，首次创建必须提供 GH_PAT（GitHub 细粒度 PAT）}"
  TC scf CreateFunction --FunctionName "$FN" --Namespace default --Type Event \
    --Runtime "$RUNTIME" --Handler index.main_handler --MemorySize 128 --Timeout 60 \
    --Code "{\"ZipFile\":\"$B64\"}" --Environment "$ENV"
  # 每半小时（北京时间 :00/:30；SCF 定时 7 段 cron：秒 分 时 日 月 星期 年）；已存在则忽略
  TC scf CreateTrigger --FunctionName "$FN" --Namespace default \
    --TriggerName every-30min --Type timer --TriggerDesc '0 0/30 * * * * *' --Enable OPEN 2>/dev/null || true
fi

# 3. 验证（真实执行一次：跑门禁，必要时会触发一次 update workflow）
echo "远端调用测试："
TC scf Invoke --FunctionName "$FN" --Namespace default --ClientContext '{}' | grep RetMsg || true
echo "完成。函数未配 CLS 日志投递，排错看上面的 RetMsg；建议在 SCF 控制台给本函数配「调用错误」云监控告警。"
