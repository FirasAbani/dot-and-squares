/**
 * Five players, one lobby.
 *
 *   Alice & Bob  — already in a game together
 *   Cara & Dan   — each staged a public game, waiting in the lobby
 *   Eve          — browsing, has to choose one of the two
 *
 * Drives real Durable Objects over real sockets. Start `npm run dev:worker`
 * (or set WORKER_PORT), then `npm run sim`.
 */
const PORT = process.env.WORKER_PORT ?? process.env.PORT ?? 8787;
const BASE = `ws://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
}
const step = (title) => console.log(`\n${title}`);

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
// Durable Object storage outlives the process, so every run needs new codes.
const code = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * 31)]).join('');

function connect(url) {
  const ws = new WebSocket(url);
  ws.frames = [];
  ws.addEventListener('message', (e) => ws.frames.push(JSON.parse(e.data)));
  ws.addEventListener('close', (e) => { ws.closeCode = e.code; });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('refused')));
  });
}

const player = (room, name, initials, token, extra = '') =>
  connect(`${BASE}/api/room/${room}?v=2&token=${token}&u=${name}&i=${initials}${extra}`);

const STAGE = '&create=1&pub=1&grid=4&time=&inc=0';

/** The latest lobby snapshot a watcher has seen. */
const seen = (ws) => { const f = ws.frames.filter((m) => m.t === 'lobby').pop(); return f ? f.games : null; };
/**
 * The lobby is shared — other clients (and other test runs) stage games in it.
 * Only ever assert about the rooms this run created, or the simulation becomes
 * a flake that fails for reasons that have nothing to do with it.
 */
const MINE = new Set();
const codesIn = (ws) => (seen(ws) ?? []).map((g) => g.code).filter((c) => MINE.has(c)).sort();
const last = (ws, t) => ws.frames.filter((m) => m.t === t).pop();

const R_GAME = code(), R_CARA = code(), R_DAN = code();
for (const c of [R_GAME, R_CARA, R_DAN]) MINE.add(c);

step('Alice and Bob are already playing.');
const alice = await player(R_GAME, 'Alice', 'AL', 't-alice', STAGE);
const bob = await player(R_GAME, 'Bob', 'BO', 't-bob');
await wait(500);
const aliceGame = last(alice, 'state') ?? last(alice, 'welcome');
check('their game is under way', aliceGame?.state?.status === 'playing');
check('Alice is p1 and Bob is p2', last(alice, 'welcome')?.seat === 'p1' && last(bob, 'welcome')?.seat === 'p2');

step('Cara and Dan each stage a public game and wait.');
const cara = await player(R_CARA, 'Cara', 'CA', 't-cara', STAGE);
const dan = await player(R_DAN, 'Dan', 'DA', 't-dan', STAGE);
await wait(600);

step('Eve opens the lobby.');
const eve = await connect(`${BASE}/api/lobby?v=2`);
await wait(500);
const open = seen(eve);
check('Eve is sent a list on arrival', Array.isArray(open), `got ${JSON.stringify(open)}`);
check('she sees exactly the two waiting games',
  JSON.stringify(codesIn(eve)) === JSON.stringify([R_CARA, R_DAN].sort()),
  `saw ${JSON.stringify(codesIn(eve))}, wanted ${JSON.stringify([R_CARA, R_DAN].sort())}`);
check("Alice and Bob's game in progress is NOT offered", !codesIn(eve).includes(R_GAME));
const caraRow = open.find((g) => g.code === R_CARA);
const danRow = open.find((g) => g.code === R_DAN);
check('each row names its host', caraRow?.hostName === 'Cara' && danRow?.hostName === 'Dan');
check('each row carries the board it was staged with', caraRow?.gridSize === 4 && danRow?.gridSize === 4);

step("Eve picks Cara's game.");
const eveInGame = await player(R_CARA, 'Eve', 'EV', 't-eve');
await wait(700);
check('Eve is seated as p2', last(eveInGame, 'welcome')?.seat === 'p2');
const started = last(eveInGame, 'state') ?? last(eveInGame, 'welcome');
check('a game is dealt for Cara and Eve', started?.state?.status === 'playing');
check('Cara is told the game began', (last(cara, 'state') ?? last(cara, 'welcome'))?.state?.status === 'playing');
check("Cara's game leaves the lobby at once", !codesIn(eve).includes(R_CARA), `still saw ${JSON.stringify(codesIn(eve))}`);
check("Dan is still waiting and still listed", codesIn(eve).includes(R_DAN));

step('A sixth player arrives too late for Cara.');
const late = await player(R_CARA, 'Zoe', 'ZO', 't-zoe').then(() => null, () => 'refused');
check('the filled game refuses them', late === 'refused');

step('Both games are played at the same time.');
const move = (ws, edgeId, seq) => ws.send(JSON.stringify({ t: 'move', edgeId, seq }));
const seqOf = (ws) => (last(ws, 'state') ?? last(ws, 'welcome')).seq;
move(alice, 'H-0-0', seqOf(alice));
move(cara, 'H-0-0', seqOf(cara));
await wait(500);
check('Alice moved in her game', last(bob, 'state')?.state.edges['H-0-0'].owner === 'p1');
check('Cara moved in hers', last(eveInGame, 'state')?.state.edges['H-0-0'].owner === 'p1');
check('the two games did not bleed into each other',
  last(bob, 'state').state !== last(eveInGame, 'state').state &&
  last(bob, 'state').state.players.p1.username === 'Alice' &&
  last(eveInGame, 'state').state.players.p1.username === 'Cara');
check('neither game appears in the lobby', !codesIn(eve).includes(R_GAME) && !codesIn(eve).includes(R_CARA));

step('Dan gives up waiting and leaves.');
dan.send(JSON.stringify({ t: 'leave' }));
dan.close();
await wait(800);
check('his game is withdrawn', !codesIn(eve).includes(R_DAN), `still saw ${JSON.stringify(codesIn(eve))}`);
check('none of this run\'s games are left open', codesIn(eve).length === 0, `saw ${JSON.stringify(codesIn(eve))}`);

step('Dan comes back and stages again.');
const danAgain = await player(R_DAN, 'Dan', 'DA', 't-dan');
await wait(700);
check('he is listed again without re-staging', codesIn(eve).includes(R_DAN), `saw ${JSON.stringify(codesIn(eve))}`);
check('he keeps his original seat', last(danAgain, 'welcome')?.seat === 'p1');

step('Eve, still watching, asks for a fresh list.');
eve.send(JSON.stringify({ t: 'refresh' }));
await wait(400);
check('the refreshed list agrees with the pushed one',
  codesIn(eve).length === 1 && codesIn(eve)[0] === R_DAN,
  `saw ${JSON.stringify(codesIn(eve))}`);

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`);
for (const s of [alice, bob, cara, eve, eveInGame, danAgain]) { try { s.close(); } catch {} }
process.exit(failures ? 1 : 0);
