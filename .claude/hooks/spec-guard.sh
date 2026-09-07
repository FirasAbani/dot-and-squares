#!/usr/bin/env bash
# Stop: if this session changed game code but left SPEC.md alone, say so.
#
# Fires once per stop and clears its own sentinel first, so it can never trap
# the session in a loop — if the answer is genuinely "the spec still holds",
# saying that once is enough and the next Stop is clean.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')"
sentinel="$root/.claude/.spec-guard/$session"

[ -f "$sentinel" ] || exit 0

changed="$(sort -u "$sentinel")"

# Already reconciled? Compare SPEC.md against the snapshot taken when this batch
# of changes began. Deliberately not a `git diff` check: SPEC.md may be
# untracked, and then git reports nothing to compare and the guard fires forever.
before="$(cat "$sentinel.spec" 2>/dev/null)"
after="$(shasum -a 256 "$root/SPEC.md" 2>/dev/null | cut -d" " -f1)"
reconciled=false
[ -n "$before" ] && [ "$before" != "$after" ] && reconciled=true

# Clear before deciding: one prompt per batch of changes, never a repeat.
rm -f "$sentinel" "$sentinel.spec"
[ -n "$changed" ] || exit 0
$reconciled && exit 0

files="$(printf '%s' "$changed" | head -20 | sed 's/^/  - /')"

jq -n --arg files "$files" '{
  decision: "block",
  reason: (
    "SPEC.md is the rebuild contract for this project and these files changed without it:\n"
    + $files
    + "\n\nUse the spec-keeper agent (Agent tool, subagent_type \"spec-keeper\") to reconcile SPEC.md with what the code now does, then finish.\n"
    + "If the change is genuinely invisible to the spec — a refactor, a typo, an internal rename that no section names — say so in one line and stop. Do not pad the spec to justify an edit."
  )
}'
