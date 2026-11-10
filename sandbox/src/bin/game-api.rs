use alchemy_sandbox::{LocalWorld, call, id, relay_refill, view};
#[path = "../demo.rs"]
mod demo;
#[path = "../market.rs"]
mod market;
#[path = "../owned.rs"]
mod owned;
use anyhow::{Context, Result, ensure};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use near_api::{Account, types::NearToken};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

fn one_unit() -> String {
    "1".into()
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Action {
    Gather {
        token_id: String,
        #[serde(default = "one_unit")]
        amount: String,
    },
    Brew {
        token_id: String,
        #[serde(default = "one_unit")]
        amount: String,
    },
    List {
        token_id: String,
        price: String,
    },
    Unlist {
        token_id: String,
    },
    ChooseAlchemist {
        nickname: String,
        character_id: String,
    },
    Trade {
        #[serde(default = "one_unit")]
        amount: String,
        merchant: String,
        token_id: String,
        buy: bool,
        limit: String,
    },
    Invest {
        merchant: String,
    },
    ServeCustomer,
    Refill,
    Rescue,
    NextDay,
    MarketTick {
        tick: u64,
    },
    Deliver {
        token_id: String,
        #[serde(default = "one_unit")]
        amount: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ActionRequest {
    request_id: String,
    world_id: String,
    action: Action,
}

#[derive(Clone, Serialize)]
struct Operation {
    action: Action,
    status: String,
    result: Value,
    error: Option<String>,
}

struct Game {
    world: LocalWorld,
    instance: String,
    operations: BTreeMap<String, Operation>,
    recorded_need: Option<Value>,
    served_day: Option<u64>,
    evidence: market::Evidence,
    market_tick: u64,
    day_ticks: u64,
    market_log: Vec<Value>,
    uncertain: bool,
    player_owned: bool,
}

struct Saves {
    primary: String,
    games: BTreeMap<String, Game>,
    requests: BTreeMap<String, (String, String)>,
}
type Shared = Arc<Mutex<Saves>>;
#[derive(Deserialize, Default)]
struct WorldQuery {
    world_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewSave {
    request_id: String,
    world_id: String,
}

async fn saves(State(saves): State<Shared>) -> Result<Json<Value>, ApiError> {
    let saves = saves.lock().await;
    let mut rows = Vec::new();
    for (id, game) in &saves.games {
        let alchemist = view(
            &game.world.contract,
            &game.world.network,
            "alchemist_view",
            json!({}),
        )
        .await
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "Saves could not be read"))?;
        rows.push(json!({"world_id":id,"alchemist":alchemist}));
    }
    Ok(Json(json!({"saves":rows,"limit":3})))
}
async fn new_save(
    State(saves): State<Shared>,
    Json(request): Json<NewSave>,
) -> Result<Json<Value>, ApiError> {
    if request.request_id.len() != 36
        || !request
            .request_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid save request"));
    }
    let mut saves = saves.lock().await;
    if let Some((parent, id)) = saves.requests.get(&request.request_id) {
        if parent != &request.world_id {
            return Err(error(
                StatusCode::CONFLICT,
                "Request belongs to another save",
            ));
        }
        return Ok(Json(json!({"world_id":id})));
    }
    let parent = saves
        .games
        .get(&request.world_id)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Save unavailable"))?;
    if parent.uncertain {
        return Err(error(
            StatusCode::CONFLICT,
            "Check your pending action before starting another game",
        ));
    }
    // shortcut: keep at most three running Sandbox saves; hosted saves use the existing funding limit.
    if saves.games.len() >= 3 {
        return Err(error(
            StatusCode::CONFLICT,
            "The three local save slots are full. Your saved games are preserved.",
        ));
    }
    if owned::enabled() {
        return Err(error(
            StatusCode::CONFLICT,
            "Use player-owned setup for this preview",
        ));
    }
    let game = fresh_game().await.map_err(|_| {
        error(
            StatusCode::SERVICE_UNAVAILABLE,
            "New game could not start; retry the same request",
        )
    })?;
    let id = game.instance.clone();
    saves.games.insert(id.clone(), game);
    saves
        .requests
        .insert(request.request_id, (request.world_id, id.clone()));
    Ok(Json(json!({"world_id":id})))
}
type ApiError = (StatusCode, Json<Value>);

fn error(status: StatusCode, message: &str) -> ApiError {
    (status, Json(json!({"error":message})))
}

impl Game {
    async fn snapshot(&self) -> Result<Value> {
        let mut state = view(
            &self.world.contract,
            &self.world.network,
            "game_view",
            json!({}),
        )
        .await?;
        let native = Account(self.world.player_id.clone())
            .view()
            .fetch_from(&self.world.network)
            .await?;
        state["environment"] = json!({"network":"sandbox","world_id":self.instance,
            "ai_mode":if self.recorded_need.is_some(){"recorded"}else{"unavailable"},
            "native_balance":native.data.amount.as_yoctonear().to_string(),
            "starter_native":NearToken::from_millinear(40).as_yoctonear().to_string(),
            "low_native":NearToken::from_millinear(25).as_yoctonear().to_string(),
            "rescue_available":native.data.amount < NearToken::from_millinear(25) && state["world"]["mana_rescue"]["available"] == true});
        let day = state["world"]["day"]
            .as_u64()
            .context("Missing market day")?;
        if self.player_owned {
            state["environment"]["player_owned"] = json!(true);
            state["environment"]["contract_id"] = json!(id("contract"));
            state["game_session"] = view(
                &self.world.contract,
                &self.world.network,
                "game_session_view",
                json!({}),
            )
            .await?;
        }
        state["customer_need"] = self.recorded_need.clone().unwrap_or(Value::Null);
        state["customer_available"] =
            Value::Bool(self.recorded_need.is_some() && self.served_day != Some(day));
        state["market"] = json!({"source":"cached_jev","tick":self.market_tick,"day_ticks":self.day_ticks,
            "ticks_per_day":10,"tick_seconds":30,"blocked":self.uncertain,"events":self.market_log,
            "needs":market::MERCHANTS.iter().map(|name| self.evidence.need(name,day)).collect::<Vec<_>>()});
        Ok(state)
    }

    async fn nonce(&self, actor: &str) -> Result<u64> {
        view(
            &self.world.contract,
            &self.world.network,
            "account_view",
            json!({"account_id":if actor == "player" { self.world.player_id.clone() } else { id(actor) }}),
        )
        .await?["next_action"]
            .as_u64()
            .context("Missing action nonce")
    }

    async fn execute(&mut self, action: &Action) -> Result<Value> {
        let nonce = self.nonce("player").await?;
        let one = NearToken::from_yoctonear(1);
        let contract = &self.world.contract;
        let network = &self.world.network;
        let signer = &self.world.signer;
        let amount = match action {
            Action::Gather { amount, .. }
            | Action::Brew { amount, .. }
            | Action::Trade { amount, .. }
            | Action::Deliver { amount, .. } => amount.parse::<u128>()?,
            _ => 1,
        };
        ensure!((1..=10).contains(&amount), "Choose 1–10 items");
        match action {
            Action::ChooseAlchemist {
                nickname,
                character_id,
            } => {
                call(
                    contract,
                    network,
                    signer,
                    "player",
                    "choose_alchemist",
                    json!({"nickname":nickname,"character_id":character_id,"nonce":nonce}),
                    one,
                )
                .await
            }
            Action::Deliver { token_id, .. } => {
                call(
                    contract,
                    network,
                    signer,
                    "player",
                    if amount == 1 {
                        "deliver_commission"
                    } else {
                        "deliver_many"
                    },
                    json!({"token_id":token_id,"amount":amount.to_string(),"nonce":nonce}),
                    one,
                )
                .await
            }
            Action::Gather { token_id, .. } => {
                call(
                    contract,
                    network,
                    signer,
                    "player",
                    "gather",
                    json!({"token_id":token_id,"amount":amount.to_string(),"nonce":nonce}),
                    one,
                )
                .await
            }
            Action::Brew { token_id, .. } => {
                call(
                    contract,
                    network,
                    signer,
                    "player",
                    if amount == 1 { "brew" } else { "brew_many" },
                    json!({"token_id":token_id,"amount":amount.to_string(),"nonce":nonce}),
                    one,
                )
                .await
            }
            Action::List { token_id, price } => {
                ensure!(
                    price.parse::<u128>().is_ok(),
                    "Price must be a whole positive number"
                );
                call(
                    contract,
                    network,
                    signer,
                    "player",
                    "list_potion",
                    json!({"token_id":token_id,"price":price,"nonce":nonce}),
                    one,
                )
                .await
            }
            Action::Unlist { token_id } => {
                call(
                    contract,
                    network,
                    signer,
                    "player",
                    "unlist_potion",
                    json!({"token_id":token_id,"nonce":nonce}),
                    one,
                )
                .await
            }
            Action::Trade {
                merchant,
                token_id,
                buy,
                limit,
                ..
            } => {
                ensure!(
                    ["mira", "rowan", "bram"].contains(&merchant.as_str()),
                    "Unknown merchant"
                );
                ensure!(limit.parse::<u128>().is_ok(), "Invalid quote limit");
                call(contract,network,signer,"player","trade",json!({"merchant_id":id(merchant),"token_id":token_id,"amount":amount.to_string(),"buy":buy,"limit":limit,"nonce":nonce}),one).await
            }
            Action::Invest { merchant } => {
                ensure!(
                    ["mira", "rowan", "bram"].contains(&merchant.as_str()),
                    "Unknown merchant"
                );
                call(
                    contract,
                    network,
                    signer,
                    "player",
                    "invest",
                    json!({"merchant_id":id(merchant),"nonce":nonce}),
                    one,
                )
                .await
            }
            Action::Refill => relay_refill(contract, network, signer, nonce, false).await,
            Action::Rescue => relay_refill(contract, network, signer, nonce, true).await,
            Action::NextDay => {
                let receipt = call(
                    contract,
                    network,
                    signer,
                    "owner",
                    "advance_day",
                    json!({}),
                    NearToken::from_yoctonear(0),
                )
                .await?;
                self.day_ticks = 0;
                Ok(receipt)
            }
            Action::MarketTick { tick } => {
                ensure!(
                    *tick == self.market_tick && self.day_ticks < 10,
                    "Stale market turn or day is complete"
                );
                let current = view(contract, network, "game_view", json!({})).await?;
                let day = current["world"]["day"].as_u64().context("Missing day")?;
                let actor = market::MERCHANTS[(self.market_tick % 3) as usize];
                let need = self.evidence.need(actor, day);
                let decision = market::decide(&current, need)?;
                let mut result = json!({"method":"market_idle"});
                if let Some(method) = &decision.method {
                    let mut args = decision.args.clone();
                    args["nonce"] = json!(self.nonce(actor).await?);
                    result = call(contract, network, signer, actor, method, args, one).await?;
                }
                self.market_log.push(
                    json!({"tick":tick,"day":day,"decision":decision,"receipt":result,
                    "source":"cached_jev","model":need.model,"request_sha256":need.request_sha256}),
                );
                if self.market_log.len() > 10 {
                    self.market_log.remove(0);
                }
                self.market_tick += 1;
                self.day_ticks += 1;
                Ok(result)
            }
            Action::ServeCustomer => {
                let need = self
                    .recorded_need
                    .as_ref()
                    .context("Recorded customer sample is unavailable")?;
                ensure!(
                    need["judgment"] == "suitable",
                    "The recorded need does not match this potion"
                );
                let current = view(contract, network, "game_view", json!({})).await?;
                let day = current["world"]["day"].as_u64().context("Missing day")?;
                ensure!(
                    self.served_day != Some(day),
                    "This customer has already visited today"
                );
                let listing = current["listings"]
                    .as_array()
                    .context("Missing shelves")?
                    .iter()
                    .find(|l| l["token_id"] == "healing_tonic")
                    .context("Put a Healing Tonic on a shelf first")?;
                let customer_nonce = self.nonce("customer").await?;
                let receipt=call(contract,network,signer,"customer","buy_listing",json!({"token_id":"healing_tonic","max_price":listing["price"],"nonce":customer_nonce}),one).await?;
                self.served_day = Some(day);
                Ok(receipt)
            }
        }
    }
}

async fn snapshot(
    State(saves): State<Shared>,
    Query(query): Query<WorldQuery>,
) -> Result<Json<Value>, ApiError> {
    let saves = saves.lock().await;
    let game = saves
        .games
        .get(query.world_id.as_ref().unwrap_or(&saves.primary))
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Save unavailable"))?;
    game.snapshot().await.map(Json).map_err(|_| {
        error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Local chain is unavailable; do not repeat pending actions.",
        )
    })
}

