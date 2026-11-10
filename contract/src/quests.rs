use super::*;

const KEY: &[u8] = b"commission-v1";
const STORY_KEY: &[u8] = b"quest-story-v1";
const WATER_TARGET: u8 = 2;
const WATER_REWARD: u128 = 3;
const TARGETS: [u8; 3] = [3, 2, 1];
const REWARDS: [u128; 3] = [13, 24, 48];
const GOODS: [Item; 3] = [
    Item::HealingTonic,
    Item::FocusDraught,
    Item::RestorationElixir,
];

impl Alchemy {
    fn deliveries(&self) -> Option<[u8; 3]> {
        env::storage_read(KEY).map(|bytes| bytes.try_into().expect("Invalid commission state"))
    }

    fn story(&self) -> Option<[u8; 4]> {
        env::storage_read(STORY_KEY).map(|bytes| {
            let story: [u8; 4] = bytes.try_into().expect("Invalid quest story");
            require!(
                story[0] <= 1 && story[1] <= 1 && story[2] <= WATER_TARGET && story[3] <= 1,
                "Invalid quest progress"
            );
            story
        })
    }

    pub(super) fn record_tonic_brew(&self, brewer: &AccountId, item: Item) {
        if brewer == &self.player_id && item == Item::HealingTonic {
            if let Some(mut story) = self.story() {
                story[0] = 1;
                env::storage_write(STORY_KEY, &story);
            }
        }
    }

    pub(super) fn record_tonic_sale(&self, seller: &AccountId, item: Item) {
        if seller == &self.player_id && item == Item::HealingTonic {
            if let Some(mut story) = self.story() {
                if story[0] == 1 {
                    story[1] = 1;
                    env::storage_write(STORY_KEY, &story);
                }
            }
        }
    }
}

#[near]
impl Alchemy {
    pub fn quest_view(&self) -> Value {
        let Some(delivered) = self.deliveries() else {
            return json!({"active":false});
        };
        let remaining: u128 = (0..3)
            .map(|i| u128::from(TARGETS[i] - delivered[i]) * REWARDS[i])
            .sum();
        let saved_story = self.story();
        let water_remaining =
            saved_story.map_or(0, |s| u128::from(WATER_TARGET - s[2]) * WATER_REWARD);
        let story = saved_story.map(|s| json!({
            "stage": if s[1] == 0 && s[3] == 0 { 0 } else if delivered[1] < 2 { 1 } else if delivered[2] < 1 { 2 } else { 3 },
            "tonic_brewed":s[0]==1,"tonic_sold":s[1]==1,"opening_credited":s[3]==1,
            "water_delivered":s[2],"water_target":WATER_TARGET,"water_reward":WATER_REWARD.to_string(),
            "water_escrow_remaining":water_remaining.to_string()
        }));
        json!({"active":true,"delivered":delivered,"targets":TARGETS,"rewards":REWARDS.map(|r|r.to_string()),
            "escrow_remaining":(remaining+water_remaining).to_string(),"seal":delivered[1] == 2 && delivered[2] == 1,
            "gardener_complete":delivered[0] == 3,"story":story})
    }

    pub fn open_commissions(&mut self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
        require!(self.deliveries().is_none(), "Commissions already funded");
        let treasury = self.treasury_id.clone();
        let mira = self.merchant_ids[0].clone();
        require!(
            self.balance(&treasury, Item::Copper) >= 96
                && self.balance(&mira, Item::Copper) >= 39
                && self.balance(&self.merchant_ids[1], Item::Copper) >= 6,
            "Commission sponsors lack funds"
        );
        let escrow = env::current_account_id();
        self.transfer(&treasury, &escrow, &[(Item::Copper, 96)]);
        self.transfer(&mira, &escrow, &[(Item::Copper, 39)]);
        env::storage_write(KEY, &[0, 0, 0]);
        self.open_story();
    }

    pub fn open_story(&mut self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
        let delivered = self.deliveries().expect("Commission is not funded");
        if self.story().is_some() {
            return;
        }
        let rowan = self.merchant_ids[1].clone();
        require!(
            self.balance(&rowan, Item::Copper) >= 6,
            "Rowan cannot fund his order"
        );
        self.transfer(&rowan, &env::current_account_id(), &[(Item::Copper, 6)]);
        // Existing guild progress remains valid when an older save opts into the new story.
        let opening_credited = u8::from(delivered[1] > 0 || delivered[2] > 0);
        env::storage_write(STORY_KEY, &[0, 0, 0, opening_credited]);
    }

    #[payable]
    pub fn deliver_commission(&mut self, token_id: String, nonce: u64) {
        self.deliver_many(token_id, U128(1), nonce);
    }

    #[payable]
    pub fn deliver_many(&mut self, token_id: String, amount: U128, nonce: u64) {
        self.authorize_gameplay(0);
        require!(
            amount.0 > 0 && amount.0 <= 10,
            "Choose between 1 and 10 items"
        );
        self.assert_player();
        let mut delivered = self.deliveries().expect("Commission is not funded");
        let item = Self::item(&token_id);
        if item == Item::SpringWater {
            let mut story = self.story().expect("Rowan has not funded his order");
            require!(
                u128::from(story[2]) + amount.0 <= u128::from(WATER_TARGET),
                "This order is complete"
            );
            let player = self.player_id.clone();
            let escrow = env::current_account_id();
            require!(self.balance(&player, item) >= amount.0, "Water not owned");
            require!(
                self.balance(&escrow, Item::Copper) >= WATER_REWARD * amount.0,
                "Commission reserve unavailable"
            );
            self.take_nonce(&player, nonce);
            self.burn(&player, item, amount.0);
            self.consumption[0][item as usize] += amount.0;
            self.transfer(&escrow, &player, &[(Item::Copper, WATER_REWARD * amount.0)]);
            story[2] += amount.0 as u8;
            env::storage_write(STORY_KEY, &story);
            env::log_str(
                &json!({"event":"water_order_delivered","delivered":story[2]}).to_string(),
            );
            return;
        }
        let index = GOODS
            .iter()
            .position(|good| *good == item)
            .expect("This order requires a potion");
        require!(
            u128::from(delivered[index]) + amount.0 <= u128::from(TARGETS[index]),
            "This order is complete"
        );
        if let Some(story) = self.story() {
            if index > 0 {
                require!(
                    story[1] == 1 || story[3] == 1,
                    "Complete your first crafted tonic sale"
                );
            }
            if index == 2 {
                require!(
                    delivered[1] == TARGETS[1],
                    "Complete the Focus Draught trial first"
                );
            }
        }
        let player = self.player_id.clone();
        let escrow = env::current_account_id();
        require!(self.balance(&player, item) >= amount.0, "Potion not owned");
        require!(
            self.balance(&escrow, Item::Copper) >= REWARDS[index] * amount.0,
            "Commission reserve unavailable"
        );
        self.take_nonce(&player, nonce);
        // Delivered potions are used by the guild/gardeners immediately, creating real consumption.
        self.burn(&player, item, amount.0);
        self.consumption[0][item as usize] += amount.0;
        self.transfer(
            &escrow,
            &player,
            &[(Item::Copper, REWARDS[index] * amount.0)],
        );
        delivered[index] += amount.0 as u8;
        env::storage_write(KEY, &delivered);
        if self.balance(&player, item) == 0 {
            self.listings.remove(&item);
        }
        env::log_str(&json!({"event":"commission_delivered","token_id":token_id,"delivered":delivered,"seal":delivered[1]==2 && delivered[2]==1}).to_string());
    }
}
