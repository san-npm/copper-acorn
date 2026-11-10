pub mod economy;
mod orders;
mod quests;
mod sessions;

use std::collections::BTreeMap;

use economy::{CRAFT_FEE, INVESTMENT, ITEMS, Item, MAX_TRADE, REFILL_PRICE, UPKEEP};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, assert_one_yocto,
    collections::LookupMap,
    env, ext_contract,
    json_types::U128,
    near, require,
    serde_json::{Value, json},
};

const REGISTERED_BYTES: u64 = 512;
const MAX_ACCOUNTS: u32 = 64;
const MAX_BATCH: usize = 32;
const RESCUE_NONCE: &[u8] = b"mana-rescue-nonce-v1";
const RESCUE_USED: &[u8] = b"mana-rescue-used-v1";
const ALCHEMIST: &[u8] = b"alchemist-v1";

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct Ledger {
    balances: [u128; 10],
    next_action: u64,
    pending_calls: u32,
    storage_paid: u128,
    last_brew_day: Option<u64>,
}

#[near(serializers = [json])]
pub struct Setup {
    pub owner_id: AccountId,
    pub player_id: AccountId,
    pub merchant_ids: [AccountId; 3], // Mira, Rowan, Bram.
    pub customer_id: AccountId,
    pub treasury_id: AccountId,
    pub refill_amount: U128,
    pub operating_reserve: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum RefillStatus {
    Pending,
    Completed,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Refill {
    pub nonce: u64,
    pub amount: U128,
    pub status: RefillStatus,
}

#[ext_contract(receiver)]
pub trait Receiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> Vec<U128>;
}

#[ext_contract(callbacks)]
pub trait Callbacks {
    fn mt_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
    ) -> Vec<U128>;
    fn resolve_mana_refill(&mut self, nonce: u64) -> Refill;
}

// shortcut: one isolated world per contract; add namespaces when serving multiple worlds from one deployment.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Alchemy {
    owner_id: AccountId,
    player_id: AccountId,
    merchant_ids: [AccountId; 3],
    customer_id: AccountId,
    treasury_id: AccountId,
    accounts: LookupMap<AccountId, Ledger>,
    account_count: u32,
    supply: [u128; 10],
    day: u64,
    gathered: [u128; 10],
    consumption: [[u128; 10]; 2],
    listings: BTreeMap<Item, u128>,
    native_pool: u128,
    native_pending: u128,
    refill_amount: u128,
    operating_reserve: u128,
    refill: Option<Refill>,
}

#[near]
impl Alchemy {
    #[init]
    pub fn new(setup: Setup) -> Self {
        require!(
            env::current_account_id().get_parent_account_id() == Some(setup.owner_id.as_ref()),
            "Contract must be a direct child of the owner"
        );
        require!(
            env::predecessor_account_id() == setup.owner_id,
            "Owner must initialize"
        );
        require!(setup.refill_amount.0 > 0, "Refill amount must be positive");
        let mut ids = vec![
            setup.owner_id.clone(),
            setup.player_id.clone(),
            setup.customer_id.clone(),
            setup.treasury_id.clone(),
            env::current_account_id(),
        ];
        ids.extend(setup.merchant_ids.iter().cloned());
        ids.sort();
        ids.dedup();
        require!(ids.len() == 8, "All account roles must be distinct");
        let mut game = Self {
            owner_id: setup.owner_id,
            player_id: setup.player_id,
            merchant_ids: setup.merchant_ids,
            customer_id: setup.customer_id,
            treasury_id: setup.treasury_id,
            accounts: LookupMap::new(b"a"),
            account_count: 8,
            supply: [0; 10],
            day: 0,
            gathered: [0; 10],
            consumption: [[0; 10]; 2],
            listings: BTreeMap::new(),
            native_pool: 0,
            native_pending: 0,
            refill_amount: setup.refill_amount.0,
            operating_reserve: setup.operating_reserve.0,
            refill: None,
        };
        for id in ids {
            game.accounts.insert(&id, &Ledger::default());
        }
        let player = game.player_id.clone();
        game.mint(&player, Item::Copper, 40);
        for (item, amount) in [
            (Item::Sunleaf, 4),
            (Item::SpringWater, 3),
            (Item::Moonmint, 1),
            (Item::WoodEssence, 1),
        ] {
            game.mint(&player, item, amount);
        }
        for merchant in game.merchant_ids.clone() {
            game.mint(&merchant, Item::Copper, 100);
        }
        game.mint(&game.customer_id.clone(), Item::Copper, 120);
        game.mint(&game.treasury_id.clone(), Item::Copper, 4540);
        for (index, goods) in [
            vec![
                (Item::Sunleaf, 10),
                (Item::Moonmint, 6),
                (Item::Emberbloom, 2),
            ],
            vec![(Item::SpringWater, 12), (Item::WoodEssence, 6)],
            vec![
                (Item::SilverDust, 4),
                (Item::HealingTonic, 2),
                (Item::FocusDraught, 1),
            ],
        ]
        .into_iter()
        .enumerate()
        {
            for (item, amount) in goods {
                game.mint(&game.merchant_ids[index].clone(), item, amount);
            }
        }
        game
    }

