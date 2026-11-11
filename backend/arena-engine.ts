import {createHash,randomInt,randomUUID} from 'node:crypto';
import {classes,makeDuel,perform,expire,xpForWin,levelForXp,units,type CharacterId,type CombatAction,type Duel,type Profile} from './combat.ts';
import {duelRecord,type Settlement} from './arena-settlement.ts';
import {arenaNavigation,arenaSpawn} from '../web/src/arena-layout.ts';
import type {Point} from '../web/src/navigation.ts';
type Invite={id:string;from:string;to:string;expires:number};
export type Store={version:1;wallets?:Record<string,string>;settlements?:Record<string,Settlement>;practice?:Record<string,Duel>;positions?:Record<string,Point>;seen?:Record<string,number>;profiles:Record<string,Profile>;matches:Record<string,Duel>;invites:Invite[];requests:Record<string,{owner:string;hash:string}>};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const worldId=(v:unknown):v is string=>uuid(v)||typeof v==='string'&&/^sandbox-[0-9]{16,20}$/.test(v);
function failure(message:string,status=400):never{throw Object.assign(Error(message),{status});}
const keys=(value:Record<string,unknown>,names:string[])=>Object.keys(value).sort().join(',')===names.sort().join(',');
function validateCombat(action:unknown):asserts action is CombatAction{
  if(!action||typeof action!=='object'||Array.isArray(action))failure('Invalid combat action.');
  const a=action as Record<string,unknown>;
  if(a.kind==='end'||a.kind==='timeout'){if(!keys(a,['kind']))failure('Invalid turn request.');return;}
  if(a.kind==='move'){if(!keys(a,['kind','x','y'])||!Number.isInteger(a.x)||!Number.isInteger(a.y))failure('Invalid movement.');return;}
  if(a.kind!=='cast'||typeof a.skill!=='string'||a.skill.length>30)failure('Invalid skill request.');
  const allowed=['kind','skill',...(a.target!==undefined?['target']:[]),...(a.x!==undefined?['x']:[]),...(a.y!==undefined?['y']:[])];
  if(!keys(a,allowed)||a.target!==undefined&&(typeof a.target!=='string'||a.target.length>100)||a.x!==undefined&&!Number.isInteger(a.x)||a.y!==undefined&&!Number.isInteger(a.y))failure('Invalid skill target.');
}

