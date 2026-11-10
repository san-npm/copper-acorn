export type Item = { token_id: string; name: string; kind: 'ingredient' | 'potion' | 'currency'; base_value: string; gather_cap: string; gathered_today: string; recipe: null | { token_id: string; amount: string }[] };
export type Wallet = { account_id: string; balances: Record<string, string>; next_action: number };
export type Quote = { token_id: string; stock: string; target: string; consumed_last_two_days: string; stock_adjustment_percent: number; demand_adjustment_percent: number; reference: string; merchant_buys_at: string; merchant_sells_at: string; rule_version: string; buy_totals?: (string|null)[]; sell_totals?: (string|null)[] };
export type Merchant = { name: string; account: Wallet; open: boolean; quotes: Quote[] };
export type GameState = {
  batch_limit?: number; alchemist?: {nickname:string;character_id:string}|null;
  world: { day: number; refill_price: string; native_pool: string; refill_amount: string; mana_rescue?: {used:boolean;pending:boolean;available:boolean} };
  player: Wallet; customer: Wallet; merchants: Merchant[]; catalog: Item[]; craft_fee: string; investment: string; shelf_slots: number;
  listings: { token_id: string; price: string }[];
  environment: { player_owned?:boolean;contract_id?:string;network: string; world_id: string; ai_mode: string; native_balance: string; starter_native: string; low_native: string; rescue_available?:boolean;refill_available?:boolean;is_active?:boolean };
  customer_need: null | { text: string; source: string; model: string; probability: number; judgment: string; recorded_at: string; request_sha256: string };
  customer_available: boolean;
  pending_operation?: { request_id: string; status: string } | null;
  quests?: { active: boolean; delivered: number[]; targets: number[]; rewards: string[]; escrow_remaining: string; seal: boolean; gardener_complete: boolean;
    story?: {stage:number;tonic_brewed:boolean;tonic_sold:boolean;opening_credited:boolean;water_delivered:number;water_target:number;water_reward:string;water_escrow_remaining:string} | null };
  market?: { source: string; tick: number; day_ticks: number; ticks_per_day: number; tick_seconds: number; blocked: boolean;
    needs: {merchant: string; text: string; model: string; probabilities: Record<string,number>}[];
    events: {tick: number; day: number; decision: {merchant: string; method: string | null; reason: string; probability: number | null}}[] };
};
export type Action = {kind:'accept_mira_order'|'deliver_mira_order'|'cancel_mira_order';order_id:number}
  | { kind: 'gather' | 'brew'; token_id: string; amount?:string }
  | {kind:'unlist';token_id:string}
  | { kind: 'list'; token_id: string; price: string }
  | { kind: 'trade'; merchant: string; token_id: string; buy: boolean; limit: string; amount?:string }
  | { kind: 'invest'; merchant: string }
  | { kind: 'market_tick'; tick: number }
  | { kind: 'deliver'; token_id: string; amount?:string }
  | { kind: 'choose_alchemist'; nickname:string;character_id:string }
  | { kind: 'serve_customer' | 'refill' | 'rescue' | 'next_day' };
export type Operation = { status: 'preparing' | 'pending' | 'confirmed' | 'failed' | 'unconfirmed'; result: { hash?: string; method?: string } | null; error: string | null };