    pub fn account_view(&self, account_id: AccountId) -> Value {
        let ledger = self.ledger(&account_id);
        let balances: BTreeMap<_, _> = ITEMS
            .into_iter()
            .map(|item| (item.id(), ledger.balances[item as usize].to_string()))
            .collect();
        let consumed_day = self
            .merchant_ids
            .iter()
            .position(|id| id == &account_id)
            .and_then(|index| env::storage_read(&[b'c', b'd', index as u8]))
            .and_then(|bytes| bytes.try_into().ok())
            .map(u64::from_le_bytes);
        json!({"account_id": account_id, "balances": balances, "next_action": ledger.next_action,
            "last_brew_day":ledger.last_brew_day,"last_consume_day":consumed_day})
    }

    pub fn world_view(&self) -> Value {
        json!({"day": self.day, "player_id": self.player_id,
            "merchant_ids": self.merchant_ids, "customer_id": self.customer_id,
            "treasury_id": self.treasury_id, "native_pool": U128(self.native_pool),
            "native_pending": U128(self.native_pending), "refill_amount": U128(self.refill_amount),
            "refill_price": U128(REFILL_PRICE), "refill": self.refill,
            "mana_rescue":{"used":env::storage_has_key(RESCUE_USED),
                "pending":self.refill.as_ref().is_some_and(|r|r.status == RefillStatus::Pending),
                "available":!env::storage_has_key(RESCUE_USED) && self.balance(&self.player_id,Item::Copper) < REFILL_PRICE
                    && self.refill.as_ref().is_none_or(|r|r.status != RefillStatus::Pending) && self.native_refill_available()},
            "rule_version": economy::RULE_VERSION})
    }

    pub fn update_contract(&self) -> Promise {
        require!(
            !env::storage_has_key(sessions::OWNED),
            "Player-owned shops are immutable"
        );
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
        let code = env::input().expect("Missing contract code");
        require!(
            (8..=700_000).contains(&code.len()) && code.starts_with(b"\0asm\x01\0\0\0"),
            "Invalid contract code"
        );
        Promise::new(env::current_account_id()).deploy_contract(code)
    }

    pub fn game_view(&self) -> Value {
        let catalog: Vec<Value> = ITEMS.into_iter().map(|item| json!({
            "token_id": item.id(), "name": item.name(),
            "kind": if item == Item::Copper { "currency" } else if item.recipe().is_some() { "potion" } else { "ingredient" },
            "base_value": U128(item.base_value()), "gather_cap": U128(item.gather_cap()),
            "gathered_today": U128(self.gathered[item as usize]),
            "recipe": item.recipe().map(|inputs| inputs.iter().map(|(input,amount)|
                json!({"token_id":input.id(),"amount":U128(*amount)})).collect::<Vec<_>>())
        })).collect();
        let merchants: Vec<Value> = self.merchant_ids.iter().enumerate().map(|(index,id)| json!({
            "name": (["Mira", "Rowan", "Bram"][index]),
            "account": self.account_view(id.clone()),
            "open": self.balance(id, Item::Copper) > 0,
            "quotes": ITEMS.into_iter().filter(|item| *item != Item::Copper).map(|item| {
                let stock=self.balance(id,item); let consumed=self.consumed(item);
                let mut q=near_sdk::serde_json::to_value(economy::quote(item,stock,consumed)).unwrap();
                q["buy_totals"]=json!((1..=10).map(|n| economy::trade_total(item,stock,consumed,n,true).map(U128)).collect::<Vec<_>>());
                q["sell_totals"]=json!((1..=10).map(|n| economy::trade_total(item,stock,consumed,n,false).map(U128)).collect::<Vec<_>>()); q
            }).collect::<Vec<_>>()
        })).collect();
        json!({"world":self.world_view(),"player":self.account_view(self.player_id.clone()),
            "customer":self.account_view(self.customer_id.clone()),"merchants":merchants,
            "quests":self.quest_view(),"batch_limit":10,"alchemist":self.alchemist_view(),
            "catalog":catalog,"craft_fee":U128(CRAFT_FEE),"investment":U128(INVESTMENT),
            "shelf_slots":economy::SHELF_SLOTS,
            "listings":self.listings.iter().map(|(item,price)| json!({"token_id":item.id(),"price":U128(*price)})).collect::<Vec<_>>()})
    }

