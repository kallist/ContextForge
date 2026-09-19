import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { verifyCodexDiscovery } from './codex-skill-discovery.mjs';
const source=resolve(process.argv[2]??'.');
const canonical=join(source,'repobound');const text=await readFile(join(canonical,'SKILL.md'),'utf8');
assert.match(text,/^---\r?\nname: repobound\r?\ndescription: .+/);assert.match(text,/license: MIT/);assert.match(text,/version: "0.5.1"/);
for(const heading of ['Availability and safe installation','Coding task','Review current changes','Context debugging','Trust boundaries'])assert.ok(text.includes('## '+heading));
assert.ok(text.includes('Never run installation silently'));assert.ok(text.includes('CLI has no status command'));assert.ok(!text.includes('repobound status'));
assert.ok(!/[A-Z]:[\\/](?:Users|aiwork)/.test(text));
for(const m of text.matchAll(/\]\((references\/[^)]+)\)/g))await access(join(canonical,m[1]));
const temp=await realpath(await mkdtemp(join(tmpdir(),'repobound-skill-')));
const npm=process.env.npm_execpath;assert.ok(npm,'Run via npm run skill:validate');
const run=(args)=>{const r=spawnSync(process.execPath,[npm,'exec','--yes','--package=skills@1.5.26','--','skills',...args],{cwd:temp,encoding:'utf8',windowsHide:true,env:{...process.env,DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'}});if(r.status!==0)throw new Error(r.stderr||r.stdout||String(r.error));return r.stdout;};
try{
 const discovered=run(['add',source,'--list']);assert.ok(discovered.includes('repobound'));assert.ok(!discovered.includes('contextforge'));
 run(['add',source,'--skill','repobound','--agent','codex','cursor','claude-code','--copy','--yes']);
 const list=run(['list','--json']);assert.ok(list.includes('repobound'));
 for(const target of ['.agents','.claude']){
  const installed=join(temp,target,'skills/repobound');assert.equal(await readFile(join(installed,'SKILL.md'),'utf8'),text);
  for(const ref of ['workflows.md','trust-and-boundaries.md'])assert.equal(await readFile(join(installed,'references',ref),'utf8'),await readFile(join(canonical,'references',ref),'utf8'));
 }
 const prompt=run(['use',source,'--skill','repobound']);assert.ok(prompt.includes('repobound'));assert.ok(prompt.includes('SKILL.md'));
 const codexBinary=process.env.REPOBOUND_CODEX_BINARY??process.env.CONTEXTFORGE_CODEX_BINARY;
 const nativeDiscovery = codexBinary ? await verifyCodexDiscovery(codexBinary, temp, text) : 'NOT TESTED';
 console.log(JSON.stringify({gate:'real skills CLI',installer:'1.5.26',discovered:1,targets:['codex','cursor','claude-code'],copiedReferences:true,promptGeneration:true,nativeDiscovery,hostModelExecution:'NOT TESTED',passed:true}));
}finally{await rm(temp,{recursive:true,force:true});}
