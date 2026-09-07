/**
 * Drives two windows in ONE browser — exactly the user's setup — through a
 * real online game. Same browser context on purpose: that is what shares
 * storage and caused the seat clash.
 */
import { chromium } from 'playwright';

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const SHOTS = new URL('../.playwright-shots/', import.meta.url).pathname;

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
// ONE context = one browser profile = shared storage. This is the point.
const ctx = await browser.newContext();
const errors = [];
ctx.on('weberror', (e) => errors.push(String(e.error())));

async function fillPlayer(page, name, initials) {
  const users = page.getByLabel('Username');
  const inits = page.getByLabel('Initials');
  await users.first().fill(name);
  await inits.first().fill(initials);
}

// ---- Window 1: create a room -------------------------------------------
const p1 = await ctx.newPage();
p1.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p1.goto(APP);
await p1.getByRole('button', { name: 'Play Online' }).click();
await fillPlayer(p1, 'Ada', 'AL');
await p1.getByRole('button', { name: /Blitz/ }).click();
await p1.getByRole('button', { name: 'Create Room' }).click();

await p1.waitForSelector('.lobby__code', { timeout: 10000 });
const code = (await p1.locator('.lobby__code').innerText()).trim();
check('window 1 created a room', /^[A-Z0-9]{6}$/.test(code), `code=${code}`);
await p1.screenshot({ path: `${SHOTS}/1-lobby.png` });

// ---- Window 2: join it (same browser, shared profile) -------------------
const p2 = await ctx.newPage();
p2.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p2.goto(`${APP}/?room=${code}`);
// The joiner now sees an invitation card first and accepts it.
await p2.waitForSelector('.invite', { timeout: 10000 });
check('the joiner is shown the match before committing', true);
await fillPlayer(p2, 'Grace', 'GH');
await p2.getByRole('button', { name: /Accept/ }).click();

// The whole bug was that this never happened. Wait for the board itself, not
// for clickable edges — the waiting player's board is correctly disabled and
// renders no hit targets at all.
const dealt = await p2
  .waitForSelector('.board__svg', { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check('window 2 joined and the game was dealt', dealt);
if (!dealt) {
  await p2.screenshot({ path: `${SHOTS}/2-stuck.png` });
  console.log('\nStill stuck — the second window never got a seat.');
  await browser.close();
  process.exit(1);
}

await p1.waitForSelector('.board__svg', { timeout: 10000 });
await p1.screenshot({ path: `${SHOTS}/2-p1-board.png` });
await p2.screenshot({ path: `${SHOTS}/3-p2-board.png` });

// ---- Seats really are different ----------------------------------------
const tok1 = await p1.evaluate((c) => sessionStorage.getItem(`ds:token:${c}`), code);
const tok2 = await p2.evaluate((c) => sessionStorage.getItem(`ds:token:${c}`), code);
check('the two windows hold different seat tokens', !!tok1 && !!tok2 && tok1 !== tok2);

// ---- Turn gating --------------------------------------------------------
const p1Targets = await p1.locator('[data-edge-id]').count();
const p2Targets = await p2.locator('[data-edge-id]').count();
check('player 1 (to move) can click the board', p1Targets > 0, `${p1Targets} targets`);
check('player 2 (waiting) cannot', p2Targets === 0, `${p2Targets} targets`);

// ---- A real move crosses the wire --------------------------------------
const firstEdge = await p1.locator('[data-edge-id]').first().getAttribute('data-edge-id');
await p1.locator(`[data-edge-id="${firstEdge}"]`).click({ force: true }); // hit lines are transparent by design

const arrived = await p2
  .waitForFunction(() => document.querySelectorAll('.edge--claimed').length === 1, null, {
    timeout: 8000,
  })
  .then(() => true)
  .catch(() => false);
check("player 1's move appears in window 2", arrived);

const p2NowPlays = await p2
  .waitForFunction(() => document.querySelectorAll('[data-edge-id]').length > 0, null, {
    timeout: 8000,
  })
  .then(() => true)
  .catch(() => false);
check('the turn passed to player 2', p2NowPlays);
await p2.screenshot({ path: `${SHOTS}/4-p2-turn.png` });

// ---- Clock is running ---------------------------------------------------
const clocks = await p1.locator('.player-card__clock').allInnerTexts();
check('both clocks are shown', clocks.length === 2, clocks.join(' / '));

// ---- Forfeit -> LOOOOOSER ----------------------------------------------
await p2.getByRole('button', { name: 'Forfeit' }).click();
const loserEl = p2.locator('text=LOOOOOSER!!');
await loserEl.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
const loser = await loserEl.isVisible();
check('the player who forfeits sees LOOOOOSER!!', loser);
check(
  'the forfeit banner does not claim all lines were played',
  !(await p2.locator('.turn-banner').innerText()).toLowerCase().includes('all lines'),
  await p2.locator('.turn-banner').innerText(),
);
await p2.screenshot({ path: `${SHOTS}/5-loser.png`, animations: 'disabled' });

const winnerSeen = await p1
  .waitForFunction(() => /wins!/i.test(document.body.innerText), null, { timeout: 8000 })
  .then(() => true)
  .catch(() => false);
check('the other player is told they won', winnerSeen);
check(
  'the WINNER is not also called a loser',
  !(await p1.locator('text=LOOOOOSER!!').isVisible()),
);
await p1.screenshot({ path: `${SHOTS}/6-winner.png`, animations: 'disabled' });

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures ? `\n${failures} FAILING` : '\nall pass');
process.exit(failures ? 1 : 0);
