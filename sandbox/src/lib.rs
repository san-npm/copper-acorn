use anyhow::{Context, Result};
use near_api::{
    Contract, NetworkConfig, Signer, Transaction,
    types::{AccountId, Action, Data, NearGas as Gas, NearToken},
};
use near_sandbox::{Sandbox, config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};

#[derive(Debug)]
pub struct ConfirmedFailure(pub String);
impl std::fmt::Display for ConfirmedFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Confirmed transaction failure: {}", self.0)
    }
}
impl std::error::Error for ConfirmedFailure {}

#[derive(Debug)]
pub struct UnconfirmedTransaction(pub String);
impl std::fmt::Display for UnconfirmedTransaction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Transaction outcome is unknown: {}", self.0)
    }
}
impl std::error::Error for UnconfirmedTransaction {}

// The well-known test key is used only in this disposable local Sandbox.
pub fn id(name: &str) -> AccountId {
    if name == "contract" {
        "game.owner.test.near".parse().unwrap()
    } else {
        format!("{name}.test.near").parse().unwrap()
    }
}

pub async fn call(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &Arc<Signer>,
    actor: &str,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> Result<Value> {
    // Gas reservations must leave a restored account able to submit its next action.
    let gas = match method {
        "mt_transfer_call" | "mt_batch_transfer_call" => 150,
        "request_mana_refill" => 40,
        _ => 20,
    };
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .gas(Gas::from_tgas(gas))
        .deposit(deposit)
        .with_signer(id(actor), signer.clone())
        .send_to(network)
        .await
        .map_err(|error| UnconfirmedTransaction(error.to_string()))?;
    let outcome = outcome
        .into_full()
        .ok_or_else(|| UnconfirmedTransaction("Transaction is still pending".into()))?;
    if !outcome.is_success() {
        return Err(ConfirmedFailure(method.into()).into());
    }
    let receipt = json!({"method":method,"hash":outcome.transaction().get_hash().to_string(),"gas_burnt":outcome.total_gas_burnt.to_string()});
    println!("{}", receipt);
    Ok(receipt)
}

pub async fn view(
    contract: &Contract,
    network: &NetworkConfig,
    method: &str,
    args: Value,
) -> Result<Value> {
    let response: Data<Value> = contract
        .call_function(method, args)
        .read_only()
        .fetch_from(network)
        .await?;
    Ok(response.data)
}

pub async fn copper(contract: &Contract, network: &NetworkConfig, actor: &str) -> Result<String> {
    Ok(view(
        contract,
        network,
        "mt_balance_of",
        json!({"account_id":id(actor),"token_id":"copper"}),
    )
    .await?
    .as_str()
    .context("Expected decimal-string balance")?
    .to_owned())
}

pub struct LocalWorld {
    pub sandbox: Sandbox,
    pub network: NetworkConfig,
    pub signer: Arc<Signer>,
    pub contract: Contract,
    pub player_id: AccountId,
}

impl LocalWorld {
    pub async fn start(player_gas: NearToken) -> Result<Self> {
        Self::start_with_player_key(player_gas, None).await
    }

    pub async fn start_with_player_key(
        player_gas: NearToken,
        player_key: Option<String>,
    ) -> Result<Self> {
        let sandbox = Sandbox::start_sandbox()
            .await
            .context("Start local NEAR Sandbox")?;
        let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
        let player_id: AccountId = if let Some(key) = &player_key {
            let pk: near_api::types::PublicKey = key.parse()?;
            let hex: String = pk.key_data().iter().map(|b| format!("{b:02x}")).collect();
            format!("p-{}.test.near", &hex[..32]).parse()?
        } else {
            id("player")
        };
        for actor in [
            "owner", "player", "mira", "rowan", "bram", "customer", "treasury", "contract",
        ] {
            let mut creation = sandbox
                .create_account(if actor == "player" {
                    player_id.as_str().parse()?
                } else {
                    id(actor).as_str().parse()?
                })
                .initial_balance(if actor == "player" {
                    player_gas
                } else {
                    NearToken::from_near(10)
                });
            if actor == "player" {
                if let Some(key) = &player_key {
                    creation = creation.public_key(key.clone());
                }
            }
            creation.send().await?;
        }
        let wasm = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/wasm32-unknown-unknown/release/briarbridge_alchemy.wasm");
        Contract::deploy(id("contract"))
            .use_code(std::fs::read(wasm)?)
            .without_init_call()
            .with_signer(signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
        let contract = Contract(id("contract"));
        let zero = NearToken::from_yoctonear(0);
        // Native amounts here are test inputs, not measured production refill settings.
        call(
            &contract,
            &network,
            &signer,
            "owner",
            "new",
            json!({"setup":{
                "owner_id":id("owner"),"player_id":player_id,
                "merchant_ids":[id("mira"),id("rowan"),id("bram")],
                "customer_id":id("customer"),"treasury_id":id("treasury"),
                "refill_amount":NearToken::from_millinear(100).as_yoctonear().to_string(),
                "operating_reserve":NearToken::from_near(1).as_yoctonear().to_string()
            }}),
            zero,
        )
        .await?;
        if player_key.is_some() {
            // Leave only the contract's guarded upgrade entry point until the player locks it.
            seal_account(&contract.0, &network, &signer).await?;
        }
        Ok(Self {
            sandbox,
            network,
            signer,
            contract,
            player_id,
        })
    }
}

pub async fn seal_account(
    account: &AccountId,
    network: &NetworkConfig,
    signer: &Arc<Signer>,
) -> Result<()> {
    let key: near_api::types::SecretKey = DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?;
    near_api::Account(account.clone())
        .delete_key(key.public_key())
        .with_signer(signer.clone())
        .send_to(network)
        .await?
        .assert_success();
    Ok(())
}

pub async fn relay_refill(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &Arc<Signer>,
    nonce: u64,
    rescue: bool,
) -> Result<Value> {
    let method = if rescue {
        "request_mana_rescue"
    } else {
        "request_mana_refill"
    };
    let delegated = contract
        .call_function(method, json!({"nonce":nonce}))
        .transaction()
        .gas(Gas::from_tgas(150))
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(id("player"), signer.clone())
        .meta()
        .tx_live_for(100)
        .presign_with(network)
        .await?
        .transaction
        .signed()
        .context("Missing delegated refill")?;
    let outcome = Transaction::construct(id("owner"), id("player"))
        .add_action(Action::Delegate(Box::new(delegated)))
        .with_signer(signer.clone())
        .send_to(network)
        .await
        .map_err(|error| UnconfirmedTransaction(error.to_string()))?;
    let outcome = outcome
        .into_full()
        .ok_or_else(|| UnconfirmedTransaction("Refill is still pending".into()))?;
    if !outcome.is_success() || !outcome.receipt_failures().is_empty() {
        return Err(ConfirmedFailure(method.into()).into());
    }
    Ok(
        json!({"method":method,"hash":outcome.transaction().get_hash().to_string(),"gas_burnt":outcome.total_gas_burnt.to_string()}),
    )
}
