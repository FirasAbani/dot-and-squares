import { chromium } from 'playwright';
const URL = 'https://dots-and-squares.dots-and-squares.workers.dev';
const log = (...a) => console.log(...a);

async function name(page, who='Ada', ini='AL') {
  await page.getByRole('button', { name: 'Play Online' }).click();
  await page.getByLabel(/username/i).fill(who);
  const i = page.getByLabel(/initials/i); await i.fill(''); await i.fill(ini);
}
const snap = async (page) => (await page.locator('main').innerText()).replace(/\s*\n\s*/g,' | ');

// A: real create, sample every 500ms
async function A() {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(URL); await name(p);
  const t0 = Date.now();
  await p.getByRole('button', { name: 'Create Room' }).click();
  let codeAt = null;
  for (let i=0;i<40;i++){
    await p.waitForTimeout(500);
    const s = await snap(p);
    if (!codeAt && /Copy link/.test(s)) { codeAt = Date.now()-t0; log('A: code visible at', codeAt,'ms ::', s); break; }
    if (i%2===0) log('A t=', Date.now()-t0, '::', s);
  }
  if(!codeAt) log('A: NEVER got code');
  await b.close();
}

// B: WebSocket that never opens and never closes -> is there any timeout?
async function B() {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.addInitScript(() => {
    const R = window.WebSocket;
    window.WebSocket = class { constructor(url){ this.url=url; this.readyState=0; this.CONNECTING=0;
      window.__hung = (window.__hung||0)+1; }
      send(){} close(){} addEventListener(){} removeEventListener(){} };
    Object.assign(window.WebSocket, { CONNECTING:0, OPEN:1, CLOSING:2, CLOSED:3 });
    window.__realWS = R;
  });
  await p.goto(URL); await name(p);
  await p.getByRole('button', { name: 'Create Room' }).click();
  for (const t of [2000, 10000, 20000, 30000]) {
    await p.waitForTimeout(t === 2000 ? 2000 : t - (t===10000?2000:t===20000?10000:20000));
    log('B hung-socket t='+t+'ms ::', await snap(p));
  }
  log('B sockets opened:', await p.evaluate(()=>window.__hung));
  await b.close();
}

// C: browse the public lobby, list rows, try joining one
async function C() {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(URL); await name(p, 'Bob', 'BO');
  await p.getByRole('button', { name: 'Browse open games' }).click();
  await p.waitForTimeout(4000);
  log('C lobby ::', await snap(p));
  const joins = p.getByRole('button', { name: /^Join / });
  const n = await joins.count();
  log('C rows:', n);
  if (n > 0) {
    const t0 = Date.now();
    await joins.first().click();
    for (let i=0;i<20;i++){ await p.waitForTimeout(1000); log('C t='+(Date.now()-t0)+' ::', await snap(p)); }
  }
  await b.close();
}
const which = process.argv[2] || 'ABC';
if (which.includes('A')) await A();
if (which.includes('B')) await B();
if (which.includes('C')) await C();
