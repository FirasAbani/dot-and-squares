/**
 * Clicks at exact points on the board and asserts the intended line is the one
 * that gets claimed. The dangerous spots are near dots, where hit rectangles
 * used to overlap and the browser awarded the click by paint order.
 */
import { chromium } from 'playwright';
const APP = process.env.APP_URL ?? 'http://localhost:8787';
const SPACING = 40, PADDING = 26;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1200 } });
await p.goto(APP);
await p.getByLabel('Username').first().fill('Ada');
await p.getByLabel('Initials').first().fill('AL');
await p.getByLabel('Username').nth(1).fill('Grace');
await p.getByLabel('Initials').nth(1).fill('GH');
// The coordinates below assume the full 10x10 grid; the app now defaults to 5x5.
await p.getByLabel(/Board/).fill('10');
await p.getByRole('button', { name: 'Start Game' }).click();
await p.waitForSelector('.board__svg');

const box = await p.locator('.board__svg').boundingBox();
const extent = PADDING * 2 + 9 * SPACING;
const scale = box.width / extent;
const screen = (x, y) => ({ x: box.x + x * scale, y: box.y + y * scale });
const dotX = (c) => PADDING + c * SPACING;
const dotY = (r) => PADDING + r * SPACING;

let fails = 0;
// Aim points: board coords, and the line that SHOULD be claimed. Each case
// targets a different edge — a claimed line is no longer selectable, so reusing
// one would test the wrong thing.
const cases = [
  ['centre of a line',            dotX(0) + 20, dotY(0),      'H-0-0'],
  ['4px right of a shared dot',   dotX(3) + 4,  dotY(2),      'H-2-3'],
  ['4px left of a shared dot',    dotX(3) - 4,  dotY(4),      'H-4-2'],
  ['2px off a dot, 8px down',     dotX(6) + 2,  dotY(1) + 8,  'V-1-6'],
  ['2px off a dot, 8px right',    dotX(7) + 8,  dotY(3) + 2,  'H-3-7'],
  ['centre of a vertical line',   dotX(8),      dotY(5) + 20, 'V-5-8'],
];

for (const [label, bx, by, expected] of cases) {
  const before = await p.$$eval('[data-edge-id]', (ns) => ns.map((n) => n.getAttribute('data-edge-id')));
  const pt = screen(bx, by);
  await p.mouse.click(pt.x, pt.y);
  await p.waitForTimeout(120);
  const after = await p.$$eval('[data-edge-id]', (ns) => ns.map((n) => n.getAttribute('data-edge-id')));
  const gone = before.filter((id) => !after.includes(id));
  const got = gone[0] ?? '(nothing)';
  const ok = got === expected;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} expected ${expected.padEnd(7)} got ${got}`);
}
await b.close();
console.log(fails ? `\n${fails} FAILING` : '\nall pass');
process.exit(fails ? 1 : 0);
