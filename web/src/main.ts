import {gameMessage} from './game-message';
import {gatheringProblem} from './gathering';
import Phaser from 'phaser';
import { MarketScene } from './market';
import { icon, itemUrl } from './icons';
import { initAccount, type GameConnection } from './account';
import { loadCharacters, initCharacters } from './characters';
import { loadWorkArt } from './action-art';
import { initArena } from './arena';
import { WORLD, type Spot } from './isometric-layout';
import type { Action, GameState, Operation } from './types';
import {miraDialog} from './mira-dialog';
import {localPlayerDevice} from './player-device';
import './style.css';
import './town-ui.css';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (text: unknown) => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const api = import.meta.env.VITE_PUBLIC_API_URL || '';
const localSandbox = import.meta.env.VITE_PUBLIC_LOCAL_SANDBOX === 'true';
const playerDevice=localSandbox&&new URLSearchParams(location.search).get('owned')==='1'?localPlayerDevice(api):null;
let online: GameConnection | null = null;
let usedOnline = false;
let connectionVersion = 0;
let state: GameState | null = null;
let panel = 'shop';
let merchant = 'mira';
let busy = false;
let unresolved = false;
let marketRunning = false;
let marketSeconds = 0;
let selectedPotion = 'healing_tonic';
let shopView='display';
let selectedRecipe='healing_tonic',selectedTrade='sunleaf',quantity=1,questHistory=false;
const sideOrders=new Set<string>();
let localWorld:string|null=null;
let missingLocalWorld=false;
let entryWorld:string|null=null,accountOwner:string|null=null,enteringOnline=false;
let accountUI:ReturnType<typeof initAccount>;
const bootDialog=playerDevice?el<HTMLDialogElement>('games-dialog'):null;
const bootRetry=el<HTMLButtonElement>('startup-retry');
let marketReady!:()=>void;
const marketLoaded=new Promise<void>(resolve=>{marketReady=resolve;});
if(bootDialog){
  bootDialog.classList.add('startup');bootDialog.dataset.boot='loading';
  el('games-title').textContent='Opening your shop';
  el('games-intro').textContent='Your first local game can take a little time to prepare. Keep this tab open.';
  el('games-status').textContent='Preparing your shop…';
  bootDialog.addEventListener('cancel',event=>{if(bootDialog.dataset.boot)event.preventDefault();});
  bootDialog.showModal();
  document.documentElement.removeAttribute('data-startup');
}
async function startupStep<T>(work:()=>Promise<T>,label:string):Promise<T>{
  for(;;){
    if(bootDialog){bootDialog.dataset.boot='loading';bootRetry.hidden=true;el('games-status').textContent=label;}
    try{return await work();}
    catch(error){
      if(!bootDialog)throw error;
      bootDialog.dataset.boot='error';
      const phase=el('games-status').textContent||label;
      el('games-status').textContent=`${phase} ${error instanceof TypeError?'The connection was interrupted.':error instanceof Error?gameMessage(error.message):'Setup could not be confirmed.'} Your saved setup is kept. Retry to continue.`;
      bootRetry.disabled=false;bootRetry.hidden=false;
      await new Promise<void>(resolve=>{bootRetry.onclick=()=>{bootRetry.disabled=true;bootRetry.hidden=true;bootRetry.onclick=null;resolve();};});
    }
  }
}
try {localWorld=sessionStorage.getItem('copper-acorn.local-world');entryWorld=sessionStorage.getItem('copper-acorn.enter-world');}catch{}
if(playerDevice&&!localWorld){
  localWorld=await startupStep(async()=>{
    const setup=sessionStorage.getItem('copper-acorn.owned-setup')||crypto.randomUUID();
    sessionStorage.setItem('copper-acorn.owned-setup',setup);
    const world=await playerDevice.create(setup,text=>{el('games-status').textContent=text;});
    sessionStorage.setItem('copper-acorn.local-world',world);
    sessionStorage.removeItem('copper-acorn.owned-setup');
    return world;
  },'Preparing your shop…');
}
const prices: Record<string, string> = {};
const pendingKey = 'copper-acorn.pending';
const characters = await (playerDevice?startupStep(loadCharacters,'Loading character artwork…'):loadCharacters().catch(() => []));
const workArt = await (playerDevice?startupStep(()=>loadWorkArt(characters.map(c=>c.id)),'Loading the market and action artwork…'):loadWorkArt(characters.map(c => c.id)).catch(() => []));
const interactionDialog = el<HTMLDialogElement>('interaction-dialog');
const mira=playerDevice||import.meta.env.VITE_PUBLIC_PLAYER_OWNERSHIP==='true'?miraDialog(interactionDialog,json,act):null;
let interaction: {kind: Spot['kind']; target: string} | null = null;
let interactionReturn: HTMLElement | null = null;
let questConversationOpen = false;
const resources: Record<string, {verb: string; text: string}> = {
  sunleaf: {verb: 'Harvest', text: 'Golden Sunleaf is ready to cut. Take the young leaves and leave the roots to grow.'},
  moonmint: {verb: 'Harvest', text: 'Silver-blue Moonmint smells cool and sharp. A careful snip yields a fresh sprig.'},
  emberbloom: {verb: 'Pick', text: 'Emberbloom petals hold a little warmth. Pick one bloom without disturbing the rest.'},
  spring_water: {verb: 'Collect', text: 'Clear water runs from the old stone spring. Fill a clean flask for your next brew.'},
  wood_essence: {verb: 'Tap', text: 'A bead of amber essence gathers at the brass tap. Collect a little and let the tree rest.'},
  silver_dust: {verb: 'Mine', text: 'Bright silver runs through this rock. Work a small vein into fine alchemical dust.'},
};
const neighbors: Record<string, {name: string; role: string; greeting: string; advice: string}> = {
  mira: {name: 'Mira', role: 'Herbalist', greeting: 'Morning, neighbour! The beds are full of good leaves today. What does your cauldron need?', advice: 'A full basket makes herbs cheaper. Watch my stock before choosing what to gather or sell.'},
  rowan: {name: 'Rowan', role: 'Distiller', greeting: 'Clean water, patient hands, a little wood essence. That is where every good draught begins.', advice: 'Keep water for your next brew. A Focus Draught is also an ingredient for a Restoration Elixir.'},
  bram: {name: 'Bram', role: 'Alchemical supplier', greeting: 'A glint of silver can change a whole brew. Looking for supplies, or bringing me something special?', advice: 'My purse is finite. Check my Copper before selling; a closed stall needs working capital to reopen.'},
};

const scene = new MarketScene(openInteraction, characters, () => {picker.ready();marketReady();}, workArt);
const picker = initCharacters(characters, scene, localSandbox, async(character_id,nickname)=>{
  await act({kind:'choose_alchemist',character_id,nickname},'Saving your alchemist…');
  if(state?.alchemist?.character_id!==character_id || state.alchemist.nickname!==nickname)throw Error('Alchemist save not confirmed');
},()=>void openGames());
const game = new Phaser.Game({ type: Phaser.CANVAS, parent: 'game', width: WORLD.width, height: WORLD.height, pixelArt: true,
  backgroundColor: '#83945b', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene });
const arena=initArena(()=>state&&(online||localSandbox&&!usedOnline)&&inGame()&&!unresolved?{world:state.environment.world_id,nickname:state.alchemist?.nickname||'Alchemist',connection:online||undefined}:null,paused=>scene.pauseMovement(paused));