async fn operation(
    State(saves): State<Shared>,
    Query(query): Query<WorldQuery>,
    Path(id): Path<String>,
) -> Result<Json<Operation>, ApiError> {
    let saves = saves.lock().await;
    let game = saves
        .games
        .get(query.world_id.as_ref().unwrap_or(&saves.primary))
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Save unavailable"))?;
    game.operations.get(&id).cloned().map(Json).ok_or_else(|| {
        error(
            StatusCode::NOT_FOUND,
            "No operation with that ID in this local world.",
        )
    })
}

async fn act(
    State(game): State<Shared>,
    Json(request): Json<ActionRequest>,
) -> Result<Json<Operation>, ApiError> {
    if !(16..=80).contains(&request.request_id.len())
        || !request
            .request_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid request ID."));
    }
    if let Action::Gather { amount, .. }
    | Action::Brew { amount, .. }
    | Action::Trade { amount, .. }
    | Action::Deliver { amount, .. } = &request.action
    {
        if amount.len() > 2
            || amount
                .parse::<u8>()
                .ok()
                .filter(|n| (1..=10).contains(n))
                .is_none()
        {
            return Err(error(StatusCode::BAD_REQUEST, "Choose 1–10 items"));
        }
    }
    let mut saves = game.lock().await;
    let game = saves.games.get_mut(&request.world_id).ok_or_else(|| {
        error(
            StatusCode::CONFLICT,
            "The local world restarted. Refresh before acting.",
        )
    })?;
    if game.player_owned
        && !matches!(
            request.action,
            Action::ServeCustomer | Action::NextDay | Action::MarketTick { .. }
        )
    {
        return Err(error(
            StatusCode::FORBIDDEN,
            "This action requires the player device signature",
        ));
    }
    if let Some(previous) = game.operations.get(&request.request_id) {
        if previous.action != request.action {
            return Err(error(
                StatusCode::CONFLICT,
                "Request ID already belongs to a different action.",
            ));
        }
        return Ok(Json(previous.clone()));
    }
    if game.uncertain {
        return Err(error(
            StatusCode::CONFLICT,
            "A local transaction has an unresolved outcome. Preserve this world for reconciliation; new writes are paused.",
        ));
    }
    if matches!(request.action, Action::Rescue) {
        let current = game.snapshot().await.map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The guild reserve could not be checked.",
            )
        })?;
        if current["environment"]["rescue_available"] != true {
            return Err(error(
                StatusCode::CONFLICT,
                "The guild rescue is unavailable. Refresh your ledger to check eligibility.",
            ));
        }
    }
    if let Action::MarketTick { tick } = request.action {
        if tick != game.market_tick || game.day_ticks >= 10 {
            return Err(error(
                StatusCode::CONFLICT,
                "Market turn already ran or the day is complete. Refresh the ledger.",
            ));
        }
    }
    // shortcut: this local log holds 256 operations; use durable storage before serving shared worlds.
    if game.operations.len() >= 256 {
        return Err(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "This local session reached its action limit.",
        ));
    }
    game.operations.insert(
        request.request_id.clone(),
        Operation {
            action: request.action.clone(),
            status: "pending".into(),
            result: Value::Null,
            error: None,
        },
    );
    let record = match game.execute(&request.action).await {
        Ok(result) => Operation {
            action: request.action,
            status: "confirmed".into(),
            result,
            error: None,
        },
        Err(err) => {
            // Only send/receipt failures can hide a submitted transaction.
            let failed = err
                .downcast_ref::<alchemy_sandbox::UnconfirmedTransaction>()
                .is_none();
            game.uncertain = !failed;
            eprintln!(
                "Local action {}: {err:#}",
                if failed { "failed" } else { "unconfirmed" }
            );
            Operation{action:request.action,status:if failed {"failed"} else {"unconfirmed"}.into(),result:Value::Null,
                error:Some(if failed {"The action did not complete. Refresh the ledger to check your inventory and any pending or refunded refill."} else {"Action was not confirmed. Refresh the ledger before trying a different action; this request will not be resubmitted."}.into())}
        }
    };
    game.operations.insert(request.request_id, record.clone());
    Ok(Json(record))
}

