import {combatCells} from '../web/src/arena-layout.ts';
// Offline screening only: these two imperfect bots cannot establish human balance.
import assert from 'node:assert/strict';
import {classes,makeDuel,perform,units,path,distance,sight,totalXp,power,type CharacterId,type Duel,type CombatAction,type Cell} from '../backend/combat.ts';

const ids=Object.keys(classes) as CharacterId[];
const cells:Cell[]=combatCells;
type Policy='pressure'|'sustain';
function candidates(d:Duel):CombatAction[]{
  const p=d.players[d.active],enemy=d.players[1-d.active],actions:CombatAction[]=[];
  for(const s of classes[p.character].skills){
    if(s.ap>p.ap||(p.cooldowns[s.id]||0)>p.turn||(p.used[s.id]||0)>=s.casts)continue;
    if(s.target==='self')actions.push({kind:'cast',skill:s.id});
    else if(s.target==='enemy'||s.target==='minion')for(const u of units(d).filter(u=>s.target==='enemy'?u.owner!==p.id:u.owner===p.id&&u.kind==='minion'))actions.push({kind:'cast',skill:s.id,target:u.id});
    else for(const c of cells){
      if(distance(c,p.pos)>s.max)continue;
      // Keep cell planning bounded, including both approach and retreat placements.
      if(s.id==='ash'&&distance(c,enemy.pos)>1||s.id==='snare'&&distance(c,enemy.pos)>2)continue;
      actions.push({kind:'cast',skill:s.id,...c});
    }
  }
  if(p.mp)for(const c of cells){const route=path(d,p.pos,c,p.id);if(route?.length&&route.length<=p.mp)actions.push({kind:'move',...c});}
  return actions;
}
function value(d:Duel,actor:string,policy:Policy){
  const p=d.players.find(p=>p.id===actor)!,q=d.players.find(p=>p.id!==actor)!;
  if(d.result)return d.result.winner===actor?10_000:d.result.winner?-10_000:0;
  const scale=(n:number)=>n/(1+.05*(p.level-1));
  const health=(u:typeof p)=>scale(u.hp+u.shields.reduce((n,s)=>n+s.amount,0)*.5-(u.effects.poison?u.effects.poison.amount*u.effects.poison.ticks*.7:0)-(u.effects.burn?u.effects.burn.amount*u.effects.burn.ticks*.7:0));
  let score=health(p)*(policy==='sustain'?1.2:1)-health(q)*(policy==='pressure'?1.2:1);
  const reach=classes[p.character].skills.find(s=>s.target==='enemy')!,gap=distance(p.pos,q.pos);
  const desired=reach.min===1&&reach.max===1?1:policy==='pressure'?2:Math.max(2,reach.max-1);
  score-=Math.abs(gap-desired)*1.8+(sight(p.pos,q.pos)?0:3);
  if(p.effects.bonus)score+=10;
  if(p.effects.evade!==undefined)score+=5;
  if(q.effects.weak!==undefined)score+=5;
  if(q.effects.healing!==undefined&&['vampire','skeleton'].includes(q.character))score+=3;
  if(q.effects.apLoss)score+=5;if(q.effects.mpLoss)score+=2;
  if(q.effects.marked!==undefined)score+=2;
  for(const u of d.minions)score+=(u.owner===actor?1:-1)*scale(u.hp*.35+power(6,p.level)*.6);
  for(const z of d.zones)score+=(z.owner===actor?1:-1)*(distance(z.cell,z.owner===actor?q.pos:p.pos)<=1?5:1);
  for(const t of d.traps)score+=(t.owner===actor?1:-1)*(distance(t.cell,t.owner===actor?q.pos:p.pos)<=1?4:1);
  return score;
}
function turn(d:Duel,policy:Policy,uses:Record<string,number>){
  const actor=d.players[d.active].id;
  type Plan={d:Duel;actions:CombatAction[];score:number};
  let beam:Plan[]=[{d,actions:[],score:value(d,actor,policy)}],best:Plan|undefined;
  for(let depth=0;depth<4;depth++){
    const next:Plan[]=[];
    for(const node of beam){
      const ended=structuredClone(node.d);if(!ended.result)perform(ended,actor,{kind:'end'},0);
      const completed={d:ended,actions:node.actions,score:value(ended,actor,policy)};
      if(!best||completed.score>best.score)best=completed;
      if(node.d.result)continue;
      for(const action of candidates(node.d)){
        const copy=structuredClone(node.d);
        try{perform(copy,actor,action,0);}catch{continue;}
        next.push({d:copy,actions:[...node.actions,action],score:value(copy,actor,policy)});
      }
    }
    beam=next.sort((a,b)=>b.score-a.score).slice(0,3);
    if(!beam.length)break;
  }
  for(const node of beam){const ended=structuredClone(node.d);if(!ended.result)perform(ended,actor,{kind:'end'},0);const score=value(ended,actor,policy);if(!best||score>best.score)best={...node,d:ended,score};}
  assert(best);for(const a of best.actions)if(a.kind==='cast')uses[a.skill]=(uses[a.skill]||0)+1;
  return best.d;
}
type Result={level:number;policy:Policy;left:CharacterId;right:CharacterId;first:number;winner:CharacterId|null;winnerIndex:number|null;round:number};
const results:Result[]=[],uses:Record<string,number>={};
for(const level of [1,10,20])for(const policy of ['pressure','sustain'] as const)for(let a=0;a<ids.length;a++)for(let b=a;b<ids.length;b++)for(const reversed of [false,true])for(const first of [0,1]){
  const pair=reversed?[ids[b],ids[a]]:[ids[a],ids[b]];
  let d=makeDuel('screen',[{id:'a',nickname:'A',character:pair[0],xp:totalXp(level),wins:0,losses:0},{id:'b',nickname:'B',character:pair[1],xp:totalXp(level),wins:0,losses:0}],0,first),turns=0;
  while(!d.result&&turns++<80)d=turn(d,policy,uses);
  assert(d.result,'The fatigue rule must end stalled matches.');
  results.push({level,policy,left:pair[0],right:pair[1],first,winner:d.result.winner?pair[d.result.winner==='a'?0:1]:null,winnerIndex:d.result.winner?d.result.winner==='a'?0:1:null,round:d.round});
}
const gaps:{left:CharacterId;right:CharacterId;levels:number[];first:number;winner:string|null}[]=[];
for(const levels of [[1,3],[1,20]])for(const a of ids)for(const b of ids)for(const first of [0,1]){
  let d=makeDuel('gap',[{id:'a',nickname:'A',character:a,xp:totalXp(levels[0]),wins:0,losses:0},{id:'b',nickname:'B',character:b,xp:totalXp(levels[1]),wins:0,losses:0}],0,first),turns=0;
  while(!d.result&&turns++<80)d=turn(d,'pressure',uses);
  assert(d.result);gaps.push({left:a,right:b,levels,first,winner:d.result.winner});
}
const rates=ids.map(id=>{const games=results.filter(r=>r.left!==r.right&&(r.left===id||r.right===id));return {id,games:games.length,wins:games.filter(r=>r.winner===id).length,draws:games.filter(r=>!r.winner).length};});
const firstWins=results.filter(r=>r.winnerIndex===r.first).length;
console.log(JSON.stringify({rules:1,warning:'Deterministic two-policy screening on one terrain only; not human balance or confidence intervals.',matches:results.length,gapMatches:gaps.length,firstWins,rates,uses,results,gaps},null,2));