function batchAmount() {return quantity>1?{amount:String(quantity)}:{};}
function quantityPicker(id:string,max=state?.batch_limit||1) {
  return `<div class="quantity-bar"><label for="${id}">Quantity</label><select id="${id}" ${disabled(max<1)}>${Array.from({length:Math.max(1,max)},(_,i)=>`<option value="${i+1}" ${quantity===i+1?'selected':''}>${i+1}</option>`).join('')}</select><span>${max>0?`Up to ${max} at once`:'Nothing available'}</span></div>`;
}
function inGame(){return !!state&&(!accountOwner||!!online)&&(!online&&state.batch_limit!==10||entryWorld===state.environment.world_id);}
function rememberEntry(id:string){sessionStorage.setItem('copper-acorn.enter-world',id);entryWorld=id;}
function enterGame(){
  if(!state||busy||unresolved||preview())return;
  rememberEntry(state.environment.world_id);
  el<HTMLDialogElement>('games-dialog').close();picker.enter();render();
}
el('continue-game').addEventListener('click',enterGame);
async function openGames() {
  const dialog=el<HTMLDialogElement>('games-dialog');
  if(!dialog.open){scene.pauseMovement(true);dialog.showModal();}
  const starting=!inGame(),version=connectionVersion,creationUnavailable=accountUI?.newGameAvailable===false;
  dialog.classList.toggle('startup',starting);
  el('games-title').textContent=starting?'Welcome to Copper Acorn':'Your saved games';
  el('games-intro').textContent=starting?(accountOwner?'Continue a saved shop or create a new alchemist. Each game keeps its own story.':localSandbox?'Open your alchemy shop. Continue a saved game or begin a new one.':'Log in to find your games. Continue your shop or begin a new adventure.'):'Each game keeps its own nickname, character, shop and progress.';
  el('close-games').hidden=starting;
  const resume=el<HTMLButtonElement>('continue-game');
  resume.hidden=!starting||!state||state.batch_limit===10&&!state.alchemist||preview()||!!accountOwner&&!online;resume.disabled=busy||unresolved;
  resume.textContent=`Continue ${state?.alchemist?.nickname||'game'}`;
  el('online-account').hidden=starting&&!import.meta.env.VITE_PUBLIC_SUPABASE_URL;
  const newButton=el<HTMLButtonElement>('new-game');
  newButton.hidden=starting&&!state&&!accountOwner;
  newButton.disabled=busy||unresolved||enteringOnline||!!accountUI?.loading()||creationUnavailable;
  if(accountOwner&&!online||!state&&!missingLocalWorld&&(!localSandbox||usedOnline)){
    el('save-list').innerHTML='';
    el('games-status').textContent=accountUI?.loading()?'Finding your saved games…':accountOwner?(creationUnavailable?'Open a saved game above to continue.':'Choose New game to create your first shop.'):'Continue with Google to load your saved games.';
    return;
  }
  el('games-status').textContent='Loading saves…';
  try {
    const data=await json<{saves:{world_id:string;alchemist:{nickname:string;character_id:string}|null;is_active?:boolean}[];limit:number;active_world_id?:string}>('/api/saves');
    if(version!==connectionVersion)return;
    el('save-list').innerHTML=data.saves.filter(save=>!starting||save.world_id!==state?.environment.world_id||preview()).map(save=>{
      const displayed=save.world_id===state?.environment.world_id;
      return `<button class="save-slot secondary" data-save="${escape(save.world_id)}" data-active="${escape(data.active_world_id||'')}" ${busy||unresolved&&!missingLocalWorld||displayed&&!preview()&&inGame()?'disabled':''}>${starting?'Load ':''}${escape(save.alchemist?.nickname||'New shop')} · ${escape(characters.find(c=>c.id===save.alchemist?.character_id)?.name||'Choose your alchemist')}${displayed?(preview()?' · activate':' · current'):''}</button>`;
    }).join('');
    const unfinished=state?.batch_limit===10&&!state.alchemist&&!preview();
    newButton.disabled=busy||unresolved||preview()||!unfinished&&(data.saves.length>=data.limit||creationUnavailable);
    el('games-status').textContent=starting&&unfinished?'Your first shop is ready. Choose New game to name your alchemist.':data.saves.length>=data.limit?`All ${data.limit} free save slots are in use. Your games are preserved.`:`${data.saves.length} / ${data.limit} save slots used`;
  }catch{if(version===connectionVersion){el('games-status').textContent='Saved games could not load. Try again or check your login.';newButton.disabled=true;}}
}
async function useLocalSave(id:string) {
  if(busy||unresolved&&!missingLocalWorld||online||!localSandbox||usedOnline)return;
  sessionStorage.setItem('copper-acorn.local-world',id);localWorld=id;
  rememberEntry(id);
  unresolved=false;missingLocalWorld=false;
  connectionVersion++;state=null;marketRunning=false;quantity=1;panel='shop';shopView='display';scene.cancelMovement();scene.refresh(null);picker.world(null);
  el<HTMLDialogElement>('games-dialog').close();await connect();
}
el('saved-games').addEventListener('click',()=>void openGames());
el('close-games').addEventListener('click',()=>el<HTMLDialogElement>('games-dialog').close());
el<HTMLDialogElement>('games-dialog').addEventListener('close',()=>scene.pauseMovement(!!document.querySelector('dialog[open]')));
el<HTMLDialogElement>('games-dialog').addEventListener('cancel',event=>{if(!inGame())event.preventDefault();});
el('new-game').addEventListener('click',async()=>{
  if(busy||unresolved||enteringOnline)return;
  if(accountOwner&&!online){
    enteringOnline=true;el<HTMLButtonElement>('new-game').disabled=true;
    const prepared=await accountUI?.prepare();
    if(!prepared){enteringOnline=false;void openGames();}
    return;
  }
  if(!state)return;
  if(state.batch_limit===10&&!state.alchemist){enterGame();return;}
  const world=state.environment.world_id,key='copper-acorn.new-game:'+world;
  let requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
  el<HTMLButtonElement>('new-game').disabled=true;el('games-status').textContent='Preparing a separate game. Your current save is kept…';
  try {
    const result=await json<{world_id:string}>('/api/new-game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({world_id:world,request_id:requestId})});
    if(online){rememberEntry(result.world_id);location.assign('?world_id='+encodeURIComponent(result.world_id));}else await useLocalSave(result.world_id);
    sessionStorage.removeItem(key);
  }catch(error){el('games-status').textContent=error instanceof Error?gameMessage(error.message):'New game could not be confirmed. Retry to check the same request.';el<HTMLButtonElement>('new-game').disabled=false;}
});
el('save-list').addEventListener('click',async event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-save]');if(!button||button.disabled||busy||unresolved&&!missingLocalWorld)return;
  if(button.dataset.save===state?.environment.world_id&&!preview()){enterGame();return;}
  if(!online){await useLocalSave(button.dataset.save!);return;}
  if(!state)return;
  try{const result=await json<{world_id:string}>('/api/select-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({world_id:state.environment.world_id,target_id:button.dataset.save,expected_active:button.dataset.active})});rememberEntry(result.world_id);location.assign('?world_id='+encodeURIComponent(result.world_id));}
  catch(error){el('games-status').textContent=error instanceof Error?gameMessage(error.message):'Save could not be selected';}
});

function item(id: string) { return state?.catalog.find(i => i.token_id === id); }
function owned(id: string) { return BigInt(state?.player.balances[id] || '0'); }
function lowMana() { return !!state && BigInt(state.environment.native_balance) < BigInt(state.environment.low_native); }
function preview() { return state?.environment.is_active === false; }
function disabled(condition = false) { return busy || unresolved || preview() || !inGame() || condition ? 'disabled' : ''; }
function message(text: string, status = '') { el('action-status').textContent = gameMessage(text); el('action-status').dataset.status = status; }

function questConversation(target: string): string {
  const q = state?.quests;
  if (!q?.active) return '';
  if (target === 'mira') return q.gardener_complete
    ? 'Every gardener has a remedy now. Thank you, neighbour! Your deliveries are paid; my stall is still open for trade.'
    : `The gardeners need three Healing Tonics. You have brought ${q.delivered[0]} of 3. I set aside 13 Copper for each, paid when you deliver. This is separate from your guild trials.`;
  if (target === 'rowan') return !q.story ? '' : q.story.water_delivered >= q.story.water_target
    ? 'Two clear flasks, just what my still needed. Your water order is paid. Keep some water for your own cauldron!'
    : `Could you bring two flasks of Spring Water? You have delivered ${q.story.water_delivered} of 2. I reserved 3 Copper per flask. Helping me is optional; the guild will not keep you waiting.`;
  if (target !== 'bram') return '';
  if (q.seal) return 'The examiner has awarded you the Alchemist’s Seal! The Copper Acorn is part of Briarbridge now. Keep brewing, trading and helping your neighbours.';
  if (q.story?.stage === 0) return q.story.tonic_brewed
    ? 'Your first tonic is brewed. Now sell a Healing Tonic from your shelf or to a merchant. An empty shelf is no sale; wait for the buyer to pay. Then the guild trials will open.'
    : 'A letter from the guild: prove that the Copper Acorn can serve the town. First brew a Healing Tonic and sell it. Then the examiner will ask for Focus Draughts and a Restoration Elixir.';
  if (!q.story) return `Your saved guild orders remain open: ${q.delivered[1]} of 2 Focus Draughts and ${q.delivered[2]} of 1 Restoration Elixir delivered. You can bring either order first. The guild reserved 24 Copper per draught and 48 for the Elixir.`;
  if (q.story.stage === 1) return `The guild needs two Focus Draughts; you have delivered ${q.delivered[1]}. Save ingredients for a third: it goes into the final Restoration Elixir. The guild pays 24 Copper per draught.`;
  return 'The Focus trial is complete. Now deliver one Restoration Elixir for the expedition’s return. It uses another Focus Draught, Emberbloom and Silver Dust. The final reward is 48 Copper and your Seal.';
}

function openInteraction(kind: Spot['kind'], target: string) {
  if(kind==='arena'){
    if(busy||unresolved){message(unresolved?'Use Refresh ledger to confirm your last action before entering the arena.':'Your last action is finishing. Try the portal once it confirms.');return;}
    if(!inGame()){void openGames();return;}
    if(picker.requireSelection())arena.open();
    return;
  }
  if (busy || unresolved) return;
  if (el<HTMLDialogElement>('character-dialog').open || interactionDialog.open) return;
  interaction = {kind, target};
  if(kind==='gather')quantity=1;
  questConversationOpen = false;
  interactionReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const portrait = el<HTMLImageElement>('interaction-portrait');
  el('interaction-advice').hidden = kind !== 'merchant';
  el('interaction-quest').hidden = kind !== 'merchant' || !questConversation(target);
  el('interaction-quest').textContent = target === 'bram' ? 'About the guild' : 'About your order';
  el('interaction-close').textContent = kind === 'merchant' ? 'Goodbye' : 'Leave';
  if (kind === 'merchant') {
    const neighbor = neighbors[target]; if (!neighbor) { interaction = null; return; }
    el('interaction-title').textContent = neighbor.name;
    el('interaction-kind').textContent = neighbor.role;
    el('interaction-text').textContent = neighbor.greeting;
    portrait.src = new URL(`assets/market/${target}.png`, document.baseURI).href;
    el('interaction-confirm').textContent = 'Visit stall';
  } else if (kind === 'gather') {
    if (!resources[target]) { interaction = null; return; }
    el('interaction-title').textContent = item(target)?.name || target.replaceAll('_', ' ');
    el('interaction-kind').textContent = 'Gathering spot';
    el('interaction-text').textContent = resources[target].text;
    portrait.src = itemUrl(target);
    el('interaction-confirm').textContent = `${resources[target].verb} ${item(target)?.name || target.replaceAll('_', ' ')}`;
  } else {
    const brewing = kind === 'cauldron';
    el('interaction-title').textContent = brewing ? 'Your brewing cauldron' : 'Your potion cabinets';
    el('interaction-kind').textContent = 'The Copper Acorn';
    el('interaction-text').textContent = brewing ? 'The coals are warm and the kettle is clean. Choose a recipe and put your ingredients to work.' : 'A good potion deserves a place in the window. Choose your stock and set your own price.';
    portrait.src = itemUrl(brewing ? 'focus_draught' : 'healing_tonic');
    el('interaction-confirm').textContent = brewing ? 'Choose a recipe' : 'Manage shelves';
  }
  portrait.dataset.kind = kind;
  renderInteraction(); scene.pauseMovement(true); interactionDialog.showModal();
  if(kind==='merchant'&&target==='mira'&&(playerDevice||state?.environment.player_owned))mira?.open();
}

function renderInteraction() {
  if (!interaction) return;
  const {kind, target} = interaction;
  const confirm = el<HTMLButtonElement>('interaction-confirm');
  el('gather-quantity').hidden=kind!=='gather'||!state?.batch_limit;
  confirm.disabled = false;
  if (kind === 'gather') {
    const resource = item(target);
    const available = resource ? BigInt(resource.gather_cap) - BigInt(resource.gathered_today) : 0n;
    const problem = gatheringProblem(resource,quantity,state?.world.day||0,!!state?.market);
    if(state?.batch_limit)el('gather-quantity').innerHTML=quantityPicker('gather-amount',Math.min(state.batch_limit,Number(available)));
    el('interaction-detail').textContent = !state ? 'Sign in with Google to open your saved inventory.' : problem || (lowMana() ? 'Mana is low. Refill before gathering.' : `Collect ${quantity===1?'one unit':quantity+' units'} · ${available} left this market day · ${owned(target)} in your satchel`);
    confirm.disabled = !state || busy || unresolved || preview() || !!problem || lowMana();
  } else if (kind === 'merchant') {
    const trader = state?.merchants.find(m => m.name.toLowerCase() === target);
    el('interaction-detail').textContent = trader ? trader.open ? `Stall open · ${trader.account.balances.copper} Copper in the till` : `Stall closed · working capital needed: ${state!.investment} Copper` : 'You can look around; sign in to trade with your saved shop.';
  } else el('interaction-detail').textContent = state ? 'Choose what to do in your shop ledger.' : 'Sign in to restore your ingredients and potions.';
}

el('interaction-close').addEventListener('click', () => interactionDialog.close());
interactionDialog.addEventListener('close', () => {
  interaction = null;
  questConversationOpen = false;
  scene.pauseMovement(!!document.querySelector('dialog[open]'));
  if (!busy && interactionReturn?.isConnected) interactionReturn.focus({preventScroll: true});
});
el('interaction-advice').addEventListener('click', () => {
  if (interaction?.kind === 'merchant') {
    questConversationOpen = false;
    el('interaction-text').textContent = neighbors[interaction.target].advice;
    el('interaction-confirm').textContent = 'Visit stall';
  }
});
el('interaction-quest').addEventListener('click', () => {
  if (interaction?.kind !== 'merchant') return;
  questConversationOpen = true;
  el('interaction-text').textContent = questConversation(interaction.target);
  el('interaction-confirm').textContent = 'Open quest journal';
});
el('interaction-confirm').addEventListener('click', () => {
  if (!interaction || el<HTMLButtonElement>('interaction-confirm').disabled) return;
  const chosen = interaction;
  const showQuests = questConversationOpen;
  interactionDialog.close(); interaction = null;
  if (chosen.kind === 'gather') void act({kind: 'gather', token_id: chosen.target,...batchAmount()}, 'Gathering an ingredient…');
  else {
    panel = showQuests ? 'quests' : chosen.kind === 'merchant' ? 'market' : chosen.kind === 'cauldron' ? 'cauldron' : 'shop';
    if (chosen.kind === 'merchant') merchant = chosen.target;
    interactionReturn = el('ledger');
    render(); el('ledger').focus();
  }
});

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const version = connectionVersion;
  if (online) {
    const result = await online<T>(path.replace(/^\/api/, ''), init);
    if (version !== connectionVersion) throw new Error('Account changed; refresh your shop.');
    return result;
  }
  if (!localSandbox || usedOnline) throw new Error('Sign in with Google to restore your saved shop.');
  if(playerDevice){
    if(path==='/api/new-game')return {world_id:await playerDevice.create(JSON.parse(String(init?.body)).request_id)} as T;
    if(path==='/api/action'&&state){
      const request=JSON.parse(String(init?.body));
      if(!['serve_customer','market_tick','next_day'].includes(request.action.kind))return await playerDevice.action(request.world_id,request.request_id,request.action,state) as T;
    }
    if(path.startsWith('/api/actions/')&&localWorld)return await playerDevice.operation(localWorld,path.slice('/api/actions/'.length)) as T;
  }
  const localPath=localWorld && !path.startsWith('/api/new-game') && !path.startsWith('/api/saves') ? path+(path.includes('?')?'&':'?')+'world_id='+encodeURIComponent(localWorld):path;
  const response = await fetch(api + localPath, { ...init, signal: AbortSignal.timeout(45_000), redirect: 'error' });
  const body = await response.json();
  if (version !== connectionVersion) throw new Error('Account changed; refresh your shop.');
  if (!response.ok) throw Object.assign(new Error(gameMessage(body.error,'Your game could not be reached. Try again.')),{status:response.status,path});
  return body as T;
}

