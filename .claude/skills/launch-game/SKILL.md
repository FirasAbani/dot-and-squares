---
name: launch-game
description: Launch and drive the Dots & Squares game (React + TypeScript + Vite dev server on port 5173). Use whenever asked to run, start, launch, open, play, or screenshot the game/app, or to confirm a change works in the real browser.
---

# Launch Dots & Squares

Vite dev server, fixed port **5173**, opened in the user's real browser on macOS.

## Launch it — two Bash tool calls, not one

**Do not shell-`&` `npm run dev` inside a normal (foreground) Bash call.**
Tried that; it is flaky in this harness — a Vite/esbuild descendant process
can hold the tool's output pipe open even after the script itself has
finished, so the *tool call* stalls for the full 120s timeout before being
force-backgrounded, even though the *server* came up in under 100ms. Confirmed
by testing: one run returned in 0.24s, the very next run of the identical
script hung the full 120s. Don't trust that pattern again.

The reliable form uses the Bash tool's own backgrounding, which detaches at
the harness level instead of the shell level:

**Call 1 — only if nothing is listening yet** (`curl -sf http://localhost:5173`
first to check), start the server with the Bash tool's `run_in_background: true`:

```bash
cd ~/Code/Application && npm run dev
```

This call returns immediately; the harness streams its output to a task file
and notifies on completion (which for a dev server means "it crashed" — a
clean launch never completes).

**Call 2 — a normal foreground call**, poll the port and open the browser:

```bash
i=0
until curl -sf http://localhost:5173 >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 100 ] && { echo "timed out"; break; }
  sleep 0.2
done
open http://localhost:5173 && echo "game up at http://localhost:5173"
```

Measured end-to-end: ~7s wall clock (mostly tool round-trip overhead, not
Vite — Vite itself reports ready in ~80ms), zero-hang, reproducible over
multiple cold-start trials. If a server is already listening, skip call 1
entirely and call 2 alone resolves in well under a second.

Do **not** use `timeout ...` in the wait loop: macOS has no `timeout` (it's
`gtimeout` from coreutils, not installed here) — the counted `until` loop
above is the portable form. Hit this once already; don't reintroduce it.

Report the URL and stop. The user is on a Mac with a display — they see the
game themselves, so a screenshot is not required to prove it launched.

## Facts you do not need to rediscover

- Port is **5173** and `--strictPort` is set: it never falls back to 5174.
- `npm run dev` = `vite`. Node lives at `/opt/homebrew/bin/node` (Homebrew).
- A server may already be running from an earlier session — that is the common
  case, and the command above handles it. Don't kill and relaunch to feel sure.
- Pass-and-play, two players, one device. No auth, no backend, no seed data.
  It opens straight onto the player-setup screen. Nothing to log into.

## Stopping it

The app has a **Quit** button (header, setup screen, and the game-over
overlay). It POSTs to `/__shutdown`, a middleware in `vite.config.ts` that
exits the Vite process — so quitting from the UI genuinely frees port 5173,
and nothing runs again until someone relaunches. That is the intended way for
the players to stop the game.

From a terminal, the same thing: `curl -X POST http://localhost:5173/__shutdown`.
Only POST stops it; a GET falls through to the app, so a prefetch can't kill
the game.

## Only if something is wrong

| Symptom | Fix |
| --- | --- |
| Port held by a stale server | `lsof -ti:5173 \| xargs kill` |
| `command not found: node` | `export PATH="/opt/homebrew/bin:$PATH"` |
| Blank page after a pull | `rm -rf node_modules/.vite && npm install` |
| Fresh clone / no `node_modules` | `npm install`; if it warns about blocked scripts, `npm install-scripts approve esbuild` |

Vite's output is in `/tmp/dots-vite.log` when launched by the command above.

## Driving it in a browser (only when asked to verify a UI change)

`chromium-cli` and Playwright are **not** installed here, and Vite's dev server
returns `index.html` with **200** for unknown paths — so `curl`-ing module URLs
proves nothing. Don't use status codes as a render check.

To actually verify rendering without a browser driver, run the jsdom suite,
which mounts the real components and drives them:

```bash
cd ~/Code/Application && npm test
```

28 tests — engine rules in `src/engine/engine.test.ts`, UI in `src/App.test.tsx`.
For a real-browser pass, ask the user to look, or ask before installing Playwright.

## Phone / LAN

```bash
npm run dev -- --host
```

Read the **Network** URL Vite prints; the IP changes between networks.

Fuller prose in [LAUNCH.md](../../../LAUNCH.md); architecture in [README.md](../../../README.md).
