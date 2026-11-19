#!/bin/bash
# ============================================================
# VibeCity → GitHub 私有仓库推送脚本
#
# 前置：需要一个具备 contents:write 权限的 GitHub token
#   A) 细粒度 PAT：https://github.com/settings/tokens?type=beta
#      → 生成新 token → Repository access 选 DeXuan/vibecity
#      → Permissions → Contents: Read and write
#   B) 经典 PAT：https://github.com/settings/tokens
#      → Generate new token (classic) → 勾选 repo
#
# 用法：
#   GITHUB_TOKEN=ghp_xxx ./push-to-github.sh
#   或先 gh auth login 再运行 ./push-to-github.sh
# ============================================================
set -euo pipefail

REPO="git@github.com:DeXuan/vibecity.git"
HTTPS_REPO="https://github.com/DeXuan/vibecity.git"

# 1) 解析 token
TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  if command -v gh >/dev/null 2>&1; then
    TOKEN="$(gh auth token 2>/dev/null || true)"
  fi
fi
if [ -z "$TOKEN" ]; then
  echo "[错误] 未找到 token。请设置 GITHUB_TOKEN 环境变量或先 gh auth login" >&2
  exit 1
fi

# 2) 预检写权限（用 github.com 通道，api.github.com 在本机可能被阻断）
echo "==> [1/3] 校验 token 写权限"
PY_DESC=$(python -c "import base64,json;print(base64.b64encode(b'probe').decode())")
HTTP=$(curl -s --noproxy '*' -m 30 -o /tmp/vb_probe.json -w '%{http_code}' \
  -X PUT "https://api.github.com/repos/DeXuan/vibecity/contents/.probe" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"probe\",\"content\":\"$PY_DESC\",\"branch\":\"main\"}" || echo "000")

if [ "$HTTP" = "201" ] || [ "$HTTP" = "200" ]; then
  echo "    token 具备写权限 ✓"
elif grep -q "Resource not accessible" /tmp/vb_probe.json 2>/dev/null; then
  echo "    [失败] token 缺少 Contents:Write 权限。" >&2
  echo "    请到下面地址重新生成：" >&2
  echo "      https://github.com/settings/tokens?type=beta" >&2
  echo "    Permissions → Contents → Read and write" >&2
  exit 2
else
  echo "    [警告] 预检返回 HTTP $HTTP（可能是网络波动，继续尝试推送）"
fi

# 3) 推送
echo "==> [2/3] 配置 remote 并推送"
git remote remove origin 2>/dev/null || true
git remote add origin "$HTTPS_REPO"
NO_PROXY='*' no_proxy='*' git -c http.proxy= -c https.proxy= \
  -c "http.https://github.com/.extraheader=Authorization: Bearer $TOKEN" \
  push -u origin main

echo "==> [3/3] 校验远端"
NO_PROXY='*' gh api repos/DeXuan/vibecity --jq '"私有: \(.private) · 大小: \(.size)KB · 默认分支: \(.default_branch)"'

echo ""
echo "✅ 完成：https://github.com/DeXuan/vibecity"