function validateState(value: GameState) {
  const money = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v);
  if (!value || value.environment?.network !== (online ? 'testnet' : 'sandbox') || typeof value.environment.world_id !== 'string'
    || !Number.isSafeInteger(value.world?.day) || !Array.isArray(value.catalog) || value.catalog.length !== 10
    || !Array.isArray(value.merchants) || value.merchants.length !== 3
    || !value.player?.balances || !Object.values(value.player.balances).every(money)
    || !money(value.environment.native_balance) || !money(value.environment.starter_native) || !money(value.environment.low_native)
    || value.alchemist!=null && (typeof value.alchemist.nickname!=='string'||!characters.some(c=>c.id===value.alchemist!.character_id)||[...value.alchemist.nickname].length>20)
    || value.batch_limit!==undefined && value.batch_limit!==10
    || !money(value.craft_fee) || !money(value.investment) || !money(value.world.refill_price)
    || !money(value.world.native_pool) || !money(value.world.refill_amount)
    || value.world.mana_rescue && [value.world.mana_rescue.used,value.world.mana_rescue.pending,value.world.mana_rescue.available].some(v=>typeof v !== 'boolean')
    || value.environment.rescue_available !== undefined && typeof value.environment.rescue_available !== 'boolean'
    || value.environment.is_active !== undefined && typeof value.environment.is_active !== 'boolean'
    || value.quests?.story != null && (!Number.isInteger(value.quests.story.stage) || value.quests.story.stage < 0 || value.quests.story.stage > 3
      || [value.quests.story.tonic_brewed,value.quests.story.tonic_sold,value.quests.story.opening_credited].some(v=>typeof v !== 'boolean')
      || !Number.isInteger(value.quests.story.water_delivered) || value.quests.story.water_delivered < 0 || value.quests.story.water_delivered > 2
      || value.quests.story.water_target !== 2 || !money(value.quests.story.water_reward) || !money(value.quests.story.water_escrow_remaining))
    || value.pending_operation != null && (typeof value.pending_operation.request_id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.pending_operation.request_id) || !['preparing','pending'].includes(value.pending_operation.status))
    || value.catalog.some(i => !/^[a-z_]+$/.test(i.token_id) || typeof i.name !== 'string' || !money(i.base_value) || !money(i.gather_cap) || !money(i.gathered_today))) {
    throw new Error('Your saved shop could not be read. Refresh the ledger before trading.');
  }
  return value;
}

