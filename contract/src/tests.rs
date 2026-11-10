use super::*;
use near_sdk::{
    PromiseResult,
    test_utils::{VMContextBuilder, get_created_receipts, get_logs},
    testing_env,
};
use std::panic::{AssertUnwindSafe, catch_unwind};

fn id(name: &str) -> AccountId {
    if name == "contract" {
        return "game.owner.test.near".parse().unwrap();
    }
    format!("{name}.test.near").parse().unwrap()
}

fn context(caller: &str, deposit: NearToken, outcome: Option<PromiseResult>) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(id("contract"))
        .predecessor_account_id(id(caller))
        .signer_account_id(id(caller))
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(100))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(
        builder.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        outcome.into_iter().collect()
    );
}

fn as_actor(name: &str) {
    context(name, NearToken::from_yoctonear(1), None);
}

fn game() -> Alchemy {
    context("owner", NearToken::from_yoctonear(0), None);
    Alchemy::new(Setup {
        owner_id: id("owner"),
        player_id: id("player"),
        merchant_ids: [id("mira"), id("rowan"), id("bram")],
        customer_id: id("customer"),
        treasury_id: id("treasury"),
        refill_amount: U128(NearToken::from_millinear(1).as_yoctonear()),
        operating_reserve: U128(NearToken::from_near(1).as_yoctonear()),
    })
}

fn assert_supply(game: &Alchemy) {
    for item in ITEMS {
        let sum: u128 = [
            "owner", "player", "mira", "rowan", "bram", "customer", "treasury", "contract",
        ]
        .into_iter()
        .map(|name| game.balance(&id(name), item))
        .sum();
        assert_eq!(sum, game.supply[item as usize], "{}", item.id());
    }
    assert_eq!(game.supply[Item::Copper as usize], 5000);
}

fn device_context(key: u8, millis: u64) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(id("contract"))
        .predecessor_account_id(id("player"))
        .signer_account_id(id("player"))
        .signer_account_pk(
            near_sdk::PublicKey::from_parts(near_sdk::CurveType::ED25519, vec![key; 32]).unwrap(),
        )
        .block_timestamp(millis * 1_000_000)
        .account_balance(NearToken::from_near(100))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(builder.build());
}

#[test]
fn device_session_is_bounded_revocable_and_cannot_upgrade_or_transfer() {
    let mut g = game();
    as_actor("player");
    g.authorize_game_session(
        near_sdk::PublicKey::from_parts(near_sdk::CurveType::ED25519, vec![7; 32]).unwrap(),
        50_000,
        2,
        U128(1),
    );
    device_context(7, 1);
    g.brew("healing_tonic".into(), 0);
    assert_eq!(g.game_session_view().unwrap().copper_left.0, 0);
    assert_eq!(g.game_session_view().unwrap().actions_left, 1);
    device_context(8, 1);
    assert!(catch_unwind(AssertUnwindSafe(|| g.gather("sunleaf".into(), U128(1), 1))).is_err());
    device_context(7, 50_000);
    assert!(catch_unwind(AssertUnwindSafe(|| g.gather("sunleaf".into(), U128(1), 1))).is_err());
    device_context(7, 2);
    assert!(catch_unwind(AssertUnwindSafe(|| g.brew("healing_tonic".into(), 1))).is_err());
    device_context(7, 2);
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.mt_transfer(
            id("mira"),
            "sunleaf".into(),
            U128(1),
            None,
            None
        )))
        .is_err()
    );
    device_context(7, 2);
    g.gather("sunleaf".into(), U128(1), 1);
    device_context(7, 3);
    assert!(catch_unwind(AssertUnwindSafe(|| g.gather("sunleaf".into(), U128(1), 2))).is_err());
    as_actor("owner");
    assert!(catch_unwind(AssertUnwindSafe(|| g.update_contract())).is_err());
    as_actor("player");
    g.revoke_game_session();
    device_context(7, 3);
    assert!(catch_unwind(AssertUnwindSafe(|| g.gather("sunleaf".into(), U128(1), 2))).is_err());
    assert_supply(&g);
}

