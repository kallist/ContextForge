// Exercise visible navigation instead of manipulating application state.
export async function view(page,name){
 const groups={proposal:'context',context:'context',review:'context',evidence:'why',coverage:'why',changes:'history',replay:'history'};
 await page.locator('[data-nav="'+groups[name]+'"]').click();
 if(groups[name]==='history')await page.locator('[data-history-action="'+name+'"]').click();
 else await page.locator('[data-tab="'+name+'"]').click();
}
