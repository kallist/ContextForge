import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('.studio-output/site/assets',{recursive:true});
for (const name of ['index.html','site.css']) await copyFile('site/'+name,'.studio-output/site/'+name);
for (const name of ['repobound-hero.png','repobound-context.png','repobound-why.png','repobound-flow.svg','social-card.png','context-snapshot.png','repobound-hero.webm']) await copyFile('docs/assets/'+name,'.studio-output/site/assets/'+name);
await cp('site/proof','.studio-output/site/proof',{recursive:true,force:true});
console.log('Static site prepared in .studio-output/site; no remote runtime dependencies.');
