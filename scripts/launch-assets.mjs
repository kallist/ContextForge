import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createContextForgeLifecycle } from '../dist/composition/contextforge-lifecycle.js';
import { SqliteCapsuleHistory } from '../dist/adapters/sqlite/sqlite-capsule-history.js';
import { startStudio } from '../dist/adapters/studio/studio-server.js';
const root = await realpath(await mkdtemp(join(tmpdir(), 'contextforge-launch-')));
let browser, studio, history;
try {
 await mkdir(join(root,'src')); await mkdir(join(root,'test'));
 await writeFile(join(root,'AGENTS.md'),'# Session fixture\nSynthetic demonstration. Verify session expiration and concurrent refresh behavior.\n');
 for (const name of ['session','session_refresh','session_store','session_expiration','session_cleanup','session_cache','session_metrics','session_audit']) {
  await writeFile(join(root,'src',name+'.ts'), 'export function '+name+'(id: string, now: number) {\n'+Array.from({length:18},(_,i)=>'  const check'+i+' = { id, expiresAt: now + '+i+' };').join('\n')+'\n  return { id, now };\n}\n');
 }
 await writeFile(join(root,'test','session.test.ts'),'import { session } from "../src/session.js";\nexport function sessionRaceTest() {\n'+Array.from({length:24},(_,i)=>'  const result'+i+' = session("race", '+i+');').join('\n')+'\n}\n');
 const app = await createContextForgeLifecycle(root); history = new SqliteCapsuleHistory(join(root,'.contextforge/history')); studio = await startStudio(app,history);
 browser = await chromium.launch({headless:true}); const page = await browser.newPage({viewport:{width:1512,height:982}});
 const errors=[],remote=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>{if(new URL(r.url()).origin!==studio.origin)remote.push(r.url());});
 await page.goto(studio.url); await page.locator('#status').filter({hasText:'Ready.'}).waitFor();
 await page.locator('#task-composer').evaluate(e=>{ if(e.tagName==='DETAILS')e.open=true; });
 await page.locator('#task').fill('Fix session race condition'); await page.locator('#budget').fill('800'); await page.locator('#compile').click();
 await page.locator('#status').filter({hasText:'Compiled and saved'}).waitFor();
 await mkdir('docs/assets',{recursive:true}); await mkdir('.studio-output',{recursive:true});
 await page.screenshot({path:'docs/assets/repobound-hero.png'});
 await page.locator('[data-tab="context"]').click(); await page.screenshot({path:'docs/assets/repobound-context.png'});
 await page.locator('[data-tab="proposal"]').click(); await page.locator('#filter').selectOption('DROPPED');
 const testRow=page.locator('#candidates tr').filter({hasText:'test/session.test.ts'}); assert.equal(await testRow.count(),1,'Demo test must really be dropped');
 await testRow.getByRole('button').click(); await page.locator('#status').filter({hasText:'Explain: OK'}).waitFor();
 await page.screenshot({path:'docs/assets/repobound-why.png'});
 // A Why navigation may hide the candidate table; return to Context before control.
 if(await page.locator('[data-nav="context"]').count())await page.locator('[data-nav="context"]').click();
 await testRow.getByRole('combobox').selectOption('PIN'); await page.locator('#recompile').click(); await page.locator('#status').filter({hasText:'New Capsule saved'}).waitFor();
 assert.ok((await page.locator('#changes').textContent()).includes('DROPPED → SELECTED'));
 await page.screenshot({path:'.studio-output/launch-rebuild.png'});
 assert.deepEqual(errors,[]); assert.deepEqual(remote,[]);
 console.log(JSON.stringify({fixture:'synthetic session race',task:'Fix session race condition',budget:800,transition:'test/session.test.ts DROPPED → SELECTED',modelExecuted:false,remoteRequests:remote.length,browserErrors:errors.length}));
 const card=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
 await card.setContent('<html><body style="margin:0;background:#10151b;color:#edf2f5;font-family:Segoe UI,system-ui;padding:62px;box-sizing:border-box;width:1200px;height:630px"><div style="color:#9ce5c4;font-size:23px">◈ RepoBound</div><h1 style="font-size:49px;line-height:1.17;letter-spacing:-1.5px;font-weight:600;margin:47px 0 42px">See and control the repository context<br>your coding agent gets.</h1><div style="font-size:26px;padding:24px 0;border-top:1px solid #3c4650;border-bottom:1px solid #3c4650">Repo <span style="color:#9ce5c4">→ RepoBound →</span> Agent Context</div><p style="color:#acb8c4;font-size:20px;margin-top:37px">Local-first &nbsp; / &nbsp; Explainable &nbsp; / &nbsp; Hard budget &nbsp; / &nbsp; Agent Skill</p></body></html>');
 await card.screenshot({path:'docs/assets/social-card.png'});
} finally {await browser?.close();await studio?.close();history?.close();await rm(root,{recursive:true,force:true});}