export type ArenaIdentity={nickname:string;character_id:CharacterId;wallet?:string};
export function arenaStep(original:Store,id:string,identity:ArenaIdentity|undefined,method:string,body:Record<string,unknown>|null,now:number){
  function active(s:Store,id:string){return (s.practice?.[id]&&!s.practice[id].result?s.practice[id]:undefined)||Object.values(s.matches).find(d=>!d.result&&d.players.some(p=>p.id===id));}
  function award(s:Store,d:Duel){
    if(d.training||!d.result||d.awarded)return;
    if(d.players.some(p=>s.wallets?.[p.id])){
      const result=duelRecord(s,d);s.settlements??={};s.settlements[d.id]={result,status:'pending'};d.awarded=true;
      d.log.push('Result saved. NEAR confirmation is pending; you may return to the courtyard.');return;
    }
    d.awarded=true;
    if(d.result.winner){
      const winner=s.profiles[d.result.winner],loser=d.players.find(p=>p.id!==winner.id)!;
      const earned=xpForWin(d.players.find(p=>p.id===winner.id)!.level,loser.level);
      winner.xp+=earned;winner.wins++;s.profiles[loser.id].losses++;
      d.log.push(`${winner.nickname} earns ${earned.toLocaleString('en-US')} XP. Defeat never removes XP.`);
    }
  }
  function view(s:Store,id:string,now:number){
    const current=active(s,id)||s.practice?.[id]||Object.values(s.matches).reverse().find(d=>d.players.some(p=>p.id===id));
    return {now,profile:{...s.profiles[id],level:levelForXp(s.profiles[id].xp),position:s.positions?.[id]||arenaSpawn(id)},players:Object.values(s.profiles).filter(p=>p.id!==id&&(s.seen?.[p.id]||0)>now-90_000).map(p=>({...p,level:levelForXp(p.xp),position:s.positions?.[p.id]||arenaSpawn(p.id),busy:!!active(s,p.id)})),
      invitations:s.invites.filter(i=>i.expires>now&&(i.to===id||i.from===id)).map(i=>({...i,fromName:s.profiles[i.from].nickname,toName:s.profiles[i.to].nickname})),match:current||null,
      settlement:current?s.settlements?.[current.id]||null:null,
      acknowledged:Object.entries(s.requests).filter(([,r])=>r.owner===id).slice(-32).map(([key])=>key.slice(id.length+1))};
  }
  function register(s:Store,id:string){
    const alchemist=identity;
    if(!alchemist){if(!s.profiles[id])failure('Choose and save your alchemist before entering the arena.',409);return false;}
    if(typeof alchemist.nickname!=='string'||[...alchemist.nickname].length<3||[...alchemist.nickname].length>20||typeof alchemist.character_id!=='string'||!Object.hasOwn(classes,alchemist.character_id))failure('Choose and save your alchemist before entering the arena.',409);
    if(s.profiles[id]&&(s.profiles[id].nickname!==alchemist.nickname||s.profiles[id].character!==alchemist.character_id))failure('The saved arena identity does not match this shop. Existing progress was preserved.',409);
    if(alchemist.wallet){
      if(!/^[a-z0-9][a-z0-9_.-]{1,62}[a-z0-9]$/.test(alchemist.wallet))failure('Invalid player wallet.',409);
      s.wallets??={};
      if(s.wallets[id]&&s.wallets[id]!==alchemist.wallet)failure('This save belongs to another wallet.',409);
      if(!s.wallets[id]&&s.profiles[id]&&s.profiles[id].xp>0)failure('Existing XP needs a verified migration before wallet binding.',409);
      s.wallets[id]=alchemist.wallet;
    }
    const fresh=!s.profiles[id];
    if(fresh){if(Object.keys(s.profiles).length>=128)failure('Arena profile capacity is reached.',409);s.profiles[id]={id,nickname:alchemist.nickname,character:alchemist.character_id as CharacterId,xp:0,wins:0,losses:0};}
    return fresh;
  }
  function rankReady(s:Store,players:string[]){
    if(players.some(p=>!!s.wallets?.[p])&&!players.every(p=>!!s.wallets?.[p]))failure('Both players must use the player-owned arena.',409);
    if(players.length===2&&s.wallets?.[players[0]]&&s.wallets[players[0]]===s.wallets[players[1]])failure('Use different player wallets for a ranked duel.',409);
    if(Object.values(s.settlements||{}).some(r=>r.status==='pending'&&players.some(p=>r.result.players.includes(s.wallets?.[p]||''))))failure('Your last result is awaiting NEAR confirmation. You can walk or train while it confirms.',409);
  }
  const s=structuredClone(original);
  let changed=register(s,id);s.seen??={};
  if((s.seen[id]||0)<now-15_000){s.seen[id]=now;changed=true;}
    s.invites=s.invites.filter(i=>i.expires>now);if(s.invites.length!==original.invites.length)changed=true;
    const current=active(s,id);
    if(current&&expire(current,now)){award(s,current);changed=true;}
    let conflict:string|undefined;
    if(method==='POST'){
      const b=body!;if(!uuid(b.request_id))failure('Invalid request ID.');
      const key=id+':'+b.request_id,hash=createHash('sha256').update(JSON.stringify(b)).digest('hex'),prior=s.requests[key];
      if(prior){if(prior.hash!==hash)failure('That request ID belongs to another action.',409);}
      else{
        if(b.kind==='walk'){
          if(!keys(b,['kind','x','y','request_id'])||!Number.isInteger(b.x)||!Number.isInteger(b.y))failure('Choose a point on the courtyard floor.');
          if(active(s,id))failure('Finish the fight before walking around the courtyard.',409);
          const to:Point=[b.x as number,b.y as number],from=s.positions?.[id]||arenaSpawn(id);
          if(!arenaNavigation.path(from,to))failure('That point is outside the open courtyard.');
          s.positions??={};s.positions[id]=to;
        }else if(b.kind==='practice'){
          if(!keys(b,['kind','request_id']))failure('Invalid training request.');
          if(active(s,id))failure('Finish the current fight before training.',409);
          const player=s.profiles[id],npc:Profile={id:'trainer-'+id,nickname:'Captain Cluck',character:'lizard',xp:player.xp,wins:0,losses:0};
          const duel=makeDuel(randomUUID(),[player,npc],now,0);duel.training=true;
          duel.log=['Training only. The Warden never attacks. No XP or record changes.'];
          s.practice??={};s.practice[id]=duel;
        }else if(b.kind==='stop-practice'){
          if(!keys(b,['kind','match','request_id'])||!uuid(b.match)||s.practice?.[id]?.id!==b.match)failure('That training session is no longer active.',409);
          delete s.practice[id];
        }else if(b.kind==='challenge'){
          if(!keys(b,['kind','target','request_id'])||!worldId(b.target)||b.target===id||!s.profiles[b.target])failure('Choose another available player.');
          if(active(s,id)||active(s,b.target))failure('A player is already in a duel.',409);
          rankReady(s,[id,b.target]);
          if(s.invites.some(i=>i.from===id))failure('An invitation is already waiting.');
          if(s.invites.length>=64)failure('The local invitation limit is reached.',409);
          s.invites.push({id:randomUUID(),from:id,to:b.target,expires:now+120_000});
        }else if(b.kind==='accept'||b.kind==='decline'){
          if(!keys(b,['kind','invite','request_id'])||!uuid(b.invite))failure('Invalid invitation.');
          const invite=s.invites.find(i=>i.id===b.invite&&(i.to===id||i.from===id));if(!invite)failure('That invitation has expired or belongs to another player.',409);
          if(b.kind==='accept'){
            if(invite.to!==id)failure('Only the invited player can accept.',403);
            if(active(s,id)||active(s,invite.from))failure('A player is already in a duel.',409);
            rankReady(s,[id,invite.from]);
            if(Object.keys(s.matches).length>=256)failure('Local match history is full. Existing games were preserved.',409);
            if(s.practice){delete s.practice[id];delete s.practice[invite.from];}
            const duel=makeDuel(randomUUID(),[s.profiles[invite.from],s.profiles[id]],now,randomInt(2));s.matches[duel.id]=duel;
            s.invites=s.invites.filter(i=>![i.from,i.to].some(p=>p===id||p===invite.from));
          }else s.invites=s.invites.filter(i=>i.id!==invite.id);
        }else if(b.kind==='act'){
          if(!keys(b,['kind','match','version','action','request_id'])||!uuid(b.match)||!Number.isSafeInteger(b.version))failure('Invalid match request.');
          validateCombat(b.action);const duel=s.matches[b.match]||(s.practice?.[id]?.id===b.match?s.practice[id]:undefined);
          if(!duel||!duel.players.some(p=>p.id===id))failure('This is not your duel.',403);
          if(duel.version!==b.version)conflict='The arena has moved on. The latest turn is shown.';
          else{
            const action=b.action,actor=duel.players.find(p=>p.id===id)!,from={...actor.pos};
            const before=units(duel).map(u=>({id:u.id,pos:{...u.pos},hp:u.hp,shield:u.shields.reduce((n,s)=>n+s.amount,0)}));
            const target=action.kind==='cast'?before.find(u=>u.id===action.target):undefined;
            const to=target?.pos||(action.kind==='cast'&&action.x!==undefined&&action.y!==undefined?{x:action.x,y:action.y}:from);
            perform(duel,id,action,now);award(s,duel);
            if(action.kind==='cast'){
              const changes=units(duel).concat(duel.players.filter(p=>p.hp===0)).map(u=>{const prior=before.find(p=>p.id===u.id);return {id:u.id,pos:{...u.pos},hp:u.hp-(prior?.hp||0),shield:u.shields.reduce((n,s)=>n+s.amount,0)-(prior?.shield||0)};}).filter(u=>u.hp||u.shield);
              duel.visuals=[...(duel.visuals||[]),{version:duel.version,actor:id,skill:action.skill,from,to,changes}].slice(-16);
            }
          }
        }else failure('Unknown arena request.');
        if(!conflict){s.requests[key]={owner:id,hash};const requests=Object.keys(s.requests);if(requests.length>1024)delete s.requests[requests[0]];changed=true;}
      }
    }
  return {state:s,changed,conflict,view:view(s,id,now)};
}
