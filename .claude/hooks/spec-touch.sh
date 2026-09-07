#!/usr/bin/env bash
# PostToolUse(Write|Edit): note that a file which SPEC.md describes was changed.
#
# Cheap and silent by design — it only appends a path to a per-session sentinel.
# The decision about whether SPEC.md actually needs an edit is made once, at
# Stop, by spec-guard.sh. Doing it here would mean waking a judge on every
# keystroke of a refactor.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
payload="$(cat)"

file="$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')"
[ -n "$file" ] || exit 0

# Relative to the repo, so the patterns below read like the repo layout.
rel="${file#"$root"/}"

case "$rel" in
  # The spec itself, and the docs that quote it, are the output — not a trigger.
  SPEC.md|README.md|CLAUDE.md|LAUNCH.md) exit 0 ;;
  # Source of truth for the behaviour SPEC.md claims. Tests count: they are the
  # verification section, and a new describe block is a spec-visible change.
  src/*|worker/*|scripts/*) ;;
  # Config that the spec pins by name (ports, migrations, asset routing).
  vite.config.ts|wrangler.jsonc|package.json|index.html) ;;
  *) exit 0 ;;
esac

dir="$root/.claude/.spec-guard"
mkdir -p "$dir"
printf '%s\n' "$rel" >> "$dir/$session"

# Snapshot SPEC.md as it stood at the FIRST change of this batch. At Stop the
# guard compares hashes: different means the spec was reconciled since, and it
# stays quiet. A content hash rather than an mtime, because an edit and a stop
# can land in the same second and `-nt` would call that "not newer".
[ -f "$dir/$session.spec" ] || shasum -a 256 "$root/SPEC.md" 2>/dev/null | cut -d" " -f1 > "$dir/$session.spec"
exit 0
