/**
 * Is the deployed game the same build as the one in `dist/`?
 *
 * Vite content-hashes every bundle, so the asset filename in `index.html` IS
 * the build identity — no version stamping, no extra endpoint to keep in sync.
 * Comparing the deployed page's asset names with the local ones therefore
 * answers the only question that matters: would a player see what I just built?
 *
 * Exits 1 when the site is behind, so it can gate a release.
 */
import { readFile } from 'node:fs/promises';

export const LIVE = process.env.LIVE_URL ?? 'https://dots-and-squares.dots-and-squares.workers.dev';

const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).sort();

async function main() {
  let local;
  try {
    local = assetsOf(await readFile('dist/index.html', 'utf8'));
  } catch {
    console.error('No dist/index.html — run `npm run build` first.');
    process.exit(2);
  }

  let live;
  try {
    const response = await fetch(LIVE, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    live = assetsOf(await response.text());
  } catch (error) {
    console.error(`Could not reach ${LIVE}: ${error.message}`);
    process.exit(2);
  }

  const same = JSON.stringify(local) === JSON.stringify(live);

  // A capability probe as well as a hash match: it names *what* is missing,
  // which a pair of opaque hashes never can.
  const lobby = await fetch(`${LIVE}/api/lobby?v=2`).then((r) => r.status).catch(() => 0);

  console.log(`live   ${LIVE}`);
  console.log(`local  ${local.join(' ')}`);
  console.log(`live   ${live.join(' ')}`);
  console.log(`lobby  ${lobby === 426 ? 'present' : `MISSING (got ${lobby}, wanted 426)`}`);

  if (same && lobby === 426) {
    console.log('\nUP TO DATE — players see the build in dist/.');
    process.exit(0);
  }

  console.log(`\nOUT OF DATE — players are on an older build.\nRun: npm run deploy`);
  process.exit(1);
}

main();
