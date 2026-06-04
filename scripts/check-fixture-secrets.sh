#!/usr/bin/env bash
# 脱敏闸门:阻止把含机密的 fixture 提交进仓库(进 git 历史几乎不可撤回)。
#
# 设计(评审拈出,安全边界要 fail-closed):
#   - 主规则(allowlist 风格):隐藏鉴权字段一律不许带值 —— 任何 type="hidden" 的 input
#     不得有非空 value;fixture 只该含可见结构 + 合成占位值。
#   - 次规则(denylist tripwire):再扫一遍常见机密形态(token/cookie/JWT/长 hex)。
#   - 自检:对投毒样本 .poisoned-sample.html 必须能检出,否则判定闸门已 no-op 并大声失败
#     (用 grep -E 显式区分「无命中(1)」与「出错(2)」,防脚本静默 fail-open)。
#
# 诚实局限:shell 闸门无法完整解析 HTML,挡不住所有未知字段名的机密;它是「合成 fixture +
#   人工脱敏 + 人工复核」之上的一道自动兜底,不是唯一防线。详见 docs/e2e-and-iteration-guide.md。
set -uo pipefail

FIXTURE_DIR="tests/e2e/fixtures"
POISONED="$FIXTURE_DIR/.poisoned-sample.html"

# denylist:常见机密形态。命中即视为含机密。
DENYLIST='Bearer [A-Za-z0-9._-]+|Set-Cookie|JSESSIONID|PHPSESSID|csrf[_-]?token|_token|sessionid|session=|eyJ[A-Za-z0-9_-]{20,}|[A-Fa-f0-9]{32,}'

# 检出一个文件里的机密;命中输出行、返回 0(有机密),无命中返回 1,出错返回 2。
detect_secrets() {
  local file="$1"
  local hits=""
  # 主规则:type="hidden" 且带非空 value 的行
  local hidden
  hidden=$(grep -nEi '<input[^>]*type=["'"'"']?hidden["'"'"']?[^>]*value=["'"'"'][^"'"'"'[:space:]]' "$file" 2>/dev/null)
  local hg=$?
  if [ $hg -eq 2 ]; then return 2; fi
  # 次规则:denylist 形态
  local deny
  deny=$(grep -nEi "$DENYLIST" "$file" 2>/dev/null)
  local dg=$?
  if [ $dg -eq 2 ]; then return 2; fi
  hits="${hidden}${deny}"
  if [ -n "$hits" ]; then
    echo "$hits"
    return 0
  fi
  return 1
}

# --- 1. 自检:投毒样本必须被检出 ---
if [ -f "$POISONED" ]; then
  if detect_secrets "$POISONED" >/dev/null; then
    : # 正确检出,继续
  else
    echo "✗ 闸门自检失败:投毒样本 $POISONED 未被检出 —— 闸门可能已 no-op(fail-open),拒绝放行。" >&2
    exit 2
  fi
else
  echo "✗ 缺少自检样本 $POISONED,无法确认闸门有效。" >&2
  exit 2
fi

# --- 2. 实扫:所有非点前缀 *.html 必须干净 ---
shopt -s nullglob
status=0
for f in "$FIXTURE_DIR"/*.html; do
  out=$(detect_secrets "$f")
  rc=$?
  if [ $rc -eq 2 ]; then
    echo "✗ 扫描 $f 时出错。" >&2
    exit 2
  elif [ $rc -eq 0 ]; then
    echo "✗ $f 含疑似机密(token/cookie/JWT/长 hex 或带值的隐藏字段):" >&2
    echo "$out" | sed 's/^/    /' >&2
    status=1
  fi
done

if [ $status -eq 0 ]; then
  echo "✓ fixtures 脱敏闸门通过(自检有效 + 无机密命中)。"
fi
exit $status