#[test]
fn mira_orders_reserve_finite_money_and_pay_only_for_verified_goods_once() {
    let mut g = game();
    as_actor("mira");
    let order = g.offer_mira_order("moonmint".into(), U128(1));
    assert_eq!(g.balance(&id("mira"), Item::Copper), 96);
    assert_eq!(g.balance(&id("contract"), Item::Copper), 4);
    as_actor("player");
    g.accept_mira_order(order.id, 0);
    as_actor("player");
    g.deliver_mira_order(order.id, 1);
    assert_eq!(g.balance(&id("player"), Item::Copper), 44);
    assert_eq!(g.balance(&id("player"), Item::Moonmint), 0);
    assert_eq!(g.mira_orders_view().completed, 1);
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| g.deliver_mira_order(order.id, 2))).is_err());
    as_actor("mira");
    assert!(
        catch_unwind(AssertUnwindSafe(
            || g.offer_mira_order("emberbloom".into(), U128(1))
        ))
        .is_err()
    );
    as_actor("owner");
    g.advance_day();
    as_actor("mira");
    let next = g.offer_mira_order("emberbloom".into(), U128(1));
    as_actor("player");
    g.accept_mira_order(next.id, 2);
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| g.deliver_mira_order(next.id, 3))).is_err());
    as_actor("player");
    g.cancel_mira_order(next.id, 3);
    assert_eq!(g.balance(&id("contract"), Item::Copper), 0);
    as_actor("owner");
    g.advance_day();
    as_actor("mira");
    g.offer_mira_order("emberbloom".into(), U128(1));
    as_actor("owner");
    g.advance_day();
    g.advance_day();
    as_actor("bram");
    g.expire_mira_order();
    assert_eq!(g.mira_orders_view().order.unwrap().status, "expired");
    assert_eq!(g.balance(&id("contract"), Item::Copper), 0);
    assert_supply(&g);
}

#[test]
fn opening_loop_moves_items_and_money_and_records_consumption() {
    let mut g = game();
    assert_supply(&g);
    as_actor("player");
    g.brew("healing_tonic".into(), 0);
    assert_eq!(g.balance(&id("player"), Item::Copper), 39);
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 2);
    assert_eq!(g.balance(&id("player"), Item::SpringWater), 2);
    as_actor("player");
    g.list_potion("healing_tonic".into(), U128(13), 1);
    as_actor("customer");
    g.buy_listing("healing_tonic".into(), U128(13), 0);
    assert_eq!(g.balance(&id("player"), Item::Copper), 52);
    assert_eq!(g.balance(&id("customer"), Item::Copper), 107);
    assert_eq!(g.balance(&id("customer"), Item::HealingTonic), 1);
    assert_eq!(g.consumed(Item::HealingTonic), 0);
    as_actor("customer");
    g.consume("healing_tonic".into(), U128(1), 1);
    assert_eq!(g.consumed(Item::HealingTonic), 1);
    assert_eq!(g.balance(&id("customer"), Item::HealingTonic), 0);
    assert_supply(&g);
    assert!(
        get_logs()
            .iter()
            .any(|line| line.contains("\"standard\":\"nep245\""))
    );
}

#[test]
fn merchant_consumption_is_owned_one_per_day_and_conserves_supply() {
    let mut g = game();
    as_actor("bram");
    g.consume("healing_tonic".into(), U128(1), 0);
    assert_eq!(g.balance(&id("bram"), Item::HealingTonic), 1);
    assert_eq!(g.consumed(Item::HealingTonic), 1);
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.consume(
            "healing_tonic".into(),
            U128(1),
            1
        )))
        .is_err()
    );
    assert_eq!(g.ledger(&id("bram")).next_action, 1);
    as_actor("player");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.consume(
            "focus_draught".into(),
            U128(1),
            0
        )))
        .is_err()
    );
    as_actor("owner");
    g.advance_day();
    as_actor("bram");
    g.consume("healing_tonic".into(), U128(1), 1);
    assert_eq!(g.consumed(Item::HealingTonic), 2);
    assert_supply(&g);
}