    pub fn quote(&self, merchant_id: AccountId, token_id: String) -> economy::Quote {
        self.assert_merchant(&merchant_id);
        let item = Self::item(&token_id);
        require!(item != Item::Copper, "Copper is the currency");
        economy::quote(item, self.balance(&merchant_id, item), self.consumed(item))
    }

    pub fn alchemist_view(&self) -> Option<Value> {
        env::storage_read(ALCHEMIST)
            .map(|v| near_sdk::serde_json::from_slice(&v).expect("Invalid alchemist"))
    }

    #[payable]
    pub fn choose_alchemist(&mut self, nickname: String, character_id: String, nonce: u64) {
        self.authorize_gameplay(0);
        self.assert_player();
        require!(
            self.alchemist_view().is_none(),
            "This game's alchemist is already chosen"
        );
        require!(
            nickname == nickname.trim()
                && (3..=20).contains(&nickname.chars().count())
                && nickname
                    .chars()
                    .all(|c| c.is_alphanumeric() || " _-".contains(c)),
            "Use 3–20 letters, numbers, spaces, hyphens or underscores"
        );
        require!(
            [
                "goblin", "magician", "dwarf", "skeleton", "lizard", "vampire", "elf", "dark-elf"
            ]
            .contains(&character_id.as_str()),
            "Unknown character"
        );
        self.take_nonce(&self.player_id.clone(), nonce);
        env::storage_write(
            ALCHEMIST,
            &near_sdk::serde_json::to_vec(
                &json!({"nickname":nickname,"character_id":character_id}),
            )
            .unwrap(),
        );
    }

    #[payable]
    pub fn gather(&mut self, token_id: String, amount: U128, nonce: u64) {
        self.authorize_gameplay(0);
        self.assert_player();
        let caller = env::predecessor_account_id();
        let item = Self::item(&token_id);
        let total = self.gathered[item as usize]
            .checked_add(amount.0)
            .expect("Amount overflow");
        require!(
            amount.0 > 0 && total <= item.gather_cap(),
            "Daily gathering cap exceeded"
        );
        self.take_nonce(&caller, nonce);
        self.gathered[item as usize] = total;
        self.mint(&caller, item, amount.0);
    }

    #[payable]
    pub fn brew(&mut self, token_id: String, nonce: u64) {
        self.brew_many(token_id, U128(1), nonce);
    }

    #[payable]
    pub fn brew_many(&mut self, token_id: String, amount: U128, nonce: u64) {
        self.authorize_gameplay(CRAFT_FEE * amount.0);
        require!(
            amount.0 > 0 && amount.0 <= 10,
            "Choose between 1 and 10 potions"
        );
        let caller = env::predecessor_account_id();
        let merchant = self.merchant_ids.contains(&caller);
        require!(
            caller == self.player_id || merchant,
            "Only player or merchant can brew"
        );
        if merchant {
            require!(amount.0 == 1, "Merchants brew one potion per day");
            self.assert_open(&caller);
        }
        let product = Self::item(&token_id);
        let recipe = product.recipe().expect("Not a potion recipe");
        let ledger = self.ledger(&caller);
        require!(
            !merchant || ledger.last_brew_day != Some(self.day),
            "Merchant already brewed today"
        );
        require!(
            ledger.balances[Item::Copper as usize] >= CRAFT_FEE * amount.0,
            "Insufficient Copper"
        );
        for &(input, units) in recipe {
            require!(
                ledger.balances[input as usize] >= units * amount.0,
                "Missing ingredient"
            );
        }
        self.take_nonce(&caller, nonce);
        for &(input, units) in recipe {
            self.burn(&caller, input, units * amount.0);
            self.consumption[0][input as usize] += units * amount.0;
        }
        self.transfer(
            &caller,
            &self.treasury_id.clone(),
            &[(Item::Copper, CRAFT_FEE * amount.0)],
        );
        self.mint(&caller, product, amount.0);
        self.record_tonic_brew(&caller, product);
        if merchant {
            let mut ledger = self.ledger(&caller);
            ledger.last_brew_day = Some(self.day);
            self.accounts.insert(&caller, &ledger);
        }
    }

