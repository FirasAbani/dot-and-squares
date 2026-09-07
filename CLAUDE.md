# Dots &amp; Squares

Two-player pass-and-play Dots and Boxes. React + TypeScript + Vite, no backend.

## Running the game

**Use the `launch-game` skill.** Don't rediscover the launch steps — and don't
shell-`&` the dev server in a foreground Bash call, it can stall the tool call
for a full 120s in this harness even though the server itself starts in
~80ms (reproduced this once already). Use two calls instead:

1. If `curl -sf http://localhost:5173` fails, start the server with the Bash
   tool's own `run_in_background: true` on `cd ~/Code/Application && npm run dev`
   — that returns immediately.
2. A normal foreground call to poll the port and `open http://localhost:5173`.

Port **5173**, `--strictPort`. A dev server is often already up from an earlier
session — reuse it rather than killing and relaunching. No `timeout` on macOS.

**Stopping it:** the app's Quit button POSTs to `/__shutdown`, a middleware in
[vite.config.ts](vite.config.ts) that exits the Vite process — so quitting from
the UI actually frees the port. Same from a terminal:
`curl -X POST http://localhost:5173/__shutdown`. POST only; GET falls through
to the app so a prefetch can't kill the game.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm test` | 260 tests: `client` (jsdom) + `worker` (node) projects |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Typecheck (client + worker) + build to `dist/` |
| `npm run dev:worker` | wrangler on :8787 — real Durable Objects, local SQLite |
| `npm run lobby-check` | drives the public lobby against a running `dev:worker` |
| `npm run sim` | five-player scenario: two mid-game, two waiting, one choosing |
| `npm run deploy` | Build and `wrangler deploy` to Cloudflare |
| `npm run check-deployed` | Is the live site the build in `dist/`? (0 yes, 1 behind, 2 unknown) |
| `npm run ship` | `deploy` then `check-deployed` — the safe way to release |

## Layout

- [src/engine/](src/engine/) — pure game rules, no React. Immutable `GameState`,
  `makeMove(state, edgeId)` returns a discriminated result and never mutates.
- [src/components/](src/components/) — setup, board (one responsive SVG), scoreboard, game over.
- [src/App.tsx](src/App.tsx) — screen routing, wires UI to engine.
- [src/styles.css](src/styles.css) — all styling.

Keep rules in the engine and out of components — that split is what would let
the same `makeMove` run on a server for online play.

## Online multiplayer

`worker/` is a Cloudflare Worker plus one Durable Object per room (`ROOM`) and exactly one
lobby (`LOBBY`, at `idFromName('global')`). It imports the game engine from `src/engine/`
directly — never copy the rules. Room rules live in `worker/room-logic.ts` as a pure
`reduceRoom`, lobby rules in `worker/lobby-logic.ts` as a pure `reduceLobby`, both tested
in node.

Two invariants that keep it free and correct:

- **No timers in the Durable Object.** One `setInterval` prevents hibernation and bills
  duration forever. The clock uses a single alarm per turn at the flag deadline.
- **Never assume turns alternate.** Claiming a square grants another turn; read
  `currentPlayer` from what `makeMove` returned.
- **An alarm that renews state must advance `lastActivity`.** `nextAlarmAt` derives from it,
  so renewing without bumping it re-arms in the past — the DO spins, and bills duration like
  the interval rule 1 forbids. A test asserting only the renewal *effect* passes happily
  while this burns; assert the next alarm moved forward.

Three more for the public lobby:

- **Deal only when both players are connected.** A seat is claimed, not released, so "both
  chairs taken" is not "both players here". Dealing on the weaker test gives the first turn
  to someone who has gone, and the other player gets a board they can never move on.
- **The lobby is a cache; the room is the authority.** A listing never grants a seat — a
  stale row is refused by the room itself. That is what lets announcements be advisory.
- **The room registers itself**, through a `{ lobby: … }` effect returned by `reduceRoom`.
  Deciding it in the reducer is what keeps every list/unlist transition testable in node.
  Never register from the Worker or the client: neither learns when a room fills.
- **Effects are dispatched with `if (!('to' in effect)) continue;`** — a positive test.
  The old blacklist form silently broke the moment a third effect variant was added.