#[test]
fn commissions_reserve_existing_copper_pay_once_and_award_the_seal() {
    let mut g = game();
    as_actor("owner");
    g.open_commissions();
    assert_eq!(g.balance(&id("mira"), Item::Copper), 61);
    assert_eq!(g.balance(&id("treasury"), Item::Copper), 4444);
    assert_eq!(g.balance(&id("rowan"), Item::Copper), 94);
    assert_eq!(g.balance(&id("contract"), Item::Copper), 141);
    assert!(catch_unwind(AssertUnwindSafe(|| g.open_commissions())).is_err());
    assert_supply(&g);
    // Test setup gives the player commission potions; actual recipes have separate coverage.
    for (item, quantity) in [
        (Item::HealingTonic, 3),
        (Item::FocusDraught, 2),
        (Item::RestorationElixir, 1),
    ] {
        g.mint(&id("player"), item, quantity);
    }
    as_actor("mira");
    assert!(
        catch_unwind(AssertUnwindSafe(
            || g.deliver_commission("healing_tonic".into(), 0)
        ))
        .is_err()
    );
    as_actor("player");
    assert!(
        catch_unwind(AssertUnwindSafe(
            || g.deliver_commission("focus_draught".into(), 0)
        ))
        .is_err()
    );
    g.brew("healing_tonic".into(), 0);
    assert_eq!(g.quest_view()["story"]["stage"], 0);
    g.list_potion("healing_tonic".into(), U128(13), 1);
    assert_eq!(g.quest_view()["story"]["tonic_sold"], false);
    as_actor("customer");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.buy_listing(
            "healing_tonic".into(),
            U128(12),
            0
        )))
        .is_err()
    );
    assert_eq!(g.quest_view()["story"]["tonic_sold"], false);
    assert_eq!(g.ledger(&id("customer")).next_action, 0);
    g.buy_listing("healing_tonic".into(), U128(13), 0);
    assert_eq!(g.quest_view()["story"]["stage"], 1);
    as_actor("player");
    assert!(
        catch_unwind(AssertUnwindSafe(
            || g.deliver_commission("restoration_elixir".into(), 2)
        ))
        .is_err()
    );
    let mut nonce = 2;
    for (item, quantity) in [
        (Item::HealingTonic, 3),
        (Item::FocusDraught, 2),
        (Item::RestorationElixir, 1),
    ] {
        for _ in 0..quantity {
            g.deliver_commission(item.id().into(), nonce);
            nonce += 1;
            assert_supply(&g);
        }
        assert!(
            catch_unwind(AssertUnwindSafe(
                || g.deliver_commission(item.id().into(), nonce)
            ))
            .is_err()
        );
        assert_eq!(g.ledger(&id("player")).next_action, nonce);
    }
    for _ in 0..2 {
        g.deliver_commission("spring_water".into(), nonce);
        nonce += 1;
    }
    assert!(
        catch_unwind(AssertUnwindSafe(
            || g.deliver_commission("spring_water".into(), nonce)
        ))
        .is_err()
    );
    assert_eq!(g.balance(&id("player"), Item::Copper), 193);
    assert_eq!(g.balance(&id("contract"), Item::Copper), 0);
    assert_eq!(g.quest_view()["escrow_remaining"], "0");
    assert_eq!(g.quest_view()["seal"], true);
    assert_eq!(g.quest_view()["gardener_complete"], true);
    assert_eq!(g.quest_view()["story"]["stage"], 3);
    assert_eq!(g.quest_view()["story"]["water_delivered"], 2);
    assert_supply(&g);
}

#[test]
fn side_orders_do_not_require_the_main_quest_and_water_cannot_pay_twice() {
    let mut g = game();
    g.open_commissions();
    as_actor("player");
    g.deliver_commission("spring_water".into(), 0);
    let before = g.quest_view();
    assert!(
        catch_unwind(AssertUnwindSafe(
            || g.deliver_commission("spring_water".into(), 0)
        ))
        .is_err()
    );
    assert_eq!(g.quest_view(), before);
    g.deliver_commission("spring_water".into(), 1);
    g.mint(&id("player"), Item::HealingTonic, 3);
    for nonce in 2..5 {
        g.deliver_commission("healing_tonic".into(), nonce);
    }
    assert_eq!(g.quest_view()["gardener_complete"], true);
    assert_eq!(g.quest_view()["story"]["stage"], 0);
    assert_eq!(g.quest_view()["story"]["tonic_sold"], false);
    assert_eq!(g.quest_view()["escrow_remaining"], "96");
    assert_eq!(g.balance(&id("player"), Item::Copper), 85);
    assert_supply(&g);
}