    #[payable]
    pub fn list_potion(&mut self, token_id: String, price: U128, nonce: u64) {
        self.authorize_gameplay(0);
        self.assert_player();
        let item = Self::item(&token_id);
        require!(
            item.recipe().is_some() && price.0 > 0,
            "Invalid potion or price"
        );
        require!(self.balance(&self.player_id, item) > 0, "Potion not owned");
        require!(
            self.listings.contains_key(&item) || self.listings.len() < economy::SHELF_SLOTS,
            "Both shelves occupied"
        );
        self.take_nonce(&env::predecessor_account_id(), nonce);
        self.listings.insert(item, price.0);
    }

    #[payable]
    pub fn unlist_potion(&mut self, token_id: String, nonce: u64) {
        self.authorize_gameplay(0);
        self.assert_player();
        let item = Self::item(&token_id);
        require!(
            self.listings.contains_key(&item),
            "Potion is not on a shelf"
        );
        self.take_nonce(&self.player_id.clone(), nonce);
        self.listings.remove(&item);
    }

    #[payable]
    pub fn buy_listing(&mut self, token_id: String, max_price: U128, nonce: u64) {
        assert_one_yocto();
        let buyer = env::predecessor_account_id();
        require!(buyer != self.player_id, "Cannot buy own listing");
        if self.merchant_ids.contains(&buyer) {
            self.assert_open(&buyer);
        }
        let item = Self::item(&token_id);
        let price = *self.listings.get(&item).expect("Potion not listed");
        require!(price <= max_price.0, "Listing price changed");
        require!(self.balance(&self.player_id, item) > 0, "Potion sold out");
        require!(
            self.balance(&buyer, Item::Copper) >= price,
            "Buyer cannot afford listing"
        );
        self.take_nonce(&buyer, nonce);
        self.transfer(&buyer, &self.player_id.clone(), &[(Item::Copper, price)]);
        self.transfer(&self.player_id.clone(), &buyer, &[(item, 1)]);
        self.record_tonic_sale(&self.player_id, item);
        if self.balance(&self.player_id, item) == 0 {
            self.listings.remove(&item);
        }
    }

    #[payable]
    pub fn trade(
        &mut self,
        merchant_id: AccountId,
        token_id: String,
        amount: U128,
        buy: bool,
        limit: U128,
        nonce: u64,
    ) -> U128 {
        self.authorize_gameplay(if buy { limit.0 } else { 0 });
        let caller = env::predecessor_account_id();
        require!(
            caller == self.player_id || self.merchant_ids.contains(&caller),
            "Player or merchant only"
        );
        if self.merchant_ids.contains(&caller) {
            self.assert_open(&caller);
        }
        self.assert_open(&merchant_id);
        require!(caller != merchant_id, "Cannot trade with self");
        let item = Self::item(&token_id);
        require!(
            item != Item::Copper && amount.0 > 0 && amount.0 <= MAX_TRADE,
            "Invalid trade"
        );
        let stock = self.balance(&merchant_id, item);
        if buy {
            require!(stock >= amount.0, "Merchant lacks stock");
        }
        let total = economy::trade_total(item, stock, self.consumed(item), amount.0, buy)
            .expect("Price overflow");
        require!(
            if buy {
                total <= limit.0
            } else {
                total >= limit.0
            },
            "Quote limit exceeded"
        );
        let (buyer, seller) = if buy {
            (caller.clone(), merchant_id)
        } else {
            (merchant_id, caller.clone())
        };
        require!(
            self.balance(&buyer, Item::Copper) >= total,
            "Buyer lacks Copper"
        );
        require!(
            self.balance(&seller, item) >= amount.0,
            "Seller lacks items"
        );
        self.take_nonce(&caller.clone(), nonce);
        self.transfer(&buyer, &seller, &[(Item::Copper, total)]);
        self.transfer(&seller, &buyer, &[(item, amount.0)]);
        self.record_tonic_sale(&seller, item);
        U128(total)
    }

