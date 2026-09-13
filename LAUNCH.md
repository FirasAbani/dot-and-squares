# Launching Dots &amp; Squares

Everything you need to get the game running again after a restart.

## The desktop icon (easiest)

Double-click **Dots & Squares** on the Desktop. It opens the deployed game at
https://dots-and-squares.firasabani.workers.dev — nothing runs on your Mac, and
the invite link you share is a real public URL the other player can open.

**It deliberately does not start a local server.** The invite link is built from the
page's own origin, so a locally-served game hands out a `localhost` link that only works
on your machine — which looks fine until you send it to someone.

If you are offline it says so and offers a local game, warning that the link will only
work on this Mac.

The app is a plain bundle at `~/Desktop/Dots & Squares.app`; its launcher is
[scripts/launcher.sh](scripts/launcher.sh). Rebuild it with `npm run make-icon` after
changing the launcher or the icon. Note the icon opens the *deployed* site, so code
changes only appear there after `npm run deploy`.

## TL;DR (terminal)

```bash
cd ~/Code/Application
npm run dev
```

Then open **http://localhost:5173** in your browser. Press `Ctrl+C` in the terminal to stop it.

That's it for day-to-day use. The rest of this file covers first-time setup, playing on a
phone, and what to do when something breaks.

## First run after a fresh clone (or if `node_modules/` is missing)

```bash
cd ~/Code/Application
npm install
npm run dev
```

If `npm install` prints a warning about blocked install scripts, run this once and reinstall:

```bash
npm install-scripts approve esbuild
```

esbuild needs its postinstall step to place the right binary for your Mac; Vite will not
start without it.

## Playing online (two devices, anywhere)

Local pass-and-play needs only `npm run dev`. For **online** play you also need the
multiplayer server, in a second terminal:

```bash
npm run dev:worker      # :8787 — the real game server, with local storage
npm run dev             # :5173 — the app, proxying /api to it
```

Open http://localhost:5173, choose **Play Online**, pick a board size and clock, and
press Create Room. You get a six-character code and a copyable link. The other player
opens that link, types a name, and the game starts.

Both terminals need to be running. If the board never appears after Create Room, the
worker on :8787 is not up.

## Playing on your phone (same Wi-Fi)

```bash
npm run dev -- --host
```

Vite then prints a second **Network** URL, something like `http://192.168.4.59:5173`. Open
that on the phone. The IP changes between networks and reboots, so always read the one Vite
prints rather than reusing an old one.

Both players share the one device — it's pass-and-play, so hand the phone over each turn.

## All the commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload at http://localhost:5173 |
| `npm run dev:worker` | The multiplayer server on :8787 (run alongside `npm run dev`) |
| `npm run deploy` | Build and publish to Cloudflare |
| `npm run dev -- --host` | Same, plus a LAN URL for phones and tablets |
| `npm test` | Runs all 94 tests once and exits |
| `npm run test:watch` | Reruns tests as you edit |
| `npm run typecheck` | TypeScript check, no build output |
| `npm run build` | Typechecks and builds to `dist/` |
| `npm run preview` | Serves the built `dist/` at http://localhost:4173 |

Run all of these from `~/Code/Application`.

## Stopping the server

The easiest way is the **Quit** button in the game itself — in the header, on the setup
screen, and on the game-over screen. It asks for confirmation, then shuts the dev server
down properly, so port 5173 is free and nothing is left running in the background. The
game stays off until someone runs `npm run dev` again; the farewell screen says so.

Otherwise press `Ctrl+C` in the terminal running it. If a stray server is holding the port:

```bash
lsof -ti:5173 | xargs kill
```

The Quit button works by POSTing to `/__shutdown`, a small middleware in
[vite.config.ts](vite.config.ts) that exits the Vite process. You can do the same from a
terminal:

```bash
curl -X POST http://localhost:5173/__shutdown
```

Only `POST` stops the server — a plain `GET` falls through to the game, so nothing can
take it down by merely loading a URL.

## Troubleshooting

**`zsh: command not found: node`**
Node lives in Homebrew at `/opt/homebrew/bin/node`. If your shell can't see it:

```bash
export PATH="/opt/homebrew/bin:$PATH"     # this shell only
echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc   # permanent
```

If Node is genuinely gone, reinstall it: `brew install node` (this project needs Node 20+;
v26.8.1 is what's installed).

**`Port 5173 is already in use`**
Either kill the old server (see above) or start on another port: `npm run dev -- --port 5174`.

**Blank page or stale behaviour after pulling changes**
Stop the server, then:

```bash
rm -rf node_modules/.vite
npm install
npm run dev
```

**Tests fail but the app looks fine**
Run `npm test` and read the first failure — the engine suite in
[src/engine/engine.test.ts](src/engine/engine.test.ts) covers the game rules, so a failure
there means a real rule regression, not a UI glitch.

## Where things live

| Path | Contents |
| --- | --- |
| [src/engine/](src/engine/) | Game rules — pure TypeScript, no React |
| [src/components/](src/components/) | Setup screen, board, scoreboard, game-over screen |
| [src/App.tsx](src/App.tsx) | Screen routing, wires the UI to the engine |
| [src/styles.css](src/styles.css) | All styling |
| [README.md](README.md) | Architecture, engine explanation, limitations |

## Note

A dev server started from a Claude Code session stops when that session ends. For your own
sessions, run `npm run dev` in your own terminal so it stays up as long as you want it.
