import {createHash} from 'node:crypto';
import type {Duel} from './combat.ts';
import type {Store} from './arena-engine.ts';

export type ResultRecord={match_id:string;players:[string,string];saves?:[string,string];winner:string|null;expected_xp:[number,number];rules:1;log_hash:string};
export type Progress={xp:number;wins:number;losses:number};
export type Settlement={result:ResultRecord;status:'pending'|'confirmed';hash?:string};
export type Referee={result:(id:string)=>Promise<ResultRecord|null>;settle:(result:ResultRecord)=>Promise<{hash:string}>;progress:(account:string,save?:string)=>Promise<Progress>};
export function duelRecord(s:Store,d:Duel):ResultRecord{
  if(d.training||!d.result)throw Error('Only completed PvP matches can be settled.');
  const players=d.players.map(p=>s.wallets?.[p.id]) as [string,string];
  if(players.some(p=>!p)||players[0]===players[1])throw Error('Two verified player wallets are required.');
  return {match_id:d.id,players,saves:d.players.map(p=>p.id) as [string,string],winner:d.result.winner?s.wallets![d.result.winner]:null,expected_xp:d.players.map(p=>s.profiles[p.id].xp) as [number,number],rules:d.rules,
    log_hash:createHash('sha256').update(JSON.stringify({players:d.players,result:d.result,round:d.round,log:d.log})).digest('hex')};
}
const same=(a:ResultRecord,b:ResultRecord)=>a.match_id===b.match_id&&a.winner===b.winner&&a.rules===b.rules&&a.log_hash===b.log_hash&&a.players.every((v,i)=>v===b.players[i]&&a.expected_xp[i]===b.expected_xp[i]&&a.saves?.[i]===b.saves?.[i]);
export async function settlePending(original:Store,referee:Referee):Promise<Store>{
  const s=structuredClone(original);
  for(const receipt of Object.values(s.settlements||{})){
    if(receipt.status==='confirmed')continue;
    const r=receipt.result;
    const prior=await referee.result(r.match_id);
    if(prior&&!same(prior,r))throw Error('The on-chain match receipt conflicts with the saved result.');
    if(!prior){receipt.hash=(await referee.settle(r)).hash;const confirmed=await referee.result(r.match_id);if(!confirmed||!same(confirmed,r))throw Error('Duel settlement is not confirmed yet.');}
    const progress=await Promise.all(r.players.map((p,i)=>referee.progress(p,r.saves?.[i])));
    for(let i=0;i<2;i++){
      const p=progress[i];
      if(![p.xp,p.wins,p.losses].every(v=>Number.isSafeInteger(v)&&v>=0)||p.xp<r.expected_xp[i])throw Error('Invalid on-chain progression.');
    }
    const duel=s.matches[r.match_id];if(!duel?.result)throw Error('The saved match is unavailable.');
    duel.players.forEach((p,i)=>Object.assign(s.profiles[p.id],progress[i]));
    receipt.status='confirmed';
  }
  return s;
}