    #[payable]
    pub fn invest(&mut self, merchant_id: AccountId, nonce: u64) {
        self.authorize_gameplay(INVESTMENT);
        self.assert_player();
        self.assert_merchant(&merchant_id);
        require!(
            self.balance(&merchant_id, Item::Copper) == 0,
            "Merchant is already open"
        );
        require!(
            self.balance(&self.player_id, Item::Copper) >= INVESTMENT,
            "Insufficient Copper"
        );
        self.take_nonce(&self.player_id.clone(), nonce);
        self.transfer(
            &self.player_id.clone(),
            &merchant_id,
            &[(Item::Copper, INVESTMENT)],
        );
    }

    #[payable]
    pub fn consume(&mut self, token_id: String, amount: U128, nonce: u64) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let merchant = self.merchant_ids.iter().position(|id| id == &caller);
        require!(
            caller == self.customer_id || merchant.is_some(),
            "Only a customer or merchant can consume purchases"
        );
        if let Some(index) = merchant {
            self.assert_open(&caller);
            require!(amount.0 == 1, "One merchant need per day");
            require!(
                env::storage_read(&[b'c', b'd', index as u8])
                    != Some(self.day.to_le_bytes().to_vec()),
                "Merchant need already fulfilled today"
            );
        }
        let item = Self::item(&token_id);
        require!(
            item.recipe().is_some() && amount.0 > 0,
            "Only potions may be consumed"
        );
        require!(self.balance(&caller, item) >= amount.0, "Potion not owned");
        self.take_nonce(&caller, nonce);
        if let Some(index) = merchant {
            env::storage_write(&[b'c', b'd', index as u8], &self.day.to_le_bytes());
        }
        self.burn(&caller, item, amount.0);
        self.consumption[0][item as usize] += amount.0;
    }

    pub fn advance_day(&mut self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
        self.day = self.day.checked_add(1).expect("Day overflow");
        self.gathered = [0; 10];
        self.consumption[1] = self.consumption[0];
        self.consumption[0] = [0; 10];
        for merchant in self.merchant_ids.clone() {
            let payment = self.balance(&merchant, Item::Copper).min(UPKEEP);
            if payment > 0 {
                self.transfer(
                    &merchant,
                    &self.treasury_id.clone(),
                    &[(Item::Copper, payment)],
                );
            }
        }
    }

    #[payable]
    pub fn fund_mana(&mut self) {
        require!(
            env::attached_deposit().as_yoctonear() > 0,
            "Attach native NEAR"
        );
        self.native_pool = self
            .native_pool
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("Reserve overflow");
    }

    #[payable]
    pub fn request_mana_refill(&mut self, nonce: u64) -> PromiseOrValue<Refill> {
        self.start_mana_refill(nonce, false)
    }

    #[payable]
    pub fn request_mana_rescue(&mut self, nonce: u64) -> PromiseOrValue<Refill> {
        self.start_mana_refill(nonce, true)
    }

    fn native_refill_available(&self) -> bool {
        let storage = env::storage_byte_cost().as_yoctonear()
            * u128::from(env::storage_usage() + REGISTERED_BYTES);
        let available = env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage)
            .saturating_sub(self.operating_reserve)
            .saturating_sub(self.native_pending);
        self.native_pool >= self.refill_amount && available >= self.refill_amount
    }

    fn rescue_nonce(&self) -> Option<u64> {
        env::storage_read(RESCUE_NONCE)
            .and_then(|bytes| bytes.try_into().ok())
            .map(u64::from_le_bytes)
    }

    fn start_mana_refill(&mut self, nonce: u64, rescue: bool) -> PromiseOrValue<Refill> {
        self.assert_player();
        if let Some(previous) = &self.refill {
            if previous.nonce == nonce {
                require!(
                    (self.rescue_nonce() == Some(nonce)) == rescue,
                    "Refill kind does not match this nonce"
                );
                return PromiseOrValue::Value(previous.clone());
            }
            require!(previous.status != RefillStatus::Pending, "Refill pending");
        }
        require!(
            self.native_refill_available(),
            "Guild native reserve unavailable"
        );
        let coins = self.balance(&self.player_id, Item::Copper);
        if rescue {
            require!(
                !env::storage_has_key(RESCUE_USED),
                "Guild rescue already used"
            );
            require!(coins < REFILL_PRICE, "Use the paid Mana refill");
        } else {
            require!(coins >= REFILL_PRICE, "Insufficient Copper");
        }
        self.authorize_gameplay(if rescue { 0 } else { REFILL_PRICE });
        self.take_nonce(&self.player_id.clone(), nonce);
        if rescue {
            env::storage_write(RESCUE_NONCE, &nonce.to_le_bytes());
        } else {
            self.transfer(
                &self.player_id.clone(),
                &env::current_account_id(),
                &[(Item::Copper, REFILL_PRICE)],
            );
        }
        self.native_pool -= self.refill_amount;
        self.native_pending += self.refill_amount;
        self.refill = Some(Refill {
            nonce,
            amount: U128(self.refill_amount),
            status: RefillStatus::Pending,
        });
        PromiseOrValue::Promise(
            Promise::new(self.player_id.clone())
                .transfer(NearToken::from_yoctonear(self.refill_amount))
                .then(
                    callbacks::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(10))
                        .resolve_mana_refill(nonce),
                ),
        )
    }

    #[private]
    pub fn resolve_mana_refill(&mut self, nonce: u64) -> Refill {
        let mut refill = self.refill.clone().expect("Unknown refill");
        require!(refill.nonce == nonce, "Wrong refill nonce");
        if refill.status != RefillStatus::Pending {
            return refill;
        }
        require!(
            env::promise_results_count() == 1,
            "One payout outcome required"
        );
        let succeeded = env::promise_result_checked(0, 64).is_ok();
        self.native_pending -= refill.amount.0;
        let recipient = if succeeded {
            self.treasury_id.clone()
        } else {
            self.player_id.clone()
        };
        let rescue = self.rescue_nonce() == Some(nonce);
        if !rescue {
            self.transfer(
                &env::current_account_id(),
                &recipient,
                &[(Item::Copper, REFILL_PRICE)],
            );
        }
        if succeeded {
            refill.status = RefillStatus::Completed;
            if rescue {
                env::storage_write(RESCUE_USED, &[1]);
            }
        } else {
            refill.status = RefillStatus::Refunded;
            self.native_pool += refill.amount.0;
        }
        env::log_str(
            &json!({"event":"mana_refill", "nonce":nonce, "status":refill.status,
            "native_amount":refill.amount,"rescue":rescue})
            .to_string(),
        );
        self.refill = Some(refill.clone());
        refill
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Value>> {
        token_ids
            .into_iter()
            .map(|id| {
                Item::parse(&id).map(|item| {
                    json!({"token_id":item.id(),"owner_id":null,"base_metadata_id":item.id(),
                   "token_metadata":Self::token_metadata(item)})
                })
            })
            .collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(
            Item::parse(&token_id)
                .map(|item| self.balance(&account_id, item))
                .unwrap_or(0),
        )
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids
            .into_iter()
            .map(|id| self.mt_balance_of(account_id.clone(), id))
            .collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        Item::parse(&token_id).map(|item| U128(self.supply[item as usize]))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|id| self.mt_supply(id)).collect()
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        self.mt_batch_transfer(
            receiver_id,
            vec![token_id],
            vec![amount],
            approval.map(|a| vec![Some(a)]),
            memo,
        );
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        Self::validate_approvals(&approvals, token_ids.len());
        require!(
            memo.as_ref().is_none_or(|m| m.len() <= 256),
            "Memo too long"
        );
        let items = Self::transfer_items(&token_ids, &amounts);
        self.transfer(&env::predecessor_account_id(), &receiver_id, &items);
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        self.mt_batch_transfer_call(
            receiver_id,
            vec![token_id],
            vec![amount],
            approval.map(|a| vec![Some(a)]),
            memo,
            msg,
        )
    }

    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        require!(msg.len() <= 4096, "Receiver message too long");
        let sender = env::predecessor_account_id();
        self.mt_batch_transfer(
            receiver_id.clone(),
            token_ids.clone(),
            amounts.clone(),
            approvals,
            memo,
        );
        let mut ledger = self.ledger(&sender);
        ledger.pending_calls = ledger
            .pending_calls
            .checked_add(1)
            .expect("Too many pending calls");
        self.accounts.insert(&sender, &ledger);
        receiver::ext(receiver_id.clone())
            .with_static_gas(Gas::from_tgas(25))
            .mt_on_transfer(
                sender.clone(),
                vec![sender.clone(); token_ids.len()],
                token_ids.clone(),
                amounts.clone(),
                msg,
            )
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .mt_resolve_transfer(sender, receiver_id, token_ids, amounts),
            )
    }

    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
    ) -> Vec<U128> {
        let requested = match env::promise_result_checked(0, 4096) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<Vec<U128>>(&bytes)
                .ok()
                .filter(|v| v.len() == amounts.len())
                .unwrap_or_else(|| amounts.clone()),
            Err(_) => amounts.clone(),
        };
        let mut used = Vec::with_capacity(amounts.len());
        for ((id, sent), refund) in token_ids.iter().zip(amounts).zip(requested) {
            let item = Self::item(id);
            let refund = refund.0.min(sent.0).min(self.balance(&receiver_id, item));
            if refund > 0 {
                self.transfer(&receiver_id, &sender_id, &[(item, refund)]);
            }
            used.push(U128(sent.0 - refund));
        }
        let mut ledger = self.ledger(&sender_id);
        ledger.pending_calls = ledger
            .pending_calls
            .checked_sub(1)
            .expect("No pending transfer");
        self.accounts.insert(&sender_id, &ledger);
        used
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> Value {
        let _ = registration_only;
        let recipient = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit().as_yoctonear();
        let mut charged = 0;
        if self.accounts.get(&recipient).is_none() {
            require!(
                self.account_count < MAX_ACCOUNTS,
                "World account limit reached"
            );
            charged = Self::storage_minimum();
            require!(deposit >= charged, "Storage deposit too small");
            self.accounts.insert(
                &recipient,
                &Ledger {
                    storage_paid: charged,
                    ..Ledger::default()
                },
            );
            self.account_count += 1;
        }
        if deposit > charged {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(deposit - charged))
                .detach();
        }
        self.storage_balance_of(recipient).unwrap()
    }

    pub fn storage_balance_bounds(&self) -> Value {
        json!({"min":U128(Self::storage_minimum()),"max":U128(Self::storage_minimum())})
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<Value> {
        self.accounts
            .get(&account_id)
            .map(|ledger| json!({"total":U128(ledger.storage_paid),"available":"0"}))
    }

    pub fn mt_metadata_contract(&self) -> Value {
        json!({"spec":"mt-1.0.0","name":"Briarbridge Alchemy"})
    }
    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<Value> {
        token_ids
            .into_iter()
            .map(|id| {
                let item = Self::item(&id);
                json!({"base":Self::base_metadata(item),"token":Self::token_metadata(item)})
            })
            .collect()
    }
    pub fn mt_metadata_token_by_token_id(&self, token_ids: Vec<String>) -> Vec<Value> {
        token_ids
            .into_iter()
            .map(|id| Self::token_metadata(Self::item(&id)))
            .collect()
    }
    pub fn mt_metadata_base_by_token_id(&self, token_ids: Vec<String>) -> Vec<Value> {
        token_ids
            .into_iter()
            .map(|id| Self::base_metadata(Self::item(&id)))
            .collect()
    }
    pub fn mt_metadata_base_by_metadata_id(&self, base_metadata_ids: Vec<String>) -> Vec<Value> {
        self.mt_metadata_base_by_token_id(base_metadata_ids)
    }
}

