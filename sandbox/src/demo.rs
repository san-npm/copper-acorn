use super::*;
use std::time::Instant;

type DemoState = Arc<Mutex<Value>>;

pub fn routes() -> Router {
    Router::new()
        .route("/api/demo", get(status).post(start))
        .with_state(Arc::new(Mutex::new(json!({"status":"idle"}))))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    request_id: String,
}

async fn status(State(state): State<DemoState>) -> Json<Value> {
    Json(state.lock().await.clone())
}

async fn start(
    State(state): State<DemoState>,
    Json(request): Json<Start>,
) -> Result<Json<Value>, ApiError> {
    if request.request_id.len() != 36
        || !request
            .request_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid demo request ID."));
    }
    let mut current = state.lock().await;
    if current["request_id"] == request.request_id {
        return Ok(Json(current.clone()));
    }
    if current["status"] == "running" {
        return Err(error(
            StatusCode::CONFLICT,
            "A separate demo is already running.",
        ));
    }
    *current = json!({"request_id":request.request_id,"status":"running","stage":"Preparing separate Sandbox","ticks":0,"elapsed_ms":0,"rows":[],"events":[],"source":"cached_jev"});
    let result = current.clone();
    drop(current);
    tokio::spawn(async move {
        let started = Instant::now();
        if let Err(err) = run(&state, started).await {
            eprintln!("Separate demo stopped: {err:#}");
            let mut current = state.lock().await;
            current["status"] = json!("failed");
            current["error"] = json!(
                "Demo stopped without retrying an unconfirmed action. Ordinary play is unchanged."
            );
            current["elapsed_ms"] = json!(started.elapsed().as_millis() as u64);
        }
    });
    Ok(Json(result))
}

async fn event(state: &DemoState, text: &str, receipt: Value) {
    state.lock().await["events"]
        .as_array_mut()
        .unwrap()
        .push(json!({"text":text,"receipt":receipt}));
}

async fn report(state: &DemoState, game: &Game, started: Instant) -> Result<()> {
    let ledger = view(
        &game.world.contract,
        &game.world.network,
        "game_view",
        json!({}),
    )
    .await?;
    let mut current = state.lock().await;
    current["rows"].as_array_mut().unwrap().push(json!({"day":ledger["world"]["day"],"merchants":ledger["merchants"],"player":ledger["player"],"quests":ledger["quests"]}));
    current["elapsed_ms"] = json!(started.elapsed().as_millis() as u64);
    Ok(())
}

