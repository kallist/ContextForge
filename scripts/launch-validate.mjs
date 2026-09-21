import assert from 'node:assert/strict';
import { readFile, access, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { assertFontPolicy } from './csp-policy.mjs';
const docs=['README.md','README_ZH.md','docs/AGENT_SKILL.md','docs/ENGINEERING_REFERENCE.md',...(await readdir('docs/brand')).filter(x=>x.endsWith('.md')).map(x=>'docs/brand/'+x),...(await readdir('docs/v0.5')).filter(x=>x.endsWith('.md')).map(x=>'docs/v0.5/'+x)];
let links=0;
for(const file of docs){
 const text=await readFile(file,'utf8');
 for(const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
  const url=match[1]; if(/^(https?:|#|mailto:)/.test(url))continue;
  await access(resolve(dirname(file),decodeURIComponent(url.split('#')[0]))); links++;
 }
 assert.ok(!/[A-Z]:[\\/](?:Users|aiwork)|\/Users\//.test(text),'Machine path in '+file);
}
for(const name of ['repobound-hero.png','repobound-context.png','repobound-why.png','social-card.png','context-snapshot.png']){
 const data=await readFile('docs/assets/'+name);assert.equal(data.toString('hex',0,8),'89504e470d0a1a0a');
 assert.ok((await stat('docs/assets/'+name)).size<1500000);
 if(['social-card.png','context-snapshot.png'].includes(name)){assert.equal(data.readUInt32BE(16),1200);assert.equal(data.readUInt32BE(20),630);}
}
assert.ok((await stat('docs/assets/repobound-hero.webm')).size<20*1024*1024);
const site=await readFile('site/index.html','utf8');assert.ok(!/<script|<iframe|<form|https?:[^"']+\.(?:css|js|woff)/i.test(site));
for(const m of site.matchAll(/(?:src|href)="([^"#]+)"/g)){if(m[1].startsWith('https:'))continue; await access(resolve('.studio-output/site',m[1]));}
// Font files are referenced from CSS, not from HTML, so the link check above never sees them.
// Each page resolves ./fonts/ against its own directory, which means every page directory needs them.
for(const css of [['site/site.css',''],['site/proof/proof.css','proof/']]){
 const text=await readFile(css[0],'utf8');const urls=[...text.matchAll(/url\("\.\/(fonts\/[^"]+\.woff2)"\)/g)].map(m=>m[1]);
 assert.ok(urls.length>=2,`${css[0]} must reference both bundled font files`);
 for(const url of urls){
  const built=resolve('.studio-output/site',css[1]+url);
  await access(built);
  const data=await readFile(built);
  assert.ok(data.length>1000,`${built} is too small to be a real font`);
  assert.equal(data.toString('hex',0,4),'774f4632',`${built} is not a woff2 file`);
 }
}
const proofFiles=['site/proof/index.html','site/proof/task-context/index.html','site/proof/review-context/index.html','site/proof/context-debugging/index.html'];
// A missing directive separator silently voids the whole policy, so validate each directive.
for(const file of [...proofFiles,'site/index.html']){try{assertFontPolicy(file,await readFile(file,'utf8'));}catch(error){assert.fail(error.message);}}
for(const file of proofFiles){const html=await readFile(file,'utf8');assert.ok(!/<script|<iframe|<form/i.test(html));assert.ok(!/(?:accuracy|productivity|token savings) (?:improved|increased)|complete impact coverage/i.test(html));}
const proof=JSON.parse(await readFile('site/proof/data/cases.json','utf8'));assert.equal(proof.cases.length,3);const proofHome=await readFile('site/proof/index.html','utf8');
for(const item of proof.cases){assert.ok(proofHome.includes(item.title));if('selected'in item){assert.ok(proofHome.includes(`<b>${item.selected}</b><span>SELECTED</span>`));assert.ok(proofHome.includes(`<b>${item.dropped}</b><span>DROPPED</span>`));}}
const debugPage=await readFile('site/proof/context-debugging/index.html','utf8');assert.ok(debugPage.includes(proof.cases[2].file)&&debugPage.includes(`${proof.cases[2].initial}</span><i></i><span>${proof.cases[2].rebuilt}`)&&debugPage.includes(proof.cases[2].beforeCapsule.slice(0,12))&&debugPage.includes(proof.cases[2].afterCapsule.slice(0,12)));
for(const file of ['README.md','README_ZH.md','site/index.html']){const text=await readFile(file,'utf8');assert.ok(!/not public until|before final publication|after the repository rename|最终发布门禁完成前|尚未公开/i.test(text),'Stale pre-release copy in '+file);}
for(const file of ['src/adapters/studio/assets/studio.css','src/adapters/studio/assets/studio.js','site/site.css','site/proof/proof.css','docs/assets/repobound-flow.svg']){const text=await readFile(file,'utf8');assert.doesNotMatch(text,/\bgreen\b|#9ce5c4|linear-gradient|radial-gradient/iu,'Forbidden green or gradient in '+file);}
console.log(JSON.stringify({gate:'launch links/assets/static site',documents:docs.length,relativeLinks:links,passed:true}));
