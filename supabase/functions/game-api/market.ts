import evidence from './merchant-evidence.json' with { type: 'json' };

export const merchants = ['mira','rowan','bram'] as const;
const potions = ['healing_tonic','focus_draught','restoration_elixir'];
export type Need = typeof evidence.cases[number];
export type Decision = {merchant:string;method:string|null;args:any;reason:string;probability:number|null};

for (const merchant of merchants) for (let slot=0;slot<3;slot++) {
  const cases=evidence.cases.filter(n=>n.merchant===merchant && n.slot===slot);
  if (evidence.source!=='cached_jev' || evidence.cases.length!==9 || cases.length!==1 || !/^[0-9a-f]{64}$/.test(cases[0].request_sha256)
      || !cases[0].model || !cases[0].text || Object.keys(cases[0].probabilities).length!==3
      || potions.some(id=>!Number.isFinite(cases[0].probabilities[id as keyof Need['probabilities']]) || cases[0].probabilities[id as keyof Need['probabilities']]<0 || cases[0].probabilities[id as keyof Need['probabilities']]>1)) throw new Error('Invalid cached merchant evidence.');
}
export function needFor(merchant:string,day:number):Need {
  if (!Number.isSafeInteger(day) || day<0) throw new Error('Invalid market day.');
  const need=evidence.cases.find(n=>n.merchant===merchant && n.slot===day%3);
  if (!need) throw new Error('Unknown merchant.');
  return need;
}
function amount(value:unknown):bigint {
  if (typeof value!=='string' || !/^[0-9]{1,39}$/.test(value) || BigInt(value)>2n**128n-1n) throw new Error('Invalid token amount.');
  return BigInt(value);
}
export function decide(state:any,need:Need):Decision {
  const actor=state.merchants.find((m:any)=>m.name.toLowerCase()===need.merchant);
  if (!actor || !Number.isSafeInteger(state.world.day) || state.world.day<0) throw new Error('Invalid merchant state.');
  const decision:Decision={merchant:need.merchant,method:null,args:{},reason:'',probability:null};
  const idle=(reason:string)=>({...decision,reason});
  if (!actor.open) return idle('Stall closed: no Copper. An investment is needed.');
  if (actor.account.last_consume_day===state.world.day) return idle("Today's customer need is already fulfilled.");
  const best=Object.entries(need.probabilities).filter(([,p])=>p>0.7).sort((a,b)=>a[1]-b[1] || (a[0]<b[0]?-1:1)).at(-1);
  if (!best) return idle('No potion has a suitability score above 0.70; keep funds.');
  const [potion,probability]=best;decision.probability=probability;
  const balances=actor.account.balances,coins=amount(balances.copper);
  const item=state.catalog.find((i:any)=>i.token_id===potion);
  if (!item?.recipe) throw new Error('Invalid potion recipe.');
  const value=amount(item.base_value);
  if (amount(balances[potion])>0n) return {...decision,method:'consume',args:{token_id:potion,amount:'1'},reason:"Use one owned potion to fulfil today's request."};
  const listing=state.listings.find((l:any)=>l.token_id===potion && amount(state.player.balances[potion])>0n && amount(l.price)>0n && amount(l.price)<=coins && amount(l.price)<=value*12n/10n);
  if (listing) return {...decision,method:'buy_listing',args:{token_id:potion,max_price:listing.price},reason:"Buy a suitable potion from the player's shelf within budget and 120% of base value."};
  if (item.recipe.every((input:any)=>amount(balances[input.token_id])>=amount(input.amount)) && coins>=amount(state.craft_fee) && actor.account.last_brew_day!==state.world.day) {
    return {...decision,method:'brew',args:{token_id:potion},reason:'Brew from owned ingredients and pay the craft fee; one brew per merchant per day.'};
  }
  let cheapest:{price:bigint;seller:string;token:string}|undefined;
  for (const input of item.recipe) {
    if (amount(balances[input.token_id])>=amount(input.amount)) continue;
    for (const seller of state.merchants.filter((m:any)=>m.account.account_id!==actor.account.account_id && m.open)) {
      const quote=seller.quotes.find((q:any)=>q.token_id===input.token_id);
      if (!quote) continue;
      const price=amount(quote.merchant_sells_at);
      if (amount(quote.stock)>0n && price<coins && price<=value && (!cheapest || price<cheapest.price)) cheapest={price,seller:seller.account.account_id,token:input.token_id};
    }
  }
  return cheapest ? {...decision,method:'trade',args:{merchant_id:cheapest.seller,token_id:cheapest.token,amount:'1',buy:true,limit:cheapest.price.toString()},reason:'Buy one missing ingredient at the cheapest available contract quote; retain at least one Copper.'}
    : idle('No affordable suitable shelf offer or available recipe ingredient; keep funds.');
}

const reasons:{[method:string]:string}={consume:"Used one owned potion for today's need.",buy_listing:"Bought a suitable potion from the player's shelf.",brew:'Brewed from owned ingredients and paid the craft fee.',trade:'Bought one missing ingredient at a contract quote.',world_view:'Kept existing merchant stock and funds this turn.'};
export function marketProgress(records:any[],day:number) {
  const days=records.filter(r=>r.action.kind==='next_day').length;
  let currentDay=day-days,tick=0,dayTicks=0;
  if (!Number.isSafeInteger(currentDay) || currentDay<0 || records.length>1000) throw new Error('Invalid market journal.');
  const events:any[]=[];
  for (const record of records) {
    if (record.action.kind==='next_day') {currentDay++;dayTicks=0;}
    if (record.action.kind!=='market_tick') continue;
    if (record.action.tick!==tick || dayTicks>=10 || !Object.hasOwn(reasons,record.result.method)) throw new Error('Inconsistent market turn journal.');
    const actor=merchants[tick%3],need=needFor(actor,currentDay),method=record.result.method;
    events.push({tick,day:currentDay,source:'cached_jev',model:need.model,request_sha256:need.request_sha256,
      decision:{merchant:actor,method:method==='world_view'?null:method,args:{},reason:reasons[method],probability:method==='world_view'?null:Math.max(...Object.values(need.probabilities))}});
    tick++;dayTicks++;
  }
  return {source:'cached_jev',tick,day_ticks:dayTicks,ticks_per_day:10,tick_seconds:30,blocked:false,
    needs:merchants.map(m=>needFor(m,day)),events:events.slice(-10)};
}
