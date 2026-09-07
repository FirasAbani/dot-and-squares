import { chromium } from 'playwright';
const URL='https://dots-and-squares.dots-and-squares.workers.dev';
const log=(...a)=>console.log(...a);
const snap=async p=>(await p.locator('body').innerText()).replace(/\s*\n\s*/g,' | ');
const b=await chromium.launch(); const p=await (await b.newContext()).newPage();
p.on('websocket',ws=>{ log('WS open',ws.url()); ws.on('close',()=>log('WS CLOSE',ws.url()));
  ws.on('framereceived',f=>log('  <=',String(f.payload).slice(0,220))); });
await p.goto(URL);
await p.getByRole('button',{name:'Play Online'}).click();
await p.getByLabel(/username/i).fill('Bob'); const i=p.getByLabel(/initials/i); await i.fill(''); await i.fill('BO');
await p.getByRole('button',{name:'Browse open games'}).click();
await p.waitForTimeout(4000);
const rows=p.getByRole('button',{name:/^Join /}); const n=await rows.count(); log('rows:',n);
if(n){ const t0=Date.now(); await rows.first().click();
  for(let k=0;k<10;k++){ await p.waitForTimeout(1500); log('t='+(Date.now()-t0)+' ::',(await snap(p)).slice(0,400)); } }
await b.close();
