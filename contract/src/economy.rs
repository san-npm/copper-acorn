use near_sdk::{json_types::U128, near};

pub const CRAFT_FEE: u128 = 1;
pub const REFILL_PRICE: u128 = 10;
pub const INVESTMENT: u128 = 20;
pub const UPKEEP: u128 = 2;
pub const MAX_TRADE: u128 = 100;
pub const SHELF_SLOTS: usize = 2;
pub const RULE_VERSION: &str = "alchemy-1";

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(usize)]
pub enum Item {
    Sunleaf,
    Moonmint,
    Emberbloom,
    SpringWater,
    WoodEssence,
    SilverDust,
    HealingTonic,
    FocusDraught,
    RestorationElixir,
    Copper,
}

pub const ITEMS: [Item; 10] = [
    Item::Sunleaf,
    Item::Moonmint,
    Item::Emberbloom,
    Item::SpringWater,
    Item::WoodEssence,
    Item::SilverDust,
    Item::HealingTonic,
    Item::FocusDraught,
    Item::RestorationElixir,
    Item::Copper,
];

impl Item {
    pub fn name(self) -> &'static str {
        match self {
            Self::Sunleaf => "Sunleaf",
            Self::Moonmint => "Moonmint",
            Self::Emberbloom => "Emberbloom",
            Self::SpringWater => "Spring Water",
            Self::WoodEssence => "Wood Essence",
            Self::SilverDust => "Silver Dust",
            Self::HealingTonic => "Healing Tonic",
            Self::FocusDraught => "Focus Draught",
            Self::RestorationElixir => "Restoration Elixir",
            Self::Copper => "Copper",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Sunleaf => "sunleaf",
            Self::Moonmint => "moonmint",
            Self::Emberbloom => "emberbloom",
            Self::SpringWater => "spring_water",
            Self::WoodEssence => "wood_essence",
            Self::SilverDust => "silver_dust",
            Self::HealingTonic => "healing_tonic",
            Self::FocusDraught => "focus_draught",
            Self::RestorationElixir => "restoration_elixir",
            Self::Copper => "copper",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        ITEMS.into_iter().find(|item| item.id() == id)
    }

    pub fn base_value(self) -> u128 {
        match self {
            Self::Sunleaf => 3,
            Self::Moonmint => 4,
            Self::Emberbloom => 5,
            Self::SpringWater => 1,
            Self::WoodEssence => 8,
            Self::SilverDust => 12,
            Self::HealingTonic => 12,
            Self::FocusDraught => 18,
            Self::RestorationElixir => 40,
            Self::Copper => 1,
        }
    }

    pub fn gather_cap(self) -> u128 {
        match self {
            Self::Sunleaf => 6,
            Self::Moonmint => 4,
            Self::Emberbloom | Self::SilverDust => 1,
            Self::SpringWater => 8,
            Self::WoodEssence => 2,
            _ => 0,
        }
    }

    pub fn target(self) -> u128 {
        if self.gather_cap() > 0 { 10 } else { 3 }
    }

    pub fn recipe(self) -> Option<&'static [(Item, u128)]> {
        match self {
            Self::HealingTonic => Some(&[(Self::Sunleaf, 2), (Self::SpringWater, 1)]),
            Self::FocusDraught => Some(&[
                (Self::Moonmint, 1),
                (Self::WoodEssence, 1),
                (Self::SpringWater, 1),
            ]),
            Self::RestorationElixir => Some(&[
                (Self::Emberbloom, 1),
                (Self::SilverDust, 1),
                (Self::FocusDraught, 1),
            ]),
            _ => None,
        }
    }
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq, Eq)]
pub struct Quote {
    pub rule_version: String,
    pub token_id: String,
    pub stock: U128,
    pub target: U128,
    pub consumed_last_two_days: U128,
    pub stock_adjustment_percent: i128,
    pub demand_adjustment_percent: u128,
    pub reference: U128,
    pub merchant_buys_at: U128,
    pub merchant_sells_at: U128,
}

pub fn quote(item: Item, stock: u128, consumed: u128) -> Quote {
    // Stocks above this point have the same capped adjustment; avoid a u128 cast overflow.
    let bounded_stock = stock.min(10_000) as i128;
    let target = item.target() as i128;
    let stock_adjustment = (100 * (target - bounded_stock))
        .div_euclid(2 * target)
        .clamp(-50, 75);
    let demand_adjustment = consumed.min(6) * 5;
    let multiplier = (100 + stock_adjustment + demand_adjustment as i128).clamp(50, 175);
    let reference = (item.base_value() * multiplier as u128 / 100).max(1);
    let bid = (reference * 80 / 100).max(1);
    let ask = (reference * 120).div_ceil(100).max(bid + 1);
    Quote {
        rule_version: RULE_VERSION.into(),
        token_id: item.id().into(),
        stock: U128(stock),
        target: U128(target as u128),
        consumed_last_two_days: U128(consumed),
        stock_adjustment_percent: stock_adjustment,
        demand_adjustment_percent: demand_adjustment,
        reference: U128(reference),
        merchant_buys_at: U128(bid),
        merchant_sells_at: U128(ask),
    }
}

pub fn trade_total(
    item: Item,
    stock: u128,
    consumed: u128,
    amount: u128,
    buy: bool,
) -> Option<u128> {
    let mut total = 0u128;
    for unit in 0..amount {
        let current = if buy {
            stock.checked_sub(unit + 1)?;
            stock - unit
        } else {
            stock.checked_add(unit)?
        };
        let q = quote(item, current, consumed);
        total = total.checked_add(if buy {
            q.merchant_sells_at.0
        } else {
            q.merchant_buys_at.0
        })?;
    }
    Some(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stock_flood_and_consumption_have_the_documented_effects() {
        for (stock, expected) in [(2, (4, 3, 5)), (10, (3, 2, 4)), (30, (1, 1, 2))] {
            let q = quote(Item::Sunleaf, stock, 0);
            assert_eq!(
                (q.reference.0, q.merchant_buys_at.0, q.merchant_sells_at.0),
                expected
            );
        }
        assert_eq!(quote(Item::SilverDust, 10, 6).reference.0, 15);
        assert_eq!(quote(Item::SilverDust, 10, u128::MAX).reference.0, 15);
        assert_eq!(quote(Item::Sunleaf, u128::MAX, 0).reference.0, 1);
        assert_eq!(quote(Item::Sunleaf, 11, 0).stock_adjustment_percent, -5);
    }

    #[test]
    fn guild_commission_requires_three_draughts_to_deliver_two_and_brew_the_elixir() {
        let mut needed = [0_u128; 10];
        for (product, units) in [(Item::FocusDraught, 3), (Item::RestorationElixir, 1)] {
            for &(input, quantity) in product.recipe().unwrap() {
                needed[input as usize] += quantity * units;
            }
        }
        assert_eq!(needed[Item::Moonmint as usize], 3);
        assert_eq!(needed[Item::WoodEssence as usize], 3);
        assert_eq!(needed[Item::SilverDust as usize], 1);
        assert_eq!(needed[Item::FocusDraught as usize], 1);
        assert_eq!(
            ITEMS.iter().filter(|item| item.recipe().is_some()).count(),
            3
        );
        assert_eq!(ITEMS.iter().filter(|item| item.gather_cap() > 0).count(), 6);
    }
}
