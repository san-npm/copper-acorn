use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const MERCHANTS: [&str; 3] = ["mira", "rowan", "bram"];
const POTIONS: [&str; 3] = ["healing_tonic", "focus_draught", "restoration_elixir"];

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Need {
    pub merchant: String,
    pub slot: u64,
    pub text: String,
    pub model: String,
    pub recorded_at: String,
    pub request_sha256: String,
    pub probabilities: BTreeMap<String, f64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub source: String,
    pub cases: Vec<Need>,
}

impl Evidence {
    pub fn load() -> Result<Self> {
        Self::parse(include_str!(
            "../../backend/fixtures/merchant-evidence.json"
        ))
    }
    pub fn parse(text: &str) -> Result<Self> {
        let evidence: Self = serde_json::from_str(text)?;
        ensure!(
            evidence.source == "cached_jev" && evidence.cases.len() == 9,
            "Invalid merchant evidence"
        );
        for merchant in MERCHANTS {
            for slot in 0..3 {
                let entries: Vec<_> = evidence
                    .cases
                    .iter()
                    .filter(|n| n.merchant == merchant && n.slot == slot)
                    .collect();
                ensure!(entries.len() == 1, "Missing or duplicate merchant need");
                let need = entries[0];
                ensure!(
                    !need.text.is_empty()
                        && need.text.len() <= 1000
                        && !need.model.is_empty()
                        && !need.recorded_at.is_empty(),
                    "Invalid evidence metadata"
                );
                ensure!(
                    need.request_sha256.len() == 64
                        && need.request_sha256.bytes().all(|c| c.is_ascii_hexdigit()),
                    "Invalid evidence hash"
                );
                ensure!(
                    need.probabilities.len() == 3
                        && POTIONS.iter().all(|id| need
                            .probabilities
                            .get(*id)
                            .is_some_and(|p| p.is_finite() && (0.0..=1.0).contains(p))),
                    "Invalid probabilities"
                );
            }
        }
        Ok(evidence)
    }
    pub fn need(&self, merchant: &str, day: u64) -> &Need {
        self.cases
            .iter()
            .find(|n| n.merchant == merchant && n.slot == day % 3)
            .expect("Validated merchant profile")
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Decision {
    pub merchant: String,
    pub method: Option<String>,
    pub args: Value,
    pub reason: String,
    pub probability: Option<f64>,
}

fn amount(value: &Value) -> Result<u128> {
    value
        .as_str()
        .context("Missing token amount")?
        .parse()
        .context("Invalid token amount")
}

pub fn decide(state: &Value, need: &Need) -> Result<Decision> {
    let merchants = state["merchants"].as_array().context("Missing merchants")?;
    let actor = merchants
        .iter()
        .find(|m| {
            m["name"]
                .as_str()
                .is_some_and(|name| name.to_lowercase() == need.merchant)
        })
        .context("Unknown merchant")?;
    let day = state["world"]["day"].as_u64().context("Missing day")?;
    let mut decision = Decision {
        merchant: need.merchant.clone(),
        method: None,
        args: json!({}),
        reason: String::new(),
        probability: None,
    };
    let mut idle = |reason: &str| {
        decision.reason = reason.into();
        decision.clone()
    };
    if actor["open"] != true {
        return Ok(idle("Stall closed: no Copper. An investment is needed."));
    }
    if actor["account"]["last_consume_day"].as_u64() == Some(day) {
        return Ok(idle("Today's customer need is already fulfilled."));
    }
    let Some((potion, probability)) = need
        .probabilities
        .iter()
        .filter(|(_, p)| **p > 0.7)
        .max_by(|a, b| a.1.total_cmp(b.1))
    else {
        return Ok(idle(
            "No potion has a suitability score above 0.70; keep funds.",
        ));
    };
    decision.probability = Some(*probability);
    let balances = &actor["account"]["balances"];
    let copper = amount(&balances["copper"])?;
    let catalog = state["catalog"].as_array().context("Missing catalog")?;
    let item = catalog
        .iter()
        .find(|i| i["token_id"] == *potion)
        .context("Unknown potion")?;
    let value = amount(&item["base_value"])?;
    let (method, args, reason) = if amount(&balances[potion])? > 0 {
        (
            "consume",
            json!({"token_id":potion,"amount":"1"}),
            "Use one owned potion to fulfil today's request.",
        )
    } else if let Some(listing) = state["listings"]
        .as_array()
        .context("Missing shelves")?
        .iter()
        .find(|l| {
            l["token_id"] == *potion
                && amount(&state["player"]["balances"][potion]).is_ok_and(|stock| stock > 0)
                && amount(&l["price"]).is_ok_and(|p| p > 0 && p <= copper && p <= value * 12 / 10)
        })
    {
        (
            "buy_listing",
            json!({"token_id":potion,"max_price":listing["price"]}),
            "Buy a suitable potion from the player's shelf within budget and 120% of base value.",
        )
    } else {
        let recipe = item["recipe"].as_array().context("Missing recipe")?;
        let fee = amount(&state["craft_fee"])?;
        let ready = recipe.iter().all(|input| {
            amount(&balances[input["token_id"].as_str().unwrap_or("")])
                .is_ok_and(|stock| amount(&input["amount"]).is_ok_and(|required| stock >= required))
        });
        if ready && copper >= fee && actor["account"]["last_brew_day"].as_u64() != Some(day) {
            (
                "brew",
                json!({"token_id":potion}),
                "Brew from owned ingredients and pay the craft fee; one brew per merchant per day.",
            )
        } else {
            let mut cheapest: Option<(u128, String, String)> = None;
            for input in recipe {
                let token = input["token_id"].as_str().context("Missing ingredient")?;
                if amount(&balances[token])? >= amount(&input["amount"])? {
                    continue;
                }
                for seller in merchants.iter().filter(|m| {
                    m["account"]["account_id"] != actor["account"]["account_id"]
                        && m["open"] == true
                }) {
                    for quote in seller["quotes"]
                        .as_array()
                        .context("Missing quotes")?
                        .iter()
                        .filter(|q| q["token_id"] == token)
                    {
                        let price = amount(&quote["merchant_sells_at"])?;
                        if amount(&quote["stock"])? > 0
                            && price < copper
                            && price <= value
                            && cheapest.as_ref().is_none_or(|(best, _, _)| price < *best)
                        {
                            cheapest = Some((
                                price,
                                seller["account"]["account_id"]
                                    .as_str()
                                    .context("Missing seller")?
                                    .into(),
                                token.into(),
                            ));
                        }
                    }
                }
            }
            if let Some((price, seller, token)) = cheapest {
                (
                    "trade",
                    json!({"merchant_id":seller,"token_id":token,"amount":"1","buy":true,"limit":price.to_string()}),
                    "Buy one missing ingredient at the cheapest available contract quote; retain at least one Copper.",
                )
            } else {
                decision.reason = "No affordable suitable shelf offer or available recipe ingredient; keep funds.".into();
                return Ok(decision);
            }
        }
    };
    decision.method = Some(method.into());
    decision.args = args;
    decision.reason = reason.into();
    Ok(decision)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_cases_match_the_hosted_planner() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../backend/fixtures/merchant-policy-cases.json"
        ))
        .unwrap();
        let evidence = Evidence::load().unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let mut state = fixture["base"].clone();
            for patch in case["patches"].as_array().unwrap() {
                *state.pointer_mut(patch["path"].as_str().unwrap()).unwrap() =
                    patch["value"].clone();
            }
            let mut need = evidence.need("mira", 0).clone();
            if let Some(probabilities) = case.get("probabilities") {
                need.probabilities = serde_json::from_value(probabilities.clone()).unwrap();
            }
            let result = decide(&state, &need).unwrap();
            assert_eq!(
                json!({"method":result.method,"args":result.args,"probability":result.probability}),
                case["expected"],
                "{}",
                case["name"]
            );
        }
    }
    fn state() -> Value {
        json!({"world":{"day":0},"player":{"balances":{"healing_tonic":"1"}},"craft_fee":"1","catalog":[{"token_id":"healing_tonic","base_value":"12","recipe":[{"token_id":"sunleaf","amount":"2"}]}],
        "listings":[{"token_id":"healing_tonic","price":"13"}],"merchants":[{"name":"Mira","open":true,"account":{"account_id":"mira","balances":{"copper":"61","healing_tonic":"0","sunleaf":"2"},"last_brew_day":null,"last_consume_day":null},"quotes":[]}]})
    }
    #[test]
    fn cached_scores_never_override_budget_closure_or_daily_limit() {
        let evidence = Evidence::load().unwrap();
        let need = evidence.need("mira", 0);
        let mut s = state();
        assert_eq!(
            decide(&s, need).unwrap().method.as_deref(),
            Some("buy_listing")
        );
        s["listings"][0]["price"] = json!("9999");
        assert_eq!(decide(&s, need).unwrap().method.as_deref(), Some("brew"));
        s["listings"][0]["price"] = json!("13");
        s["player"]["balances"]["healing_tonic"] = json!("0");
        assert_eq!(decide(&s, need).unwrap().method.as_deref(), Some("brew"));
        s["merchants"][0]["account"]["last_brew_day"] = json!(0);
        assert!(decide(&s, need).unwrap().method.is_none());
        s["merchants"][0]["account"]["balances"]["healing_tonic"] = json!("1");
        assert_eq!(decide(&s, need).unwrap().method.as_deref(), Some("consume"));
        s["merchants"][0]["account"]["last_consume_day"] = json!(0);
        assert!(decide(&s, need).unwrap().method.is_none());
        s["merchants"][0]["open"] = json!(false);
        assert!(decide(&s, need).unwrap().method.is_none());
        let mut uncertain = need.clone();
        uncertain.probabilities.values_mut().for_each(|p| *p = 0.7);
        assert!(decide(&state(), &uncertain).unwrap().method.is_none());
    }
    #[test]
    fn malformed_or_duplicate_evidence_is_rejected() {
        let text = include_str!("../../backend/fixtures/merchant-evidence.json");
        let mut v: Value = serde_json::from_str(text).unwrap();
        v["cases"][0]["probabilities"]["healing_tonic"] = json!(1.1);
        assert!(Evidence::parse(&v.to_string()).is_err());
        v["cases"][0] = v["cases"][1].clone();
        assert!(Evidence::parse(&v.to_string()).is_err());
    }
}
