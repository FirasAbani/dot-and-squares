#!/bin/bash
# Desktop launcher for Dots & Squares.
#
# Opens the deployed game. It deliberately does NOT start a local server: the
# share link a player sends is built from the page's own origin, so a
# locally-served game hands out a localhost URL that nobody else can open.
# Pointing straight at the deployed site is what makes "send this link to the
# other player" actually work.

LIVE="https://dots-and-squares.dots-and-squares.workers.dev"
PROJECT="$HOME/Code/Application"
PORT=8787

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

reachable() { curl -sf -o /dev/null --max-time 6 "$LIVE" 2>/dev/null; }

if reachable; then
  open "$LIVE"
  exit 0
fi

# Offline. Offer a local game rather than silently handing out a localhost
# link that looks like it should work — that is the exact trap this avoids.
CHOICE=$(osascript \
  -e 'display dialog "Cannot reach the online game — you appear to be offline.\n\nA local game will still work on this Mac, but the invite link it produces only works here, so you cannot play someone else." buttons {"Cancel", "Play Offline"} default button "Cancel" with title "Dots & Squares"' \
  -e 'button returned of result' 2>/dev/null)

[ "$CHOICE" = "Play Offline" ] || exit 0

cd "$PROJECT" || exit 1
command -v node >/dev/null 2>&1 || {
  osascript -e 'display dialog "Node.js was not found, so the offline game cannot start." buttons {"OK"} with icon stop with title "Dots & Squares"' >/dev/null 2>&1
  exit 1
}

curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT" 2>/dev/null || {
  [ -f dist/index.html ] || npx vite build >>/tmp/dots-and-squares.log 2>&1
  nohup npx wrangler dev --port $PORT >>/tmp/dots-and-squares.log 2>&1 &
  disown 2>/dev/null
  for _ in $(seq 1 200); do
    curl -sf -o /dev/null "http://localhost:$PORT" 2>/dev/null && break
    sleep 0.25
  done
}

open "http://localhost:$PORT"
