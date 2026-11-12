#!/usr/bin/env bash
# Облачная сессия Claude Code стартует со свежим клоном: ставим зависимости,
# чтобы pnpm test / typecheck / dev работали сразу. Локально ничего не делаем.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-.}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
command -v pnpm >/dev/null || corepack enable
pnpm install --frozen-lockfile --reporter=silent
