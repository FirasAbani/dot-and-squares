# Dots &amp; Squares

A two-player Dots and Boxes game, playable on one device or online over a shared link.
Players alternate joining neighbouring dots; closing the fourth side of a box claims it,
scores a point, and earns another turn. The board is adjustable from 2 × 2 up to 10 × 10
dots, with an optional blitz clock.

### The clock scales with the board

You pick a *speed*, not a minute count, because this board is not chess: a 10 × 10 grid is
180 moves against chess's ~40, and the move count changes with the board size you choose.
A fixed "3+2" means 17 seconds per move on a 4 × 4 and 4 seconds on a 10 × 10 — a 4×
swing for the same label. `timeControlFor(gridSize, speed)` sizes the clock from the moves
the board actually has, so Blitz feels like Blitz at any size:

| Board | Bullet | Blitz | Rapid |
| --- | --- | --- | --- |
| 4 × 4 | 0:20 + 1s | 0:25 + 2s | 0:50 + 5s |
| 6 × 6 | 0:45 + 1s | 1:00 + 2s | 2:00 + 5s |
| 10 × 10 | 2:15 + 1s | 3:00 + 2s | 6:00 + 5s |

Blitz on the default board lands on exactly 3:00 + 2s — the familiar chess 3+2.

Every timed speed carries a **Fischer increment**: seconds credited when you complete a
move, charged after the turn is deducted, so moving faster than the increment banks time.
Without one, a 180-move game flags in the endgame — precisely where the long claiming
chains need thinking time. Casual is untimed.

The interface is **Bold Utility** — near-black ground, flat square-cornered surfaces,
heavy Archivo type, uppercase tracked labels, and oversized tabular scores. There is one
filled control per screen and it is white; everything else is an outline. The active
player's card inverts to white rather than being tinted, so whose turn it is survives
being read at arm's length.

Built with React + TypeScript + Vite. The game rules live in a framework-free
TypeScript engine that the UI merely renders.

## Setup and run

Requires Node.js 20 or newer.

```bash
npm install     # install dependencies
npm run dev     # start the dev server at http://localhost:5173
npm test        # run the engine + UI test suites
npm run build   # typecheck and produce a production build in dist/
npm run preview # serve the production build locally
```

If `npm install` warns about blocked install scripts, run `npm install-scripts approve esbuild`
(esbuild needs its postinstall step to place its platform binary).

## Project structure

```
src/
├── engine/               # Pure game rules — no React, no DOM
│   ├── types.ts          # Player, Edge, Square, GameState, MoveResult
│   ├── board.ts          # Grid construction and coordinate maths
│   ├── engine.ts         # Game creation, move application, scoring, winner
│   ├── index.ts          # Public engine API
│   └── engine.test.ts    # 21 rule tests
├── components/
│   ├── PlayerSetup.tsx   # Screen 1 — usernames and initials
│   ├── Scoreboard.tsx    # Player cards, scores, turn indicator
│   ├── GameBoard.tsx     # Screen 2 — responsive SVG board
│   ├── GameOverScreen.tsx# Screen 3 — result, Play Again / New Game / Quit
│   ├── QuitScreen.tsx    # Farewell screen shown once the server is down
│   └── theme.ts          # Per-player colour tokens
├── shutdown.ts           # Asks the dev server to stop itself
├── App.tsx               # Screen routing and engine wiring
├── App.test.tsx          # 25 UI tests driving the real components
├── net/                  # room codes and the WebSocket session hook
├── shared/protocol.ts    # message types, shared with the worker
└── styles.css            # Responsive styling
```

## How the game engine works

The engine is a set of pure functions over an immutable `GameState`. It knows nothing
about React, the DOM, or how the board is drawn — the UI's only job is to render state
and forward the id of the edge a player picked.

### The board

A 10 × 10 grid of dots produces:

| Element | Count | Addressing |
| --- | --- | --- |
| Dots | 100 | `row`, `column` in `0..9` |
| Horizontal edges | 90 | `H-{row}-{column}`, joins `(row, column)` to `(row, column+1)` |
| Vertical edges | 90 | `V-{row}-{column}`, joins `(row, column)` to `(row+1, column)` |
| Squares | 81 | `S-{row}-{column}`, the box whose top-left dot is `(row, column)` |

Every square is bounded by exactly four edges, derived arithmetically rather than stored:

```
S-r-c  →  H-r-c (top), H-(r+1)-c (bottom), V-r-c (left), V-r-(c+1) (right)
```

