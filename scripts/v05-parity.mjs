import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { reviewFixture } from './review-fixture.mjs';
const source=resolve('.'),temp=await realpath(await mkdtemp(join(tmpdir(),'contextforge-parity-'))),npm=process.env.npm_execpath;
assert.ok(npm,'Run via npm run v05:parity');
const run=(cmd,args,cwd)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,env:process.env});if(r.status!==0)throw new Error(r.stderr||r.stdout||String(r.error));return r.stdout;};
const sha=s=>createHash('sha256').update(s).digest('hex');
try{
 const pack=JSON.parse(run(process.execPath,[npm,'pack','--json','--pack-destination',temp],source))[0];assert.equal(pack.version,'0.5.0');
 const results=[];
 for(const [label,spec] of [['stable','@kallist/contextforge@0.4.1'],['candidate',join(temp,pack.filename)]]){
  const install=join(temp,label,'install'),repo=join(temp,label,'repo'),art=join(temp,label,'artifacts');
  await mkdir(install,{recursive:true});await mkdir(repo,{recursive:true});await mkdir(art,{recursive:true});
  await writeFile(join(install,'package.json'),'{}');
  run(process.execPath,[npm,'install','--ignore-scripts','--no-audit','--no-fund','--cache',join(temp,label,'fresh-cache'),spec],install);
  const cli=join(install,'node_modules/@kallist/contextforge/dist/cli/main.js');const command=(args)=>run(process.execPath,[cli,...args],repo);
  await reviewFixture(repo);assert.equal(command(['--version']).trim(),label==='stable'?'0.4.1':'0.5.0');assert.ok(command(['--help']).includes('review'));
  const index=JSON.parse(command(['index',repo,'--json']));
  const search=JSON.parse(command(['search','fix ledger',repo,'--json']));
  command(['pack','fix ledger',repo,'--budget','1000','--capsule',join(art,'task.json'),'--out',join(art,'task.md')]);
  command(['review',repo,'--base','HEAD','--budget','1000','--capsule',join(art,'review.json'),'--out',join(art,'review.md')]);
  const task=JSON.parse(await readFile(join(art,'task.json'),'utf8')),review=JSON.parse(await readFile(join(art,'review.json'),'utf8'));
  const explain=JSON.parse(command(['explain',join(art,'task.json'),'--query','WHY_SELECTED','--subject','src/ledger.ts','--json']));
  const coverage=JSON.parse(command(['coverage',join(art,'task.json'),'--json']));const reviewCoverage=JSON.parse(command(['coverage',join(art,'review.json'),'--json']));
  results.push({index,search,task,review,explain,coverage,reviewCoverage,taskMarkdown:await readFile(join(art,'task.md'),'utf8'),reviewMarkdown:await readFile(join(art,'review.md'),'utf8')});
 }
 // Explicit boundary: index/search timing and absolute root are runtime observations.
 const normalize=(r)=>{
  const value=structuredClone(r);
  delete value.index.performance; delete value.index.repositoryRoot; delete value.index.indexedAt;
  delete value.search.performance; delete value.search.repositoryRoot;
  delete value.task.runtime;delete value.review.runtime;
  return value;
 };
 const a=normalize(results[0]),b=normalize(results[1]);
 await mkdir('.studio-output',{recursive:true});
 // Raw diagnostic snapshots stay ignored and are never packaged or committed.
 await writeFile('.studio-output/parity-diagnostic.json',JSON.stringify([a,b],null,2));
 assert.deepEqual(b,a,'Semantic parity: normalization must not erase behavior differences');
 const report={gate:'public 0.4.1 vs fresh 0.5.0 tarball',candidateOrder:'IDENTICAL',candidateDecisions:'IDENTICAL',taskPayload:sha(a.taskMarkdown),reviewPayload:sha(a.reviewMarkdown),reviewSemantics:'IDENTICAL',explain:'IDENTICAL',coverageLint:'IDENTICAL',normalization:['index.performance','index.repositoryRoot','index.indexedAt','search.performance','search.repositoryRoot','task.runtime','review.runtime'],package:{name:pack.name,version:pack.version,files:pack.entryCount,packedBytes:pack.size},passed:true};
 await writeFile('.studio-output/parity.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await rm(temp,{recursive:true,force:true});}
