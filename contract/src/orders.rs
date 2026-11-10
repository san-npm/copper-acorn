use super::*;

const KEY: &[u8] = b"mira-orders-v1";

#[near(serializers = [json])]
#[derive(Clone)]
pub struct MiraOrder {
    pub id: u64,
    pub token_id: String,
    pub amount: U128,
    pub reward: U128,
    pub expires_day: u64,
    pub status: String,
}

#[near(serializers = [json])]
#[derive(Default)]
pub struct MiraOrders {
    pub completed: u64,
    pub last_offer_day: Option<u64>,
    pub order: Option<MiraOrder>,
}

impl Alchemy {
    fn save_orders(&self, orders: &MiraOrders) {
        env::storage_write(KEY, &near_sdk::serde_json::to_vec(orders).unwrap());
    }

    fn close_mira_order(&mut self, orders: &mut MiraOrders, status: &str) {
        let order = orders.order.as_mut().expect("No Mira order");
        require!(
            ["offered", "accepted"].contains(&order.status.as_str()),
            "Order already closed"
        );
        self.transfer(
            &env::current_account_id(),
            &self.merchant_ids[0].clone(),
            &[(Item::Copper, order.reward.0)],
        );
        order.status = status.into();
        self.save_orders(orders);
    }
}

#[near]
impl Alchemy {
    pub fn mira_orders_view(&self) -> MiraOrders {
        env::storage_read(KEY)
            .map(|v| near_sdk::serde_json::from_slice(&v).expect("Invalid Mira orders"))
            .unwrap_or_default()
    }

    #[payable]
    pub fn offer_mira_order(&mut self, token_id: String, amount: U128) -> MiraOrder {
        assert_one_yocto();
        let mira = self.merchant_ids[0].clone();
        require!(env::predecessor_account_id() == mira, "Mira only");
        self.assert_open(&mira);
        let mut orders = self.mira_orders_view();
        require!(
            orders.last_offer_day != Some(self.day),
            "Mira offers at most one order per day"
        );
        require!(
            orders
                .order
                .as_ref()
                .is_none_or(|o| !["offered", "accepted"].contains(&o.status.as_str())),
            "Close the previous order first"
        );
        let item = Self::item(&token_id);
        require!(
            item != Item::Copper && amount.0 > 0 && amount.0 <= 3,
            "Invalid requested goods"
        );
        let stock = self.balance(&mira, item);
        require!(
            stock + amount.0 <= item.target(),
            "Mira does not need those goods"
        );
        // The model can select goods; only game rules determine and fund the reward.
        let reward = item.base_value() * amount.0;
        require!(
            self.balance(&mira, Item::Copper) >= reward + UPKEEP,
            "Mira cannot fund this order"
        );
        self.transfer(&mira, &env::current_account_id(), &[(Item::Copper, reward)]);
        let order = MiraOrder {
            id: self.day.checked_add(1).expect("Day overflow"),
            token_id,
            amount,
            reward: U128(reward),
            expires_day: self.day.checked_add(2).expect("Day overflow"),
            status: "offered".into(),
        };
        orders.last_offer_day = Some(self.day);
        orders.order = Some(order.clone());
        self.save_orders(&orders);
        order
    }

    #[payable]
    pub fn accept_mira_order(&mut self, order_id: u64, nonce: u64) {
        self.authorize_gameplay(0);
        self.assert_player();
        let mut orders = self.mira_orders_view();
        let order = orders.order.as_mut().expect("No Mira offer");
        require!(
            order.id == order_id && order.status == "offered" && self.day < order.expires_day,
            "Offer is not available"
        );
        self.take_nonce(&self.player_id.clone(), nonce);
        order.status = "accepted".into();
        self.save_orders(&orders);
    }

    #[payable]
    pub fn deliver_mira_order(&mut self, order_id: u64, nonce: u64) {
        self.authorize_gameplay(0);
        self.assert_player();
        let mut orders = self.mira_orders_view();
        let order = orders.order.as_mut().expect("No Mira order");
        require!(
            order.id == order_id && order.status == "accepted" && self.day < order.expires_day,
            "Order is not active"
        );
        let item = Self::item(&order.token_id);
        let player = self.player_id.clone();
        require!(
            self.balance(&player, item) >= order.amount.0,
            "Gather or craft the requested goods first"
        );
        self.take_nonce(&player, nonce);
        self.burn(&player, item, order.amount.0);
        self.consumption[0][item as usize] += order.amount.0;
        self.transfer(
            &env::current_account_id(),
            &player,
            &[(Item::Copper, order.reward.0)],
        );
        if self.balance(&player, item) == 0 {
            self.listings.remove(&item);
        }
        order.status = "completed".into();
        orders.completed = orders
            .completed
            .checked_add(1)
            .expect("Order count overflow");
        self.save_orders(&orders);
    }

    #[payable]
    pub fn cancel_mira_order(&mut self, order_id: u64, nonce: u64) {
        self.authorize_gameplay(0);
        self.assert_player();
        let mut orders = self.mira_orders_view();
        require!(
            orders.order.as_ref().is_some_and(|o| o.id == order_id),
            "Order changed"
        );
        self.take_nonce(&self.player_id.clone(), nonce);
        self.close_mira_order(&mut orders, "cancelled");
    }

    pub fn expire_mira_order(&mut self) {
        let mut orders = self.mira_orders_view();
        require!(
            orders
                .order
                .as_ref()
                .is_some_and(|o| self.day >= o.expires_day),
            "Order has not expired"
        );
        self.close_mira_order(&mut orders, "expired");
    }
}
