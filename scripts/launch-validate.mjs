import assert from 'node:assert/strict';
import { readFile, access, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const docs=['README.md','README_ZH.md','docs/ENGINEERING_REFERENCE.md',...(await readdir('docs/v0.5')).filter(x=>x.endsWith('.md')).map(x=>'docs/v0.5/'+x)];
let links=0;
for(const file of docs){
 const text=await readFile(file,'utf8');
 for(const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
  const url=match[1]; if(/^(https?:|#|mailto:)/.test(url))continue;
  await access(resolve(dirname(file),decodeURIComponent(url.split('#')[0]))); links++;
 }
 assert.ok(!/[A-Z]:[\\/](?:Users|aiwork)|\/Users\//.test(text),'Machine path in '+file);
}
for(const name of ['contextforge-hero.png','contextforge-context.png','contextforge-why.png','social-card.png']){
 const data=await readFile('docs/assets/'+name);assert.equal(data.toString('hex',0,8),'89504e470d0a1a0a');
 assert.ok((await stat('docs/assets/'+name)).size<1500000);
 if(name==='social-card.png'){assert.equal(data.readUInt32BE(16),1200);assert.equal(data.readUInt32BE(20),630);}
}
const site=await readFile('site/index.html','utf8');assert.ok(!/<script|<iframe|<form|https?:[^"']+\.(?:css|js|woff)/i.test(site));
for(const m of site.matchAll(/(?:src|href)="([^"#]+)"/g)){if(m[1].startsWith('https:'))continue; await access(resolve('.studio-output/site',m[1]));}
console.log(JSON.stringify({gate:'launch links/assets/static site',documents:docs.length,relativeLinks:links,passed:true}));
