import {test as base,type Page} from '@playwright/test';
export {expect} from '@playwright/test';
export type {Page,APIRequestContext} from '@playwright/test';

// Existing scenarios exercise saves from before immutable per-game identities.
export function legacyState<T extends {batch_limit?:number;alchemist?:unknown}>(state:T):T {
  delete state.batch_limit;delete state.alchemist;return state;
}
export async function openAccount(page:Page){
  if(await page.locator('#character-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.locator('#cancel-character').click();
  if(!await page.locator('#games-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.getByRole('button',{name:'Saved games',exact:true}).click();
}
export const test=base.extend({page:async({page},use)=>{
  await page.route('**/api/state*',async route=>{
    const response=await route.fetch();if(!response.ok())return route.fulfill({response});
    await route.fulfill({json:legacyState(await response.json())});
  });
  try{await use(page);}finally{await page.unrouteAll({behavior:'wait'});}
}});