impl Alchemy {
    fn ledger(&self, account: &AccountId) -> Ledger {
        self.accounts
            .get(account)
            .expect("Account is not registered")
    }
    fn balance(&self, account: &AccountId, item: Item) -> u128 {
        self.accounts
            .get(account)
            .map_or(0, |a| a.balances[item as usize])
    }
    fn item(id: &str) -> Item {
        Item::parse(id).expect("Unknown token")
    }
    fn consumed(&self, item: Item) -> u128 {
        self.consumption[0][item as usize].saturating_add(self.consumption[1][item as usize])
    }
    fn assert_player(&self) {
        require!(
            env::predecessor_account_id() == self.player_id,
            "Player only"
        );
    }
    fn assert_merchant(&self, id: &AccountId) {
        require!(self.merchant_ids.contains(id), "Unknown merchant");
    }
    fn assert_open(&self, id: &AccountId) {
        self.assert_merchant(id);
        require!(self.balance(id, Item::Copper) > 0, "Merchant is closed");
    }
    fn storage_minimum() -> u128 {
        env::storage_byte_cost().as_yoctonear() * u128::from(REGISTERED_BYTES)
    }

    fn take_nonce(&mut self, account: &AccountId, expected: u64) {
        let mut ledger = self.ledger(account);
        require!(ledger.next_action == expected, "Stale or repeated action");
        ledger.next_action = ledger
            .next_action
            .checked_add(1)
            .expect("Action nonce exhausted");
        self.accounts.insert(account, &ledger);
    }