The same maths runs in reverse: `squareIdsTouchingEdge` returns the (at most two) squares
an edge can complete, so a move only ever inspects two candidate squares instead of all 81.

### Making a move

`makeMove(state, edgeId)` returns a discriminated result — either
`{ ok: true, state, claimedSquares, extraTurn }` or `{ ok: false, state, reason }` — and
never mutates the state it was given. It applies the rules in order:

1. **Validate.** Reject if the game is finished (`game-over`), the edge id is unknown
   (`unknown-edge`), or the edge is already claimed (`edge-taken`).
2. **Claim the edge** for `state.currentPlayer`.
3. **Detect squares.** For each of the ≤ 2 squares touching that edge, check whether all
   four bounding edges are now owned. Newly closed squares are assigned to the mover.
4. **Score.** Increment the mover's `squares` by the number of boxes just closed.
5. **Turn.** If at least one square was closed the mover goes again; otherwise the turn
   passes. Closing two boxes with one line awards both and still grants the extra turn.
6. **Completion.** When no unclaimed edge remains, `status` becomes `finished` and
   `winner` is set to a player id, or `'draw'` on equal scores.

`makeMoveBetweenDots(state, dotA, dotB)` is a thin wrapper for input expressed as two dots.
It maps the pair onto an edge via `edgeIdBetweenDots`, which returns `null` — and therefore
a `not-adjacent` rejection — for identical, diagonal, out-of-bounds, or distant dots.

### Why the split matters

Because the engine is pure and serialisable, the same `makeMove` call can later run on a
server or on a peer's machine with an identical result. Adding online play means replacing
the local `setState` in [App.tsx](src/App.tsx) with a transport that ships an edge id and
receives the next `GameState` — no rule code changes.

## UI notes

The interface follows the twenty practices captured in the
[`gui-design` skill](.claude/skills/gui-design/SKILL.md) — Nielsen's heuristics, the UX
laws, and the WCAG 2.2 floors.

- The board is a single responsive `<svg>` with a square `viewBox`, so it scales from a
  narrow phone to a desktop window without redrawing logic.
- Each unclaimed edge is drawn as a thin 3px line but carries an invisible 30-unit hit
  line on top, making touch targets roughly 10× the visible stroke.
- **A click is resolved to the nearest line, not to whichever shape the browser hit.**
  Hit rectangles necessarily overlap: a round cap spilled 15 units past each end, so
  neighbouring lines shared a 30-unit band around every dot and SVG awarded the click to
  whichever was painted last — verticals, since they render after horizontals. Players
  aimed at one line and claimed another. `distanceToEdge` now picks the closest unclaimed
  line within `SELECT_RADIUS`, and hover previews the same line a click would take, so
  what lights up is what you get. `npm run aim-check` clicks exact pixel offsets near dots
  and asserts the intended line is claimed.
- Hover previews are suppressed for touch pointers so phones don't get a stuck highlight.
- The active player's card inverts to white on black. Inactive cards mute their own text
  rather than the card being dimmed with `opacity`, which used to drop the muted name text
  below the 4.5:1 contrast minimum.
- Each card carries a 4px accent bar in the player's colour. On the inverted active card
  it switches to the darker variant (`theme.soft`) so it still clears 3:1 against white.
- Claimed squares are filled in the owner's colour and stamped with their initials.

### Colour is never the only signal

Players are blue and amber rather than blue and red, and **claimed lines also differ in
stroke pattern** — player one solid, player two dashed. A claimed line carries no text to
fall back on, so without the second channel the board would be unreadable to a
colour-blind player. Every foreground/background pair in
[theme.ts](src/components/theme.ts) and [styles.css](src/styles.css) was measured: body
text ≥4.5:1, lines, focus rings and UI boundaries ≥3:1.

Two things the dark ground changed. The focus ring is **white**, not near-black — the
light-theme ring would have been invisible. And the claimed-square fills are translucent,
so their initials were checked against the *composited* colour (`#25344c` and `#49391b`)
rather than against the flat board.

### Keyboard play

The board is a single tab stop. Focus it and the arrow keys move a dashed cursor between
lines, with Enter or Space to claim the one under it. Movement is geometric — it picks
the nearest line midpoint in the direction pressed — so the cursor crosses between
horizontal and vertical lines with no orientation mode to keep track of. A visually
hidden live region announces the cursor's position and whether the line is open.

This replaces the earlier pointer-only board without introducing 180 tab stops.

### Motion

