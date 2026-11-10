import {gameMessage} from './game-message';
import {classes,same,distance,path,sight,units,totalXp,type Duel,type Profile,type CombatAction,type CombatVisual} from '../../backend/combat.ts';
import {characterUrl} from './characters';
import './arena.css';
import {ARENA,arenaNavigation,arenaSpawn,arenaFloor,COMBAT_GRID,combatCells,combatPoint,cellName} from './arena-layout';
import type {Point} from './navigation';
import {arenaAsset,skillArt} from './arena-art';
import {playCombatEffect,warmCombatArt} from './combat-effects';
import {warmArenaFlames} from './arena-flames';
import type {GameConnection} from './account';

type Context={world:string;nickname:string;connection?:GameConnection};
type Snapshot={settlement?:{status:string;hash?:string}|null;now:number;profile:Profile&{level:number;position:Point};players:(Profile&{level:number;busy:boolean;position:Point})[];invitations:{id:string;from:string;to:string;fromName:string;toName:string;expires:number}[];match:Duel|null;acknowledged:string[]};
const esc=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const sprite=(character:string)=>`background-image:url('${characterUrl(character+'.png')}')`;
const skillIcon=skillArt;
const projection=(x:number,y:number)=>{const [px,py]=combatPoint(x,y);return {left:px/ARENA.width*100,top:py/ARENA.height*100};};

