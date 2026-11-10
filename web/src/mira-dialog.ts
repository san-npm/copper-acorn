import {gameMessage} from './game-message';
import type {Action} from './types';

type View={thread:{messages:{who:string;text:string}[]};orders:{completed:number;order:null|{id:number;token_id:string;amount:string;reward:string;status:string}};chat_available:boolean};
export function miraDialog(dialog:HTMLDialogElement,request:<T>(path:string,init?:RequestInit)=>Promise<T>,act:(action:Action,label:string)=>Promise<void>){
  const pane=document.createElement('section');pane.className='mira-conversation';pane.hidden=true;
  pane.innerHTML='<div class="mira-history" aria-label="Conversation with Mira" aria-live="polite"></div><p class="mira-order"></p><div class="mira-choices"><button data-talk="work">Ingredient work</button><button data-talk="potions">Potion work</button><button data-talk="hint">A hint</button></div><div class="mira-order-actions"></div><form><label for="mira-message">Talk to Mira</label><div><input id="mira-message" maxlength="400" autocomplete="off"><button type="submit">Say</button></div><p class="help">Mira remembers your recent conversations. Keep messages about the game and leave out personal details.</p></form><p class="mira-status" role="status"></p>';
  dialog.querySelector('#interaction-text')!.after(pane);
  const status=pane.querySelector<HTMLElement>('.mira-status')!,input=pane.querySelector<HTMLInputElement>('input')!,form=pane.querySelector('form')!;
  let generation=0,busy=false,view:View|null=null,pending:{request_id:string;choice?:string;message?:string}|null=null;
  const button=(label:string,kind:Action['kind'],id:number)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>void deliver(kind,id));return b;};
  function render(){
    const log=pane.querySelector<HTMLElement>('.mira-history')!;log.replaceChildren();
    for(const m of view?.thread.messages.slice(-4)||[]){const p=document.createElement('p');p.textContent=(m.who==='mira'?'Mira: ':'You: ')+m.text;log.append(p);}
    const o=view?.orders.order,active=o&&['offered','accepted'].includes(o.status);
    pane.querySelector<HTMLElement>('.mira-order')!.textContent=active?`${o.amount} ${o.token_id.replaceAll('_',' ')} · ${o.reward} Copper · ${o.status}`:view?.orders.completed?`${view.orders.completed} ${view.orders.completed===1?'delivery':'deliveries'} confirmed.`:'';
    const actions=pane.querySelector<HTMLElement>('.mira-order-actions')!;actions.replaceChildren();
    if(active){actions.append(button(o.status==='offered'?'Accept order':'Deliver goods',o.status==='offered'?'accept_mira_order':'deliver_mira_order',o.id),button('Decline order','cancel_mira_order',o.id));}
    for(const b of pane.querySelectorAll<HTMLButtonElement>('button'))b.disabled=busy;
    input.disabled=busy||!view?.chat_available;form.querySelector('button')!.disabled=input.disabled;
    input.placeholder=view?.chat_available?'Ask about alchemy or the current order':'Mira is busy; use the choices above';
  }
  async function load(){const started=generation,result=await request<View>('/api/npc');if(started!==generation||pane.hidden||!dialog.open)return;view=result;render();}
  async function talk(body:{choice?:string;message?:string}){
    if(busy)return;const started=generation;busy=true;status.textContent='Mira checks her order book…';render();
    if(!pending||pending.choice!==body.choice||pending.message!==body.message)pending={request_id:crypto.randomUUID(),...body};
    try{const result=await request<View>('/api/npc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});if(started!==generation)return;pending=null;view=result;input.value='';status.textContent='';}
    catch(e){if(started===generation)status.textContent=e instanceof Error?gameMessage(e.message):'Mira is unavailable.';}
    finally{if(started===generation){busy=false;render();}}
  }
  async function deliver(kind:Action['kind'],id:number){
    if(busy||!['accept_mira_order','deliver_mira_order','cancel_mira_order'].includes(kind))return;
    const started=generation;busy=true;render();
    try{await act({kind:kind as 'accept_mira_order'|'deliver_mira_order'|'cancel_mira_order',order_id:id},'Confirming Mira’s order…');if(started===generation){await load();status.textContent='Order checked against your confirmed goods.';}}
    catch(e){if(started===generation)status.textContent=e instanceof Error?gameMessage(e.message):'Order could not be confirmed.';}
    finally{if(started===generation){busy=false;render();}}
  }
  pane.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-talk]');if(b)void talk({choice:b.dataset.talk});});
  form.addEventListener('submit',e=>{e.preventDefault();if(input.value.trim())void talk({message:input.value.trim()});});
  dialog.addEventListener('close',()=>{generation++;busy=false;pane.hidden=true;view=null;});
  return {open(){generation++;busy=false;pane.hidden=false;view=null;render();status.textContent='Opening Mira’s order book…';const started=generation;void load().then(()=>{if(started===generation&&dialog.open)return talk({choice:'greet'});}).catch(e=>{if(started===generation)status.textContent=e instanceof Error?gameMessage(e.message):'Mira is unavailable.';});}};
}
