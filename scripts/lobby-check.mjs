/**
 * Drives the public lobby against a real Worker and real Durable Objects — the
 * one thing the unit suites cannot prove, because they mock the socket.
 *
 * Start `npm run dev:worker`, then `npm run lobby-check`. Durable Object
 * storage survives between runs, so every room code here is randomised.
 */
const PORT = process.env.WORKER_PORT ?? process.env.PORT ?? 8787;
const BASE = `ws://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function open(url) {
  const ws = new WebSocket(url);
  ws.frames = [];
  ws.addEventListener('message', (e) => ws.frames.push(JSON.parse(e.data)));
  return new Promise((res, rej) => {
    ws.addEventListener('open', () => res(ws));
    ws.addEventListener('error', () => rej(new Error(`could not open ${url}`)));
    ws.addEventListener('close', (e) => { if (ws.readyState !== 1) rej(new Error(`closed ${e.code}`)); });
  });
}
const games = (ws) => { const f = ws.frames.filter((m) => m.t === 'lobby').pop(); return f ? f.games : null; };
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed = true; };
let failed = false;
// Durable Object storage survives between runs, soeach run needs fresh codes.
const rnd = () => Array.from({ length: 3 }, () => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 31)]).join('');
const PUB1 = `P${rnd()}A2`, PRV = `R${rnd()}B2`, PUB3 = `Q${rnd()}C2`, GHOST = `G${rnd()}D2`;

// A watcher sits on the lobby screen the whole time, touching nothing.
const watcher = await open(`${BASE}/api/lobby?v=2`);
await wait(300);
check('watcher gets an initial snapshot', Array.isArray(games(watcher)));
const startCount = games(watcher).length;

// Somebody stages a PUBLIC game.
const host = await open(`${BASE}/api/room/${PUB1}?v=2&token=t-host&u=Ada&i=AL&create=1&pub=1&grid=5&time=&inc=0`);
await wait(500);
const listed = games(watcher);
check('the public game is pushed to the idle watcher', listed.length === startCount + 1);
const row = listed.find((g) => g.code === PUB1);
check('the row carries the host name', row?.hostName === 'Ada');
check('the row carries the board size', row?.gridSize === 5);

// Somebody stages a PRIVATE game.
const priv = await open(`${BASE}/api/room/${PRV}?v=2&token=t-priv&u=Grace&i=GH&create=1&grid=5&time=&inc=0`);
await wait(500);
check('a private game never appears', !games(watcher).some((g) => g.code === PRV));

// A second player joins the public game from the lobby.
const guest = await open(`${BASE}/api/room/${PUB1}?v=2&token=t-guest&u=Bob&i=BO`);
await wait(600);
check('the row vanishes the moment the game fills', !games(watcher).some((g) => g.code === PUB1));
check('both players got a game', guest.frames.some((m) => m.t === 'welcome' && m.state));

// A third player cannot take a seat that is gone.
const refused = await open(`${BASE}/api/room/${PUB1}?v=2&token=t-third&u=Eve&i=EV`).then(
  () => false,
  () => true,
);
check('a late click is refused', refused);

// The waiting host drops: their listing must go with them.
const host2 = await open(`${BASE}/api/room/${PUB3}?v=2&token=t-h2&u=Cleo&i=CL&create=1&pub=1&grid=5&time=&inc=0`);
await wait(500);
check('second public game listed', games(watcher).some((g) => g.code === PUB3));
host2.close();
await wait(700);
check('a vanished host is withdrawn', !games(watcher).some((g) => g.code === PUB3));

// ...and re-listed when they come back.
const back = await open(`${BASE}/api/room/${PUB3}?v=2&token=t-h2&u=Cleo&i=CL`);
await wait(600);
check('a returning host is re-listed', games(watcher).some((g) => g.code === PUB3));

// A host who reloads opens a new socket before the old one's close lands. The
// stale close must not unlist a host who is sitting right there.
const PUB4 = `R${rnd()}E2`;
const reload1 = await open(`${BASE}/api/room/${PUB4}?v=2&token=t-h3&u=Iris&i=IR&create=1&pub=1&grid=5&time=&inc=0`);
await wait(400);
const reload2 = await open(`${BASE}/api/room/${PUB4}?v=2&token=t-h3&u=Iris&i=IR`);
await wait(900);
check('a reloading host stays listed', games(watcher).some((g) => g.code === PUB4));
try { reload1.close(); reload2.close(); } catch {}

// Joining a room that never existed must not make you its host.
const ghost = await open(`${BASE}/api/room/${GHOST}?v=2&token=t-g&u=Zed&i=ZE`).then(
  () => false,
  () => true,
);
check('a stale listing cannot make a joiner the host', ghost);

console.log('\nfinal lobby:', JSON.stringify(games(watcher).map((g) => g.code)));
for (const s of [watcher, host, priv, guest, back]) { try { s.close(); } catch {} }
process.exit(failed ? 1 : 0);
