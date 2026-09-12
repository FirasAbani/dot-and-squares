# Dots & Squares — Build Specification

A complete, implementation-independent description of this project. The intent is that
handing this document to a competent engineer (or to Claude, with the prompt *"rebuild
Dots and Squares"*) reproduces the same product: same rules, same architecture, same
guarantees, same feel.

Read this as **requirements plus the reasoning behind them**. Where a decision has a
non-obvious justification, that justification is part of the spec — it is what stops a
rebuild from "simplifying" its way back into a bug that was already fixed once. Sections
marked **INVARIANT** must not be traded away.

---

## 1. The product in one paragraph

Two players take turns drawing a single line between two adjacent dots on a square grid.
Closing the fourth side of a box claims it, scores a point, and **earns another turn**.
When every line is drawn, the higher score wins. It plays three ways — two people on one
device, two people over a shared link, or one person against a computer opponent — with
an optional chess-style clock, on a board from 3×3 to 10×10 dots.

---

## 2. Scope

### In scope
- Pass-and-play on one device
- Online play for two, over a 6-character room code / shareable link
- A live public lobby: stage a game, and everyone browsing sees it appear at once
- Single-player against a bot at three difficulties
- A blitz clock with a Fischer increment, sized from the board
- Resignation, draw offers, timeout losses, rematches, and a head-to-head series tally
- Full keyboard play, screen-reader support, WCAG 2.2 AA colour and focus
- Synthesised sound (no audio files), mutable
- Deployment as a single Cloudflare Worker serving both the app and the multiplayer

### Explicitly out of scope
- Accounts, logins, persistence of players across devices, matchmaking, chat
- Ranking, skill-matching or filtering in the lobby — it is one flat list, newest first
- Push or OS-level notifications; "global notification" means the live list, nothing more
- More than two players; non-square boards; game variants
- Any backend beyond the one Worker + Durable Object
- Any paid infrastructure — the whole thing must run inside free tiers

---

## 3. Technology

| Layer | Choice | Why this and not something else |
| --- | --- | --- |
| UI | React 18 + TypeScript | Ubiquitous; the rules live outside it, so it is replaceable |
| Build | Vite 6 | Sub-100ms dev start, which the launch flow depends on |
| Tests | Vitest 3, two projects | Client needs jsdom, worker logic is pure node; they cannot share one environment |
| Browser tests | Playwright | Only for the two verification scripts, not for unit tests |
| Server | Cloudflare Workers + Durable Objects (SQLite) | One stateful object per room, free tier, no server to operate |
| Board rendering | One inline SVG | Resolution-independent, scriptable hit-testing, no canvas state to sync |
| Styling | One hand-written CSS file with custom properties | No framework; the design system is ~30 tokens |

Node.js 20+. No CSS framework, no state library, no animation library, no audio files.

---

## 4. Rules of play (the engine contract)

### 4.1 Board geometry

A board of `gridSize` dots per side (`3 ≤ gridSize ≤ 10`, default 10) contains:

- **Dots:** `gridSize²`
- **Horizontal edges:** `H-{row}-{col}` for `row ∈ [0, gridSize)`, `col ∈ [0, gridSize-1)`
- **Vertical edges:** `V-{row}-{col}` for `row ∈ [0, gridSize-1)`, `col ∈ [0, gridSize)`
- **Squares:** `S-{row}-{col}` for `row, col ∈ [0, gridSize-1)`
- **Total edges (= total moves):** `2 · n · (n-1)` — 180 on a 10×10

The square at `(r, c)` is bounded by exactly `H-r-c`, `H-(r+1)-c`, `V-r-c`, `V-r-(c+1)`.
An edge touches at most two squares.

**3×3 is the floor.** A 2×2 grid is one single square and there is no game in it — the
option was removed deliberately, not overlooked.

### 4.2 Moves

`makeMove(state, edgeId, now?)` returns a **discriminated result** and never mutates:

```ts
| { ok: true;  state; claimedSquares: string[]; extraTurn: boolean }
| { ok: false; state; reason: 'game-over'|'unknown-edge'|'edge-taken'|'not-adjacent' }
```

Applying a move, in order:
1. Reject if the game is finished, the edge is unknown, or the edge is already owned.
2. If a clock is running and the flag has already fallen, **the clock wins** — return a
   finished, flagged state rather than the move.
3. Assign the edge to the current player.
4. For each of the (≤2) squares the edge touches: if all four sides are now owned and the
   square is unclaimed, award it to the mover.
5. If any square was claimed, the mover **keeps the turn**; otherwise it passes.
6. If every edge is owned, the game is finished with ending `board-complete`.

**INVARIANT — turns do not alternate.** Claiming a square grants another turn, so a
single player can run a chain of many consecutive moves. Nothing anywhere — UI, bot,
server, tests — may infer whose turn it is by flipping the previous player. Always read
`currentPlayer` from the state `makeMove` returned. This is the single most frequently
reintroduced bug in this codebase.

A single move can claim **at most 2** squares. Long chains are therefore a *run of moves*,
not one move; anything presenting "the chain" must accumulate across the run.

### 4.3 Endings

`ending: 'board-complete' | 'resignation' | 'agreed-draw' | 'timeout'`, plus `endedBy`
naming the player who resigned or flagged.

**INVARIANT — the winner is not always the higher score.** A resignation or a timeout
loses *even when that player is ahead*. Winner-by-score is computed only for
`board-complete`; every other ending sets its winner explicitly and must never be
recomputed from the score.

### 4.4 The clock

Stored as **balances plus a start timestamp**, never as a ticking counter:

```ts
{ initialMs, incrementMs, remainingMs: {p1, p2}, turnStartedAt: number | null }
```

- `remainingMsFor(state, player, now)` — display only, counts down the running turn.
- `hasFlagged(state, now)` — the only authority on whether time has run out.
- On completing a move: **charge the elapsed turn first, then credit the increment**, so a
  player who moves faster than the increment banks time. That ordering is the point of a
  Fischer clock; reversing it makes the increment free.
- The clock restarts on an extra turn too — the mover's own time keeps running, as in chess.

**Speeds, not fixed minute counts.** This board is not chess: a 10×10 is 180 moves against
chess's ~40, and the move count changes with the board size the player picks. A fixed
"3+2" is 17s per move on a 4×4 and 4s on a 10×10 — a 4× swing under one label. So the
clock is derived:

```
movesPerPlayer = edgeCount(gridSize) / 2
seconds        = movesPerPlayer × speed.baseSecondsPerMove
total          = max(15, round(seconds / 5) × 5)     // tidy 5s steps, playable floor
```

| Speed | sec/move | increment |
| --- | --- | --- |
| Casual | — (untimed) | — |
| Bullet | 1.5 | +1s |
| Blitz | 2 | +2s |
| Rapid | 4 | +5s |

Blitz on the default 10×10 lands on exactly **3:00 + 2s**, the familiar chess 3+2. Every
timed speed carries an increment: without one you flag in the endgame, which is precisely
where the long chains need thinking time. The computed control is always shown to the
player as e.g. `3:00 + 2s`, never left as a mystery.

### 4.5 Engine purity — **INVARIANT**

The engine must contain **no React, no DOM, no `Math.random`, no `Date.now()`, no I/O**.
`now` is passed in. State is plain JSON-serialisable data. Every function returns new
objects and mutates nothing.

This is not stylistic. It is what lets the *same* `makeMove` run on the server as the
authority for online play. The server imports the engine directly — **the rules are never
copied, ported, or reimplemented.** A rebuild that duplicates rules on both sides has
failed this spec even if it plays correctly today.

---

## 5. The computer opponent

A separate pure module over the engine — same purity rules, with `rand: () => number`
injected so a seeded test replays identically.

`chooseMove(state, difficulty, rand): string | null`

Derived helpers (the engine has no notion of safety; it belongs here):
- `isSafe(edge)` — after playing it, no square sits on exactly three sides.
- `sacrificeCost(edge)` — how many boxes cascade to the opponent if you open here, by
  walking the resulting chain.

| Difficulty | Behaviour |
| --- | --- |
| Easy | Any legal edge at random |
| Medium | Take a free box (preferring a double); else any safe edge; else anything |
| Hard | As Medium, but when every move is a sacrifice, open the **cheapest** chain |

Hard is strong but not a solver, and that is accepted. If it needs to be stronger, the
investment is the double-cross (declining the last two boxes of a chain to keep control),
not the easier tiers.

Three traps, all of which were hit during the original build:

1. **Do not key the bot's turn on `currentPlayer`.** An extra turn leaves it unchanged, so
   the bot would stop mid-chain — exactly when it should continue. Key on the count of
   remaining edges.
2. **The bot is charged for its own think time**, because the clock bills wall-clock. Cap
   its delay: `min(450ms, remaining / 20)`, or it flags itself on a short clock.
3. **Disable the board on the bot's turn.** "Is it my turn" is trivially true in a local
   game, so without this a human can move for the computer.

The same analysis powers a player-facing **chain vision** overlay (hold `C`): it shows
which moves are safe and what each sacrifice costs. It reveals nothing the position does
not already contain — it renders the reading a strong player does in their head.

---

## 6. Online multiplayer

### 6.1 Shape

```
Browser ──WebSocket──► Worker ──► /api/room/:code ──► GameRoom Durable Object (one per room)
                          │                              │ imports the engine
                          │                              └ authoritative game state
                          │                                        │ announces itself
                          └────► /api/lobby ──► LobbyRoom Durable Object (exactly one)
                                                   └ open games + every watching browser
```

One Durable Object per room, addressed by `idFromName(CODE)`, plus **one** LobbyRoom at
`idFromName('global')`. Everything else — the built SPA — is served by Workers Static
Assets from the same Worker, so there is one deploy and one origin.

A second DO rather than KV or D1: the lobby needs push fan-out and strong consistency, and
a Durable Object is both in one concept. Adding a storage product would buy neither.

### 6.2 Room codes

Six characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` — **no 0/O, 1/I/L**, because codes
get read aloud and typed by hand. The alphabet and its pattern live in `shared/protocol.ts`
and the **server validates against them**, so a confusable code fails fast instead of
quietly resolving to a different Durable Object than the one meant. Generated in the *browser* and confirmed by the server:
creating a room costs no extra request, the upgrade carries `create=1`, and the server
answers a conflict if the code is taken. Shared as `${origin}/?room=CODE`, which opens
straight into the join screen.

**The share link must use the deployed origin, not `localhost`.** A link built from a dev
server is useless to the second player.

### 6.3 Seats and identity

A per-room token identifies a returning player; a known token always reclaims its own
seat, which is what makes a mid-game refresh rejoin the same match.

**INVARIANT — the token lives in `sessionStorage`, never `localStorage`.** Every window of
a browser shares `localStorage`, so both windows claimed p1, the second seat was never
filled, and the game could never start when testing two players on one machine.
`sessionStorage` is tab-scoped: two windows are two players, and a refresh still
reconnects. (Known edge: *duplicating* a tab copies it in some browsers and reproduces the
clash. Open a new window instead.)

A disconnect **does not free the seat** — this is turn-based and the player can come back.

### 6.4 Protocol

Typed messages shared by both sides from one file, with a `PROTOCOL_VERSION` checked at
the upgrade and bumped on any incompatible change.

- **Client →** `move` (carrying the last applied `seq`), `resign`, `offer-draw`,
  `respond-draw`, `rematch`, `resync`, `leave`
- **Server →** `welcome`, `state` (with `seq`, `reason`, `series`), `presence`, `rematch`,
  `draw-offered`, `draw-declined`, `rematch-timeout`, `rejected`, `error`

The lobby socket is separate, anonymous and read-only — it carries no token and no seat:

- **Client →** `refresh` (re-syncs a tab that slept)
- **Server →** `lobby` (the whole list), `error`

The lobby broadcasts **whole snapshots, never deltas**, for the same reason the game does:
a listing race then heals itself on the next broadcast instead of needing reconciliation.

`PROTOCOL_VERSION` is **2**: version 1 had no lobby and no `visibility`.

The server broadcasts **whole game states**, not deltas. The client is a renderer and never
an authority.

Anti-cheat is two lines: the sender must own the current turn, and the `seq` they carry
must match the room's — which also stops a laggy double-tap from consuming two edges.

A plain read-only HTTP endpoint (`?info=1`) previews a room — board size, clock, host name,
whether it is full or in progress — **without claiming a seat**, so the second player can
see what they are walking into and decline.

### 6.5 Free-tier invariants — **INVARIANT**

1. **No timers, no intervals, no long-lived promises in the Durable Object.** A resident
   object bills for duration forever; a hibernating one bills nothing. The clock is
   enforced with a **single alarm per turn**, set at the flag deadline (or the idle-reap
   deadline when untimed).
2. **Nothing important in instance fields.** The object is evicted between messages: room
   state goes to storage, per-socket state rides in the socket's attachment. Use the
   WebSocket Hibernation API.
3. Validate the room code in the Worker *before* deriving the id, so a malformed code never
   instantiates — and never bills for — an object.
4. Rooms are reaped after **24 hours idle** with nobody connected.
5. The same rules bind LobbyRoom: no timers, one alarm set to the earliest listing expiry,
   and `deleteAlarm()` when the list empties.

Inbound WebSocket messages are billed at a 20:1 **discount** (100 messages = 5 requests).
A rebuild should not "optimise" message count on the false belief that it is a penalty.

### 6.6 Server-side rules are a pure function — **INVARIANT**

All room behaviour lives in a pure `reduceRoom(room, event) → { room, effects }`, where
events are `message | disconnect | alarm` and effects are addressed messages, a close-room
signal, and a **lobby announcement**. The lobby has its own
`reduceLobby(state, event) → { state, effects }` alongside it.

Deciding registration inside the reducer rather than in the I/O layer is what makes every
list/unlist transition testable in plain node. The Durable Object is I/O only: parse, call, persist, send.

This is what makes the server testable in plain node with no Workers runtime, no sockets
and no storage — the same discipline that makes the engine cheap to test.

The alarm handler is the authority on time: if the flag has fallen, the game ends now,
whatever either browser believes.

### 6.7 The lobby is a cache; the room is the authority — **INVARIANT**

A listing is a snapshot of something that was true a moment ago. **The lobby never grants a
seat** — a browser that clicks a stale row is refused by the room itself, exactly as if it
had typed a dead code. That is what lets every write to the lobby be advisory and cheap.

**The room registers itself.** Only the room knows the truth about its seats, so a Worker-
or client-side registration would be wrong the instant the second player arrived. A room is
listed while it is public, pending, and its host is connected; the moment any of those stops
being true it is withdrawn, and if it becomes true again it is re-listed.

Three independent nets remove a dead listing, fastest first:

1. the host's `disconnect`, `leave`, or the join that fills the second seat;
2. the 24-hour idle reap closing the room;
3. a **15-minute TTL** swept by the lobby's single alarm — the backstop for a Durable Object
   that died without ever running a close handler.

Announcements are fire-and-forget inside a `try/catch`: a failed announce must never break a
game. A dropped `unlist` self-heals via the TTL; a dropped `list` cannot, so **a listed room
re-announces itself on a renewal alarm** every 5 minutes — inside the 15-minute TTL, so a
waiting host never expires off the list, and still one alarm.

**A renewal MUST advance `lastActivity` — INVARIANT.** `nextAlarmAt` is derived from it, so
renewing without touching it re-arms the alarm at a moment already past: the object wakes in
a tight loop and bills duration exactly like the interval the free-tier rules forbid. It is a
spinning timer wearing an alarm's clothing, and it looks correct in a test that asserts only
the renewal *effect*. Assert that the next alarm moved **forward**.

The lobby also stays silent when a renewal changes nothing a watcher can see — only the
expiry moved — so waiting hosts do not wake every browser in the lobby on a timer. They are **awaited in effect order**, which is
what stops a `list` landing after the `unlist` that followed it.

Registration travels as an internal stub fetch to `https://lobby/announce`. Public lobby
traffic is rewritten to `/watch`, so the public surface and the internal write surface share
no namespace and routing is not the only thing defending it.

**Joining a room that does not exist is a refusal, not a creation.** Only `create=1` creates.
Without that rule a listing outliving its room would let any browser become the host of a
room it never staged.

**A game is dealt only when both players are actually connected — INVARIANT.** Seats are
claimed, not released, so a room can hold a chair whose player has gone. Dealing on "both
chairs claimed" hands the first turn to someone who is not coming back, and the other player
is left on a board they can never move on — which is what a stale lobby row produced in
production.

**An abandoned room is taken over, not refused.** Deregistration needs the host's disconnect
to be *observed*, and a browser that dies without a close frame never is, so a row can
outlive its host until the listing expires. A player who clicks one becomes its host and
waits, and it is re-listed under their name with the board and clock it was staged with.
Being first into a game is a normal thing to be, so this is a better answer than an error.

---

## 7. Interface

### 7.1 Design language — "Bold Utility"

Flat, high-contrast, square-cornered, heavy type on a near-black ground. Chosen over
softer alternatives because the board is the content and the chrome should not compete.

- Near-black ground `#0b0b0c`, raised surfaces `#16171a` / `#1e1f23`
- Heavy grotesque type (Archivo), uppercase tracked labels, oversized **tabular** numerals
  for scores and clocks so digits do not jitter as they count
- **One filled control per screen**, and it is white; everything else is an outline
- The active player's card **inverts to white** rather than being tinted, so whose turn it
  is survives being read at arm's length
- A 4/8px spacing scale — every gap, pad and margin comes from it
- Three motion tokens, so reduced-motion is flattened in one place
- Square corners, no shadows, no gradients, no confetti, no particles

### 7.2 Screens

1. **Setup** — mode (Pass & Play / Play Online / Play the Computer), player names and
   initials, and — for the two offline modes — board size, speed, difficulty. Only the
   controls that do something are rendered: a joiner inherits the host's board and clock,
   so those controls are hidden rather than shown inert.
   The online tab carries exactly two things: **Browse Open Games**, the single way into
   an online match, and a room-code field for someone who was sent an invite. It creates
   nothing. Board, clock and visibility are asked in the lobby, at the moment a game is
   actually staged — asking them here, before anyone has decided to host, is what let the
   same settings be picked in two places and disagree.
2. **Open games** — the live public lobby, and the one origin of an online game: one row
   per pending game with host, board and clock, newest first, updating without any user
   action. An empty state that invites the player to stage one. **Start a Game** opens a
   staging panel in place of the list — board, speed, and **Public** (listed here) or
   **Private** (link only), defaulting to public, since a lobby nobody stages into is an
   empty lobby. Replacing the list rather than sitting under it keeps one primary action
   per view and an obvious way back. A private game is still staged from here and still
   gets a code and share link on the Waiting screen; visibility only decides whether the
   row appears in this list. A refused join returns here with a plain explanation, never a
   dead end; every row is held while one join is in flight, so a double-tap cannot open
   two sockets. The app holds this screen until the room the joiner picked actually
   answers with a seat — routing away the instant the socket opens, rather than waiting
   for the seat, flashes the host's Waiting screen (room code included) at the joiner for
   one frame before the real screen replaces it.
3. **Waiting** — shown to the host: the room code and share link, revealed only once the
   room is actually live (never publish a code before the server has confirmed it), with
   clear waiting state. A public room says so, since someone may arrive at any moment. A
   **joiner** taking a seat sees a distinct variant of the same screen — "Joining" /
   "Taking a seat in {host}'s game…" — with no room code and no Copy link, since a joiner
   has no invite of their own to share and was previously shown the host's code by mistake.
4. **Board** — the SVG grid, scoreboard, clocks, turn banner, chain badge, notices.
4. **Game over** — result, achievement eyebrow, scores, series tally, rematch, **Main
   Menu**, quit.
5. **Something went wrong** — the error-boundary fallback, rendered in place of the whole
   app when any render below it throws. Without it the player gets a white tab: no
   explanation, no way back, and no sign anything is wrong beyond an empty page. It offers
   **Back to Menu** and **Reload**. Back to Menu *remounts* the tree rather than clearing a
   flag — re-rendering the state that just threw only throws again — which for an online
   game drops the socket too, correct since that match is over regardless. The error goes
   to the browser console and nowhere else; this game collects nothing about its players.

### 7.3 Board rendering and hit-testing

One responsive SVG. Geometry: 40px dot spacing, 26px padding, dot radius 5.2, claimed line
width 5.5, unclaimed 2.5, invisible hit stroke 30.

**INVARIANT — resolve a click to the *nearest* edge, not to whichever hit area was struck.**
Fat overlapping hit strokes with round caps extend past their endpoints and overlap near
every dot, so at a corner the click lands on whichever element happens to be on top. This
was the single most-reported bug ("I click one line and a different one connects"). The
fix is: compute the distance from the pointer to every unclaimed edge segment, take the
minimum within a radius, and use `stroke-linecap: butt` on hit strokes. A pixel-offset
regression script exists precisely to keep this fixed.

Both players are distinguished by **colour *and* line style** (solid blue / dashed amber) —
colour is never the only channel (WCAG 1.4.1). Blue/amber rather than blue/red, because
red and blue are the pair most often confused.

### 7.4 Feel

The strategic payoff of Dots and Boxes is the endgame cascade, and it is invisible unless
you build it. Requirements:

- **Accumulate the chain across the run** (client-side, derived from state changes, so it
  works identically online where only whole states arrive): a state that claims squares
  adds to the run; a state that claims nothing, or where the turn passed, resets it.
- **Stagger the reveal** — each newly claimed square scales in on a per-index delay, so a
  double claim reads as two beats rather than one flash.
- **Name the run** — a typographic `Chain ×5` badge at 3+, escalating at 5 and 8, placed
  clear of the grid so it never covers the board mid-cascade.
- **Say the extra turn out loud** in the turn banner when the turn did not pass.
- An **achievement eyebrow** on the end screen naming the most notable true thing about the
  game — Perfect board, Beat Hard, Comeback, Longest chain ×n, Won by one, Commanding win —
  never falling through to a flat "Game over". It is shown only to the winner (or to both,
  on a shared screen); congratulating the winner to the loser's face is not the goal.

### 7.5 Sound

Synthesised through Web Audio — **no audio files**. A lazily created context primed on the
first user gesture, one master gain for mute, and a latch so a failure never throws twice.
Pitches come from a diatonic scale so nothing is dissonant.

- A short tick on every claimed line, so the board feels physical
- A square-claim tone whose **pitch rises with position in the chain** — the highest-value
  sound here; it makes a long cascade audibly a crescendo
- A chain-resolve flourish, victory/defeat stings, opponent joined/left, draw offered, a
  refusal blip
- A countdown in the final 5 seconds, and a time-up tone
- Opponent actions are voiced distinctly from your own
- Mute is persisted

**Accessibility trap:** the mute button must not carry an `aria-label` that differs from
its visible text (WCAG 2.5.3 Label in Name).

### 7.6 Accessibility floor

- WCAG 2.2 AA: **4.5:1** for text, **3:1** for UI and focus indicators. Every pair in the
  palette is measured, and the measurements are documented. (Amber `#b45309` measured
  4.29:1 on a raised surface and had to be darkened — verify against the *actual*
  background, not the base one.)
- Full keyboard play: arrow keys move a cursor between edges, Enter/Space plays.
  **The keyboard cursor must be hidden until a key is actually used** — otherwise it
  renders as stray white marks after a mouse click, which reads as a rendering glitch.
- `role="status"` / polite live regions for turn changes, notices and offers.
- `prefers-reduced-motion` honoured through the motion tokens.
- Colour never the sole carrier of meaning.

### 7.7 Persistence (browser)

- `ds:players` (localStorage) — names and initials, so returning to setup never means
  retyping. The end screen therefore offers **Main Menu**, which returns to setup with
  the players already filled in. Named for the destination, not for the errand: as
  "Change Setup" it read as an errand, and a player finishing a game against the computer
  saw only Play Again and Quit — no way back.
- `ds:muted` (localStorage) — mute preference.
- `ds:token:CODE` (sessionStorage) — the seat token, per §6.3.

Initials are **never auto-derived from the name** — an explicit product decision.

### 7.8 Dead controls — **INVARIANT**

No control may render in a state where pressing it does nothing. The concrete case: a
"Quit / Leave Game" footer button. In local dev it stops the dev server, which is real; in
a deployed build it means "leave the game", which on the setup screen is a no-op because
there is no game. It must not render there. A rebuild should generalise the rule: if a
button's action is unreachable in the current state, do not draw it.

---

## 8. Local development

- Dev server on port **5173**, `--strictPort`.
- A dev-and-preview-only middleware exposes **`POST /__shutdown`**, which exits the Vite
  process — this is what lets the app's own Quit button actually free the port, and it
  stays off until someone starts it again. **POST only**, so a stray GET or a prefetch
  cannot take the game down. It must not be reachable in a production build.
- `/api` is proxied to the worker on 8787 with `ws: true` (required, or the WebSocket
  upgrade never arrives), so the real Durable Object can be used with HMR intact.

**Trap:** Vite dev returns `index.html` with **200** for unknown paths, so a `curl` status
code is not a render check.

**Trap:** `run_worker_first: ["/api/*"]` is required in the Worker's asset config, or the
SPA handler answers `/api/*` with `index.html` before the Worker sees it and the WebSocket
upgrade fails obscurely.

**Trap:** the Durable Object migration must be `new_sqlite_classes`, not `new_classes` —
the free plan only offers the SQLite backend and the other form is rejected at deploy.

**Trap:** run only one `npm run dev:worker` per checkout. Two instances share
`.wrangler/state`'s local SQLite, and a hot-reload of one then kills the runtime with
`SQLITE_BUSY: database is locked (SQLITE_BUSY_RECOVERY)`. The confusing part is that the
*victim* is usually the instance just started, while the stale one keeps answering on 8787
with pre-change code — so the symptom looks like edits not taking effect, not like a crash.

---

## 9. Verification

The suite that must exist and pass. Current totals: **260 unit tests** across eleven files.

| Layer | Coverage required |
| --- | --- |
| Engine (~52) | Board construction at every size, move legality and rejection reasons, square claiming, the extra turn, board-complete, resignation and draw and timeout endings beating the score, clock charging and increment ordering, flag detection, immutability |
| Bot (~9) | Returns only legal unclaimed edges; deterministic under a seed; returns null with nothing to play; plays a full game at every difficulty without stalling; medium/hard always take a free box and prefer doubles; never volunteer a third side while a safe move exists; hard picks the cheapest sacrifice; hard beats easy over a series |
| Lobby logic (~29) | Listing and upserting by code, unlisting, a silent no-op for an unknown code, expiry hidden from `visibleGames` and swept by the alarm, partial sweeps keeping survivors, one alarm at the earliest expiry and none when empty, the full-lobby cap refusing newcomers while still letting an existing host renew, sender-only snapshots for connect and refresh, `bad-message` for anything else, and that no branch mutates its input |
| Lobby feed (~11) | Connects at the right protocol version, fills from a snapshot, replaces the list wholesale rather than appending, survives an unreadable frame, retries after an unexpected close, stops retrying once closed deliberately, refreshes when the tab returns, closes on unmount, and stays idempotent across repeated `close()` calls (a caller closing from an effect on every render must not force a re-render loop) |
| Public lobby UI (~9) | A row per game with host, board and clock; the empty state only once loaded, never while connecting; joining the row that was pressed; every row held during a join; the filled-game notice; the reconnecting state |
| Lobby flow (~16) | Through the real App: the Public/Private toggle in the lobby's staging panel defaulting to public, `pub=1` sent only for a public room, a private host still getting a code and Copy link, the setup screen offering no way to create a room at all, browsing gated on a name, **a game appearing with no user action at all**, a row vanishing when it fills, the room socket opening while the lobby is held until a seat lands, a refused join (close **1006**) returning to the list without a retry storm, a joiner never being shown the host's code or Copy link, and Back keeping the player's name and mode |
| Five-player scenario (~9) | At the React/jsdom level, not mocked further than the socket: two players already in a game, two hosts each waiting on their own public game, a browser who sees exactly the two open games and picks one, and a sixth onlooker root proving the same push reaches a second browser live; a join failing mid-click closing 1006, the lobby socket dropping and recovering, an empty snapshot, and join-then-leave returning to a sane screen |
| Room logic (~50) | Seating, create-vs-join, token reclaim, room-full and room-exists refusals, turn ownership, stale seq, resign / draw offer / decline / accept, rematch votes, series tally counted once at the transition, alarm flagging, idle reap, next-alarm calculation, listing a public room and never a private one, withdrawing it when the game starts / the host drops / the host leaves / the room is reaped, re-listing a returning host, and refusing a joiner against an empty room rather than making them its host |
| App (~42) | Setup validation, playing a match, keyboard play, quitting (both dev and deployed), match options, losing on time, playing the computer, chain accumulation and reset, the end screen addressing the right player, returning to setup with names kept, no dead controls |

Plus **`lobby-check`** — `npm run dev:worker`, then `npm run lobby-check` drives real
Durable Objects over real sockets: a watcher sitting idle on the lobby sees a staged public
game arrive, never sees a private one, watches the row vanish as it fills, is refused a
seat that has gone, sees a vanished host withdrawn and a returning one re-listed, and
cannot become the host of a room that no longer exists. The unit suites mock the socket;
this is the only thing that proves the wiring.

Plus **`sim`** — the five-player scenario end to end: two players already in a game, two
hosts waiting in the lobby, and a fifth browsing who must see exactly the two open games
(never the one in progress), pick one, and start playing while the other host stays listed.
It also covers a late arrival being refused, two games running without bleeding into each
other, a host leaving and being withdrawn, and that host returning to their own seat and
listing.

Plus two Playwright scripts against a running build:
- **`aim-check`** — clicks at deliberate pixel offsets near dots and asserts the *intended*
  line is drawn. This is the regression net for §7.3 and it caught a real production bug
  (3/6 failures on the old build, always the vertical edge; 6/6 after the fix).
- **`browser-check`** — an end-to-end pass over rendering, play, and the end screen.

`npm run typecheck` covers the client and the worker separately.

### Testing discipline

Two lessons worth carrying into a rebuild:

- **A test can encode the bug.** The dead-button test asserted the button was present on
  the setup screen and passed happily while the button did nothing. When fixing behaviour,
  read the existing test to see whether it is pinning the defect.
- **Suspect the test before the app.** Several "failures" during the original build were
  faulty tests: a loop that ended when hit targets vanished during the bot's turn, a
  30-second block from querying a missing element, reusing an already-claimed edge,
  `line-height: normal` computing to `NaN`, and a legitimate 8–8 draw producing no victory
  sound.

---

## 10. Deployment

`npm run ship` = deploy, then verify the players actually got it. `npm run deploy` alone is
typecheck + build + `wrangler deploy`.

**Building is not shipping — INVARIANT.** The desktop launcher opens the *deployed* URL, so
after any change the app keeps showing the old game until a deploy runs, and nothing looks
broken. `npm run check-deployed` compares the content-hashed asset names in `dist/index.html`
against the live page (Vite hashes by content, so the asset name is the build identity — no
version stamp to keep in sync) and probes `/api/lobby` as a capability check. The launcher
runs it at every launch and offers to deploy when the site is behind; "could not tell"
(offline, or nothing built) never interrupts.

**Workers Logs are on** — `observability.enabled` in `wrangler.jsonc`, sampling at 1 (100%).
A bug a real player hits inside a Durable Object otherwise leaves no trace anywhere: the room
is the only thing that saw it, and it is gone by the time anyone thinks to ask. This game's
entire traffic is a handful of matches, so there is nothing worth sampling down.

 One Worker serves the static SPA
and the multiplayer; the SPA fallback handles client routing; `/api/*` reaches the Worker
first. Deploying is expected to be routine and repeated — verify against production after
each deploy, not only locally.

---

## 11. Build order for a rebuild

1. **Engine** — types, board maths, `makeMove`, winner, endings. Tests first; it is pure,
   so this is fast and everything else depends on it being right.
2. **Clock** — balances and timestamps, speeds derived from the board, increment ordering.
3. **Local UI** — setup, SVG board with nearest-edge hit-testing, scoreboard, end screen.
4. **Feel** — chain accumulation, staggered reveal, sound, achievements.
5. **Bot** — safety and sacrifice-cost analysis, the three tiers, the three traps in §5.
6. **Online** — protocol types, pure room logic with its node tests, then the Durable
   Object as I/O around it, then the client session hook.
7. **Lobby** — shared types and `reduceLobby` with its node tests, then LobbyRoom as I/O
   around it, then rooms announcing themselves through the reducer, then the browse screen.
   Stages 1 and 2 are invisible to the player, which is what makes a break easy to place.
8. **Deploy** — Worker with static assets, verify in production, then the aim/browser
   checks against the live URL.

Doing 6 before 3 is possible but wasteful; doing 3 without 1 being pure will force the
rules to be rewritten when the server needs them.

---

## 12. Summary of invariants

1. Turns do not alternate — always read `currentPlayer` from the move result.
2. The engine is pure, and the server imports it rather than reimplementing it.
3. A resignation or timeout loses regardless of score.
4. No timers in the Durable Object; one alarm per turn.
5. Nothing important in Durable Object instance fields.
6. The seat token is per-tab (`sessionStorage`), not per-browser.
7. Clicks resolve to the nearest edge, with butt line caps.
8. Colour is never the only channel; contrast is measured against the real background.
9. The keyboard cursor stays hidden until a key is pressed.
10. No control renders in a state where it does nothing.
11. The lobby is a cache; the room is the only thing that can grant a seat.
12. A room registers itself — nothing else knows the truth about its seats.
13. Joining a room that does not exist is a refusal, not a creation.
14. A refused upgrade closes with **1006**, not 1001 — the same code a dropped network
    gives. Having opened at least once is what tells them apart; without that a rejected
    join retries forever behind a "reconnecting" spinner.
15. A reload puts a second socket on a seat before the first one's close lands. A close
    must not report a player gone while another of their sockets is live.
16. Building is not shipping: the desktop app shows the deployed build, so every change
    needs a deploy before any player sees it.
17. An alarm that renews state must move its own next deadline forward, or it is a timer.
18. The server validates room codes against the real alphabet, so a confusable code cannot
    open a different room.
19. A game is dealt only when both players are connected, never merely both seats claimed.
20. **An offer nobody can answer must expire.** A rematch offered to a player who has
    already closed their browser used to wait for ever — the votes were recorded, nothing
    was ever broadcast back, and the offerer watched a screen that could never change. An
    unanswered rematch now carries a 5-second deadline on the room's single alarm; when it
    passes, both sides are told and returned to the start.
21. Every terminal connection state must be nameable on screen. A failed connect that renders
    the same spinner as a slow one is a hang as far as the player is concerned, and a connect
    with no timeout can spin for ever on nothing.