All transitions run off three custom properties, and `prefers-reduced-motion: reduce`
collapses them to 1ms in one place rather than per-component.

## Playing the computer

A third mode beside Pass & Play and Play Online, with Easy / Medium / Hard.
[src/ai/bot.ts](src/ai/bot.ts) is pure and node-testable like the engine it sits on — no
React, no DOM, and `rand` is injected rather than calling `Math.random`, so a seeded test
replays the same game every time.

- **Easy** plays any legal edge.
- **Medium** takes any box that is one side from complete (preferring a double), then any
  *safe* edge — one that leaves no square on three sides.
- **Hard** adds the endgame: when every move is a sacrifice it opens the **smallest**
  chain, walking the cascade with `sacrificeCost` to find the cheapest give-away.

Hard wins 6+ of 8 games against Easy in the test suite.

Two things the wiring has to get right, both of which look fine until they are not:

- **The bot effect is keyed on the number of drawn edges, not on `currentPlayer`.**
  Claiming a box grants another turn and leaves `currentPlayer` unchanged, so a
  currentPlayer-keyed effect stalls the bot exactly mid-cascade.
- **The bot is charged for its own thinking time**, because `chargeClock` bills wall
  clock. The delay is capped at `min(450ms, remaining / 20)` so it cannot flag itself on a
  short clock.

## Chains

A single move claims at most two boxes, so a long cascade is a *run* of moves by one
player across their extra turns. Nothing accumulated that before: `lastClaimedSquares` is
overwritten every move and claiming eight boxes looked exactly like claiming one.

The run is tracked in [App.tsx](src/App.tsx) from whole `GameState`s rather than from
`MoveResult`, because the online client only ever receives states — so one implementation
covers both modes with no protocol change. A move that claims nothing, or the turn
changing hands, ends the run.

It surfaces three ways: squares scale in staggered by their position in the run, a
`Chain ×n` badge appears at three or more, and the turn banner says "goes again" so the
build-up reads as one sequence. Each claimed box also sounds a semitone higher than the
last, so a cascade is audibly a crescendo — see `playClaimSquare` in
[src/sound.ts](src/sound.ts).

## Online multiplayer

Two people on different devices, over a shareable link. Deployed to Cloudflare
Workers with one Durable Object per game room.

```bash
npm run dev:worker   # wrangler on :8787 — a real Durable Object, local SQLite
npm run dev          # vite on :5173 with HMR, proxying /api to the worker
npm run deploy       # typecheck, build, and wrangler deploy
```

Player one picks **Play Online**, chooses the board and clock, and gets a six-character
code plus a copyable link. Player two opens the link, enters a name, and the game deals
itself.

### The engine runs on the server, unchanged

`worker/GameRoom.ts` imports `makeMove` from [src/engine/](src/engine/) directly — no
copy, no duplicated rules. The engine is pure, dependency-free and JSON-serialisable, so
it runs in a V8 isolate as-is. The room's own rules live in
[worker/room-logic.ts](worker/room-logic.ts) as a pure `reduceRoom` function, tested in
plain node with no Workers runtime.

The Durable Object validates that the sender owns `state.currentPlayer` before applying
anything, so a client can never move out of turn. Every move carries the sequence number
the client last saw; a stale one is refused, which is what stops a laggy double-tap from
consuming two edges.

**Never assume the turn alternates.** Claiming a square grants another turn, so the next
player is whatever `makeMove` returned — chains of claims are common in the endgame and
an alternation assumption desyncs badly.

### Why it costs nothing

The Workers free plan allows 100,000 requests/day, and inbound WebSocket messages bill
20:1 in your favour — Cloudflare's docs put it as "100 incoming messages count as 5
requests". A full 180-move game is roughly 9 billed requests, so the ceiling is thousands
of games a day, not dozens.

Duration is the real constraint, and hibernation is what protects it. Two invariants in
[worker/GameRoom.ts](worker/GameRoom.ts):

- **No timers, intervals or long-lived promises in the object.** One stray `setInterval`
  turns an abandoned room into a permanently-billed one.
- **No important state in instance fields.** The object is evicted between messages, so
  per-socket state rides in `serializeAttachment` and room state in SQLite storage.

The clock obeys the same rule: it is stored as a balance plus a start timestamp, and the
object sets exactly **one alarm per turn** at the flag deadline. Idle rooms are reaped by
that same alarm after 24h.

### Reconnecting

