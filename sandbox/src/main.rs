use alchemy_sandbox::{LocalWorld, call, copper, id, relay_refill, view};
use anyhow::{Context, Result, ensure};
use near_api::{
    Account,
    types::{NearGas, NearToken},
};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<()> {
    let LocalWorld {
        sandbox,
        network,
        signer,
        contract,
        ..
    } = LocalWorld::start(NearToken::from_near(10)).await?;
    let one = NearToken::from_yoctonear(1);
    let zero = NearToken::from_yoctonear(0);
    ensure!(copper(&contract, &network, "player").await? == "40");
    call(
        &contract,
        &network,
        &signer,
        "player",
        "gather",
        json!({"token_id":"sunleaf","amount":"1","nonce":0}),
        one,
    )
    .await?;
    call(
        &contract,
        &network,
        &signer,
        "player",
        "brew",
        json!({"token_id":"healing_tonic","nonce":1}),
        one,
    )
    .await?;
    ensure!(copper(&contract, &network, "player").await? == "39");
    call(
        &contract,
        &network,
        &signer,
        "player",
        "list_potion",
        json!({"token_id":"healing_tonic","price":"13","nonce":2}),
        one,
    )
    .await?;
    call(
        &contract,
        &network,
        &signer,
        "customer",
        "buy_listing",
        json!({"token_id":"healing_tonic","max_price":"13","nonce":0}),
        one,
    )
    .await?;
    ensure!(copper(&contract, &network, "player").await? == "52");
    ensure!(copper(&contract, &network, "customer").await? == "107");
    call(
        &contract,
        &network,
        &signer,
        "owner",
        "fund_mana",
        json!({}),
        NearToken::from_near(1),
    )
    .await?;
    call(
        &contract,
        &network,
        &signer,
        "player",
        "request_mana_refill",
        json!({"nonce":3}),
        one,
    )
    .await?;
    ensure!(copper(&contract, &network, "player").await? == "42");
    let state = view(&contract, &network, "world_view", json!({})).await?;
    ensure!(
        state["refill"]["status"] == "Completed",
        "Native payout callback did not complete"
    );
    println!("Sandbox opening loop passed: gather, brew, sell, funded native refill.");

    // A receiver with no mt_on_transfer method must trigger a token refund.
    let before = view(
        &contract,
        &network,
        "mt_balance_of",
        json!({"account_id":id("player"),"token_id":"sunleaf"}),
    )
    .await?;
    call(
        &contract,
        &network,
        &signer,
        "player",
        "mt_transfer_call",
        json!({"receiver_id":id("mira"),
        "token_id":"sunleaf","amount":"1","approval":null,"memo":null,"msg":"refund-test"}),
        one,
    )
    .await?;
    let after = view(
        &contract,
        &network,
        "mt_balance_of",
        json!({"account_id":id("player"),"token_id":"sunleaf"}),
    )
    .await?;
    ensure!(before == after, "Failed receiver did not refund token");
    let unauthorized = contract
        .call_function("resolve_mana_refill", json!({"nonce":3}))
        .transaction()
        .with_signer(id("customer"), signer.clone())
        .send_to(&network)
        .await?;
    ensure!(
        unauthorized.is_failure(),
        "Private callback accepted an external caller"
    );
    println!("Sandbox callbacks passed: receiver failure refund and private-callback rejection.");

    // Patch only the gas balance, retaining the player's initialized key and game inventory.
    sandbox
        .patch_state(id("player").as_str().parse()?)
        .fetch_from(
            sandbox.rpc_addr.clone(),
            near_sandbox::FetchData::NONE.account(),
        )
        .await?
        .initial_balance(zero)
        .send()
        .await?;
    let empty = Account(id("player")).view().fetch_from(&network).await?;
    ensure!(empty.data.amount == zero, "Player gas fixture is not zero");
    relay_refill(&contract, &network, &signer, 4, false).await?;
    ensure!(copper(&contract, &network, "player").await? == "32");
    let restored = Account(id("player")).view().fetch_from(&network).await?;
    ensure!(
        restored.data.amount >= NearToken::from_millinear(100),
        "Native gas was not replenished"
    );
    call(
        &contract,
        &network,
        &signer,
        "player",
        "gather",
        json!({"token_id":"spring_water","amount":"1","nonce":5}),
        one,
    )
    .await?;
    call(
        &contract,
        &network,
        &signer,
        "player",
        "brew",
        json!({"token_id":"healing_tonic","nonce":6}),
        one,
    )
    .await?;
    ensure!(copper(&contract, &network, "player").await? == "31");
    println!(
        "Sandbox zero-gas recovery passed: funded relayer restored native balance and the player resumed an ordinary transaction."
    );
    ensure!(
        view(
            &contract,
            &network,
            "mt_supply",
            json!({"token_id":"copper"})
        )
        .await?
            == "5000"
    );
    call(&contract, &network, &signer, "mira", "trade",
        json!({"merchant_id":id("rowan"),"token_id":"spring_water","amount":"1","buy":true,"limit":"10","nonce":0}), one).await?;
    call(
        &contract,
        &network,
        &signer,
        "mira",
        "brew",
        json!({"token_id":"healing_tonic","nonce":1}),
        one,
    )
    .await?;
    ensure!(copper(&contract, &network, "mira").await? == "97");
    ensure!(copper(&contract, &network, "rowan").await? == "102");
    let metadata=view(&contract,&network,"mt_metadata_token_all",
        json!({"token_ids":["sunleaf","moonmint","emberbloom","spring_water","wood_essence","silver_dust","healing_tonic","focus_draught","restoration_elixir","copper"]})).await?;
    ensure!(metadata.as_array().is_some_and(
        |items| items.len() == 10 && items.iter().all(|item| item["base"]["decimals"] == "0")
    ));
    println!("Sandbox merchant trade/brew and metadata checks passed.");
    let coins = copper(&contract, &network, "player").await?;
    call(&contract,&network,&signer,"player","mt_transfer",json!({"receiver_id":id("treasury"),"token_id":"copper","amount":coins,"approval":null,"memo":null}),one).await?;
    sandbox
        .patch_state(id("player").as_str().parse()?)
        .fetch_from(
            sandbox.rpc_addr.clone(),
            near_sandbox::FetchData::NONE.account(),
        )
        .await?
        .initial_balance(zero)
        .send()
        .await?;
    let nonce = view(
        &contract,
        &network,
        "account_view",
        json!({"account_id":id("player")}),
    )
    .await?["next_action"]
        .as_u64()
        .unwrap();
    ensure!(
        Account(id("player"))
            .view()
            .fetch_from(&network)
            .await?
            .data
            .amount
            == zero
    );
    ensure!(copper(&contract, &network, "player").await? == "0");
    relay_refill(&contract, &network, &signer, nonce, true).await?;
    ensure!(
        Account(id("player"))
            .view()
            .fetch_from(&network)
            .await?
            .data
            .amount
            >= NearToken::from_millinear(100)
    );
    ensure!(copper(&contract, &network, "player").await? == "0");
    ensure!(
        view(&contract, &network, "world_view", json!({})).await?["mana_rescue"]["used"] == true
    );
    for n in 1..=2 {
        call(
            &contract,
            &network,
            &signer,
            "player",
            "gather",
            json!({"token_id":"sunleaf","amount":"1","nonce":nonce+n}),
            one,
        )
        .await?;
    }
    call(&contract,&network,&signer,"player","trade",json!({"merchant_id":id("mira"),"token_id":"sunleaf","amount":"1","buy":false,"limit":"0","nonce":nonce+3}),one).await?;
    call(
        &contract,
        &network,
        &signer,
        "player",
        "brew",
        json!({"token_id":"healing_tonic","nonce":nonce+4}),
        one,
    )
    .await?;
    let restored = view(&contract, &network, "game_view", json!({})).await?;
    ensure!(
        restored["player"]["balances"]["healing_tonic"]
            .as_str()
            .unwrap()
            .parse::<u128>()?
            > 0
    );
    let pool_before =
        view(&contract, &network, "world_view", json!({})).await?["native_pool"].clone();
    let duplicate = relay_refill(&contract, &network, &signer, nonce + 5, true).await;
    ensure!(
        view(&contract, &network, "world_view", json!({})).await?["native_pool"] == pool_before,
        "Rejected rescue changed the native reserve"
    );
    ensure!(
        duplicate.is_err(),
        "Relayer reported a rejected rescue as successful"
    );
    ensure!(
        view(
            &contract,
            &network,
            "account_view",
            json!({"account_id":id("player")})
        )
        .await?["next_action"]
            == nonce + 5
    );
    ensure!(
        view(
            &contract,
            &network,
            "mt_supply",
            json!({"token_id":"copper"})
        )
        .await?
            == "5000"
    );
    println!(
        "Sandbox free rescue passed: zero Copper/zero gas, one sponsored payout, gather/trade/brew resumed, second rescue rejected,5000 Copper preserved."
    );
    let before_upgrade = view(&contract, &network, "game_view", json!({})).await?;
    let wasm = std::fs::read(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/wasm32-unknown-unknown/release/briarbridge_alchemy.wasm"),
    )?;
    let rejected = contract
        .call_function_raw("update_contract", wasm.clone())
        .transaction()
        .gas(NearGas::from_tgas(100))
        .with_signer(id("mira"), signer.clone())
        .send_to(&network)
        .await?
        .into_full()
        .context("Unauthorized update pending")?;
    ensure!(!rejected.is_success(), "Non-owner updated contract");
    ensure!(view(&contract, &network, "game_view", json!({})).await? == before_upgrade);
    let upgraded = contract
        .call_function_raw("update_contract", wasm)
        .transaction()
        .gas(NearGas::from_tgas(100))
        .with_signer(id("owner"), signer.clone())
        .send_to(&network)
        .await?
        .into_full()
        .context("Owner update pending")?;
    ensure!(
        upgraded.is_success() && upgraded.receipt_failures().is_empty(),
        "Owner code update failed"
    );
    ensure!(
        view(&contract, &network, "game_view", json!({})).await? == before_upgrade,
        "Update changed saved state"
    );
    println!(
        "Sandbox upgrade passed: non-owner rejected, owner redeployed raw release WASM, complete game view unchanged."
    );
    println!("All Sandbox checks passed. This run used no public testnet or live Jev.");
    Ok(())
}
