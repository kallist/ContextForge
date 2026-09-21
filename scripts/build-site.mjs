import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('.studio-output/site/assets',{recursive:true});
for (const name of ['index.html','site.css']) await copyFile('site/'+name,'.studio-output/site/'+name);
for (const name of ['repobound-hero.png','repobound-context.png','repobound-why.png','repobound-flow.svg','social-card.png','context-snapshot.png','repobound-hero.webm']) await copyFile('docs/assets/'+name,'.studio-output/site/assets/'+name);
await cp('site/proof','.studio-output/site/proof',{recursive:true,force:true});
// Bundled latin-subset fonts, served locally and never from a CDN. Each stylesheet
// resolves ./fonts/ against its own directory: site.css sits at the site root while
// proof.css sits in proof/, so both targets need the files or the pages silently
// fall back to system fonts.
const fonts = ['plex-sans-latin-var.woff2','jetbrains-mono-latin-var.woff2'];
for (const target of ['.studio-output/site/fonts','.studio-output/site/proof/fonts']) {
  await mkdir(target,{recursive:true});
  for (const name of fonts) await copyFile('src/adapters/studio/assets/fonts/'+name,target+'/'+name);
}
console.log('Static site prepared in .studio-output/site; no remote runtime dependencies.');