#[test]
fn older_guild_progress_is_preserved_and_story_funding_is_owner_only_and_once() {
    let mut g = game();
    g.open_commissions();
    // Model the old release: only the original commissions were funded and stored.
    env::storage_remove(b"quest-story-v1");
    g.transfer(&id("contract"), &id("rowan"), &[(Item::Copper, 6)]);
    g.mint(&id("player"), Item::FocusDraught, 1);
    g.mint(&id("player"), Item::RestorationElixir, 1);
    as_actor("player");
    g.deliver_commission("restoration_elixir".into(), 0);
    g.deliver_commission("focus_draught".into(), 1);
    assert!(g.quest_view()["story"].is_null());
    assert!(catch_unwind(AssertUnwindSafe(|| g.open_story())).is_err());
    as_actor("owner");
    g.open_story();
    assert_eq!(g.quest_view()["delivered"], json!([0, 1, 1]));
    assert_eq!(g.quest_view()["story"]["stage"], 1);
    assert_eq!(g.quest_view()["story"]["opening_credited"], true);
    assert_eq!(g.quest_view()["story"]["tonic_sold"], false);
    assert_eq!(g.quest_view()["escrow_remaining"], "69");
    let before = g.quest_view();
    let copper = g.balance(&id("contract"), Item::Copper);
    g.open_story();
    assert_eq!(g.quest_view(), before);
    assert_eq!(g.balance(&id("contract"), Item::Copper), copper);
    assert_supply(&g);
}

#[test]
fn buying_a_tonic_or_selling_before_brewing_does_not_complete_the_opening() {
    let mut g = game();
    g.open_commissions();
    as_actor("player");
    g.trade(
        id("bram"),
        "healing_tonic".into(),
        U128(1),
        true,
        U128(40),
        0,
    );
    g.trade(
        id("bram"),
        "healing_tonic".into(),
        U128(1),
        false,
        U128(1),
        1,
    );
    assert_eq!(g.quest_view()["story"]["stage"], 0);
    g.brew("healing_tonic".into(), 2);
    g.trade(
        id("bram"),
        "healing_tonic".into(),
        U128(1),
        false,
        U128(1),
        3,
    );
    assert_eq!(g.quest_view()["story"]["stage"], 1);
    assert_supply(&g);
}

#[test]
fn missing_ingredients_and_stale_actions_do_not_charge_copper() {
    let mut g = game();
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| g.brew("restoration_elixir".into(), 0))).is_err());
    assert_eq!(g.balance(&id("player"), Item::Copper), 40);
    assert_eq!(g.ledger(&id("player")).next_action, 0);
    as_actor("player");
    g.brew("healing_tonic".into(), 0);
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| g.brew("healing_tonic".into(), 0))).is_err());
    assert_eq!(g.balance(&id("player"), Item::Copper), 39);
    assert_eq!(g.balance(&id("player"), Item::HealingTonic), 1);
    assert_supply(&g);
}

#[test]
fn quantities_consume_exact_inputs_and_orders_pay_only_for_owned_units() {
    let mut g = game();
    g.open_commissions();
    as_actor("player");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.brew_many(
            "healing_tonic".into(),
            U128(3),
            0
        )))
        .is_err()
    );
    assert_eq!(g.balance(&id("player"), Item::Copper), 40);
    assert_eq!(g.ledger(&id("player")).next_action, 0);
    g.brew_many("healing_tonic".into(), U128(2), 0);
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 0);
    assert_eq!(g.balance(&id("player"), Item::SpringWater), 1);
    assert_eq!(g.balance(&id("player"), Item::HealingTonic), 2);
    assert_eq!(g.balance(&id("player"), Item::Copper), 38);
    g.deliver_many("healing_tonic".into(), U128(2), 1);
    assert_eq!(g.balance(&id("player"), Item::Copper), 64);
    assert_eq!(g.quest_view()["delivered"], json!([2, 0, 0]));
    assert_eq!(g.quest_view()["escrow_remaining"], "115");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.deliver_many(
            "healing_tonic".into(),
            U128(2),
            2
        )))
        .is_err()
    );
    assert_eq!(g.ledger(&id("player")).next_action, 2);
    assert_supply(&g);
}

#[test]
fn nickname_and_character_are_permanent_per_world() {
    let mut g = game();
    as_actor("mira");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.choose_alchemist(
            "Mira".into(),
            "elf".into(),
            0
        )))
        .is_err()
    );
    as_actor("player");
    for name in ["ab", "<script>", " has spaces "] {
        assert!(
            catch_unwind(AssertUnwindSafe(|| g.choose_alchemist(
                name.into(),
                "goblin".into(),
                0
            )))
            .is_err()
        );
    }
    g.choose_alchemist("Moon Keeper".into(), "skeleton".into(), 0);
    assert_eq!(
        g.game_view()["alchemist"],
        json!({"nickname":"Moon Keeper","character_id":"skeleton"})
    );
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.choose_alchemist(
            "Other".into(),
            "elf".into(),
            1
        )))
        .is_err()
    );
    assert_eq!(g.ledger(&id("player")).next_action, 1);
    assert_supply(&g);
}

