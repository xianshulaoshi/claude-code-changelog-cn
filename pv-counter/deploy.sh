#!/usr/bin/env bash
# 部署/更新 PV 计数云函数（SCF 函数 cc-pv + COS 桶 cc-changelog-pv-<appid>）
# 用法：TX_SID=xxx TX_SKEY=yyy APPID=1451971551 ./deploy.sh
# 注意：密钥只作环境变量传入，不落盘；建议使用仅授权 COS+SCF 的子账号密钥。
set -euo pipefail
cd "$(dirname "$0")"

: "${TX_SID:?需要环境变量 TX_SID}"
: "${TX_SKEY:?需要环境变量 TX_SKEY}"
: "${APPID:?需要环境变量 APPID}"
REGION="${REGION:-ap-guangzhou}"
BUCKET="cc-changelog-pv-${APPID}"
FN=cc-pv

TC() { tccli "$@" --secretId "$TX_SID" --secretKey "$TX_SKEY" --region "$REGION"; }

# 1. 存储桶（已存在则忽略报错）
TC cos create_bucket --bucket "$BUCKET" 2>/dev/null || true

# 2. 打包函数
zip -j -q /tmp/cc-pv.zip index.js
B64=$(base64 -i /tmp/cc-pv.zip | tr -d '\n')
ENV="{\"Variables\":[{\"Key\":\"COS_BUCKET\",\"Value\":\"$BUCKET\"},{\"Key\":\"COS_REGION\",\"Value\":\"$REGION\"},{\"Key\":\"COS_SID\",\"Value\":\"$TX_SID\"},{\"Key\":\"COS_SKEY\",\"Value\":\"$TX_SKEY\"}]}"

# 3. 创建或更新函数（CreateFailed/不存在 → 重建；否则更新代码与配置）
if TC scf GetFunction --FunctionName "$FN" 2>/dev/null | grep -q '"Status": "CreateFailed"'; then
  TC scf DeleteFunction --FunctionName "$FN" || true
  sleep 5
  TC scf CreateFunction --FunctionName "$FN" --Namespace default --Type Event \
    --Runtime Nodejs16.13 --Handler index.main_handler --MemorySize 128 --Timeout 10 \
    --Code "{\"ZipFile\":\"$B64\"}" --Environment "$ENV"
else
  TC scf UpdateFunctionCode --FunctionName "$FN" --Namespace default --ZipFile "$B64" \
    || TC scf CreateFunction --FunctionName "$FN" --Namespace default --Type Event \
      --Runtime Nodejs16.13 --Handler index.main_handler --MemorySize 128 --Timeout 10 \
      --Code "{\"ZipFile\":\"$B64\"}" --Environment "$ENV"
  TC scf UpdateFunctionConfiguration --FunctionName "$FN" --Namespace default \
    --Environment "$ENV" || true
fi

# 4. 验证
echo "远端调用测试："
TC scf Invoke --FunctionName "$FN" --Namespace default --ClientContext '{"httpMethod":"GET"}' | grep RetMsg || true
echo "完成。还差一步（CLI 无接口）：控制台 → 云函数 cc-pv → 函数 URL → 开启（免鉴权），把 URL 填到 lib/render-html.mjs 的 PV_ENDPOINT。"