export function initArena(context:()=>Context|null,pause:(value:boolean)=>void){
  const dialog=document.createElement('dialog');dialog.id='arena-dialog';dialog.className='arena-dialog';dialog.setAttribute('aria-labelledby','arena-title');
  dialog.innerHTML='<header class="arena-heading"><div><span class="eyebrow">BRIARBRIDGE · DUELLING GROUNDS</span><h2 id="arena-title">The Arena of Eight</h2></div><div class="arena-header-actions"><button id="arena-motion" class="secondary"></button><button id="arena-book" class="secondary">Spellbook</button><button id="arena-close" class="secondary">Back to town</button></div></header><p class="arena-intro">A friendly duel. Three class skills. One minute per turn. Keep your items; earn XP only by winning.</p><div class="arena-recovery" hidden><p id="arena-status" role="status"></p><button id="arena-retry" hidden>Retry last action</button></div><section id="arena-spellbook" aria-label="Spellbook" hidden></section><div id="arena-content"></div>';
  document.body.append(dialog);
  const content=dialog.querySelector<HTMLElement>('#arena-content')!,status=dialog.querySelector<HTMLElement>('#arena-status')!;
  const recovery=dialog.querySelector<HTMLElement>('.arena-recovery')!,retry=dialog.querySelector<HTMLButtonElement>('#arena-retry')!;
  let actionNotice=false;
  const scenery=document.createElement('div');scenery.className='arena-scenery';scenery.setAttribute('aria-hidden','true');
  const at=(x:number,y:number)=>`left:${x/ARENA.width*100}%;top:${y/ARENA.height*100}%`;
  const spectators:[string,number,number][]=[['goblin',335,226],['dwarf',490,190],['elf',380,169],['magician',534,138],['lizard',1035,182],['vampire',1190,222],['dark-elf',1130,164],['skeleton',990,132]];
  scenery.innerHTML=[
    ...[[98,155,1.6],[1435,155,1.6],[291,170,1],[460,120,1],[578,103,1],[964,104,1],[1082,121,1],[1251,165,1],[225,728,1],[394,790,1]].map(([x,y,size],i)=>`<span class="arena-lantern-glow" style="${at(x,y)};--size:${size};--phase:${-i*.57}s"></span>`),
    ...[65,1402].map((x,i)=>`<span class="arena-flame" style="${at(x,75)};--phase:${-i*.65}s"></span>`),
    ...spectators.map(([character,x,y],i)=>`<span class="arena-spectator seated" style="${at(x,y+20)};--phase:${-i*.61}s"><span class="arena-portrait" style="background-image:url('${characterUrl('arena-spectators.png')}');background-position-x:${['goblin','magician','dwarf','skeleton','lizard','vampire','elf','dark-elf'].indexOf(character)*100/7}%"></span></span>`)
  ].join('');
  void warmArenaFlames(scenery).catch(()=>{scenery.dataset.fireError='true';});
  let current:Snapshot|null=null,world='',busy=false,selected='',cursor={x:1,y:3},offset=0,lobby=false,signature='',generation=0,expiry='',person='',book=false,pending:Record<string,unknown>|null=null;
  let exitAfterWalk:false|'queued'|'walking'=false;
  let queued:Record<string,unknown>|null=null;
  let walkPreview:Point|null=null;
  let resultNotice:{text:string;until:number}|null=null;
  let animating=false;const visualSeen=new Map<string,number>(),visualQueue:{duel:Duel;event:CombatVisual}[]=[];
  let motionOverride:boolean|null=null;
  try{const value=localStorage.getItem('copper-acorn.combat-motion');if(value==='full'||value==='reduced')motionOverride=value==='reduced';}catch{}
  const motionMedia=matchMedia('(prefers-reduced-motion: reduce)');
  const reducedEffects=()=>motionOverride??motionMedia.matches;
  const motionButton=dialog.querySelector<HTMLButtonElement>('#arena-motion')!;
  function showMotion(){dialog.dataset.motion=reducedEffects()?'reduced':'full';motionButton.textContent='Animations: '+(reducedEffects()?'Reduced':'Full');motionButton.setAttribute('aria-pressed',String(!reducedEffects()));}
  motionButton.addEventListener('click',()=>{motionOverride=!reducedEffects();try{localStorage.setItem('copper-acorn.combat-motion',motionOverride?'reduced':'full');}catch{}showMotion();});
  motionMedia.addEventListener('change',showMotion);showMotion();
  function placeOverlays(){const map=content.querySelector('.arena-map-scroll');if(map)for(const overlay of content.querySelectorAll<HTMLElement>('.arena-fighters,.arena-result'))overlay.style.top=map.getBoundingClientRect().top+12+'px';}
  window.addEventListener('resize',placeOverlays);
  // Keep the scene, its actors and scroll position alive while refreshing the controls.
  function paint(html:string){
    const next=document.createElement('template');next.innerHTML=html;
    const selector='.arena-map-scroll',scene=content.querySelector<HTMLElement>(selector),fresh=next.content.querySelector<HTMLElement>(selector);
    const focus=document.activeElement as HTMLElement,scrollTop=dialog.scrollTop;
    if(scene&&fresh){
      const left=scene.scrollLeft,top=scene.scrollTop;
      if(!animating){
        for(const node of fresh.querySelectorAll<HTMLElement>('[data-unit],[data-room-unit],[data-cell]')){
          const attribute=node.hasAttribute('data-unit')?'data-unit':node.hasAttribute('data-room-unit')?'data-room-unit':'data-cell';
          const old=scene.querySelector<HTMLElement>(`[${attribute}="${node.getAttribute(attribute)}"]`);if(!old)continue;
          const moving=old.classList.contains('moving');
          for(const attr of [...old.attributes])if(!node.hasAttribute(attr.name)&&attr.name!=='data-destination')old.removeAttribute(attr.name);
          for(const attr of [...node.attributes])if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
          if(moving)old.classList.add('moving');
          if(attribute==='data-room-unit'){
            const detail=old.querySelector('small'),updated=node.querySelector('small');if(detail&&updated)detail.textContent=updated.textContent;
          }else{
            const actor=old.querySelector<HTMLElement>('.arena-actor'),updated=node.querySelector<HTMLElement>('.arena-actor');
            if(actor&&updated&&actor.style.backgroundImage===updated.style.backgroundImage)updated.replaceWith(actor);
            old.replaceChildren(...node.childNodes);
          }
          node.replaceWith(old);
        }
        const map=scene.querySelector('.arena-world'),nextMap=fresh.querySelector('.arena-world');
        if(map&&nextMap){for(const attr of [...map.attributes])if(!nextMap.hasAttribute(attr.name))map.removeAttribute(attr.name);for(const attr of [...nextMap.attributes])map.setAttribute(attr.name,attr.value);for(const child of [...map.childNodes])if(child!==scenery)child.remove();map.append(...nextMap.childNodes);}
      }
      for(const node of [...content.childNodes])if(node!==scene)node.remove();
      let before=true;for(const node of [...next.content.childNodes]){if(node===fresh){before=false;continue;}if(before)scene.before(node);else content.append(node);}
      scene.scrollLeft=left;scene.scrollTop=top;
    }else content.replaceChildren(next.content);
    const map=content.querySelector('.arena-world');if(map&&scenery.parentElement!==map)map.prepend(scenery);
    if(content.contains(focus))focus.focus({preventScroll:true});dialog.scrollTop=scrollTop;placeOverlays();
  }
  const pendingKey=()=>`copper-acorn.arena-pending:${world}`;
  const fighting=()=>!!current?.match&&!current.match.result;
  function allowed(){return !!current?.match&&!current.match.result&&current.match.players[current.match.active].id===world&&!queued&&!pending&&!animating;}
  function portrait(character:string){if(character==='chicken')return `<span class="arena-portrait arena-chicken" aria-hidden="true" style="background-image:url('${arenaAsset('training-chicken.png')}')"></span>`;return `<span class="arena-portrait" aria-hidden="true" style="${sprite(character)}"></span>`;}
  function tell(text:string,preserve=false){status.textContent=text?gameMessage(text):'';actionNotice=preserve;recovery.hidden=book||!text&&(!pending||busy);}
  function remember(body:Record<string,unknown>|null){if(body)localStorage.setItem(pendingKey(),JSON.stringify(body));else localStorage.removeItem(pendingKey());pending=body;if(!body&&queued?.kind!=='walk')walkPreview=null;}
  async function request(body?:Record<string,unknown>){
    if(busy||!world||context()?.world!==world)return;
    busy=true;const version=generation;let succeeded=false;
    if(body)tell(body.kind==='walk'?'':'Confirming your arena action…');
    try{
      if(body)remember(body);
      const init:RequestInit={method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20_000),redirect:'error'};
      const connection=context()?.connection;
      let data:Snapshot;
      if(connection)data=await connection<Snapshot>('/arena?world_id='+encodeURIComponent(world),init);
      else{
        const response=await fetch('/api/arena?world_id='+encodeURIComponent(world),init);
        const result=await response.json();
        if(!response.ok)throw Object.assign(Error(typeof result.error==='string'?result.error:'The arena could not be reached.'),{status:response.status});
        data=result;
      }
      if(version!==generation)return;
      offset=data.now-Date.now();
      if(body||pending&&typeof pending.request_id==='string'&&data.acknowledged.includes(pending.request_id))remember(null);
      const was=current?.match;
      current=data;void warmCombatArt(current!.profile.character);
      if(current!.match){const d=current!.match,last=visualSeen.get(d.id);if(last!==undefined)for(const event of d.visuals||[])if(event.version>last)visualQueue.push({duel:structuredClone(d),event});visualSeen.set(d.id,Math.max(0,...(d.visuals||[]).map(e=>e.version)));}
      if(current!.match&&!current!.match.result&&current!.match.id!==was?.id){lobby=false;selected='';resultNotice=null;}
      const ended=current!.match;
      if(ended?.result&&was?.id===ended.id&&!was.result)resultNotice={text:ended.training?'Training complete · No XP awarded':ended.result.winner===world?'Victory':ended.result.winner?'Defeat':'Draw',until:0};
      if(body)selected='';
      if(body?.kind==='stop-practice')lobby=true;
      if(fighting())exitAfterWalk=false;
      if(pending)tell('An earlier action is unconfirmed. Use Retry last action to check the same request.');
      else if(body||!actionNotice)tell('');
      succeeded=true;
    }catch(error){if(version===generation){walkPreview=null;if(body&&[400,403,404,409,413,415].includes((error as {status?:number}).status||0))remember(null);if(body?.kind==='walk'&&!pending)exitAfterWalk=false;tell((error instanceof Error?gameMessage(error.message,'The arena could not confirm this action.'):'Arena connection interrupted.')+(pending?' Your last request is kept for a safe retry.':''),!!body&&!pending);}}
    finally{
      if(version===generation){
        busy=false;render();await flushEffects();
        if(version===generation){
          if(succeeded&&queued&&!pending&&dialog.open){if(!busy){const next=queued;queued=null;void request(next);}}
          else queued=null;
          render();
        }
      }
    }
  }
  async function flushEffects(){
    if(animating||!visualQueue.length||!dialog.open)return;animating=true;const stamp=generation;render(true);
    try{while(visualQueue.length&&dialog.open&&stamp===generation){const item=visualQueue.shift()!,board=content.querySelector<HTMLElement>('.arena-board');if(board){dialog.dataset.attacking=item.event.skill;await playCombatEffect(board,item.duel,item.event,reducedEffects());}}}
    finally{if(stamp===generation){animating=false;delete dialog.dataset.attacking;render(true);}}
  }
  function post(value:Record<string,unknown>){
    if(queued&&(value.kind!=='walk'||queued.kind!=='walk'))return;
    if(pending&&(!busy||value.kind!=='walk'||pending.kind!=='walk'))return;
    const body={...value,request_id:crypto.randomUUID()};
    if(value.kind==='walk'&&current&&!fighting()&&Number.isInteger(value.x)&&Number.isInteger(value.y)){
      const target:Point=[value.x as number,value.y as number];
      if(!arenaNavigation.path(current.profile.position,target))return;
      walkPreview=target;
    }
    if(busy)queued=body;else void request(body);render(true);
  }
  function act(action:CombatAction){const d=current?.match;if(!d||!allowed())return;post({kind:'act',match:d.id,version:d.version,action});}
  function clock(){
    const d=current?.match,timer=dialog.querySelector('#arena-timer');if(!d||d.result||!timer)return;
    const remaining=Math.max(0,Math.ceil((d.deadline-Date.now()-offset)/1000));timer.textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
    timer.classList.toggle('urgent',remaining<=10);timer.setAttribute('aria-label',`${remaining} seconds remaining`);
    if(remaining===0&&expiry!==d.id+':'+d.version){expiry=d.id+':'+d.version;void request();}
  }
  function render(force=false){
    if(!dialog.open)return;
    retry.hidden=!pending||busy;retry.disabled=busy||book;recovery.hidden=book||!status.textContent&&(!pending||busy);
    dialog.querySelector<HTMLButtonElement>('#arena-close')!.disabled=!!current&&(fighting()||busy||!!pending||!!exitAfterWalk);
    if(!current){content.innerHTML='<p class="empty-state">Finding your arena character…</p><button data-reload>Try again</button>';return;}
    if(current.match?.result&&!lobby&&!busy&&!pending&&!animating&&!visualQueue.length){lobby=true;selected='';person='';book=false;}
    if(lobby&&resultNotice&&!resultNotice.until&&!animating&&!visualQueue.length)resultNotice.until=performance.now()+5000;
    const key=JSON.stringify([current.profile,current.players,current.invitations,current.match,current.settlement,selected,lobby,busy,!!pending,person,book,animating,exitAfterWalk,resultNotice,!!queued,walkPreview]);
    if(!force&&key===signature){clock();return;}signature=key;
    const focused=(document.activeElement as HTMLElement)?.dataset.cell;
    const previousPositions=new Map(Array.from(content.querySelectorAll<HTMLElement>('[data-unit],[data-room-unit]')).map(el=>{const box=el.parentElement!,style=getComputedStyle(el);return [el.dataset.unit||el.dataset.roomUnit!,{left:parseFloat(style.left)/box.clientWidth*100+'%',top:parseFloat(style.top)/box.clientHeight*100+'%'}];}));
    dialog.classList.toggle('arena-fighting',!!current.match&&!lobby);
    const me=current.profile,role=classes[me.character];
    const spellbook=dialog.querySelector<HTMLElement>('#arena-spellbook')!;spellbook.hidden=!book;content.inert=book;
    if(book)spellbook.innerHTML=`<header><h3>${role.role} · Spellbook</h3><button id="arena-book-close" class="secondary">Close spellbook</button></header><p>Level ${me.level}. Flat amounts below are level 1 values; power ×${(1+.05*(me.level-1)).toFixed(2)} at your level. All three skills are available from level 1.</p><div class="arena-class-cards">${role.skills.map(s=>`<article>${skillIcon(s.id)}<strong>${s.name}</strong><small>${s.ap} AP · Range ${s.min}–${s.max} · ${s.casts} cast${s.casts>1?'s':''} per turn${s.cd?' · Cooldown '+s.cd+' own turns':''}</small><p>${esc(s.text)}</p></article>`).join('')}</div><p>Movement uses MP. Melee requires an edge-adjacent cell. Training gives no XP and Captain Cluck never attacks.</p>`;

    if(!current.match||lobby){
      const next=me.level===20?'Maximum level':`${(me.xp-totalXp(me.level)).toLocaleString()} / ${(totalXp(me.level+1)-totalXp(me.level)).toLocaleString()} XP to next level`;
      const people=[{id:'trainer',nickname:'Captain Cluck',character:'chicken',level:me.level,busy:false,position:ARENA.chicken},...current.players];
      const chosen=people.find(p=>p.id===person);
      const roomStyle=(p:Point)=>`left:${p[0]/ARENA.width*100}%;top:${p[1]/ARENA.height*100}%;z-index:${Math.round(p[1])}`;
      paint(`${resultNotice?.until?`<p class="arena-result" role="status">${esc(resultNotice.text)}</p>`:''}<section class="arena-profile arena-room-profile"><strong>${esc(me.nickname)} · ${role.role} · Level ${me.level}</strong><span>${current.settlement?.status==='pending'?'Saving your result · walking and training remain available':next}</span><span>${current.players.length} other player${current.players.length===1?'':'s'}</span></section>
        <section class="arena-invites">${current.invitations.map(i=>i.to===world?`<div><p><strong>${esc(i.fromName)}</strong> invites you to a friendly duel.</p><button data-invite="${i.id}" data-choice="accept" ${busy||pending?'disabled':''}>Accept duel</button><button class="secondary" data-invite="${i.id}" data-choice="decline" ${busy||pending?'disabled':''}>Cancel</button></div>`:`<div><p>Invitation sent to ${esc(i.toName)}.</p><button class="secondary" data-invite="${i.id}" data-choice="decline" ${busy||pending?'disabled':''}>Cancel invitation</button></div>`).join('')}</section>
        <p id="arena-room-help" class="arena-map-help">Click the paving to walk, or use WASD / arrows. Click a character for Fight / Cancel. </p>
        <div class="arena-map-scroll"><div class="arena-world" data-walkmap tabindex="0" role="region" aria-label="Arena courtyard map" aria-describedby="arena-room-help">
          <button class="arena-return" data-return ${busy||pending||exitAfterWalk?'disabled':''} style="${roomStyle(ARENA.exit)}" aria-label="Return portal to town"><img src="${arenaAsset('arena-portal.png')}" alt=""><span>Town</span></button>
          <div class="arena-world-person self" data-room-unit="${world}" style="${roomStyle(walkPreview||me.position||arenaSpawn(world))}"><span class="arena-avatar">${portrait(me.character)}<span>${esc(me.nickname)} · You</span></span></div>
          ${people.map(p=>`<div class="arena-world-person${p.id==='trainer'?' training-target':''}" data-room-unit="${p.id}" style="${roomStyle(p.position)}"><button class="arena-avatar" data-person="${p.id}" aria-label="${esc(p.nickname)}">${portrait(p.character)}<span>${esc(p.nickname)}</span>${p.id==='trainer'?'':`<small>Lv ${p.level} · ${p.busy?'Fighting':classes[p.character as keyof typeof classes].role}</small>`}</button></div>`).join('')}
        </div></div>
        ${chosen?`<aside class="arena-bubble" role="dialog" aria-label="Fight ${esc(chosen.nickname)}"><strong>${esc(chosen.nickname)}</strong><p>${chosen.id==='trainer'?'Practice with Captain Cluck. No attacks or XP.':`Level ${chosen.level} · ${classes[chosen.character as keyof typeof classes].role}. Send a duel invitation?`}</p><button data-fight="${chosen.id}" ${busy||pending||chosen.busy?'disabled':''}>Fight</button><button data-cancel-fight class="secondary">Cancel</button></aside>`:''}`);
      const bubble=content.querySelector<HTMLElement>('.arena-bubble');if(bubble){const anchor=content.querySelector<HTMLElement>(`[data-person="${person}"]`)!.getBoundingClientRect(),left=Math.max(18,Math.min(innerWidth-bubble.offsetWidth-18,anchor.x+anchor.width/2-bubble.offsetWidth/2));bubble.style.left=left+'px';bubble.style.top=Math.max(90,Math.min(innerHeight-bubble.offsetHeight-12,anchor.top-bubble.offsetHeight-12))+'px';bubble.style.setProperty('--arrow',Math.max(12,Math.min(bubble.offsetWidth-12,anchor.x+anchor.width/2-left))+'px');}
      if(!reducedEffects())for(const el of content.querySelectorAll<HTMLElement>('[data-room-unit]')){
        const destinationKey=el.style.left+el.style.top,priorDestination=el.dataset.destination;el.dataset.destination=destinationKey;
        const old=previousPositions.get(el.dataset.roomUnit!);if(!old||priorDestination===destinationKey)continue;el.getAnimations().forEach(a=>a.cancel());el.classList.remove('moving');
        const destination:Point=[parseFloat(el.style.left)/100*ARENA.width,parseFloat(el.style.top)/100*ARENA.height],from:Point=[parseFloat(old.left)/100*ARENA.width,parseFloat(old.top)/100*ARENA.height];
        if(Math.hypot(destination[0]-from[0],destination[1]-from[1])<2)continue;
        const route=arenaNavigation.path(from,destination);if(!route)continue;
        const frames=[from,...route].map(([x,y])=>({left:x/ARENA.width*100+'%',top:y/ARENA.height*100+'%'})),dx=destination[0]-from[0],dy=destination[1]-from[1],sprite=el.querySelector<HTMLElement>('.arena-portrait')!;
        sprite.style.backgroundPositionY=(Math.abs(dx)>Math.abs(dy)?dx>0?2:1:dy>0?0:3)*100/3+'%';el.classList.add('moving');
        el.animate(frames,{duration:Math.min(1800,Math.max(200,Math.hypot(dx,dy)*3)),easing:'linear'}).finished.then(()=>el.classList.remove('moving')).catch(()=>undefined);
      }

      return;
    }
    const d=current.match,you=d.players.find(p=>p.id===world)!,active=d.players[d.active],yourTurn=allowed();
    const chosen=classes[you.character].skills.find(s=>s.id===selected);
    const result=d.training?'Training complete':d.result?(d.result.winner===world?'Victory':d.result.winner?'Defeat':'Draw'):'';
    const top=d.result?`${result} · ${d.training?'No XP awarded':d.result.winner?'Knockout':'Both fighters fell'}`:d.training?'Training · Your turn':`${active.nickname}'s turn`;
    const myTurn=active.id===world;
    const mode=chosen?`${chosen.name}: ${chosen.target==='cell'?'choose a cell':'choose a target'}`:'Choose a cell to move, or select a skill.';
    const row=(y:number)=>combatCells.filter(c=>c.y===y);
    paint(`<div class="arena-turn arena-room-profile"><h3>${esc(top)}</h3>${d.result?'':'<span id="arena-timer" role="timer"></span>'}<span>Round ${d.round}</span></div>
      <p id="arena-board-help" class="arena-map-help">${d.result?'Your items and Copper stay with your shop.':animating?'Casting…':myTurn?esc(mode):'The other player is taking their turn.'} Arrow keys choose a cell; Enter uses it.</p>
      <div class="arena-map-scroll"><div class="arena-world arena-board" role="grid" aria-label="Duel arena, courtyard floor" aria-rowcount="${COMBAT_GRID.size}" aria-colcount="${COMBAT_GRID.size}" aria-describedby="arena-board-help" style="--cell-width:${COMBAT_GRID.stepX*2/ARENA.width*100}%;--cell-height:${COMBAT_GRID.stepY*2/ARENA.height*100}%">
        <div class="arena-return arena-return-sealed" style="left:${ARENA.exit[0]/ARENA.width*100}%;top:${ARENA.exit[1]/ARENA.height*100}%;z-index:${ARENA.exit[1]}" role="img" aria-label="Portal sealed during combat"><img src="${arenaAsset('arena-portal.png')}" alt=""><span>Sealed</span></div>
      <div class="arena-fighters">${d.players.map(p=>`<article class="${p.id===active.id&&!d.result?'active':''}">${portrait(d.training&&p.id!==world?'chicken':p.character)}<div><strong>${esc(d.training&&p.id!==world?'Captain Cluck':p.nickname)} · Lv ${p.level}</strong><span>${d.training&&p.id!==world?'':classes[p.character].role}${p.id===world?' · You':''}</span><meter min="0" max="${p.maxHp}" value="${p.hp}" aria-label="${esc(p.nickname)} health"></meter><span>${p.hp} / ${p.maxHp} HP${p.shields.length?' · '+p.shields.reduce((n,s)=>n+s.amount,0)+' shield':''}</span><small>${p.ap} AP · ${p.mp} MP</small></div></article>`).join('')}</div>
        <div class="arena-grid" style="clip-path:polygon(${arenaFloor[0].map(([x,y])=>x/ARENA.width*100+'% '+y/ARENA.height*100+'%').join(',')})">
        ${Array.from({length:COMBAT_GRID.size},(_,i)=>COMBAT_GRID.min+i).map(y=>`<div role="row">${row(y).map(cell=>{
          const {x}=cell,p=projection(x,y),occupant=units(d).find(u=>same(u.pos,cell)),steps=yourTurn&&!chosen?path(d,you.pos,cell,you.id):null;
          const reach=yourTurn&&!!chosen&&distance(you.pos,cell)>=chosen.min&&distance(you.pos,cell)<=chosen.max&&sight(you.pos,cell);
          const hazard=d.zones.some(z=>distance(z.cell,cell)<=1),trap=d.traps.some(t=>same(t.cell,cell));
          return `<button role="gridcell" class="arena-cell${steps&&steps.length>0&&steps.length<=you.mp?' reachable':''}${reach?' in-range':''}${hazard?' fire-zone':''}${trap?' trap':''}" data-cell="${x},${y}" style="left:${p.left}%;top:${p.top}%" tabindex="${same(cursor,cell)?0:-1}" aria-rowindex="${y-COMBAT_GRID.min+1}" aria-colindex="${x-COMBAT_GRID.min+1}" aria-label="Cell ${cellName(x,y)}${occupant?', '+esc(occupant.kind==='fighter'?d.players.find(f=>f.id===occupant.id)!.nickname:'Boneguard'):''}"><span>${trap?'✕':cellName(x,y)}</span></button>`;
        }).join('')}</div>`).join('')}
        </div>
        ${[...d.players,...d.minions].map(u=>{const p=projection(u.pos.x,u.pos.y),fighter=d.players.find(f=>f.id===u.owner)!;return `<div data-unit="${u.id}" class="arena-unit${u.kind==='minion'?' boneguard':''}${d.training&&u.id!==world&&u.kind==='fighter'?' training-target':''}${u.hp===0?' knocked-out':''}" style="left:${p.left}%;top:${p.top}%;z-index:${Math.round(p.top/100*ARENA.height)}" aria-hidden="true"><span class="arena-actor${d.training&&u.id!==world&&u.kind==='fighter'?' arena-chicken':''}" style="${d.training&&u.id!==world&&u.kind==='fighter'?`background-image:url('${arenaAsset('training-chicken.png')}')`:sprite(u.kind==='minion'?'skeleton':fighter.character)}"></span><span class="arena-unit-health" style="--health:${u.hp/u.maxHp*100}%"></span>${u.effects.burn?'<span class="arena-effect burn">Burn</span>':''}${u.effects.poison?'<span class="arena-effect poison">Poison</span>':''}${u.effects.marked!==undefined?'<span class="arena-effect">Marked</span>':''}${u.shields.length?'<span class="arena-effect">Shield</span>':''}</div>`;}).join('')}
      </div></div>
      <div class="arena-combat-bar"><div class="arena-skills" role="group" aria-label="Your skills">${classes[you.character].skills.map(s=>{
        const cooldown=Math.max(0,(you.cooldowns[s.id]||0)-you.turn),used=you.used[s.id]||0;
        return `<button data-skill="${s.id}" aria-label="${s.name}" title="${s.name} · ${s.ap} AP${cooldown?' · Cooldown '+cooldown:''}" aria-pressed="${selected===s.id}" ${!yourTurn||you.ap<s.ap||cooldown||used>=s.casts?'disabled':''}>${skillIcon(s.id)}<span class="arena-skill-cost">${s.ap} AP</span>${cooldown?`<span class="arena-cooldown">${cooldown}</span>`:''}</button>`;
      }).join('')}</div><div class="arena-controls"><button id="arena-move" class="secondary" ${!yourTurn?'disabled':''}>Move</button><button id="arena-end" ${!yourTurn?'disabled':''}>End turn</button>${d.training?`<button id="arena-stop" class="secondary" ${busy||pending?'disabled':''}>Stop training</button>`:''}</div></div>
      <details class="arena-journal"><summary>Battle journal</summary><p>${d.training?'Captain Cluck never attacks. Training gives no XP or win/loss record.':'Healing uses class skills only. No combat potions.'} Open Spellbook for skill details.</p><ol>${d.log.slice(-14).map(line=>`<li>${esc(line)}</li>`).join('')}</ol></details>`);
    if(focused)content.querySelector<HTMLButtonElement>(`[data-cell="${focused}"]`)?.focus({preventScroll:true});
    if(!reducedEffects()&&!animating)content.querySelectorAll<HTMLElement>('[data-unit]').forEach(el=>{
      const destinationKey=el.style.left+el.style.top,priorDestination=el.dataset.destination;el.dataset.destination=destinationKey;
      const previous=previousPositions.get(el.dataset.unit!);if(priorDestination===destinationKey||!previous||previous.left===el.style.left&&previous.top===el.style.top)return;
      const left=el.style.left,top=el.style.top,dx=parseFloat(left)-parseFloat(previous.left),dy=parseFloat(top)-parseFloat(previous.top);
      const direction=Math.abs(dx)>=Math.abs(dy)?dx>0?2:1:dy>0?0:3;
      el.querySelector<HTMLElement>('.arena-actor')!.style.backgroundPositionY=direction*100/3+'%';
      el.style.left=previous.left;el.style.top=previous.top;el.getBoundingClientRect();el.classList.add('moving');
      requestAnimationFrame(()=>{el.style.left=left;el.style.top=top;});setTimeout(()=>el.classList.remove('moving'),350);
    });
    clock();
  }
  function choose(x:number,y:number){
    const d=current?.match;if(!d||!allowed())return;cursor={x,y};const s=classes[current!.profile.character].skills.find(s=>s.id===selected);
    if(!s){
      const actor=d.players.find(p=>p.id===world)!,steps=path(d,actor.pos,{x,y},world);
      if(!steps||steps.length>actor.mp){tell(actor.mp===0?'No movement points remain. End your turn to move again.':'That cell is out of reach. Choose a highlighted cell.',true);return;}
      if(steps.length)act({kind:'move',x,y});return;
    }
    if(s.target==='cell')act({kind:'cast',skill:s.id,x,y});
    else{const target=units(d).find(u=>same(u.pos,{x,y}));if(target)act({kind:'cast',skill:s.id,target:target.id});else tell('Choose a living target for that skill.');}
  }
  content.addEventListener('click',event=>{
    const element=event.target as HTMLElement,target=element.closest<HTMLButtonElement>('button');
    if(!target&&element.closest('[data-walkmap]')&&!element.closest('[data-room-unit]')){exitAfterWalk=false;const area=element.closest<HTMLElement>('[data-walkmap]')!.getBoundingClientRect();person='';post({kind:'walk',x:Math.round((event.clientX-area.left)/area.width*ARENA.width),y:Math.round((event.clientY-area.top)/area.height*ARENA.height)});return;}
    if(!target||target.disabled)return;
    if(target.hasAttribute('data-return')){leave();return;}
    exitAfterWalk=false;
    if(target.dataset.person){person=person===target.dataset.person?'':target.dataset.person;render(true);}
    if(target.hasAttribute('data-cancel-fight')){person='';render(true);}
    if(target.dataset.fight){const opponent=target.dataset.fight;person='';post(opponent==='trainer'?{kind:'practice'}:{kind:'challenge',target:opponent});}
    if(target.id==='arena-stop'&&current?.match?.training)post({kind:'stop-practice',match:current.match.id});
    if(target.dataset.invite)post({kind:target.dataset.choice,invite:target.dataset.invite});
    if(target.dataset.cell){const [x,y]=target.dataset.cell.split(',').map(Number);choose(x,y);}
    if(target.dataset.skill){const s=classes[current!.profile.character].skills.find(s=>s.id===target.dataset.skill)!;if(s.target==='self')act({kind:'cast',skill:s.id});else{selected=selected===s.id?'':s.id;render(true);}}
    if(target.id==='arena-end')act({kind:'end'});
    if(target.id==='arena-move'){selected='';render(true);}
    if(target.hasAttribute('data-reload'))void request();
  });
  retry.addEventListener('click',()=>{if(pending&&!busy)void request(pending);});
  content.addEventListener('keydown',event=>{
    const element=event.target as HTMLElement;
    if(element.closest('[data-walkmap]')&&!book){const directions:Record<string,Point>={ArrowRight:[24,0],d:[24,0],ArrowLeft:[-24,0],a:[-24,0],ArrowDown:[0,24],s:[0,24],ArrowUp:[0,-24],w:[0,-24]},step=directions[event.key];if(step&&current){event.preventDefault();exitAfterWalk=false;person='';post({kind:'walk',x:current.profile.position[0]+step[0],y:current.profile.position[1]+step[1]});}return;}
    const target=element.closest<HTMLElement>('[data-cell]');if(!target)return;
    const delta:Record<string,[number,number]>={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]};
    if(delta[event.key]){event.preventDefault();const [dx,dy]=delta[event.key];let next={x:cursor.x+dx,y:cursor.y+dy};while(next.x>=COMBAT_GRID.min&&next.y>=COMBAT_GRID.min&&next.x<COMBAT_GRID.min+COMBAT_GRID.size&&next.y<COMBAT_GRID.min+COMBAT_GRID.size&&!combatCells.some(c=>same(c,next)))next={x:next.x+dx,y:next.y+dy};if(!combatCells.some(c=>same(c,next)))return;cursor=next;content.querySelectorAll<HTMLElement>('[data-cell]').forEach(c=>c.tabIndex=c.dataset.cell===`${cursor.x},${cursor.y}`?0:-1);content.querySelector<HTMLElement>(`[data-cell="${cursor.x},${cursor.y}"]`)?.focus();}
  });
  function reset(){queued=null;walkPreview=null;resultNotice=null;exitAfterWalk=false;delete dialog.dataset.attacking;visualQueue.length=0;visualSeen.clear();animating=false;content.inert=false;dialog.querySelector<HTMLElement>('#arena-spellbook')!.hidden=true;generation++;busy=false;current=null;signature='';selected='';pending=null;expiry='';tell('');if(dialog.open)closeArena();}
  function open(){
    const ctx=context();if(!ctx)return;reset();world=ctx.world;cursor={x:1,y:3};lobby=false;
    try{const saved=JSON.parse(localStorage.getItem(pendingKey())||'null');if(saved&&typeof saved.request_id==='string')pending=saved;}catch{tell('Your last arena request could not be restored.');}
    person='';book=false;exitAfterWalk=false;history.replaceState(null,'',location.pathname+location.search+'#arena');document.body.classList.add('in-arena');pause(true);dialog.showModal();render();void request();
  }
  function leave(){
    if(!current){closeArena();return;}
    if(fighting()){tell(current?.match?.training?'Use Stop training to finish practice.':'Finish the duel before returning to town.');return;}
    if(pending||exitAfterWalk)return;
    book=false;person='';lobby=true;exitAfterWalk='queued';
    enterReturnPortal();render(true);
  }
  function enterReturnPortal(){
    if(!exitAfterWalk||busy||pending||book||!current||fighting()||!dialog.open)return;
    if(exitAfterWalk==='queued'){exitAfterWalk='walking';post({kind:'walk',x:ARENA.exitApproach[0],y:ARENA.exitApproach[1]});return;}
    const position=current.profile.position;
    if(position[0]!==ARENA.exitApproach[0]||position[1]!==ARENA.exitApproach[1])return;
    const actor=content.querySelector<HTMLElement>(`[data-room-unit="${world}"]`);if(!actor)return;
    const style=getComputedStyle(actor),map=actor.parentElement!;
    const x=parseFloat(style.left)/map.clientWidth*ARENA.width,y=parseFloat(style.top)/map.clientHeight*ARENA.height;
    if(Math.hypot(x-position[0],y-position[1])<1)closeArena();
  }
  dialog.querySelector('#arena-close')!.addEventListener('click',leave);
  dialog.addEventListener('cancel',event=>{if(book){event.preventDefault();book=false;render(true);}else if(person){event.preventDefault();person='';render(true);}else{event.preventDefault();if(exitAfterWalk){exitAfterWalk=false;tell('Portal travel cancelled.');render(true);}else leave();}});
  dialog.querySelector('#arena-book')!.addEventListener('click',()=>{exitAfterWalk=false;book=!book;render(true);if(book)dialog.querySelector<HTMLButtonElement>('#arena-book-close')!.focus();});
  dialog.querySelector('#arena-spellbook')!.addEventListener('click',event=>{if((event.target as HTMLElement).closest('#arena-book-close')){book=false;render(true);dialog.querySelector<HTMLButtonElement>('#arena-book')!.focus();}});
  function finishClose(){if(dialog.open)return;queued=null;walkPreview=null;resultNotice=null;exitAfterWalk=false;document.body.classList.remove('in-arena');if(location.hash==='#arena')history.replaceState(null,'',location.pathname+location.search);generation++;busy=false;animating=false;visualQueue.length=0;delete dialog.dataset.attacking;pause(!!document.querySelector('dialog[open]'));}
  function closeArena(){dialog.close();finishClose();}
  dialog.addEventListener('close',finishClose);
  const ticker=setInterval(()=>{if(!dialog.open&&location.hash==='#arena'&&context())open();if(dialog.open){if(context()?.world!==world)reset();else{clock();if(resultNotice?.until&&performance.now()>=resultNotice.until){resultNotice=null;render();}enterReturnPortal();}}},200);
  const poll=setInterval(()=>{if(dialog.open&&!busy&&!animating&&(!selected||!allowed()))void request();},1500);
  return {open,reset,destroy(){clearInterval(ticker);clearInterval(poll);motionMedia.removeEventListener('change',showMotion);window.removeEventListener('resize',placeOverlays);dialog.remove();}};
}