async function refresh(recover = true) {
  let next = validateState(await json<GameState>('/api/state'));
  state = next;
  missingLocalWorld=false;
  unresolved = !!next.pending_operation;
  let restored = false;
  if (recover) {
    let pending: {world_id:string;request_id:string;action?:Action} | null = null;
    let browserPending = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
      if (typeof saved?.world_id === 'string' && typeof saved.request_id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(saved.request_id)) {
        if (saved.world_id === next.environment.world_id) {pending = saved; browserPending = true;}
      }
      else if (saved !== null) sessionStorage.removeItem(pendingKey);
    } catch {
      // The server journal can restore an action even when the browser copy is damaged or unavailable.
      try { sessionStorage.removeItem(pendingKey); } catch { /* Browser storage may be blocked. */ }
    }
    if (!pending && next.pending_operation) pending = { world_id: next.environment.world_id, request_id: next.pending_operation.request_id };
    if (pending) {
      unresolved = true;
      let operation: Operation;
      try { operation = await json<Operation>(`/api/actions/${encodeURIComponent(pending.request_id)}`); }
      catch (error) {
        if (!online || !pending.action || (error as {status?:number}).status !== 404) throw error;
        operation = await json<Operation>('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
      }
      if (['confirmed','failed'].includes(operation.status)) {
        if (browserPending) sessionStorage.removeItem(pendingKey);
        restored = true;
        next = validateState(await json<GameState>('/api/state')); state = next;
        unresolved = !!next.pending_operation;
        if (unresolved) message('Another action is waiting for confirmation. Use Refresh ledger before doing anything else.', 'pending');
        else message(operation.status === 'confirmed' ? 'Previous action confirmed. Your ledger has been restored.' : operation.error || 'Previous action failed. Your confirmed inventory is restored.', operation.status === 'confirmed' ? 'confirmed' : 'error');
      } else message('Previous action is waiting for confirmation. Use Refresh ledger before doing anything else.', 'pending');
    }
  }
  picker.world(next); render(); scene.refresh(next);
  return restored;
}

