use super::*;

pub fn enabled() -> bool {
    std::env::var("PLAYER_OWNERSHIP").as_deref() == Ok("true")
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewOwnedGame {
    request_id: String,
    public_key: String,
}

pub async fn new_game(
    State(shared): State<Shared>,
    Json(body): Json<NewOwnedGame>,
) -> Result<Json<Value>, ApiError> {
    if !enabled() {
        return Err(error(
            StatusCode::NOT_FOUND,
            "Player-owned preview is disabled",
        ));
    }
    let valid = body.public_key.starts_with("ed25519:")
        && body
            .public_key
            .parse::<near_api::types::PublicKey>()
            .is_ok();
    if !valid
        || body.request_id.len() != 36
        || !body
            .request_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Send a public Ed25519 key and request ID",
        ));
    }
    let mut saves = shared.lock().await;
    if let Some((key, id)) = saves.requests.get(&body.request_id) {
        if key != &body.public_key {
            return Err(error(
                StatusCode::CONFLICT,
                "Request already belongs to another public key",
            ));
        }
        return Ok(Json(
            json!({"world_id":id,"player_id":saves.games[id].world.player_id}),
        ));
    }
    if saves.games.len() >= 3 {
        return Err(error(
            StatusCode::CONFLICT,
            "This private preview has three shops; existing shops were preserved",
        ));
    }
    let game = fresh_game_with_key(Some(body.public_key.clone()))
        .await
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Player-owned Sandbox could not start",
            )
        })?;
    if saves.games.is_empty() {
        let arena: near_api::types::AccountId = "arena.owner.test.near".parse().unwrap();
        game.world
            .sandbox
            .create_account(arena.clone().as_str().parse().unwrap())
            .initial_balance(NearToken::from_near(10))
            .send()
            .await
            .map_err(|_| {
                error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Arena reserve setup failed",
                )
            })?;
        let wasm = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/wasm32-unknown-unknown/release/briarbridge_arena.wasm");
        near_api::Contract::deploy(arena.clone())
            .use_code(std::fs::read(wasm).map_err(|_| {
                error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Build the arena contract first",
                )
            })?)
            .without_init_call()
            .with_signer(game.world.signer.clone())
            .send_to(&game.world.network)
            .await
            .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "Arena deployment failed"))?
            .assert_success();
        call(
            &near_api::Contract(arena.clone()),
            &game.world.network,
            &game.world.signer,
            "owner",
            "new",
            json!({"referee":id("owner")}),
            NearToken::from_yoctonear(0),
        )
        .await
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Arena initialization failed",
            )
        })?;
        alchemy_sandbox::seal_account(&arena, &game.world.network, &game.world.signer)
            .await
            .map_err(|_| {
                error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Arena deployment key removal failed",
                )
            })?;
    }
    let id = game.instance.clone();
    if saves.primary.is_empty() {
        saves.primary = id.clone();
    }
    let player = game.world.player_id.clone();
    saves.games.insert(id.clone(), game);
    saves
        .requests
        .insert(body.request_id, (body.public_key, id.clone()));
    Ok(Json(json!({"world_id":id,"player_id":player})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefereeRequest {
    method: String,
    args: Value,
}

pub async fn referee(
    State(shared): State<Shared>,
    headers: axum::http::HeaderMap,
    Json(body): Json<RefereeRequest>,
) -> Result<Json<Value>, ApiError> {
    let token = std::env::var("LOCAL_REFEREE_TOKEN").unwrap_or_default();
    if token.len() < 24
        || headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            != Some(format!("Bearer {token}").as_str())
    {
        return Err(error(
            StatusCode::FORBIDDEN,
            "Referee authentication required",
        ));
    }
    let saves = shared.lock().await;
    let game = saves
        .games
        .get(&saves.primary)
        .filter(|g| g.player_owned)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Player-owned arena is not ready"))?;
    let arena = near_api::Contract("arena.owner.test.near".parse().unwrap());
    let result = match body.method.as_str() {
        "result" | "progress" => view(&arena, &game.world.network, &body.method, body.args).await,
        "settle_duel" => {
            call(
                &arena,
                &game.world.network,
                &game.world.signer,
                "owner",
                "settle_duel",
                body.args,
                NearToken::from_yoctonear(0),
            )
            .await
        }
        _ => return Err(error(StatusCode::BAD_REQUEST, "Unsupported referee method")),
    }
    .map_err(|_| {
        error(
            StatusCode::SERVICE_UNAVAILABLE,
            "NEAR result confirmation is pending",
        )
    })?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rpc {
    world_id: String,
    method: String,
    params: Value,
}

// Only public reads and already-signed transactions cross this boundary; no player key is accepted.
pub async fn rpc(
    State(shared): State<Shared>,
    Json(body): Json<Rpc>,
) -> Result<Json<Value>, ApiError> {
    if !["query", "block", "tx", "send_tx"].contains(&body.method.as_str()) {
        return Err(error(StatusCode::BAD_REQUEST, "Unsupported chain method"));
    }
    let saves = shared.lock().await;
    let game = saves
        .games
        .get(&body.world_id)
        .filter(|g| g.player_owned)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Choose a player-owned local shop"))?;
    let response = reqwest::Client::new()
        .post(&game.world.sandbox.rpc_addr)
        .timeout(std::time::Duration::from_secs(20))
        .json(&json!({"jsonrpc":"2.0","id":"device","method":body.method,"params":body.params}))
        .send()
        .await
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Chain request could not be confirmed",
            )
        })?;
    let value: Value = response
        .json()
        .await
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "Invalid chain response"))?;
    Ok(Json(value))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mira {
    world_id: String,
    method: String,
    token_id: Option<String>,
    amount: Option<String>,
}

pub async fn mira(
    State(shared): State<Shared>,
    Json(body): Json<Mira>,
) -> Result<Json<Value>, ApiError> {
    let saves = shared.lock().await;
    let game = saves
        .games
        .get(&body.world_id)
        .filter(|g| g.player_owned)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Choose a player-owned local shop"))?;
    let result = match body.method.as_str() {
        "view" => {
            view(
                &game.world.contract,
                &game.world.network,
                "mira_orders_view",
                json!({}),
            )
            .await
        }
        "offer" => {
            call(
                &game.world.contract,
                &game.world.network,
                &game.world.signer,
                "mira",
                "offer_mira_order",
                json!({"token_id":body.token_id,"amount":body.amount}),
                NearToken::from_yoctonear(1),
            )
            .await
        }
        "expire" => {
            call(
                &game.world.contract,
                &game.world.network,
                &game.world.signer,
                "mira",
                "expire_mira_order",
                json!({}),
                NearToken::from_yoctonear(0),
            )
            .await
        }
        _ => return Err(error(StatusCode::BAD_REQUEST, "Unsupported NPC action")),
    }
    .map_err(|_| {
        error(
            StatusCode::CONFLICT,
            "Mira's confirmed order changed; refresh before continuing",
        )
    })?;
    Ok(Json(result))
}
