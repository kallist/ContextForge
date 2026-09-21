// Exercise visible navigation instead of manipulating application state.
// "Why" is no longer a destination: recorded evidence lives in the Context inspector,
// reachable as the Evidence view inside the Context group.
export async function view(page,name){
 const groups={proposal:'context',context:'context',review:'context',evidence:'context',coverage:'changes',changes:'changes',replay:'history'};
 await page.locator('[data-nav="'+groups[name]+'"]').click();
 if(groups[name]==='history')await page.locator('[data-history-action="'+name+'"]').click();
 else await page.locator('[data-tab="'+name+'"]').click();
}