    fn mint(&mut self, account: &AccountId, item: Item, amount: u128) {
        let mut ledger = self.ledger(account);
        ledger.balances[item as usize] = ledger.balances[item as usize]
            .checked_add(amount)
            .expect("Balance overflow");
        self.supply[item as usize] = self.supply[item as usize]
            .checked_add(amount)
            .expect("Supply overflow");
        self.accounts.insert(account, &ledger);
        Self::event(
            "mt_mint",
            json!({"owner_id":account,"token_ids":[item.id()],"amounts":[U128(amount)]}),
        );
    }

    fn burn(&mut self, account: &AccountId, item: Item, amount: u128) {
        let mut ledger = self.ledger(account);
        ledger.balances[item as usize] = ledger.balances[item as usize]
            .checked_sub(amount)
            .expect("Insufficient balance");
        self.supply[item as usize] -= amount;
        self.accounts.insert(account, &ledger);
        Self::event(
            "mt_burn",
            json!({"owner_id":account,"token_ids":[item.id()],"amounts":[U128(amount)]}),
        );
    }

    fn transfer(&mut self, sender: &AccountId, recipient: &AccountId, items: &[(Item, u128)]) {
        require!(sender != recipient, "Cannot transfer to self");
        let mut from = self.ledger(sender);
        let mut to = self.ledger(recipient);
        let mut totals = BTreeMap::<Item, u128>::new();
        for &(item, amount) in items {
            require!(amount > 0, "Transfer amount must be positive");
            let sum = totals.entry(item).or_default();
            *sum = sum.checked_add(amount).expect("Amount overflow");
        }
        for (item, amount) in totals {
            from.balances[item as usize] = from.balances[item as usize]
                .checked_sub(amount)
                .expect("Insufficient balance");
            to.balances[item as usize] = to.balances[item as usize]
                .checked_add(amount)
                .expect("Balance overflow");
        }
        self.accounts.insert(sender, &from);
        self.accounts.insert(recipient, &to);
        Self::event(
            "mt_transfer",
            json!({"old_owner_id":sender,"new_owner_id":recipient,
            "token_ids":items.iter().map(|(i,_)| i.id()).collect::<Vec<_>>(),
            "amounts":items.iter().map(|(_,a)| U128(*a)).collect::<Vec<_>>()}),
        );
    }

