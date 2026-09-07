import { chromium } from 'playwright';
const URL='https://dots-and-squares.dots-and-squares.workers.dev';
const log=(...a)=>console.log(...a);
const snap=async p=>(await p.locator('main').innerText()).replace(/\s*\n\s*/g,' | ');
async function name(p,who,ini){ await p.getByRole('button',{name:'Play Online'}).click();
  await p.getByLabel(/username/i).fill(who); const i=p.getByLabel(/initials/i); await i.fill(''); await i.fill(ini); }

// D: host stages a public game, then its tab is CLOSED. Second player joins the stale row.
const b=await chromium.launch();
const hc=await b.newContext(); const host=await hc.newPage();
await host.goto(URL); await name(host,'Ghost','GH');
await host.getByRole('button',{name:'Create Room'}).click();
await host.waitForTimeout(4000);
const hs=await snap(host); log('HOST ::', hs);
const code=(hs.match(/\b[A-Z0-9]{6}\b/)||[])[0]; log('code=',code);
await hc.close(); log('host context closed');
await new Promise(r=>setTimeout(r,3000));

const jc=await b.newContext(); const j=await jc.newPage();
await j.goto(URL); await name(j,'Bob','BO');
await j.getByRole('button',{name:'Browse open games'}).click();
await j.waitForTimeout(4000);
log('LOBBY ::', await snap(j));
const rows=j.getByRole('button',{name:/^Join /}); log('rows:',await rows.count());
const target=j.getByRole('button',{name:new RegExp("Join Ghost")});
if(await target.count()){ const t0=Date.now(); await target.first().click();
  for(let i=0;i<12;i++){ await j.waitForTimeout(1500); log('J t='+(Date.now()-t0)+' ::',(await snap(j)).slice(0,300)); } }
else log('stale row NOT listed');
await b.close();