async function act(action: Action, label: string) {
  if (!state || busy || unresolved || preview() || !inGame()) return;
  if (!['choose_alchemist','refill','rescue'].includes(action.kind) && !picker.requireSelection()) return;
  if (action.kind === 'gather') {
    const resource = item(action.token_id);
    const problem=gatheringProblem(resource,Number(action.amount||'1'),state.world.day,!!state.market);
    if(problem){message(problem);return;}
  }
  if (['gather', 'brew', 'list', 'unlist', 'trade', 'invest', 'deliver'].includes(action.kind) && lowMana()) { message('Mana is low. Refill before your next action.'); return; }
  const focusId = document.activeElement?.id;
  const version = connectionVersion;
  let submitted = false, confirmed = false;
  busy = true; message(label, 'pending'); render();
  try {
    const prepared = await scene.prepareWork(action);
    if (version !== connectionVersion) return;
    if (!prepared) { message('Action canceled before submission.'); return; }
    const request = { request_id: crypto.randomUUID(), world_id: state.environment.world_id, action };
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request)); }
    catch { throw new Error('Browser session storage is unavailable. No action was submitted.'); }
    unresolved = true; submitted = true; render();
    const operation = await json<Operation>('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (operation.status === 'failed') { sessionStorage.removeItem(pendingKey); throw new Error(operation.error || 'The action failed. Your confirmed inventory is preserved.'); }
    if (operation.status !== 'confirmed') throw new Error(operation.error || 'Action has not been confirmed.');
    confirmed = true;
    sessionStorage.removeItem(pendingKey);
    await Promise.all([scene.finishWork(true), refresh(false)]);
    if (version !== connectionVersion) return;
    message(action.kind === 'rescue' ? 'Guild rescue confirmed. Your Mana is restored.' : 'Confirmed. Your stock and purse are up to date.', 'confirmed');
  } catch (error) {
    if (version !== connectionVersion) return;
    void scene.finishWork(false);
    if (confirmed) { unresolved = true; message('Action confirmed, but the ledger could not refresh. Use “Refresh ledger” to restore your stock.', 'error'); return; }
    if (!submitted) { message(error instanceof Error ? gameMessage(error.message) : 'Action canceled before submission.', 'error'); return; }
    if ([400,401,403,404,405,409,413,415].includes((error as {status?:number}).status || 0)) sessionStorage.removeItem(pendingKey);
    message(`${error instanceof Error ? gameMessage(error.message) : 'Connection interrupted.'} Use “Refresh ledger” to check the outcome; no automatic retry was made.`, 'error');
  } finally {
    if (version !== connectionVersion) return;
    busy = false; render();
    if (focusId && (document.activeElement === document.body || submitted && document.activeElement === game.canvas)) {
      const target = document.getElementById(focusId) as HTMLButtonElement | null;
      (target && !target.disabled ? target : el('ledger')).focus({ preventScroll: true });
    }
  }
}

function shelfPanel(): string {
  const s = state!;
  const potions = s.catalog.filter(i => i.kind === 'potion');
  const selected = item(selectedPotion)!;
  const capacity = s.listings.length < s.shelf_slots || s.listings.some(l => l.token_id === selectedPotion);
  const suggested = prices[selectedPotion] || (BigInt(selected.base_value) + 1n).toString();
  const shelves = Array.from({ length: s.shelf_slots }, (_, index) => {
    const listing = s.listings[index];
    return listing ? `<div class="shelf-slot stocked">${icon(listing.token_id, 40)}<div><strong>${escape(item(listing.token_id)?.name)}</strong><span>${escape(listing.price)} Copper · ${owned(listing.token_id)} in stock</span></div><button id="unlist-${listing.token_id}" class="small" data-unlist="${listing.token_id}" ${disabled(lowMana())}>Take off shelf</button></div>`
      : `<div class="shelf-slot empty"><span class="shelf-number">0${index + 1}</span><div><strong>An empty shelf</strong><span>A place for your next good brew.</span></div></div>`;
  }).join('');
  const listing = s.listings.find(l => l.token_id === 'healing_tonic');
  const canServe = s.customer_available && listing && owned('healing_tonic') > 0n && BigInt(s.customer.balances.copper) >= BigInt(listing.price);
  const customer=`<section class="customer-card" aria-label="Customer request"><span class="eyebrow">A VISITING GARDENER</span><h3>A small remedy</h3><blockquote>${s.customer_need ? escape(s.customer_need.text) : 'No visitor request is available right now.'}</blockquote>
    <button id="serve" ${disabled(!canServe)}>Serve gardener${listing ? ` · ${escape(listing.price)} Copper` : ''}</button>
    <p class="help">${!s.customer_available ? 'This visitor is unavailable. The next market day brings another visit.' : !listing ? 'Place a Healing Tonic on a shelf to meet this request.' : !canServe ? 'Check tonic stock and the customer’s remaining budget.' : `Customer budget: ${escape(s.customer.balances.copper)} Copper.`}</p></section>`;
  const tabs=`<div class="shop-sections"><button data-shop-view="display" aria-pressed="${shopView==='display'}">Display</button><button data-shop-view="customers" aria-pressed="${shopView==='customers'}">Customers</button></div>`;
  if(shopView==='customers')return tabs+customer;
  return tabs+`<div class="panel-heading"><h3>Stock your shelves</h3><p>Choose your price. Keep the proceeds for tomorrow’s ingredients.</p>${s.quests?.story?.stage === 0 ? '<p>A guild letter awaits: brew and sell your first tonic to begin.</p><div class="quest-actions"><button class="secondary" data-quest-panel="quests">Read the guild letter</button></div>' : ''}</div>${shelves}
    <form id="listing-form" class="listing-form"><label for="potion-select">Potion to display</label><select id="potion-select">${potions.map(i => `<option value="${i.token_id}" ${i.token_id === selectedPotion ? 'selected' : ''}>${escape(i.name)} (${owned(i.token_id)} owned)</option>`).join('')}</select>
    <div class="price-row"><div><label for="listing-price">Price in Copper</label><input id="listing-price" type="text" inputmode="numeric" pattern="[0-9]+" maxlength="39" required value="${escape(suggested)}" /></div><button id="list" ${disabled(owned(selectedPotion) < 1n || !capacity || lowMana())}>Put on shelf</button></div><p class="help">${!capacity ? 'Both shelves are occupied. Take a potion off a shelf first.' : owned(selectedPotion) < 1n ? 'Brew or buy this potion before displaying it.' : 'Listing a potion does not sell it yet.'}</p></form>
`;
}

function cauldronPanel(): string {
  const s = state!;
  return `<div class="panel-heading"><h3>A little careful brewing</h3><p>Three recipes, one cauldron. Each potion costs ${escape(s.craft_fee)} Copper.</p></div><label for="recipe-select">Recipe</label><select id="recipe-select">${s.catalog.filter(i=>i.recipe).map(i=>`<option value="${i.token_id}" ${i.token_id===selectedRecipe?'selected':''}>${escape(i.name)}</option>`).join('')}</select>${s.catalog.filter(i => i.recipe && i.token_id===selectedRecipe).map(i => {
    const available = i.recipe!.every(input => owned(input.token_id) >= BigInt(input.amount)*BigInt(quantity)) && owned('copper') >= BigInt(s.craft_fee)*BigInt(quantity);
    return `<article class="recipe"><div class="recipe-heading">${icon(i.token_id, 44)}<div><h4>${escape(i.name)}</h4><span>Creates ${quantity} potion${quantity===1?'':'s'}</span></div></div><ul>${i.recipe!.map(input => `<li><span>${icon(input.token_id, 22)}${escape(item(input.token_id)?.name)}</span><span class="${owned(input.token_id) < BigInt(input.amount)*BigInt(quantity) ? 'short' : ''}">${owned(input.token_id)} / ${BigInt(input.amount)*BigInt(quantity)}</span></li>`).join('')}<li><span>Copper fee</span><span>${BigInt(s.craft_fee)*BigInt(quantity)}</span></li></ul><button id="brew-${i.token_id}" data-brew="${i.token_id}" ${disabled(!available || lowMana())}>Brew ${quantity>1?quantity+' × ':''}${escape(i.name)}</button>${!available ? '<p class="help">Gather or buy the missing ingredients first.</p>' : ''}</article>`;
  }).join('')}`;
}

