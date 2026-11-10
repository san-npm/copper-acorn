import type {Action,GameState} from '../web/src/types.ts';

export const gameplayMethods=['choose_alchemist','gather','brew_many','list_potion','unlist_potion','trade','invest','deliver_many','request_mana_refill','request_mana_rescue','accept_mira_order','deliver_mira_order','cancel_mira_order'];
export function playerCall(action:Action,state:GameState):{method:string;args:Record<string,unknown>}{
  const nonce=state.player.next_action,amount='amount' in action?action.amount||'1':'1';
  const merchant='merchant' in action?state.merchants.find(m=>m.name.toLowerCase()===action.merchant)?.account.account_id:undefined;
  switch(action.kind){
    case 'choose_alchemist':return {method:'choose_alchemist',args:{nickname:action.nickname,character_id:action.character_id,nonce}};
    case 'gather':return {method:'gather',args:{token_id:action.token_id,amount,nonce}};
    case 'brew':return {method:'brew_many',args:{token_id:action.token_id,amount,nonce}};
    case 'deliver':return {method:'deliver_many',args:{token_id:action.token_id,amount,nonce}};
    case 'list':return {method:'list_potion',args:{token_id:action.token_id,price:action.price,nonce}};
    case 'unlist':return {method:'unlist_potion',args:{token_id:action.token_id,nonce}};
    case 'trade':if(!merchant)throw Error('Unknown merchant.');return {method:'trade',args:{merchant_id:merchant,token_id:action.token_id,amount,buy:action.buy,limit:action.limit,nonce}};
    case 'invest':if(!merchant)throw Error('Unknown merchant.');return {method:'invest',args:{merchant_id:merchant,nonce}};
    case 'refill':return {method:'request_mana_refill',args:{nonce}};
    case 'rescue':return {method:'request_mana_rescue',args:{nonce}};
    case 'accept_mira_order':case 'deliver_mira_order':case 'cancel_mira_order':return {method:action.kind,args:{order_id:action.order_id,nonce}};
    default:throw Error('This action belongs to the game NPCs.');
  }
}
