import type {Item} from './types';

export function gatheringProblem(resource:Item|undefined,amount:number,day:number,market:boolean):string|null {
  if(!resource)return 'Gathering details are unavailable. Refresh your ledger and try again.';
  const cap=BigInt(resource.gather_cap),collected=BigInt(resource.gathered_today),left=cap-collected;
  if(cap===0n)return `${resource.name} cannot be gathered in this saved game. Check the merchant stalls for supplies.`;
  if(left<=0n)return `This save has collected ${collected}/${cap} ${resource.name} on market day ${day+1}. ${market?'Run the market':'Choose Next market day'} in your ledger to replenish it. Reopening the game does not start a new market day.`;
  if(BigInt(amount)>left)return `Only ${left} ${resource.name} left this market day. Choose ${left} or fewer.`;
  return null;
}