async fn fixture(state: &DemoState, game: &mut Game, started: Instant) -> Result<()> {
    state.lock().await["world_id"] = json!(game.instance);
    let w = &game.world;
    let one = NearToken::from_yoctonear(1);
    // The stress fixture transfers existing coins; the supply and all trading rules stay unchanged.
    let receipt=call(&w.contract,&w.network,&w.signer,"mira","mt_transfer",json!({"receiver_id":id("treasury"),"token_id":"copper","amount":"55","approval":null,"memo":"Demo low-cash fixture"}),one).await?;
    event(
        state,
        "Stress fixture: Mira starts with 6 spendable Copper; 55 moved to treasury.",
        receipt,
    )
    .await;
    report(state, &game, started).await?;
    state.lock().await["stage"] = json!("Sunleaf supply shock");
    let receipt = call(
        &w.contract,
        &w.network,
        &w.signer,
        "player",
        "gather",
        json!({"token_id":"sunleaf","amount":"6","nonce":game.nonce("player").await?}),
        one,
    )
    .await?;
    event(state, "Gathered the normal daily cap: 6 Sunleaf.", receipt).await;
    for _ in 0..6 {
        let ledger = view(
            &game.world.contract,
            &game.world.network,
            "game_view",
            json!({}),
        )
        .await?;
        let mira = &ledger["merchants"][0];
        if mira["open"] != true {
            break;
        }
        let q = mira["quotes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|q| q["token_id"] == "sunleaf")
            .context("Missing Sunleaf quote")?;
        let copper = mira["account"]["balances"]["copper"]
            .as_str()
            .unwrap()
            .parse::<u128>()?;
        if copper < q["merchant_buys_at"].as_str().unwrap().parse::<u128>()? {
            break;
        }
        let receipt = game
            .execute(&Action::Trade {
                amount: "1".into(),
                merchant: "mira".into(),
                token_id: "sunleaf".into(),
                buy: false,
                limit: q["merchant_buys_at"].as_str().unwrap().into(),
            })
            .await?;
        event(
            state,
            "Sold one Sunleaf at the current contract quote.",
            receipt,
        )
        .await;
    }
    report(state, &game, started).await?;
    let closed = view(
        &game.world.contract,
        &game.world.network,
        "game_view",
        json!({}),
    )
    .await?;
    ensure!(
        closed["merchants"][0]["open"] == false,
        "Stress fixture did not close the stall"
    );
    event(
        state,
        "Mira reached zero Copper and closed; existing inventory stays owned.",
        Value::Null,
    )
    .await;
    let receipt = game
        .execute(&Action::Invest {
            merchant: "mira".into(),
        })
        .await?;
    event(
        state,
        "Player invested 20 owned Copper; Mira reopened.",
        receipt,
    )
    .await;
    report(state, &game, started).await?;
    Ok(())
}

async fn run(state: &DemoState, started: Instant) -> Result<()> {
    let mut game = fresh_game().await?;
    fixture(state, &mut game, started).await?;
    state.lock().await["stage"] = json!("Seven market days · same contract rules");
    for day in 0..7 {
        for _ in 0..10 {
            let tick = game.market_tick;
            game.execute(&Action::MarketTick { tick }).await?;
            let mut current = state.lock().await;
            current["ticks"] = json!(game.market_tick);
            current["elapsed_ms"] = json!(started.elapsed().as_millis() as u64);
        }
        game.execute(&Action::NextDay).await?;
        report(state, &game, started).await?;
        ensure!(
            game.day_ticks == 0 && game.market_tick == (day + 1) * 10,
            "Invalid demo progression"
        );
    }
    let final_state = game.snapshot().await?;
    let mut wallets = vec![
        "owner", "player", "mira", "rowan", "bram", "customer", "treasury",
    ];
    wallets.push("contract");
    let mut copper = 0u128;
    for actor in wallets {
        let account = if actor == "contract" {
            game.world.contract.0.clone()
        } else {
            id(actor)
        };
        let balance = view(
            &game.world.contract,
            &game.world.network,
            "mt_balance_of",
            json!({"account_id":account,"token_id":"copper"}),
        )
        .await?;
        copper += balance
            .as_str()
            .context("Missing Copper")?
            .parse::<u128>()?;
    }
    ensure!(copper == 5000, "Copper supply changed");
    let mut current = state.lock().await;
    current["final_state"] = final_state;
    current["copper_supply"] = json!(copper.to_string());
    current["status"] = json!("completed");
    current["stage"] = json!("Seven days confirmed");
    current["elapsed_ms"] = json!(started.elapsed().as_millis() as u64);
    current["within_target"] = json!(started.elapsed().as_secs_f64() <= 60.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn status_state() -> DemoState {
        Arc::new(Mutex::new(json!({"events":[],"rows":[]})))
    }
    #[tokio::test]
    #[ignore = "Creates two isolated Sandbox chains and confirms two seven-day traces"]
    async fn regular_guarded_actions_match_accelerated_week() -> Result<()> {
        let mut normal = fresh_game().await?;
        fixture(&status_state(), &mut normal, Instant::now()).await?;
        let world_id = normal.instance.clone();
        let shared = Arc::new(Mutex::new(Saves {
            primary: world_id.clone(),
            games: BTreeMap::from([(world_id.clone(), normal)]),
            requests: BTreeMap::new(),
        }));
        for day in 0..7 {
            for turn in 0..=10 {
                let action = if turn == 10 {
                    Action::NextDay
                } else {
                    Action::MarketTick {
                        tick: day * 10 + turn,
                    }
                };
                let request_id = format!("normal-day-{day}-turn-{turn}-request");
                let request = || ActionRequest {
                    request_id: request_id.clone(),
                    world_id: world_id.clone(),
                    action: action.clone(),
                };
                let first = act(State(shared.clone()), Json(request()))
                    .await
                    .map_err(|_| anyhow::anyhow!("Regular request rejected"))?
                    .0;
                ensure!(
                    first.status == "confirmed",
                    "Regular action did not confirm"
                );
                let duplicate = act(State(shared.clone()), Json(request()))
                    .await
                    .map_err(|_| anyhow::anyhow!("Duplicate request rejected"))?
                    .0;
                ensure!(first.result == duplicate.result, "Replay changed receipt");
            }
        }
        let ordinary = shared.lock().await.games[&world_id].snapshot().await?;
        let accelerated = status_state();
        run(&accelerated, Instant::now()).await?;
        let fast = accelerated.lock().await;
        let final_state = &fast["final_state"];
        for field in [
            "world",
            "player",
            "customer",
            "merchants",
            "catalog",
            "craft_fee",
            "investment",
            "shelf_slots",
            "listings",
            "quests",
        ] {
            ensure!(
                ordinary[field] == final_state[field],
                "Normal/accelerated mismatch in {field}"
            );
        }
        ensure!(
            ordinary["market"]["tick"] == 70 && final_state["market"]["tick"] == 70,
            "Wrong turn count"
        );
        println!(
            "77 guarded regular requests +77 duplicate replays match the accelerated world's final economic state; demo {}ms",
            fast["elapsed_ms"]
        );
        Ok(())
    }
}
