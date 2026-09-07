#!/usr/bin/env bash
# Stop: if this session changed shipped code and dist/ no longer reflects it, say so.
#
# The desktop app opens the DEPLOYED site and decides whether to offer "Deploy
# Now" by comparing dist/ against live. So a stale dist/ does not merely delay a
# release — it makes that guard report "up to date" and hide the fact that
# players are behind. Nothing looks broken. This is the hook that breaks the
# silence.
#
# Fires once per batch of changes and clears its own sentinel first, so it can
# never trap the session in a loop.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')"
sentinel="$root/.claude/.ship-guard/$session"

[ -f "$sentinel" ] || exit 0

changed="$(sort -u "$sentinel")"
# Clear before deciding: one prompt per batch of changes, never a repeat.
rm -f "$sentinel"
[ -n "$changed" ] || exit 0

# Is dist/ actually behind? Measured against the build output rather than
# against the session's own history, because a build that already happened
# this session is a perfectly good answer and must not be nagged about.
stale=false
if [ ! -f "$root/dist/index.html" ]; then
  stale=true
  why="There is no local build at all, so the launcher cannot tell what players are on (its check exits 2 and stays quiet)."
else
  newer="$(cd "$root" && find src worker scripts index.html vite.config.ts wrangler.jsonc package.json \
    -newer dist/index.html -type f \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -path 'src/test-utils/*' 2>/dev/null | head -5)"
  if [ -n "$newer" ]; then
    stale=true
    why="These are newer than the last build:
$(printf '%s' "$newer" | sed 's/^/  - /')"
  fi
fi

$stale || exit 0

jq -n --arg why "$why" '{
  decision: "block",
  reason: (
    "The desktop app shows the DEPLOYED build, and its \"Deploy Now\" prompt is driven by comparing dist/ to the live site. dist/ is now stale, so that prompt would report \"up to date\" and silently hide this change from players.\n\n"
    + $why
    + "\n\nUse the ship-check skill (Skill tool, skill \"ship-check\") to rebuild and report where the desktop app actually stands, then finish.\n"
    + "Build, do not deploy — the user releases from the desktop icon. If the rebuild leaves the asset hashes unchanged, say so in one line and stop."
  )
}'