#[test]
fn bulk_price_tables_equal_the_executed_stock_curve() {
    let mut g = game();
    let view = g.game_view();
    let quotes = view["merchants"][0]["quotes"].as_array().unwrap();
    let q = quotes.iter().find(|q| q["token_id"] == "sunleaf").unwrap();
    let limit = q["sell_totals"][3]
        .as_str()
        .unwrap()
        .parse::<u128>()
        .unwrap();
    as_actor("player");
    let total = g.trade(id("mira"), "sunleaf".into(), U128(4), false, U128(limit), 0);
    assert_eq!(total.0, limit);
    assert_eq!(g.balance(&id("player"), Item::Copper), 40 + limit);
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 0);
    assert_supply(&g);
    assert!(economy::trade_total(Item::HealingTonic, 1, 0, 2, true).is_none());
    assert!(economy::trade_total(Item::Sunleaf, u128::MAX, 0, 2, false).is_none());
}

#[test]
fn gathering_caps_are_per_day_and_only_the_player_can_gather() {
    let mut g = game();
    as_actor("mira");
    assert!(catch_unwind(AssertUnwindSafe(|| g.gather("sunleaf".into(), U128(1), 0))).is_err());
    as_actor("player");
    g.gather("sunleaf".into(), U128(6), 0);
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| g.gather("sunleaf".into(), U128(1), 1))).is_err());
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 10);
    context("owner", NearToken::from_yoctonear(0), None);
    g.advance_day();
    as_actor("player");
    g.gather("sunleaf".into(), U128(1), 1);
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 11);
    assert_supply(&g);
}

#[test]
fn quotes_reprice_per_unit_and_wash_trades_do_not_create_demand() {
    let mut g = game();
    as_actor("player");
    let cost = g.trade(id("mira"), "sunleaf".into(), U128(2), true, U128(100), 0);
    assert_eq!(cost.0, 8);
    as_actor("player");
    let proceeds = g.trade(id("mira"), "sunleaf".into(), U128(2), false, U128(0), 1);
    assert!(proceeds.0 < cost.0);
    assert_eq!(g.consumed(Item::Sunleaf), 0);
    assert_eq!(g.balance(&id("mira"), Item::Sunleaf), 10);
    assert_supply(&g);
}

#[test]
fn closed_merchant_rejects_trade_until_twenty_copper_investment() {
    let mut g = game();
    as_actor("mira");
    g.mt_transfer(id("treasury"), "copper".into(), U128(100), None, None);
    as_actor("player");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.trade(
            id("mira"),
            "sunleaf".into(),
            U128(1),
            true,
            U128(100),
            0
        )))
        .is_err()
    );
    as_actor("player");
    g.invest(id("mira"), 0);
    assert_eq!(g.balance(&id("mira"), Item::Copper), 20);
    as_actor("player");
    g.trade(id("mira"), "sunleaf".into(), U128(1), true, U128(100), 1);
    assert_supply(&g);
}

#[test]
fn batch_transfer_aggregates_duplicate_ids_without_partial_debit() {
    let mut g = game();
    as_actor("player");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.mt_batch_transfer(
            id("mira"),
            vec!["sunleaf".into(), "sunleaf".into()],
            vec![U128(3), U128(3)],
            None,
            None
        )))
        .is_err()
    );
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 4);
    as_actor("player");
    g.mt_batch_transfer(
        id("mira"),
        vec!["sunleaf".into(), "sunleaf".into()],
        vec![U128(1), U128(2)],
        None,
        None,
    );
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 1);
    assert_supply(&g);
}

#[test]
fn core_transfer_requires_one_yocto_and_does_not_accept_external_approvals() {
    let mut g = game();
    context("player", NearToken::from_yoctonear(0), None);
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.mt_transfer(
            id("mira"),
            "sunleaf".into(),
            U128(1),
            None,
            None
        )))
        .is_err()
    );
    as_actor("customer");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.mt_transfer(
            id("customer"),
            "sunleaf".into(),
            U128(1),
            Some((id("player"), 0)),
            None
        )))
        .is_err()
    );
    assert_supply(&g);
}

