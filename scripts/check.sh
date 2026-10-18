#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
for executable in uv node npm; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Required executable missing: %s. See docs/operations/LOCAL.md.\n' "$executable" >&2
    exit 127
  fi
done
export ASTANA_MODE=fixture
export LLM_PROVIDER=none
uv sync --locked --all-packages
uv run --locked pytest
uv run --locked python scripts/smoke.py --self-test
uv run --locked python verify_contracts.py
uv run --locked python scripts/generate_contracts.py --check
uv run --locked ruff check --select E9,F .
npm ci --prefix .github/typescript --ignore-scripts --no-audit --no-fund
npm run --prefix .github/typescript check
node --check services/api/src/astana_api/static/sandbox.js
