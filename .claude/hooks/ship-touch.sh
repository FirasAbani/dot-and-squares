#!/usr/bin/env bash
# PostToolUse(Write|Edit): note that a file which reaches the shipped bundle changed.
#
# Cheap and silent, like spec-touch.sh: it only appends a path to a per-session
# sentinel. Whether dist/ is actually stale is decided once, at Stop, by
# ship-guard.sh — measuring the build on every keystroke of a refactor would
# cost a build per edit.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
payload="$(cat)"

file="$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')"
[ -n "$file" ] || exit 0

rel="${file#"$root"/}"

case "$rel" in
  # Tests and test helpers are never bundled, so they cannot change what a
  # player sees. Excluded here rather than discovered after a pointless build.
  *.test.ts|*.test.tsx|src/test-utils/*|src/test-setup.ts) exit 0 ;;
  # Everything that does reach the deployed site.
  src/*|worker/*|scripts/*) ;;
  index.html|vite.config.ts|wrangler.jsonc|package.json) ;;
  *) exit 0 ;;
esac

dir="$root/.claude/.ship-guard"
mkdir -p "$dir"
printf '%s\n' "$rel" >> "$dir/$session"
exit 0