#[test]
fn receiver_unused_amount_is_capped_and_malformed_response_refunds() {
    for response in [b"[\"2\"]".to_vec(), b"[\"999\"]".to_vec(), b"true".to_vec()] {
        let mut g = game();
        as_actor("player");
        g.mt_transfer_call(
            id("mira"),
            "sunleaf".into(),
            U128(4),
            None,
            None,
            "test".into(),
        )
        .detach();
        context(
            "contract",
            NearToken::from_yoctonear(0),
            Some(PromiseResult::Successful(response.clone())),
        );
        let used = g.mt_resolve_transfer(
            id("player"),
            id("mira"),
            vec!["sunleaf".into()],
            vec![U128(4)],
        );
        let expected = if response == b"[\"2\"]" { 2 } else { 0 };
        assert_eq!(used[0].0, expected);
        assert_eq!(g.balance(&id("player"), Item::Sunleaf), 4 - expected);
        assert_eq!(g.ledger(&id("player")).pending_calls, 0);
        assert_supply(&g);
    }
}

#[test]
fn receiver_failure_refunds_only_remaining_balance() {
    let mut g = game();
    as_actor("player");
    g.mt_transfer_call(
        id("mira"),
        "sunleaf".into(),
        U128(4),
        None,
        None,
        "test".into(),
    )
    .detach();
    g.transfer(&id("mira"), &id("rowan"), &[(Item::Sunleaf, 13)]);
    context(
        "contract",
        NearToken::from_yoctonear(0),
        Some(PromiseResult::Failed),
    );
    let used = g.mt_resolve_transfer(
        id("player"),
        id("mira"),
        vec!["sunleaf".into()],
        vec![U128(4)],
    );
    assert_eq!(used[0].0, 3);
    assert_eq!(g.balance(&id("player"), Item::Sunleaf), 1);
    assert_supply(&g);
}

#[test]
fn mana_payment_finalizes_only_on_success_and_retry_creates_no_second_payout() {
    let mut g = game();
    context("owner", NearToken::from_millinear(10), None);
    g.fund_mana();
    let pool = g.native_pool;
    as_actor("player");
    drop(g.request_mana_refill(0));
    assert_eq!(g.balance(&id("player"), Item::Copper), 30);
    assert_eq!(g.balance(&id("treasury"), Item::Copper), 4540);
    assert_eq!(g.balance(&id("contract"), Item::Copper), 10);
    assert_eq!(g.native_pending, g.refill_amount);
    assert!(!get_created_receipts().is_empty());
    as_actor("player");
    assert!(matches!(g.request_mana_refill(0), PromiseOrValue::Value(_)));
    assert!(get_created_receipts().is_empty());
    context(
        "contract",
        NearToken::from_yoctonear(0),
        Some(PromiseResult::Successful(Vec::new())),
    );
    assert_eq!(g.resolve_mana_refill(0).status, RefillStatus::Completed);
    assert_eq!(g.balance(&id("treasury"), Item::Copper), 4550);
    assert_eq!(g.native_pool, pool - g.refill_amount);
    assert_eq!(g.native_pending, 0);
    g.resolve_mana_refill(0);
    assert_eq!(g.balance(&id("treasury"), Item::Copper), 4550);
    assert_supply(&g);
}

#[test]
fn failed_mana_payout_restores_coins_and_reserve() {
    let mut g = game();
    context("owner", NearToken::from_millinear(10), None);
    g.fund_mana();
    let pool = g.native_pool;
    as_actor("player");
    drop(g.request_mana_refill(0));
    context(
        "contract",
        NearToken::from_yoctonear(0),
        Some(PromiseResult::Failed),
    );
    assert_eq!(g.resolve_mana_refill(0).status, RefillStatus::Refunded);
    assert_eq!(g.balance(&id("player"), Item::Copper), 40);
    assert_eq!(g.native_pool, pool);
    assert_supply(&g);
}

#[test]
fn free_rescue_reserves_native_once_without_taking_or_minting_copper() {
    let mut g = game();
    context("owner", NearToken::from_millinear(10), None);
    g.fund_mana();
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| drop(g.request_mana_rescue(0)))).is_err());
    g.mt_transfer(id("treasury"), "copper".into(), U128(40), None, None);
    let pool = g.native_pool;
    drop(g.request_mana_rescue(0));
    assert_eq!(g.balance(&id("player"), Item::Copper), 0);
    assert_eq!(g.balance(&id("contract"), Item::Copper), 0);
    assert_eq!(g.native_pool, pool - g.refill_amount);
    assert_eq!(g.native_pending, g.refill_amount);
    assert!(!env::storage_has_key(RESCUE_USED));
    as_actor("player");
    assert!(matches!(g.request_mana_rescue(0), PromiseOrValue::Value(_)));
    assert!(get_created_receipts().is_empty());
    assert!(catch_unwind(AssertUnwindSafe(|| drop(g.request_mana_refill(0)))).is_err());
    assert!(catch_unwind(AssertUnwindSafe(|| drop(g.request_mana_rescue(1)))).is_err());
    context(
        "contract",
        NearToken::from_yoctonear(0),
        Some(PromiseResult::Successful(Vec::new())),
    );
    assert_eq!(g.resolve_mana_refill(0).status, RefillStatus::Completed);
    g.resolve_mana_refill(0);
    assert!(env::storage_has_key(RESCUE_USED));
    assert_eq!(g.native_pending, 0);
    assert_eq!(g.balance(&id("treasury"), Item::Copper), 4580);
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| drop(g.request_mana_rescue(1)))).is_err());
    assert_eq!(g.ledger(&id("player")).next_action, 1);
    assert_eq!(g.native_pool, pool - g.refill_amount);
    assert_supply(&g);
}

