import type {Duel,CombatVisual} from '../../backend/combat.ts';
import {localArt,actionUrl} from './action-art';
import {ARENA,combatPoint} from './arena-layout';

const point=(x:number,y:number)=>{const [px,py]=combatPoint(x,y);return {x:px/ARENA.width*100,y:py/ARENA.height*100};};
const hues:Record<string,string>={vampire:'#e98ba1',goblin:'#b7db74','dark-elf':'#ef9479',elf:'#c6e69b',magician:'#ffc46c',lizard:'#83d2c2',skeleton:'#c4a1ff',dwarf:'#ebd59c'};

const poses=new Map<string,Promise<boolean>>();
function loadPose(character:string,pose:string){
  const url=actionUrl(character+'-'+pose+'.png');let ready=poses.get(url);
  if(!ready){const image=new Image();image.src=url;ready=image.decode().then(()=>true,()=>false);poses.set(url,ready);}return ready;
}
export async function warmCombatArt(character:string){if(localArt)await Promise.all(['harvest','tap'].map(pose=>loadPose(character,pose)));}

export async function playCombatEffect(board:HTMLElement,d:Duel,event:CombatVisual,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches){
  const caster=d.players.find(p=>p.id===event.actor||p.id+'-bone'===event.actor);if(!caster||!board.isConnected)return;
  const pose=['shiv','cheap','cleave','rupture','scale','quarry','harpoon'].includes(event.skill)?'tap':'harvest';
  const ready=localArt&&!reduced&&event.actor===caster.id?await loadPose(caster.character,pose):false;
  if(!board.isConnected)return;
  const from=point(event.from.x,event.from.y),to=point(event.to.x,event.to.y);
  const layer=document.createElement('div');layer.className='combat-effects';layer.dataset.visual=String(event.version);layer.setAttribute('aria-hidden','true');layer.style.setProperty('--spell-color',hues[caster.character]);board.append(layer);
  const running:Promise<unknown>[]=[];
  const animate=(el:HTMLElement,frames:Keyframe[],duration:number,delay=0)=>{
    if(reduced)return;
    const animation=el.animate(frames,{duration,delay,fill:'both',easing:'ease-out'});
    running.push(animation.finished.catch(()=>undefined).then(()=>animation.cancel()));
  };
  const actor=board.querySelector<HTMLElement>(`[data-unit="${event.actor}"] .arena-actor`);
  if(actor&&!reduced){
    const dx=to.x-from.x,dy=to.y-from.y,direction=Math.abs(dx)+Math.abs(dy)<.1?0:Math.abs(dx)>=Math.abs(dy)?dx>0?2:1:dy>0?0:3;
    if(ready){
      const prior=actor.getAttribute('style')||'';
      actor.classList.add('casting');actor.style.backgroundImage=`url('${actionUrl(caster.character+'-'+pose+'.png')}')`;actor.style.backgroundSize='800% 400%';actor.style.backgroundPositionY=direction*100/3+'%';
      const playback=actor.animate([{backgroundPositionX:'0%'},{backgroundPositionX:'100%'}],{duration:850,easing:'steps(7)',fill:'forwards'});
      running.push(playback.finished.catch(()=>undefined).then(()=>{playback.cancel();actor.classList.remove('casting');actor.setAttribute('style',prior);}));
    }else animate(actor,[{transform:'translate(0,0)'},{transform:`translate(${Math.sign(dx)*12}px,${Math.sign(dy)*6}px) rotate(-8deg)`},{transform:'translate(0,0)'}],750);
  }
  const melee=event.actor!==caster.id||['shiv','cheap','cleave','rupture','scale'].includes(event.skill),arrow=['briar','gale','silence','quarry','harpoon','needle'].includes(event.skill);
  const projectile=document.createElement('span');projectile.className='spell-projectile '+(melee?'slash':arrow?'arrow':'orb');
  if(melee)projectile.innerHTML='<svg viewBox="0 0 64 64"><path d="M8 56Q12 13 58 5Q27 24 8 56Z" fill="currentColor"/><path d="M13 49Q20 23 51 11" fill="none" stroke="#fff6da" stroke-width="3"/></svg>';
  else if(arrow)projectile.innerHTML='<svg viewBox="0 0 64 20"><path d="M3 10h49M44 3l14 7-14 7M4 3l10 7L4 17" fill="none" stroke="currentColor" stroke-width="3"/><path d="M15 9h30" stroke="#fff5d5" stroke-width="2"/></svg>';
  projectile.style.left=from.x+'%';projectile.style.top=from.y-7+'%';layer.append(projectile);
  const angle=Math.atan2((to.y-from.y)*board.clientHeight,(to.x-from.x)*board.clientWidth)*180/Math.PI;
  if(reduced||event.from.x===event.to.x&&event.from.y===event.to.y)projectile.style.display='none';
  else if(melee)animate(projectile,[{left:to.x+'%',top:to.y-6+'%',opacity:0,transform:'translate(-50%,-50%) rotate(-55deg) scale(.2)'},{offset:.45,left:to.x+'%',top:to.y-6+'%',opacity:1,transform:'translate(-50%,-50%) rotate(-15deg) scale(1)'},{left:to.x+'%',top:to.y-6+'%',opacity:0,transform:'translate(-50%,-50%) rotate(30deg) scale(1.3)'}],700,250);
  else animate(projectile,[{left:from.x+'%',top:from.y-7+'%',opacity:1,transform:`translate(-50%,-50%) rotate(${angle}deg) scale(.7)`},{offset:.6,left:to.x+'%',top:to.y-7+'%',opacity:1,transform:`translate(-50%,-50%) rotate(${angle}deg) scale(1)`},{left:to.x+'%',top:to.y-7+'%',opacity:0,transform:`translate(-50%,-50%) rotate(${angle}deg) scale(1.4)`}],650,250);
  const impact=document.createElement('span');impact.className='spell-impact';impact.style.left=to.x+'%';impact.style.top=to.y+'%';layer.append(impact);
  animate(impact,[{opacity:0,transform:'translate(-50%,-75%) scale(.2)'},{offset:.5,opacity:1,transform:'translate(-50%,-75%) scale(.5)'},{opacity:0,transform:'translate(-50%,-75%) scale(1.25)'}],650,450);
  for(const change of event.changes){
    const at=point(change.pos.x,change.pos.y),label=document.createElement('span');label.className='combat-number '+(change.hp>0?'healing':change.hp<0?'damage':'shield');label.style.left=at.x+'%';label.style.top=at.y+'%';
    label.textContent=change.hp?(change.hp>0?'+':'−')+Math.abs(change.hp):(change.shield>0?'+':'−')+Math.abs(change.shield)+' shield';layer.append(label);
    animate(label,[{opacity:0,transform:'translate(-50%,-100%)'},{offset:.3,opacity:1,transform:'translate(-50%,-170%)'},{opacity:0,transform:'translate(-50%,-260%)'}],1000,400);
    if(change.hp<0){const target=board.querySelector<HTMLElement>(`[data-unit="${change.id}"] .arena-actor`);if(target)animate(target,[{filter:'brightness(1)'},{filter:'brightness(2.5) sepia(.4)'},{filter:'brightness(1)'}],450,450);}
  }
  await Promise.all(running);if(reduced)await new Promise(resolve=>setTimeout(resolve,800));layer.remove();
}