    fn transfer_items(ids: &[String], amounts: &[U128]) -> Vec<(Item, u128)> {
        require!(
            !ids.is_empty() && ids.len() <= MAX_BATCH && ids.len() == amounts.len(),
            "Invalid batch lengths"
        );
        ids.iter()
            .zip(amounts)
            .map(|(id, a)| (Self::item(id), a.0))
            .collect()
    }

    fn validate_approvals(approvals: &Option<Vec<Option<(AccountId, u64)>>>, length: usize) {
        if let Some(values) = approvals {
            require!(values.len() == length, "Invalid approvals length");
            require!(
                values.iter().all(Option::is_none),
                "Approval extension is not enabled"
            );
        }
    }

    fn event(name: &str, data: Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"nep245","version":"1.0.0","event":name,"data":[data]})
        ));
    }

    fn base_metadata(item: Item) -> Value {
        json!({"name":item.id().replace('_'," "),"id":item.id(),"symbol":null,"icon":null,
            "decimals":"0","base_uri":null,"reference":null,"copies":null,"reference_hash":null})
    }
    fn token_metadata(item: Item) -> Value {
        json!({"title":item.id().replace('_'," "),"description":"Briarbridge game asset",
            "media":null,"media_hash":null,"issued_at":null,"expires_at":null,"starts_at":null,
            "updated_at":null,"extra":null,"reference":null,"reference_hash":null})
    }
}

#[cfg(test)]
mod tests;