function marketPanel(): string {
  const s = state!;
  const trader = s.merchants.find(m => m.name.toLowerCase() === merchant) || s.merchants[0];
  return `<div class="panel-heading"><h3>Neighbors at the market</h3><p>Their stock and Copper are finite. Prices change with stock and demand.</p></div>
    <div class="merchant-picker">${s.merchants.map(m => `<button id="merchant-${m.name.toLowerCase()}" data-merchant="${m.name.toLowerCase()}" aria-pressed="${m.name.toLowerCase() === merchant}">${escape(m.name)}</button>`).join('')}</div>
    <div class="merchant-summary"><strong>${escape(trader.name)}’s stall</strong><span>${trader.open ? 'Open' : 'Closed'} · ${escape(trader.account.balances.copper)} Copper</span></div>
    ${!trader.open ? `<div class="closed-note"><p>The stall has no working capital. Contributing ${escape(s.investment)} Copper will reopen it; no repayment is promised.</p><button id="invest" ${disabled(owned('copper') < BigInt(s.investment) || lowMana())}>Reopen stall · ${escape(s.investment)} Copper</button></div>` : ''}
    <div class="market-items"><label for="market-item-select">Item</label><select id="market-item-select">${trader.quotes.map(q=>`<option value="${q.token_id}" ${q.token_id===selectedTrade?'selected':''}>${escape(item(q.token_id)?.name)}</option>`).join('')}</select>${trader.quotes.filter(q=>q.token_id===selectedTrade).map(q => {const ask=q.buy_totals?.[quantity-1]??(quantity===1?q.merchant_sells_at:null),bid=q.sell_totals?.[quantity-1]??(quantity===1?q.merchant_buys_at:null);return `<article class="market-item"><div class="market-item-name">${icon(q.token_id)}<div><strong>${escape(item(q.token_id)?.name)}</strong><span>Stall: ${escape(q.stock)} · You: ${owned(q.token_id)}</span></div></div><div class="trade-buttons"><button id="buy-${merchant}-${q.token_id}" data-trade="${q.token_id}" data-buy="true" data-limit="${ask}" ${disabled(!trader.open || !ask || BigInt(q.stock) < BigInt(quantity) || owned('copper') < BigInt(ask||'0') || lowMana())}>Buy${quantity>1?' '+quantity:''} · ${escape(ask||'—')}</button><button id="sell-${merchant}-${q.token_id}" class="secondary" data-trade="${q.token_id}" data-buy="false" data-limit="${bid}" ${disabled(!trader.open || !bid || owned(q.token_id) < BigInt(quantity) || BigInt(trader.account.balances.copper) < BigInt(bid||'0') || lowMana())}>Sell${quantity>1?' '+quantity:''} · ${escape(bid||'—')}</button></div>
    <details class="price-reason"><summary>Why this price?</summary><p>Stock ${escape(q.stock)} / target ${escape(q.target)} (${q.stock_adjustment_percent > 0 ? '+' : ''}${q.stock_adjustment_percent}%). ${escape(q.consumed_last_two_days)} consumed in the last two market days (+${q.demand_adjustment_percent}%). Reference: ${escape(q.reference)} Copper. The merchant pays 80% and charges 120% of reference, with integer rounding. A batch changes stock one unit at a time; its total sums those successive prices.</p><small>Rule ${escape(q.rule_version)}</small></details></article>`;}).join('')}</div>`;
}

function questPanel(): string {
  const q = state?.quests;
  if (!q?.active) return '<p>The guild has no funded orders in this world.</p>';
  const story = q.story;
  const stage = story?.stage ?? (q.seal ? 3 : q.delivered[1] < 2 ? 1 : 2);
  const progress = (step: number) => !story ? q.delivered[step] >= q.targets[step] ? 'Complete' : 'Available order' : stage > step ? 'Complete' : stage === step ? 'Current objective' : 'Locked';
  const deliver = (id: string, complete: boolean, locked = false) => `<button data-deliver="${id}" ${disabled(complete || locked || owned(id)<BigInt(quantity) || lowMana() || (id==='spring_water'?q.story!.water_target-q.story!.water_delivered:q.targets[['healing_tonic','focus_draught','restoration_elixir'].indexOf(id)]-q.delivered[['healing_tonic','focus_draught','restoration_elixir'].indexOf(id)])<quantity)}>Deliver ${quantity>1?quantity+' × ':''}${escape(item(id)?.name)}</button>`;
  const guide = (destination: string, label: string) => `<button class="secondary" data-quest-panel="${destination}">${label}</button>`;
  return `<div class="quest-panel" data-history="${questHistory}" data-story="${!!story}"><button id="quest-history" class="small">${questHistory?'Current step':'Show all steps'}</button><div class="panel-heading"><p class="eyebrow">MAIN QUEST</p><h3>The Alchemist’s Seal</h3><p>${q.seal ? 'Your work has earned the guild’s seal. The Copper Acorn is yours to grow; the market remains open.' : 'The guild examiner is visiting Briarbridge. Prove your shop can serve the town, then supply the expedition. Bram carries the guild’s letters.'}</p></div>
    ${story ? `<article class="recipe quest-step" data-quest-step="0" data-progress="${progress(0)}"><p class="eyebrow">1 · ${progress(0)}</p><h4>Open for business</h4><p>Brew a Healing Tonic, then sell one from your shelf or to a merchant.</p><p class="help">${story.opening_credited ? 'Your saved guild progress recognizes this opening step.' : `Brewed: ${story.tonic_brewed ? 'yes' : 'not yet'} · Sale paid: ${story.tonic_sold ? 'yes' : 'not yet'}. Listing alone does not count.`}</p><div class="quest-actions">${guide('cauldron','View recipes')}${guide('shop','Open shelves')}</div></article>` : ''}
    <article class="recipe quest-step" data-quest-step="1" data-progress="${progress(1)}"><p class="eyebrow">2 · ${progress(1)}</p><h4>The Focus trial</h4><p>Deliver two Focus Draughts for the guild laboratory.</p><p class="help">${q.delivered[1]} / ${q.targets[1]} delivered · ${escape(q.rewards[1])} Copper per potion${stage === 0 ? ' · Complete your first crafted tonic sale to unlock.' : ''}</p>${deliver('focus_draught',q.delivered[1]>=q.targets[1],!!story && stage<1)}</article>
    <article class="recipe quest-step" data-quest-step="2" data-progress="${progress(2)}"><p class="eyebrow">3 · ${progress(2)}</p><h4>The Restoration trial</h4><p>Deliver one Restoration Elixir for the expedition’s return.</p><p class="help">${q.delivered[2]} / ${q.targets[2]} delivered · ${escape(q.rewards[2])} Copper and the Seal${story && stage < 2 ? ' · Finish the Focus trial to unlock.' : ''}</p>${deliver('restoration_elixir',q.delivered[2]>=q.targets[2],!!story && stage<2)}</article>
    <p class="help">Plan for three Focus Draughts in total: two delivered, one used in the Elixir. Each brew uses ingredients and ${escape(state!.craft_fee)} Copper.</p><div class="quest-actions">${guide('cauldron','Plan your next brew')}</div>
    <div class="panel-heading quest-side-heading"><p class="eyebrow">SIDE QUESTS · OPTIONAL</p><h3>Neighbours in need</h3><p>Help at any time. These orders never block the guild trials.</p></div>
    <details class="recipe" data-side-quest="mira" ${sideOrders.has('mira')?'open':''}><summary>Mira’s gardeners · ${q.delivered[0]}/${q.targets[0]}${q.gardener_complete?' · Done':''}</summary><p>${q.gardener_complete ? 'The gardeners have their remedies. Mira thanks you; this order is paid.' : 'Bring three Healing Tonics to help the gardeners through their work.'}</p><p class="help">${q.delivered[0]} / ${q.targets[0]} delivered · ${escape(q.rewards[0])} Copper per potion</p>${deliver('healing_tonic',q.gardener_complete)}</details>
    ${story ? `<details class="recipe" data-side-quest="rowan" ${sideOrders.has('rowan')?'open':''}><summary>Rowan’s clear-water order · ${story.water_delivered}/${story.water_target}${story.water_delivered===story.water_target?' · Done':''}</summary><p>${story.water_delivered >= story.water_target ? 'Rowan has two clean flasks for his still. He thanks you; this order is paid.' : 'Bring two Spring Water for Rowan’s still. Keep enough for your own recipes.'}</p><p class="help">${story.water_delivered} / ${story.water_target} delivered · ${escape(story.water_reward)} Copper per flask</p>${deliver('spring_water',story.water_delivered>=story.water_target)}<div class="quest-actions"><button class="secondary" data-quest-resource="spring_water">Find Spring Water</button></div></details>` : ''}
    <p class="help">${escape(q.escrow_remaining)} Copper reserved for remaining orders. Deliveries consume owned goods and pay once. Selling from your shelves is separate from fulfilling an order.</p></div>`;
}