For local dev run `npm run dev:worker` and `npm run dev` together — Vite proxies `/api`
to :8787 with `ws: true`. If 8787 is taken by another project, set `WORKER_PORT` on **both**
commands (it drives the wrangler port and the Vite proxy target alike).

## Shipping — the desktop app shows the DEPLOYED build

[scripts/launcher.sh](scripts/launcher.sh) opens
`https://dots-and-squares.dots-and-squares.workers.dev`, deliberately: a locally served
game hands out a `localhost` invite link nobody else can open, so pointing at production
is what makes "send this link" work.

The consequence is the trap that has already bitten once: **building is not shipping.**
`npm run build` changes nothing a player sees, so after any change the desktop app keeps
showing the old game until `npm run deploy` runs. Nothing about the app looks broken.

Two guards now make that visible instead of silent:

- **`npm run check-deployed`** compares the content-hashed asset names in `dist/index.html`
  with the ones the live page serves, and probes `/api/lobby` as a capability check. Vite
  hashes bundles by content, so the asset name *is* the build identity — no version
  stamping to keep in sync. Exit 1 means players are behind.
- **The launcher runs that check on every launch** and, if the site is behind, offers
  "Deploy Now" before opening. Exit code 2 (offline, or no local build) never nags.

**Use `npm run ship`, not `npm run deploy`** — it deploys and then verifies that players
actually got it.

After editing [scripts/launcher.sh](scripts/launcher.sh), copy it into the bundle
(`cp scripts/launcher.sh ~/Desktop/"Dots & Squares.app"/Contents/MacOS/launch`) or rerun
`npm run make-icon`; the app holds its own copy.

## Gotchas

- Vite dev returns `index.html` with **200** for unknown paths, so a `curl`
  status code is not a render check. Use `npm test` to verify rendering.
- No Playwright or `chromium-cli` installed. Ask before adding one.
- Board edge ids are `H-{row}-{col}` / `V-{row}-{col}`; squares `S-{row}-{col}`.
- jsdom has no WebSocket. Use [src/test-utils/fakeSocket.ts](src/test-utils/fakeSocket.ts)
  with `vi.stubGlobal` **per suite** — never in `src/test-setup.ts`, where replacing the
  global would quietly reach every existing test. Its static `OPEN` is load-bearing.
- This project has no `jest-dom`; assertions are plain DOM (`.textContent`, `.disabled`).
- **A refused WebSocket upgrade closes with 1006, not 1001.** 1001 is what the server sends
  when it closes a socket it had already accepted. A test that simulates 1001 for a refused
  join proves nothing — that exact mistake hid a hang where a full room retried forever.
- Durable Object storage survives between `dev:worker` runs, so a room code reused from an
  earlier run answers `room-exists`. `lobby-check` randomises its codes for this reason.
- **Only one `wrangler dev` per checkout — this bites hard.** Two share `.wrangler/state`,
  and a hot-reload then kills the runtime with
  `SQLITE_BUSY: database is locked (SQLITE_BUSY_RECOVERY)`. The failure is confusing because
  the *victim* is usually the instance you just started, while the stale one keeps serving
  pre-change code on 8787. Always `pgrep -fl "wrangler|workerd"` first, and
  `pkill -f "wrangler dev"; pkill -f "workerd serve"` to clear the decks.

## Rebuilding from scratch

[SPEC.md](SPEC.md) is the full build specification — rules, architecture, protocol,
design language, invariants and the traps behind them. If asked to **rebuild Dots and
Squares**, or to reproduce this project elsewhere, read that first and follow its build
order; it is written to be sufficient on its own.

**SPEC.md is kept current automatically.** A `PostToolUse` hook notes every edit to
`src/`, `worker/`, `scripts/` or the config files the spec pins; a `Stop` hook then
asks for the spec to be reconciled if those changed and SPEC.md did not, by way of the
[spec-keeper](.claude/agents/spec-keeper.md) agent. Both live in
[.claude/hooks/](.claude/hooks/) and are wired up in
[.claude/settings.json](.claude/settings.json). It fires at most once per batch of
changes, and "this change is invisible to the spec" is an accepted answer — do not pad
the document to satisfy it.

More detail: [LAUNCH.md](LAUNCH.md) for running, [README.md](README.md) for architecture.
