import {COMBAT_GRID,combatCells} from '../web/src/arena-layout.ts';
// Combat arithmetic is deterministic. Jev judges merchant needs, never damage or winners.
export type CharacterId = 'vampire'|'goblin'|'dark-elf'|'elf'|'magician'|'lizard'|'skeleton'|'dwarf';
export type Cell = {x:number;y:number};
export type Skill = {id:string;name:string;ap:number;min:number;max:number;cd:number;casts:number;target:'enemy'|'self'|'cell'|'minion';text:string};
const skill=(id:string,name:string,ap:number,min:number,max:number,cd:number,casts:number,target:Skill['target'],text:string):Skill=>({id,name,ap,min,max,cd,casts,target,text});
export const classes:Record<CharacterId,{name:string;role:string;skills:Skill[]}>= {
  vampire:{name:'Vampire',role:'Healer',skills:[
    skill('thread','Crimson Thread',3,1,3,0,2,'enemy','15 damage. Heal half the health damage dealt.'),
    skill('mend','Night Mend',4,0,0,2,1,'self','Heal 26 health and cleanse the oldest poison or burn.'),
    skill('oath','Pallid Oath',2,1,4,3,1,'enemy','Reduce direct spell damage by 30% through the next enemy turn.') ]},
  goblin:{name:'Goblin',role:'Rogue',skills:[
    skill('shiv','Viper Shiv',3,1,1,0,2,'enemy','16 damage. Poison for 4 at the next two turn starts.'),
    skill('smoke','Smoke Step',2,0,2,3,1,'cell','Step up to two cells and halve the next direct hit.'),
    skill('cheap','Cheap Shot',4,1,1,0,1,'enemy','24 damage; 34 against a poisoned enemy.') ]},
  'dark-elf':{name:'Dark Elf',role:'Berserker',skills:[
    skill('cleave','Raking Cleave',3,1,1,0,2,'enemy','18 damage, plus 4 per full quarter of health missing, up to 12 extra.'),
    skill('price','Blood Price',2,0,0,2,1,'self','Pay 8 health to strengthen the next direct attack this turn by 50%.'),
    skill('rupture','Rupture',4,1,3,2,1,'enemy','Charge up to two cells. 30 damage, or 45 at 40% health or below.') ]},
  elf:{name:'Elf',role:'Archer',skills:[
    skill('briar','Briar Arrow',3,2,6,0,2,'enemy','18 damage; 21 before spending movement this turn.'),
    skill('gale','Gale Arrow',4,1,4,0,1,'enemy','12 damage and push the target up to two cells.'),
    skill('silence','Silencing Volley',4,2,5,3,1,'enemy','16 damage and two fewer action points next turn.') ]},
  magician:{name:'Magician',role:'Pyromancer',skills:[
    skill('lance','Cinder Lance',3,1,4,0,2,'enemy','16 damage. Burn for 5 at the next two turn starts.'),
    // The paper review found 38 damage insufficient beside two Lances; test the 46-damage detonation.
    skill('flash','Flashover',4,1,4,0,1,'enemy','24 damage; 46 by consuming your existing burn.'),
    skill('ash','Ash Ring',4,0,3,3,1,'cell','Place a five-cell fire zone for two enemy turns. 8 damage once per actor per round.') ]},
  lizard:{name:'Lizardman',role:'Protector',skills:[
    skill('scale','Scale Strike',3,1,1,0,2,'enemy','15 damage. A health hit grants 6 shield until your next turn.'),
    skill('guard','Stoneblood Guard',4,0,0,2,1,'self','28 shield through two enemy turns. Shields do not heal.'),
    skill('anchor','Anchor Roar',2,1,3,3,1,'enemy','Two fewer movement points next turn. Resist pushes and pulls until your next turn.') ]},
  skeleton:{name:'Liche',role:'Necromancer',skills:[
    skill('needle','Grave Needle',3,1,4,0,2,'enemy','18 damage. Reduce healing received by 25% through the next enemy turn.'),
    skill('raise','Raise Boneguard',3,1,1,3,1,'cell','Summon one 20-health Boneguard. It moves and strikes for 6 after later turns.'),
    skill('recall','Soul Recall',3,0,12,0,1,'minion','Sacrifice your Boneguard and recover its remaining health.') ]},
  dwarf:{name:'Dwarf',role:'Hunter',skills:[
    skill('quarry','Quarry Bolt',3,1,4,0,2,'enemy','17 damage. Mark the target for two of its turns.'),
    skill('snare','Iron Snare',3,0,3,0,1,'cell','One visible trap: 20 damage, or 28 against a marked target, and a movement penalty.'),
    skill('harpoon','Harpoon Line',2,2,4,3,1,'enemy','Pull one cell, or two against a marked target. Cast in a straight line.') ]},
};
export const BOARD=COMBAT_GRID.size,TURN_MS=60_000;
const floorCells=new Set(combatCells.map(p=>p.x+','+p.y));
export const walls:Cell[]=Array.from({length:BOARD**2},(_,i)=>({x:COMBAT_GRID.min+i%BOARD,y:COMBAT_GRID.min+Math.floor(i/BOARD)})).filter(p=>!floorCells.has(p.x+','+p.y));
export const same=(a:Cell,b:Cell)=>a.x===b.x&&a.y===b.y;
export const distance=(a:Cell,b:Cell)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export const onBoard=(p:Cell)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=COMBAT_GRID.min&&p.y>=COMBAT_GRID.min&&p.x<COMBAT_GRID.min+BOARD&&p.y<COMBAT_GRID.min+BOARD;
export const power=(n:number,level:number)=>Math.floor((n*(100+5*(level-1))+50)/100);
export const totalXp=(level:number)=>20*(2**(level-1)-1);
export function levelForXp(xp:number){let level=1;while(level<20&&xp>=totalXp(level+1))level++;return level;}
export function xpForWin(winnerLevel:number,opponentLevel:number){
  if(winnerLevel>=20)return 0;
  const e=Math.min(opponentLevel,winnerLevel+2)-1,n=20n*7n**BigInt(e),d=4n**BigInt(e);
  return Number((n+d-1n)/d);
}
type Dot={amount:number;ticks:number;source:string;order:number};
type Effects={poison?:Dot;burn?:Dot;marked?:number;weak?:number;healing?:number;evade?:number;grounded?:number;bonus?:boolean;apLoss?:number;mpLoss?:number};
type Shield={kind:string;amount:number;until:number};
export type Unit={id:string;owner:string;kind:'fighter'|'minion';pos:Cell;hp:number;maxHp:number;shields:Shield[];effects:Effects;ready?:number};
export type Profile={id:string;nickname:string;character:CharacterId;xp:number;wins:number;losses:number};
export type Fighter=Unit&{nickname:string;character:CharacterId;level:number;ap:number;mp:number;moved:boolean;turn:number;cooldowns:Record<string,number>;used:Record<string,number>};
export type CombatVisual={version:number;actor:string;skill:string;from:Cell;to:Cell;changes:{id:string;pos:Cell;hp:number;shield:number}[]};
export type Duel={id:string;rules:1;training?:boolean;visuals?:CombatVisual[];players:[Fighter,Fighter];minions:Unit[];zones:{owner:string;cell:Cell;through:number;hits:Record<string,number>}[];traps:{owner:string;cell:Cell;through:number}[];active:number;round:number;half:number;version:number;deadline:number;result:null|{winner:string|null;reason:string};log:string[];awarded:boolean};
export type CombatAction={kind:'move';x:number;y:number}|{kind:'cast';skill:string;target?:string;x?:number;y?:number}|{kind:'end'}|{kind:'timeout'};
function requireRule(test:unknown,message:string):asserts test{if(!test)throw Object.assign(Error(message),{status:400});}
function owner(d:Duel,u:Unit){return d.players.find(p=>p.id===u.owner)!;}
export function units(d:Duel):Unit[]{return [...d.players,...d.minions].filter(p=>p.hp>0);}
export function empty(d:Duel,p:Cell,ignore?:string){return onBoard(p)&&floorCells.has(p.x+','+p.y)&&!units(d).some(u=>u.id!==ignore&&same(u.pos,p));}
function neighbors(p:Cell){return [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}];}
export function path(d:Duel,from:Cell,to:Cell,ignore?:string):Cell[]|null{
  if(!onBoard(to)||!empty(d,to,ignore))return null;
  if(same(from,to))return [];
  const queue:{p:Cell;steps:Cell[]}[]=[{p:from,steps:[]}],seen=new Set([`${from.x},${from.y}`]);
  for(let i=0;i<queue.length;i++)for(const p of neighbors(queue[i].p)){
    const key=`${p.x},${p.y}`;if(seen.has(key)||!empty(d,p,ignore))continue;seen.add(key);
    const steps=[...queue[i].steps,p];if(same(p,to))return steps;queue.push({p,steps});
  }
  return same(from,to)?[]:null;
}
export function sight(from:Cell,to:Cell){
  // Supercover traversal prevents shooting through a blocked diagonal corner.
  const dx=to.x-from.x,dy=to.y-from.y,nx=Math.abs(dx),ny=Math.abs(dy),sx=Math.sign(dx),sy=Math.sign(dy);
  let x=from.x,y=from.y,ix=0,iy=0;
  const blocked=(a:number,b:number)=>!floorCells.has(a+','+b);
  while(ix<nx||iy<ny){
    const decision=(1+2*ix)*ny-(1+2*iy)*nx;
    if(decision===0){if(blocked(x+sx,y)||blocked(x,y+sy))return false;x+=sx;y+=sy;ix++;iy++;}
    else if(decision<0){x+=sx;ix++;}else{y+=sy;iy++;}
    if(blocked(x,y))return false;
  }
  return true;
}
function log(d:Duel,text:string){d.log.push(text);if(d.log.length>80)d.log.shift();}
function name(d:Duel,u:Unit){return u.kind==='fighter'?owner(d,u).nickname:`${owner(d,u).nickname}'s Boneguard`;}
function finish(d:Duel){
  if(d.result)return;
  const alive=d.players.filter(p=>p.hp>0);
  if(alive.length<2){d.result={winner:alive[0]?.id||null,reason:alive.length?'knockout':'double knockout'};log(d,alive.length?`${alive[0].nickname} wins by knockout.`:'Both fighters fall. Draw.');d.minions=[];d.zones=[];d.traps=[];}
  d.minions=d.minions.filter(p=>p.hp>0);
}
function damage(d:Duel,target:Unit,n:number,direct=false){
  if(d.result||target.hp<=0)return 0;
  if(direct&&target.effects.evade!==undefined){n=Math.floor(n/2);delete target.effects.evade;}
  for(const s of target.shields.sort((a,b)=>a.until-b.until)){const block=Math.min(n,s.amount);s.amount-=block;n-=block;}
  target.shields=target.shields.filter(s=>s.amount>0);
  const actual=Math.min(target.hp,n);target.hp-=actual;
  if(actual)log(d,`${name(d,target)} takes ${actual} damage.`);
  return actual;
}
function heal(d:Duel,u:Unit,n:number){
  if(u.hp<=0)return;
  if(u.effects.healing!==undefined)n=Math.floor(n*.75);
  const gained=Math.min(u.maxHp-u.hp,n);u.hp+=gained;
  log(d,`${name(d,u)} recovers ${gained} health.`);
}
function shield(d:Duel,p:Fighter,kind:string,n:number,until:number){
  let existing=p.shields.find(s=>s.kind===kind);
  if(kind==='scale'&&existing)n=Math.min(power(12,p.level),existing.amount+n);
  p.shields=p.shields.filter(s=>s.kind!==kind);
  n=Math.max(0,Math.min(n,power(40,p.level)-p.shields.reduce((sum,s)=>sum+s.amount,0)));
  if(n)p.shields.push({kind,amount:n,until});
  log(d,`${p.nickname} has ${p.shields.reduce((sum,s)=>sum+s.amount,0)} shield.`);
}
function ground(d:Duel,u:Unit){
  if(d.result||u.hp<=0)return;
  for(const trap of [...d.traps])if(trap.owner!==u.owner&&same(trap.cell,u.pos)){
    const caster=d.players.find(p=>p.id===trap.owner)!;
    damage(d,u,power(u.effects.marked!==undefined?28:20,caster.level));u.effects.mpLoss=2;
    d.traps=d.traps.filter(t=>t!==trap);log(d,'Iron Snare springs.');finish(d);if(d.result||u.hp<=0)return;
  }
  for(const zone of d.zones)if(zone.owner!==u.owner&&distance(zone.cell,u.pos)<=1&&zone.hits[u.id]!==d.round){
    zone.hits[u.id]=d.round;damage(d,u,power(8,d.players.find(p=>p.id===zone.owner)!.level));finish(d);if(d.result)return;
  }
}
function displace(d:Duel,caster:Fighter,u:Unit,count:number,pull:boolean){
  if(u.effects.grounded!==undefined||u.hp<=0)return;
  const dx=u.pos.x-caster.pos.x,dy=u.pos.y-caster.pos.y;
  const step=Math.abs(dx)>=Math.abs(dy)?{x:Math.sign(dx),y:0}:{x:0,y:Math.sign(dy)};
  for(let i=0;i<count;i++){
    const destination={x:u.pos.x+step.x*(pull?-1:1),y:u.pos.y+step.y*(pull?-1:1)};
    if(!empty(d,destination,u.id))break;
    u.pos=destination;ground(d,u);if(d.result||u.hp<=0)break;
  }
}
function start(d:Duel,now:number){
  const p=d.players[d.active];p.turn++;p.used={};p.moved=false;
  d.traps=d.traps.filter(t=>t.owner!==p.id||t.through>p.turn);
  for(const u of [p,...d.minions.filter(u=>u.owner===p.id)]){
    u.shields=u.shields.filter(s=>s.until>p.turn);
    for(const key of ['marked','weak','healing','evade','grounded'] as const)if(u.effects[key]!==undefined&&u.effects[key]!<p.turn)delete u.effects[key];
    for(const key of ['poison','burn'] as const){const effect=u.effects[key];if(effect){damage(d,u,effect.amount);if(--effect.ticks<=0)delete u.effects[key];}}
    finish(d);if(d.result)return;
    ground(d,u);if(d.result)return;
  }
  p.ap=6-Math.min(2,p.effects.apLoss||0);p.mp=3-Math.min(2,p.effects.mpLoss||0);
  delete p.effects.apLoss;delete p.effects.mpLoss;
  d.deadline=now+TURN_MS;log(d,`${p.nickname}'s turn: ${p.ap} AP, ${p.mp} MP.`);
}
function minionTurn(d:Duel,p:Fighter){
  for(const u of d.minions.filter(u=>u.owner===p.id&&u.hp>0&&(u.ready||0)<=p.turn)){
    const enemy=d.players.find(q=>q.id!==p.id)!;
    const movement=3-Math.min(2,u.effects.mpLoss||0);delete u.effects.mpLoss;
    for(let step=0;step<movement&&distance(u.pos,enemy.pos)>1;step++){
      const candidates=neighbors(enemy.pos).filter(c=>empty(d,c,u.id)).map(c=>path(d,u.pos,c,u.id)).filter((v):v is Cell[]=>v!==null).sort((a,b)=>a.length-b.length);
      if(!candidates[0]?.length)break;u.pos=candidates[0][0];ground(d,u);if(d.result||u.hp<=0)break;
    }
    if(!d.result&&u.hp>0&&distance(u.pos,enemy.pos)===1){
      const before=enemy.shields.reduce((n,s)=>n+s.amount,0),actual=damage(d,enemy,u.effects.weak!==undefined?Math.floor(power(6,p.level)*.7):power(6,p.level),true);
      d.visuals=[...(d.visuals||[]),{version:d.version+1,actor:u.id,skill:'raise',from:{...u.pos},to:{...enemy.pos},changes:[{id:enemy.id,pos:{...enemy.pos},hp:-actual,shield:enemy.shields.reduce((n,s)=>n+s.amount,0)-before}]}].slice(-16);
      log(d,'Boneguard strikes.');finish(d);
    }
    if(d.result)return;
  }
}
function end(d:Duel,now:number){
  const p=d.players[d.active];minionTurn(d,p);if(d.result)return;
  delete p.effects.bonus;
  for(const u of units(d).filter(u=>u.owner===p.id))for(const key of ['marked','weak','healing'] as const)if(u.effects[key]!==undefined&&u.effects[key]!<=p.turn)delete u.effects[key];
  d.zones=d.zones.filter(z=>z.owner===p.id||z.through>p.turn);
  if(++d.half===2){
    d.half=0;
    if(!d.training&&d.round>10){
      for(const q of d.players){const n=Math.min(q.hp,power(2*(d.round-10),q.level));q.hp-=n;log(d,`${q.nickname} takes ${n} arena fatigue.`);}
      finish(d);if(d.result)return;
    }
    d.round++;
  }
  d.active=1-d.active;start(d,now);
  if(d.training&&!d.result&&d.active===1)end(d,now);
}
export function makeDuel(id:string,profiles:[Profile,Profile],now:number,first=0):Duel{
  requireRule(profiles[0].id!==profiles[1].id,'Choose another player.');
  const players=profiles.map((p,i):Fighter=>{
    const level=levelForXp(p.xp),maxHp=100+5*(level-1);
    return {id:p.id,owner:p.id,kind:'fighter' as const,nickname:p.nickname,character:p.character,level,maxHp,hp:maxHp,pos:{x:i?5:1,y:3},ap:0,mp:0,moved:false,turn:0,cooldowns:{},used:{},shields:[],effects:{}};
  });
  const d:Duel={id,rules:1,players:[players[0],players[1]],minions:[],zones:[],traps:[],active:first?1:0,round:1,half:0,version:0,deadline:now+TURN_MS,result:null,log:['Friendly duel. No items or Copper are at stake.'],awarded:false};start(d,now);return d;
}
export function expire(d:Duel,now:number){if(!d.result&&now>=d.deadline){log(d,'Time is up. The turn passes.');end(d,now);d.version++;return true;}return false;}
export function perform(d:Duel,actor:string,action:CombatAction,now:number){
  requireRule(!d.result,'This duel has ended.');
  requireRule(d.players.some(p=>p.id===actor),'This is not your duel.');
  if(action.kind==='timeout'){requireRule(now>=d.deadline,'This turn still has time.');expire(d,now);return;}
  requireRule(now<d.deadline,'This turn has expired. Refresh the arena.');
  const p=d.players[d.active];requireRule(p.id===actor,'Wait for your turn.');
  if(action.kind==='end'){end(d,now);d.version++;return;}
  if(action.kind==='move'){
    const steps=path(d,p.pos,action,p.id);requireRule(steps&&steps.length>0&&steps.length<=p.mp,'Choose a reachable cell within your movement points.');
    for(const cell of steps){p.pos=cell;p.mp--;p.moved=true;ground(d,p);if(d.result)break;}log(d,`${p.nickname} moves.`);d.version++;return;
  }
  requireRule(action.kind==='cast','Unknown arena action.');
  const s=classes[p.character].skills.find(s=>s.id===action.skill);requireRule(s,'That skill does not belong to your class.');
  requireRule(p.ap>=s.ap,'Not enough action points.');
  requireRule((p.cooldowns[s.id]||0)<=p.turn,'That skill is cooling down.');
  requireRule((p.used[s.id]||0)<s.casts,'That skill has reached its turn limit.');
  let target:Unit|undefined,cell:Cell|undefined,charge:Cell[]|null=null;
  if(s.target==='self')target=p;
  else if(s.target==='cell'){
    cell={x:action.x!,y:action.y!};requireRule(onBoard(cell)&&distance(p.pos,cell)>=s.min&&distance(p.pos,cell)<=s.max&&sight(p.pos,cell),'Choose a visible cell within skill range.');
    if(s.id==='smoke'||s.id==='raise')requireRule(empty(d,cell,p.id)&&!same(cell,p.pos),'That destination is occupied.');
    if(s.id==='smoke'){const route=path(d,p.pos,cell,p.id);requireRule(route&&route.length<=2,'Smoke Step cannot cross that obstacle.');}
    if(s.id==='raise')requireRule(!d.minions.some(u=>u.owner===p.id),'Your Boneguard is already present.');
    if(s.id==='snare')requireRule(empty(d,cell),'A trap needs an empty cell.');
    if(s.id==='ash')requireRule(floorCells.has(cell!.x+','+cell!.y),'Choose open ground.');
  }else{
    target=units(d).find(u=>u.id===action.target);requireRule(target,'Choose a living target.');
    if(s.target==='minion')requireRule(target.kind==='minion'&&target.owner===p.id,'Choose your own Boneguard.');
    else requireRule(target.owner!==p.id,'Choose an enemy target.');
    requireRule(distance(p.pos,target.pos)>=s.min&&distance(p.pos,target.pos)<=s.max&&(s.target==='minion'||sight(p.pos,target.pos)),'The target is outside range or behind cover.');
    if(s.id==='harpoon')requireRule(p.pos.x===target.pos.x||p.pos.y===target.pos.y,'Harpoon Line requires a straight line.');
    if(s.id==='rupture'){
      charge=neighbors(target.pos).filter(c=>same(c,p.pos)||empty(d,c,p.id)).map(c=>path(d,p.pos,c,p.id)).filter((v):v is Cell[]=>v!==null&&v.length<=2).sort((a,b)=>a.length-b.length)[0]||null;
      requireRule(charge!==null,'There is no clear charge path.');
    }
  }
  if(s.id==='price')requireRule(p.hp>power(8,p.level),'Blood Price would cost your last health.');
  p.ap-=s.ap;p.used[s.id]=(p.used[s.id]||0)+1;if(s.cd)p.cooldowns[s.id]=p.turn+s.cd;
  log(d,`${p.nickname} casts ${s.name}.`);
  if(s.id==='mend'){
    heal(d,p,power(26,p.level));const dots=(['poison','burn'] as const).filter(k=>p.effects[k]).sort((a,b)=>p.effects[a]!.order-p.effects[b]!.order);if(dots[0])delete p.effects[dots[0]];
  }else if(s.id==='oath')target!.effects.weak=owner(d,target!).turn+1;
  else if(s.id==='smoke'){p.pos=cell!;p.effects.evade=p.turn;ground(d,p);}
  else if(s.id==='price'){p.hp-=power(8,p.level);p.effects.bonus=true;}
  else if(s.id==='guard')shield(d,p,'guard',power(28,p.level),p.turn+2);
  else if(s.id==='anchor'){target!.effects.mpLoss=2;p.effects.grounded=p.turn;}
  else if(s.id==='raise'){
    const bone:Unit={id:p.id+'-bone',owner:p.id,kind:'minion',pos:cell!,hp:power(20,p.level),maxHp:power(20,p.level),effects:{},shields:[],ready:p.turn+1};
    d.minions.push(bone);ground(d,bone);
  }
  else if(s.id==='recall'){const remaining=target!.hp;d.minions=d.minions.filter(u=>u.id!==target!.id);heal(d,p,remaining);}
  else if(s.id==='ash'){d.zones=d.zones.filter(z=>z.owner!==p.id);d.zones.push({owner:p.id,cell:cell!,through:d.players[1-d.active].turn+2,hits:{}});}
  else if(s.id==='snare'){d.traps=d.traps.filter(t=>t.owner!==p.id);d.traps.push({owner:p.id,cell:cell!,through:p.turn+3});}
  else if(s.id==='harpoon')displace(d,p,target!,target!.effects.marked!==undefined?2:1,true);
  else{
    let base=({thread:15,shiv:16,cheap:target!.effects.poison?34:24,cleave:18+4*Math.min(3,Math.floor((p.maxHp-p.hp)*4/p.maxHp)),rupture:p.hp*100<=p.maxHp*40?45:30,briar:p.moved?18:21,gale:12,silence:16,lance:16,flash:target!.effects.burn?.source===p.id?46:24,scale:15,needle:18,quarry:17} as Record<string,number>)[s.id];
    requireRule(base!==undefined,'Skill effect is unavailable.');
    if(charge){for(const c of charge){p.pos=c;ground(d,p);if(d.result)break;}if(d.result){d.version++;return;}}
    if(s.id==='flash'&&target!.effects.burn?.source===p.id)delete target!.effects.burn;
    let n=power(base,p.level);if(p.effects.bonus){n=Math.floor(n*1.5);delete p.effects.bonus;}if(p.effects.weak!==undefined)n=Math.floor(n*.7);
    const actual=damage(d,target!,n,true);
    if(s.id==='thread')heal(d,p,Math.floor(actual/2));
    if(actual){
      if(s.id==='shiv'||s.id==='lance')target!.effects[s.id==='shiv'?'poison':'burn']={amount:power(s.id==='shiv'?4:5,p.level),ticks:2,source:p.id,order:d.version};
      if(s.id==='scale')shield(d,p,'scale',power(6,p.level),p.turn+1);
      if(s.id==='needle')target!.effects.healing=owner(d,target!).turn+1;
      if(s.id==='quarry')target!.effects.marked=owner(d,target!).turn+2;
    }
    if(s.id==='silence'&&target!.hp>0)target!.effects.apLoss=2;
    if(s.id==='gale')displace(d,p,target!,2,false);
    finish(d);
  }
  finish(d);d.version++;
}