function render() {
  el<HTMLButtonElement>('refresh').disabled = busy;
  document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.panel === panel)));
  if (!state) return;
  const s = state;
  const clock = el('market-clock'); clock.hidden = false;
  if (s.market) {
    clock.innerHTML=`<div class="market-compact"><span>Market ${marketRunning?'open':'paused'} · ${s.market.day_ticks}/10</span><button id="market-toggle" ${disabled(s.market.blocked)}>${marketRunning?'Pause market':'Start market'}</button></div><details class="market-log"><summary>Merchant activity</summary>${s.market.events.slice(-4).reverse().map(e=>`<p>Day ${e.day+1} · ${escape(e.decision.merchant)} · ${escape(gameMessage(e.decision.reason,'Checking stock and customer demand.'))}</p>`).join('')}</details>`;
  } else clock.innerHTML=`<div class="market-compact"><span>Restock gathering spots for tomorrow</span><button id="legacy-next-day" ${disabled()}>Next market day</button></div>`;
  const active = document.activeElement?.id;
  el('copper').textContent = s.player.balances.copper;
  el('day-label').textContent = `Market day ${s.world.day + 1}`;
  el('network-label').textContent = preview() ? 'Shop preview' : online ? 'Saved shop' : 'Practice shop';
  const native = BigInt(s.environment.native_balance);
  el<HTMLMeterElement>('mana-meter').value = Math.min(100, Number(native * 100n / BigInt(s.environment.starter_native)));
  el('mana-label').textContent = native === 0n ? 'Empty' : lowMana() ? 'Low' : 'Ready';
  const refill = el<HTMLButtonElement>('refill'); refill.textContent = `Refill Mana · ${s.world.refill_price} Copper`;
  refill.disabled = busy || unresolved || preview() || owned('copper') < BigInt(s.world.refill_price) || BigInt(s.world.native_pool) < BigInt(s.world.refill_amount) || s.environment.refill_available === false || s.world.mana_rescue?.pending === true;
  const rescue=s.world.mana_rescue;
  const showRescue=!!rescue && lowMana() && owned('copper') < BigInt(s.world.refill_price);
  refill.hidden=showRescue;
  const rescueButton=el<HTMLButtonElement>('rescue');rescueButton.hidden=!showRescue;
  rescueButton.disabled=busy || unresolved || preview() || !s.environment.rescue_available || !rescue?.available || rescue.used || rescue.pending;
  rescueButton.textContent=rescue?.used ? 'Guild rescue used' : 'Free guild rescue';
  const rescueDetail=el('rescue-detail');rescueDetail.hidden=!showRescue;
  rescueDetail.textContent=rescue?.used ? 'This shop has used its free rescue. Your progress is preserved.' : rescue?.pending ? 'A refill is awaiting confirmation. Use Refresh ledger to check its outcome.' : !s.environment.rescue_available ? 'The guild reserve cannot fund a rescue yet. Your progress is preserved.' : 'Not enough Copper for a refill? The guild can restore your Mana once per shop, at no Copper cost.';
  el('resources').innerHTML = s.catalog.filter(i => i.kind === 'ingredient').map(i => `<button id="gather-${i.token_id}" class="resource" data-gather="${i.token_id}" ${disabled(BigInt(i.gathered_today) >= BigInt(i.gather_cap) || lowMana())}>${icon(i.token_id)}<span><strong>${escape(i.name)}</strong><small>${BigInt(i.gather_cap) - BigInt(i.gathered_today)} left this market day</small></span></button>`).join('');
  const goods = s.catalog.filter(i => i.kind !== 'currency');
  el('inventory').innerHTML = goods.map(i => `<div class="bag-item" title="${escape(i.name)}">${icon(i.token_id)}<span>${escape(i.name)}</span><strong data-owned="${i.token_id}">${owned(i.token_id)}</strong></div>`).join('');
  el('bag-count').textContent = `${goods.reduce((sum, i) => sum + owned(i.token_id), 0n)} items`;
  el('quest-tab').hidden = !s.quests?.active;
  el('panel').innerHTML = (['cauldron','market','quests'].includes(panel)&&s.batch_limit?quantityPicker('action-amount'):'') + (panel === 'cauldron' ? cauldronPanel() : panel === 'market' ? marketPanel() : panel === 'quests' ? questPanel() : shelfPanel());
  if (interactionDialog.open) renderInteraction();
  if (active && active !== 'game') document.getElementById(active)?.focus({ preventScroll: true });
}

