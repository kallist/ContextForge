import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { view } from './studio-navigation.mjs';
import { reviewFixture } from './review-fixture.mjs';
const packageRoot=resolve(process.argv[2]??'.'),repo=await realpath(await mkdtemp(join(tmpdir(),'contextforge-v05-browser-')));
let child,browser,reviewRoot;
async function start(repository=repo){
 child=spawn(process.execPath,[join(packageRoot,'dist/cli/main.js'),'studio','--repository',repository],{cwd:repository,windowsHide:true,stdio:['pipe','pipe','pipe']});
 return await new Promise((yes,no)=>{let output='';const timeout=setTimeout(()=>no(new Error('Studio startup timeout')),15000);child.on('error',no);child.on('exit',code=>{clearTimeout(timeout);no(new Error('Studio exited '+code));});child.stdout.on('data',b=>{output+=b;const url=output.match(/http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/);if(url){clearTimeout(timeout);yes(url[0]);}});});
}
async function stop(){if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}}
try{
 await mkdir(join(repo,'src'));await writeFile(join(repo,'AGENTS.md'),'# Rules\nTest session behavior.\n');
 for(let i=0;i<10;i++)await writeFile(join(repo,'src','session'+i+'.ts'),'export function session'+i+'() {\n'+Array.from({length:24},(_,n)=>'  const x'+n+' = "session evidence '+n+'";').join('\n')+'\n  return "<img src=x onerror=globalThis.injected=true>";\n}\n');
 await writeFile(join(repo,'.env'),'PRIVATE_SOURCE_SENTINEL=never_read\n');
 let url=await start();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1512,height:982}});const remote=[],errors=[];let origin=new URL(url).origin;
 page.on('request',r=>{if(new URL(r.url()).origin!==origin)remote.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 const first=performance.now();await page.goto(url);await page.locator('#status').filter({hasText:'Ready.'}).waitFor();const firstLoadMs=performance.now()-first;
 assert.equal(await page.title(),'RepoBound Studio');assert.ok((await page.locator('.brand').innerText()).includes('RepoBound'));
 assert.equal(await page.locator('h1').innerText(),'What should your agent see?');assert.equal(await page.locator('[data-nav]').count(),3);assert.equal(await page.locator('#budget').inputValue(),'8000');assert.equal(new URL(page.url()).hash,'');
 await page.locator('#task').fill('Fix session expiration race condition');await page.locator('#budget').fill('1200');const buildStart=performance.now();await page.locator('#compile').click();await page.locator('#status').filter({hasText:'Compiled and saved'}).waitFor();const buildMs=performance.now()-buildStart;
 const parent=await page.locator('#identity').textContent();await view(page,'context');assert.ok((await page.locator('#payload').textContent()).includes('<img src=x onerror='));assert.equal(await page.locator('img').count(),0);assert.equal(await page.evaluate(()=>globalThis.injected),undefined);
 await view(page,'proposal');await page.locator('#filter').selectOption('DROPPED');const row=page.locator('#candidates tr').filter({hasText:'src/'}).first();const label=await row.locator('select').getAttribute('aria-label');
 await row.getByRole('button').focus();await page.keyboard.press('Enter');await page.locator('#status').filter({hasText:'Explain: OK'}).waitFor();assert.equal(await page.locator('[data-nav="why"]').getAttribute('aria-current'),'page');assert.ok((await page.locator('#explain').textContent()).includes('RECORDED DECISION'));assert.ok(await page.locator('#explain').evaluate(e=>e===globalThis.document.activeElement));
 await view(page,'proposal');await page.getByRole('combobox',{name:label,exact:true}).selectOption('PIN');await page.locator('#recompile').click();await page.locator('#status').filter({hasText:'New Capsule saved'}).waitFor();assert.notEqual(await page.locator('#identity').textContent(),parent);assert.ok((await page.locator('#changes').textContent()).includes('DROPPED → SELECTED'));
 // Each control goes through the visible UI and the real CLI-served API.
 for(const kind of ['EXCLUDE','PREFER','FOCUS','RANGE']){
  await view(page,'proposal');await page.locator('#filter').selectOption('ALL');await page.locator('#clear').click();
  if(kind==='RANGE')page.once('dialog',d=>d.accept('1-3'));
  await page.getByRole('combobox',{name:label,exact:true}).selectOption(kind);await page.locator('#whatif-budget').fill('3000');
  await page.locator('#recompile').click();await page.locator('#status').filter({hasText:'New Capsule saved'}).waitFor();assert.ok((await page.locator('#provenance').textContent()).includes(kind));
  if(kind==='EXCLUDE'){await view(page,'proposal');const controlled=page.locator('#candidates tr').filter({has:page.getByRole('combobox',{name:label,exact:true})});assert.ok((await controlled.textContent()).includes('DROPPED'));}
 }
 await view(page,'replay');await page.locator('#verify').click();await page.locator('#status').filter({hasText:'Replay: EXACT_MATCH'}).waitFor();
 await page.locator('[data-nav="history"]').click();assert.ok(await page.locator('.history-entry').count()>=6);await page.locator('.history-entry').first().click();await page.locator('#status').filter({hasText:'Saved metadata opened'}).waitFor();
 for(const [width,height] of [[1024,768],[1280,800],[1512,982],[1920,1080]]){
  await page.setViewportSize({width,height});await view(page,'proposal');
  assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth));
  const box=await page.locator('#compile').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width);
  await page.keyboard.press("Tab"); await page.locator('#compile').focus();assert.notEqual(await page.locator('#compile').evaluate(e=>globalThis.getComputedStyle(e).outlineStyle),'none');
 }
 await page.reload();await page.locator('#status').filter({hasText:'Ready.'}).waitFor();await page.locator('[data-nav="history"]').click();assert.ok(await page.locator('.history-entry').count()>=6);
 await stop();url=await start();origin=new URL(url).origin;await page.goto(url);await page.locator('#status').filter({hasText:'Ready.'}).waitFor();await page.locator('[data-nav="history"]').click();await page.locator('.history-entry').first().click();await page.locator('#status').filter({hasText:'Saved metadata opened'}).waitFor();await view(page,'context');assert.ok((await page.locator('#payload').textContent()).includes('Exact context is not stored'));assert.ok(await page.locator('#copy').isDisabled());
 assert.equal(await page.locator('img').count(),0);assert.equal(await page.evaluate(()=>globalThis.injected),undefined);assert.ok(!(await page.locator('body').textContent()).includes(repo));assert.ok(!(await page.locator('body').textContent()).includes('PRIVATE_SOURCE_SENTINEL'));assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
 await stop();reviewRoot=await realpath(await mkdtemp(join(tmpdir(),'contextforge-v05-review-')));await reviewFixture(reviewRoot);
 url=await start(reviewRoot);origin=new URL(url).origin;await page.goto(url);await page.locator('#status').filter({hasText:'Ready.'}).waitFor();
 await page.locator('#mode-review').click();await page.locator('#review-budget').fill('1000');await page.locator('#review-compile').click();await page.locator('#status').filter({hasText:'Review Context saved'}).waitFor();
 await view(page,'review');assert.ok((await page.locator('#review-detail').textContent()).includes('ledger'));assert.ok(await page.locator('.impact-card').count()>0);
 await view(page,'proposal');await page.locator('#filter').selectOption('DROPPED');const reviewRow=page.locator('#candidates tr').filter({hasText:'src/'}).first();await reviewRow.getByRole('button').click();await page.locator('#status').filter({hasText:'Explain: OK'}).waitFor();
 await view(page,'proposal');await reviewRow.getByRole('combobox').selectOption('PIN');await page.locator('#recompile').click();await page.locator('#status').filter({hasText:'New Capsule saved'}).waitFor();assert.ok((await page.locator('#changes').textContent()).includes('DROPPED → SELECTED'));
 await view(page,'coverage');assert.ok((await page.locator('#coverage').textContent()).includes('BOUNDED CANDIDATES'));
 await view(page,'replay');await page.locator('#verify').click();await page.locator('#status').filter({hasText:'Replay: EXACT_MATCH'}).waitFor();
 assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({gate:'CLI-launched Studio',package:process.argv[2]?'FRESH_INSTALL':'WORKTREE',browser:await browser.version(),controls:['Include','Exclude','Prefer','Focus','Range'],viewports:[[1024,768],[1280,800],[1512,982],[1920,1080]],firstLoadMs:Math.round(firstLoadMs),buildMs:Math.round(buildMs),remoteRequests:0,browserErrors:0,restart:true,reviewJourney:true,passed:true}));
}finally{await browser?.close();await stop();await rm(repo,{recursive:true,force:true});if(reviewRoot)await rm(reviewRoot,{recursive:true,force:true});}