#[test]
fn only_the_configured_owner_can_schedule_a_bounded_contract_upgrade() {
    let g = game();
    let code = b"\0asm\x01\0\0\0".to_vec();
    let input = |caller: &str, bytes: Vec<u8>| {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(id("contract"))
            .predecessor_account_id(id(caller))
            .signer_account_id(id(caller))
            .account_balance(NearToken::from_near(100))
            .prepaid_gas(Gas::from_tgas(300));
        let mut context = builder.build();
        context.input = bytes.into();
        testing_env!(context);
    };
    for caller in ["player", "mira", "customer"] {
        input(caller, code.clone());
        assert!(catch_unwind(AssertUnwindSafe(|| drop(g.update_contract()))).is_err());
        assert!(get_created_receipts().is_empty());
    }
    for invalid in [vec![], b"not wasm".to_vec(), vec![0; 700_001]] {
        input("owner", invalid);
        assert!(catch_unwind(AssertUnwindSafe(|| drop(g.update_contract()))).is_err());
        assert!(get_created_receipts().is_empty());
    }
    input("owner", code.clone());
    drop(g.update_contract());
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, id("contract"));
    assert!(
        matches!(&receipts[0].actions[0],near_sdk::mock::MockAction::DeployContract{code:bytes,..} if bytes==&code)
    );
    assert_eq!(g.balance(&id("player"), Item::Copper), 40);
    assert_supply(&g);
}

#[test]
fn failed_rescue_restores_the_coupon_and_reserve_but_replay_never_pays_again() {
    let mut g = game();
    as_actor("player");
    g.mt_transfer(id("treasury"), "copper".into(), U128(31), None, None);
    assert!(catch_unwind(AssertUnwindSafe(|| drop(g.request_mana_rescue(0)))).is_err());
    assert_eq!(g.ledger(&id("player")).next_action, 0);
    context("owner", NearToken::from_millinear(10), None);
    g.fund_mana();
    let pool = g.native_pool;
    as_actor("mira");
    assert!(catch_unwind(AssertUnwindSafe(|| drop(g.request_mana_rescue(0)))).is_err());
    as_actor("player");
    drop(g.request_mana_rescue(0));
    context(
        "contract",
        NearToken::from_yoctonear(0),
        Some(PromiseResult::Failed),
    );
    assert_eq!(g.resolve_mana_refill(0).status, RefillStatus::Refunded);
    assert_eq!(g.native_pool, pool);
    assert_eq!(g.native_pending, 0);
    assert_eq!(g.balance(&id("player"), Item::Copper), 9);
    assert!(!env::storage_has_key(RESCUE_USED));
    as_actor("player");
    assert!(matches!(g.request_mana_rescue(0), PromiseOrValue::Value(_)));
    assert!(get_created_receipts().is_empty());
    drop(g.request_mana_rescue(1));
    assert_eq!(g.rescue_nonce(), Some(1));
    context(
        "contract",
        NearToken::from_yoctonear(0),
        Some(PromiseResult::Successful(Vec::new())),
    );
    assert_eq!(g.resolve_mana_refill(1).status, RefillStatus::Completed);
    assert!(env::storage_has_key(RESCUE_USED));
    assert_supply(&g);
}

#[test]
fn empty_native_reserve_does_not_take_copper() {
    let mut g = game();
    as_actor("player");
    assert!(catch_unwind(AssertUnwindSafe(|| drop(g.request_mana_refill(0)))).is_err());
    assert_eq!(g.balance(&id("player"), Item::Copper), 40);
    assert_eq!(g.ledger(&id("player")).next_action, 0);
    assert!(g.refill.is_none());
}