document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(b => b.addEventListener('click', () => { panel = b.dataset.panel!; if(panel==='shop')shopView='display';render(); }));
el('refill').addEventListener('click', () => void act({ kind: 'refill' }, 'Refilling Mana…'));
el('rescue').addEventListener('click',()=>void act({kind:'rescue'}, 'Requesting the guild’s one-time rescue…'));
el('market-clock').addEventListener('click', event => {
  if ((event.target as HTMLElement).id === 'legacy-next-day') { void act({kind:'next_day'},'Opening the next market day…'); return; }
  if ((event.target as HTMLElement).id === 'market-toggle') { marketRunning = !marketRunning; marketSeconds = 0; render(); }
});
setInterval(() => {
  if (!marketRunning || !state?.market || busy || unresolved || preview() || document.hidden || document.querySelector('dialog[open]')) return;
  if (state.market.blocked) { marketRunning = false; render(); return; }
  if (state.market.day_ticks === state.market.ticks_per_day) { marketSeconds = 0; void act({kind:'next_day'}, 'Opening the next market day…'); return; }
  if (++marketSeconds < state.market.tick_seconds) return;
  marketSeconds = 0;
  void act({kind:'market_tick',tick:state.market.tick}, 'The merchants are trading…');
}, 1000);
el('resources').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gather]');
  if (button && !button.disabled) openInteraction('gather', button.dataset.gather!);
});
el('gather-quantity').addEventListener('change',event=>{const v=Number((event.target as HTMLSelectElement).value);if(Number.isInteger(v)&&v>=1&&v<=10){quantity=v;renderInteraction();}});
el('panel').addEventListener('toggle',event=>{const d=event.target as HTMLDetailsElement;if(d.dataset.sideQuest){if(d.open)sideOrders.add(d.dataset.sideQuest);else sideOrders.delete(d.dataset.sideQuest);}},true);
el('panel').addEventListener('change', event => {
  const target=event.target as HTMLSelectElement;
  if(target.id==='action-amount'){const n=Number(target.value);if(Number.isInteger(n)&&n>=1&&n<=10){quantity=n;render();}}
  if(target.id==='recipe-select'){selectedRecipe=target.value;quantity=1;render();}
  if(target.id==='market-item-select'){selectedTrade=target.value;quantity=1;render();}
  if ((event.target as HTMLElement).id === 'potion-select') { selectedPotion = (event.target as HTMLSelectElement).value; render(); }
});
el('panel').addEventListener('input', event => { if ((event.target as HTMLElement).id === 'listing-price') prices[selectedPotion] = (event.target as HTMLInputElement).value; });
el('panel').addEventListener('submit', event => {
  if ((event.target as HTMLElement).id !== 'listing-form') return;
  event.preventDefault(); const price = el<HTMLInputElement>('listing-price').value;
  if (!/^\d+$/.test(price) || BigInt(price) < 1n || BigInt(price) > 2n ** 128n - 1n) { message('Enter a positive whole Copper price.', 'error'); return; }
  void act({ kind: 'list', token_id: selectedPotion, price }, 'Stocking a shelf…');
});
el('panel').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
  if (button.dataset.questPanel) { panel = button.dataset.questPanel; render(); el('ledger').focus(); }
  if (button.dataset.questResource) openInteraction('gather',button.dataset.questResource);
  if(button.dataset.shopView){shopView=button.dataset.shopView;render();}
  if(button.id==='quest-history'){questHistory=!questHistory;render();}
  if (button.dataset.brew) void act({ kind: 'brew', token_id: button.dataset.brew,...batchAmount() }, 'Brewing a potion…');
  if (button.dataset.deliver) void act({kind:'deliver',token_id:button.dataset.deliver,...batchAmount()}, 'Delivering an order…');
  if (button.dataset.unlist) void act({ kind: 'unlist', token_id: button.dataset.unlist }, 'Taking the potion off the shelf…');
  if (button.dataset.merchant) { merchant = button.dataset.merchant; selectedTrade='sunleaf';quantity=1;render(); }
  if (button.dataset.trade) void act({ kind: 'trade', merchant, token_id: button.dataset.trade, buy: button.dataset.buy === 'true', limit: button.dataset.limit!,...batchAmount() }, 'Trading with your neighbor…');
  if (button.id === 'serve') void act({ kind: 'serve_customer' }, 'Serving the gardener…');
  if (button.id === 'invest') void act({ kind: 'invest', merchant }, 'Restoring the stall’s working capital…');
  if (button.id === 'retry') void connect();
});

const refreshButton = document.createElement('button'); refreshButton.id = 'refresh'; refreshButton.className = 'refresh'; refreshButton.textContent = 'Refresh ledger';
refreshButton.addEventListener('click', () => void connect()); el('action-status').after(refreshButton);
async function connect() {
  if (busy) return;
  const version = connectionVersion;
  busy = true; render();
  try {
    const restored = await refresh();
    if (version !== connectionVersion) return;
    if (!unresolved && !restored) message(preview() ? 'Shop preview. Your current shop remains active until this one is activated.' : lowMana() ? 'Mana is low. Refill before your next trade.' : 'Your shop is open. Try brewing a Healing Tonic.');
  } catch (error) {
    if (version !== connectionVersion) return;
    unresolved = true;
    const failure=error as {status?:number;path?:string};
    missingLocalWorld=localSandbox&&!online&&!usedOnline&&!!localWorld&&failure.status===404&&failure.path==='/api/state';
    message(missingLocalWorld?'This local save is no longer available. Open Saved games to select an available game.':`${error instanceof Error ? gameMessage(error.message) : 'Connection interrupted.'} Trading is paused. Use “Refresh ledger” to try again.`, 'error');
  } finally {
    if (version === connectionVersion) {
      busy = false;render();
      if(bootDialog?.dataset.boot){
        await marketLoaded;
        if(version!==connectionVersion)return;
        delete bootDialog.dataset.boot;bootRetry.hidden=true;
      }
      if(enteringOnline&&state){enteringOnline=false;enterGame();}
      if(inGame()){
        const dialog=el<HTMLDialogElement>('games-dialog');if(dialog.classList.contains('startup'))dialog.close();picker.enter();
      }else if(online||usedOnline||!localSandbox||state?.batch_limit===10||missingLocalWorld)void openGames();
    }
  }
}
accountUI=initAccount((connection,enter=false) => {
  enteringOnline=!!connection&&(enter||enteringOnline);
  arena.reset();
  if (interactionDialog.open) interactionDialog.close();
  interaction = null;
  scene.cancelMovement();
  connectionVersion++; online = connection; state = null; busy = false; unresolved = false;missingLocalWorld=false;
  scene.refresh(null); picker.world(null);
  marketRunning = false; marketSeconds = 0;
  if (connection) usedOnline = true;
  el('copper').textContent = '—'; el('day-label').textContent = 'Market day —';
  el('mana-label').textContent = '—'; el<HTMLMeterElement>('mana-meter').value = 0;
  el('market-clock').hidden = true; el('market-clock').innerHTML = '';
  el('rescue').hidden = true; el('rescue-detail').hidden = true;
  el('resources').innerHTML = ''; el('inventory').innerHTML = '';
  el('bag-count').textContent = 'Waiting for inventory';
  el<HTMLButtonElement>('refill').disabled = true;
  el('network-label').textContent = connection ? 'Restoring your saved shop…' : localSandbox && !usedOnline ? 'Opening your practice shop…' : 'Sign in to open your shop';
  el('panel').innerHTML = '<div class="empty-state"><h3>Your shop is waiting</h3><p>Sign in with Google using the account controls below to restore your inventory.</p></div>';
  render();
  if (connection || localSandbox && !usedOnline) void connect(); else {message('Sign in with Google to open your saved shop.');if(!localSandbox||accountOwner)void openGames();}
}, account => {
  if(accountOwner&&accountOwner!== (account?.owner||null)){entryWorld=null;try{sessionStorage.removeItem('copper-acorn.enter-world');}catch{}}
  accountOwner=account?.owner||null;if(accountOwner)usedOnline=true;picker.account(account);
  if(el<HTMLDialogElement>('games-dialog').open)void openGames();
});
if(playerDevice){
  const revoke=document.createElement('button');revoke.id='revoke-device';revoke.className='secondary';revoke.textContent='Revoke device access';
  revoke.addEventListener('click',async()=>{
    if(!localWorld||busy)return;revoke.disabled=true;
    try{const result=await playerDevice.revoke(localWorld);message(result.status==='confirmed'?'Device access revoked. Your goods stay with your player account.':'Revocation is awaiting confirmation. Refresh to check the same request.');}
    catch(e){message(e instanceof Error?gameMessage(e.message):'Revocation could not be confirmed.','error');}
    finally{revoke.disabled=false;}
  });el('saved-games').after(revoke);
}
if (localSandbox) void connect();
else void openGames();
document.documentElement.removeAttribute('data-startup');
if (import.meta.hot) import.meta.hot.dispose(() => { connectionVersion++; arena.destroy();game.destroy(true); });