async fn local_only(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if host
        .strip_prefix("127.0.0.1:")
        .or_else(|| host.strip_prefix("localhost:"))
        .is_none_or(|port| port.parse::<u16>().is_err())
    {
        return error(StatusCode::FORBIDDEN, "Local host required.").into_response();
    }
    let origin = request.headers().get(header::ORIGIN).cloned();
    if origin.as_ref().is_some_and(|value| {
        ![
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:5174",
            "http://localhost:5174",
            "http://127.0.0.1:5175",
            "http://localhost:5175",
            "http://127.0.0.1:5176",
            "http://localhost:5176",
            "http://127.0.0.1:5177",
            "http://localhost:5177",
        ]
        .iter()
        .any(|allowed| value == *allowed)
    }) {
        return error(StatusCode::FORBIDDEN, "Local game origin required.").into_response();
    }
    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    if let Some(origin) = origin {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Origin"));
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET,POST,OPTIONS"),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Content-Type"),
        );
    }
    response
}

fn recorded_need() -> Option<Value> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let record: Value = serde_json::from_slice(
        &std::fs::read(root.join("backend/fixtures/jev-recorded-sample.json")).ok()?,
    )
    .ok()?;
    let fixture: Value =
        serde_json::from_slice(&std::fs::read(root.join("backend/fixtures/jev-probe.json")).ok()?)
            .ok()?;
    if record["status"] != "completed" || record["request"] != fixture {
        return None;
    }
    Some(
        json!({"source":"recorded","model":record["result"]["model"],"recorded_at":record["completed_at"],
        "request_sha256":record["request_sha256"],"probability":record["result"]["probabilities"]["scraped_hand"],
        "judgment":record["decisions"]["scraped_hand"],"text":fixture["questions"]["scraped_hand"]["instructions"]["customer_need"]}),
    )
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("Install local shutdown handler");
        tokio::select! { _=tokio::signal::ctrl_c()=>{}, _=terminate.recv()=>{} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn fresh_game() -> Result<Game> {
    fresh_game_with_key(None).await
}

async fn fresh_game_with_key(public_key: Option<String>) -> Result<Game> {
    let player_owned = public_key.is_some();
    let world =
        LocalWorld::start_with_player_key(NearToken::from_millinear(40), public_key).await?;
    call(
        &world.contract,
        &world.network,
        &world.signer,
        "owner",
        "open_commissions",
        json!({}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    call(
        &world.contract,
        &world.network,
        &world.signer,
        "owner",
        "fund_mana",
        json!({}),
        NearToken::from_near(1),
    )
    .await?;
    let instance = format!(
        "sandbox-{}",
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    );
    Ok(Game {
        world,
        instance,
        operations: BTreeMap::new(),
        recorded_need: recorded_need(),
        served_day: None,
        evidence: market::Evidence::load()?,
        market_tick: 0,
        day_ticks: 0,
        market_log: Vec::new(),
        uncertain: false,
        player_owned,
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    let port = std::env::var("GAME_API_PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse::<u16>()
        .context("Invalid local API port")?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let mut games = BTreeMap::new();
    let primary = if owned::enabled() {
        String::new()
    } else {
        let initial = fresh_game().await?;
        let id = initial.instance.clone();
        games.insert(id.clone(), initial);
        id
    };
    let game = Arc::new(Mutex::new(Saves {
        primary: primary.clone(),
        games,
        requests: BTreeMap::new(),
    }));
    let app = Router::new()
        .route("/api/health", get(|| async { "ready" }))
        .route("/api/owned/new-game", post(owned::new_game))
        .route("/api/owned/rpc", post(owned::rpc))
        .route("/api/owned/mira", post(owned::mira))
        .route("/api/owned/referee", post(owned::referee))
        .route("/api/state", get(snapshot))
        .route("/api/saves", get(saves))
        .route("/api/new-game", post(new_save))
        .route("/api/action", post(act))
        .route("/api/actions/{id}", get(operation))
        .with_state(game)
        .merge(demo::routes())
        .layer(DefaultBodyLimit::max(4096))
        .layer(middleware::from_fn(local_only));
    println!(
        "Local game API ready at http://127.0.0.1:{port}; disposable Sandbox, no live Jev requests."
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