A per-browser token in `localStorage`, keyed by room code, is what reclaims a seat. A
refresh mid-game rejoins the same match; a disconnected player's seat is held, not freed,
so nobody can take their chair while they are away.

## Ending a game early

Online, **Forfeit** ends the match immediately: the player who quits loses whatever the
score says, and gets a full-screen `LOOOOOSER!!`. **Offer Draw** asks the opponent, and
ties the game only once they accept — either player can decline and play on.

Running out of time works the same way: the loser is whoever's clock hit zero, regardless
of score. Because the winner cannot be derived from the score in any of these cases,
`GameState` carries an explicit `ending` (`board-complete` / `resignation` /
`agreed-draw` / `timeout`) and `endedBy`, and `calculateWinner` only score-compares for
`board-complete`.

The clock is stored as a balance plus a turn-start timestamp, never a ticking counter —
which is what lets the server stay authoritative without running a timer.

## Quitting the dev server

The **Quit** button ends the session properly rather than just closing a tab. It is on
the header, the setup screen, and the game-over screen, and it always confirms first —
mid-match it warns that the game in progress will be lost, since nothing is persisted.

A page cannot stop the server it is talking to, so the confirmation POSTs to
`/__shutdown`, a middleware registered by a small plugin in
[vite.config.ts](vite.config.ts) that flushes the response and then exits the Vite
process. Port 5173 is freed and stays free until someone runs `npm run dev` again — the
farewell screen shows that command, because by then there is no server left to serve a
retry.

Two deliberate constraints:

- **POST only.** A `GET /__shutdown` falls through to the app, so a link preview or
  prefetch cannot take the game down.
- **Dev and preview only.** The route is installed by `configureServer` and
  `configurePreviewServer`, neither of which runs during `vite build`, so it cannot reach
  a production bundle. If the built `dist/` is served by a static host the button still
  closes the interface, and the farewell screen says nothing was shut down.

`window.close()` is attempted but usually refused — browsers only allow it for
script-opened windows — so the farewell screen is written to stand on its own.

## Testing

`npm test` runs 93 tests in three projects (`client` in jsdom, `worker` in node).

**Engine ([src/engine/engine.test.ts](src/engine/engine.test.ts))** — board contains 100 dots,
180 edges and 81 squares; horizontal and vertical moves work in either dot order; diagonal,
non-adjacent, out-of-bounds, unknown and duplicate moves are rejected; completing a square
awards it and grants another turn; one line closing two squares awards both; ordinary moves
switch turns; the final edge ends the game; winner and draw are calculated correctly; state
is never mutated in place.

**UI ([src/App.test.tsx](src/App.test.tsx))** — Start Game stays disabled until both players
are valid; initials uppercase as typed; a started match renders all 180 clickable edges;
clicking claims a line, switches turns, fills a square with the owner's initials and updates
the scoreboard; claimed lines stop responding; playing all 180 lines shows the winner dialog
with 81 filled squares; Play Again resets the board; New Game returns to setup.

The quit tests cover the parts that are easy to get wrong: cancelling never contacts the
server, confirming POSTs to `/__shutdown` and shows the farewell screen, the mid-match
warning appears, Quit is reachable from the game-over overlay (which covers the header),
a non-OK response reports that nothing was stopped, and a dropped connection counts as a
successful shutdown rather than an error — Vite often kills the socket as it exits.

## Limitations and possible V2 work

Known limitations:

- **Not verified in a real browser.** The UI is covered by jsdom tests, but no manual
  desktop or physical-device pass has been done — layout at unusual viewport sizes and real
  touch behaviour should be spot-checked before shipping.
- **Two tabs in one browser** share a room token per code, so the same person opening two
  tabs will contend for one seat.
- **Keyboard focus is not trapped in modals.** Escape closes the quit confirmation and the
  safe button takes focus, but focus can still tab out of an open dialog to the content
  behind it.
- **No persistence in local pass-and-play.** Refreshing discards a local match. Online
  matches are persisted in the room's Durable Object and survive a refresh.
- **No undo, move history, or replay.**
- **Anyone with the link can take the open seat.** Codes are ~9e8 combinations, which is
  fine for a private game, but there are no accounts.

Recommended V2 features:

1. **Single-player opponent** — a bot built on the existing pure engine, from random legal
   moves up to chain-aware play.
2. **Undo / move history**, cheap to add given immutable states — keep the array.
3. **Sound and haptics**, and a focus trap for the modals.
4. **Delta move broadcasts** instead of full state, to cut Durable Object CPU.