#[test]
fn registration_allowance_covers_a_maximum_length_account_record() {
    let mut g = game();
    let account: AccountId = "a".repeat(64).parse().unwrap();
    let bytes = env::storage_usage();
    context(
        "owner",
        NearToken::from_yoctonear(Alchemy::storage_minimum()),
        None,
    );
    let before = env::storage_usage();
    g.storage_deposit(Some(account.clone()), Some(true));
    let added = env::storage_usage() - before;
    assert!(
        added <= REGISTERED_BYTES,
        "record added {added} bytes; initial {bytes}"
    );
    assert_eq!(g.mt_balance_of(account, "copper".into()).0, 0);
}

#[test]
fn a_merchant_can_buy_ingredients_with_its_own_wallet() {
    let mut g = game();
    as_actor("mira");
    let paid = g.trade(
        id("rowan"),
        "spring_water".into(),
        U128(1),
        true,
        U128(10),
        0,
    );
    assert_eq!(g.balance(&id("mira"), Item::Copper), 100 - paid.0);
    assert_eq!(g.balance(&id("rowan"), Item::Copper), 100 + paid.0);
    assert_eq!(g.balance(&id("mira"), Item::SpringWater), 1);
    as_actor("mira");
    g.brew("healing_tonic".into(), 1);
    assert_eq!(g.balance(&id("mira"), Item::HealingTonic), 1);
    as_actor("mira");
    assert!(catch_unwind(AssertUnwindSafe(|| g.brew("healing_tonic".into(), 2))).is_err());
    assert_supply(&g);
}

#[test]
fn guild_potions_can_be_brewed_without_duplicating_the_intermediate_draught() {
    let mut g = game();
    for (nonce, item, amount) in [
        (0, "moonmint", 2),
        (1, "wood_essence", 2),
        (2, "emberbloom", 1),
        (3, "silver_dust", 1),
    ] {
        as_actor("player");
        g.gather(item.into(), U128(amount), nonce);
    }
    for nonce in 4..7 {
        as_actor("player");
        g.brew("focus_draught".into(), nonce);
    }
    as_actor("player");
    g.brew("restoration_elixir".into(), 7);
    assert_eq!(g.balance(&id("player"), Item::FocusDraught), 2);
    assert_eq!(g.balance(&id("player"), Item::RestorationElixir), 1);
    assert_eq!(g.balance(&id("player"), Item::SpringWater), 0);
    assert_eq!(g.balance(&id("player"), Item::SilverDust), 0);
    assert_eq!(g.balance(&id("player"), Item::Copper), 36);
    assert_supply(&g);
}

#[test]
fn game_view_exports_the_contract_recipes_and_current_market_quotes() {
    let mut g = game();
    let before = g.game_view();
    assert_eq!(before["catalog"].as_array().unwrap().len(), 10);
    assert_eq!(before["player"]["balances"]["copper"], "40");
    assert_eq!(before["catalog"][6]["recipe"][0]["token_id"], "sunleaf");
    assert_eq!(before["catalog"][6]["recipe"][0]["amount"], "2");
    as_actor("player");
    g.trade(id("mira"), "sunleaf".into(), U128(4), false, U128(0), 0);
    let after = g.game_view();
    assert_eq!(after["merchants"][0]["quotes"][0]["stock"], "14");
    assert_eq!(after["merchants"][0]["quotes"][0]["merchant_sells_at"], "3");
    assert_eq!(
        after["merchants"][0]["quotes"][0]["consumed_last_two_days"],
        "0"
    );
    assert_supply(&g);
}

#[test]
fn full_shelves_can_be_cleared_to_change_the_assortment() {
    let mut g = game();
    for item in [
        Item::HealingTonic,
        Item::FocusDraught,
        Item::RestorationElixir,
    ] {
        g.mint(&id("player"), item, 1);
    }
    as_actor("player");
    g.list_potion("healing_tonic".into(), U128(13), 0);
    as_actor("player");
    g.list_potion("focus_draught".into(), U128(19), 1);
    as_actor("player");
    assert!(
        catch_unwind(AssertUnwindSafe(|| g.list_potion(
            "restoration_elixir".into(),
            U128(41),
            2
        )))
        .is_err()
    );
    as_actor("player");
    g.unlist_potion("healing_tonic".into(), 2);
    as_actor("player");
    g.list_potion("restoration_elixir".into(), U128(41), 3);
    assert_eq!(g.listings.len(), 2);
    assert_eq!(g.balance(&id("player"), Item::HealingTonic), 1);
    assert_supply(&g);
}
