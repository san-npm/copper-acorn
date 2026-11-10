use near_sdk::{AccountId, PanicOnDefault, collections::LookupMap, env, near, require};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ResultRecord {
    pub match_id: String,
    pub players: [AccountId; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saves: Option<[String; 2]>,
    pub winner: Option<AccountId>,
    pub expected_xp: [u64; 2],
    pub rules: u8,
    pub log_hash: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Progress {
    pub xp: u64,
    pub wins: u64,
    pub losses: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    referee: AccountId,
    results: LookupMap<String, ResultRecord>,
    players: LookupMap<String, Progress>,
}

fn level(xp: u64) -> u32 {
    (1..=20)
        .rev()
        .find(|l| xp >= 20 * ((1u64 << (l - 1)) - 1))
        .unwrap()
}

fn reward(winner: u32, opponent: u32) -> u64 {
    if winner >= 20 {
        return 0;
    }
    let e = opponent.min(winner + 2) - 1;
    let n = 20u64 * 7u64.pow(e);
    let d = 4u64.pow(e);
    n.div_ceil(d)
}

#[near]
impl Arena {
    #[init]
    pub fn new(referee: AccountId) -> Self {
        require!(
            env::predecessor_account_id() == referee,
            "Referee must initialize"
        );
        Self {
            referee,
            results: LookupMap::new(b"r"),
            players: LookupMap::new(b"p"),
        }
    }

    pub fn progress(&self, account_id: AccountId, save_id: Option<String>) -> Progress {
        self.players.get(&progress_key(&account_id, save_id.as_deref())).unwrap_or_default()
    }

    pub fn result(&self, match_id: String) -> Option<ResultRecord> {
        self.results.get(&match_id)
    }

    // This attests to the trusted referee's result; it does not replay or prove the fight.
    pub fn settle_duel(&mut self, result: ResultRecord) -> ResultRecord {
        require!(
            env::predecessor_account_id() == self.referee,
            "Referee only"
        );
        require!(
            result.match_id.len() == 36
                && result.match_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_hexdigit()
                    }
                }),
            "Invalid match ID"
        );
        require!(
            result.rules == 1
                && result.log_hash.len() == 64
                && result.log_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid rules or log hash"
        );
        require!(
            result.players[0] != result.players[1],
            "Distinct players required"
        );
        require!(
            result
                .winner
                .as_ref()
                .is_none_or(|w| result.players.contains(w)),
            "Winner must be a participant"
        );
        if let Some(prior) = self.results.get(&result.match_id) {
            require!(prior == result, "Conflicting result for this match");
            return prior;
        }
        let keys: [String; 2] = std::array::from_fn(|i| progress_key(&result.players[i], result.saves.as_ref().map(|s|s[i].as_str())));
        let mut profiles = keys.clone().map(|p| self.players.get(&p).unwrap_or_default());
        require!(
            profiles[0].xp == result.expected_xp[0] && profiles[1].xp == result.expected_xp[1],
            "Progression changed; reconcile before another ranked duel"
        );
        if let Some(winner) = &result.winner {
            let w = usize::from(winner == &result.players[1]);
            let l = 1 - w;
            profiles[w].xp = profiles[w]
                .xp
                .checked_add(reward(level(profiles[w].xp), level(profiles[l].xp)))
                .expect("XP overflow");
            profiles[w].wins = profiles[w].wins.checked_add(1).expect("Wins overflow");
            profiles[l].losses = profiles[l].losses.checked_add(1).expect("Losses overflow");
        }
        for (id, progress) in keys.iter().zip(profiles.iter()) {
            self.players.insert(id, progress);
        }
        self.results.insert(&result.match_id, &result);
        require!(
            env::account_balance().as_yoctonear()
                >= u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear(),
            "Referee storage reserve exhausted"
        );
        result
    }
}

fn progress_key(account: &AccountId, save: Option<&str>) -> String {
    if let Some(save) = save {
        require!(!save.is_empty() && save.len() <= 80 && save.bytes().all(|b|b.is_ascii_alphanumeric() || b == b'-'), "Invalid save ID");
        format!("{account}/{save}")
    } else { account.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{NearToken, test_utils::VMContextBuilder, testing_env};
    use std::panic::{AssertUnwindSafe, catch_unwind};
    fn context(actor: &str) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("arena.test.near".parse().unwrap())
            .predecessor_account_id(actor.parse().unwrap())
            .account_balance(NearToken::from_near(10));
        testing_env!(b.build());
    }
    #[test]
    fn receipts_are_once_only_scoped_and_survive_a_state_roundtrip() {
        context("referee.test.near");
        let mut a = Arena::new("referee.test.near".parse().unwrap());
        let record = ResultRecord {
            match_id: "10000000-0000-4000-8000-000000000001".into(),
            players: [
                "alice.test.near".parse().unwrap(),
                "bob.test.near".parse().unwrap(),
            ],
            saves: None,
            winner: Some("alice.test.near".parse().unwrap()),
            expected_xp: [0, 0],
            rules: 1,
            log_hash: "a".repeat(64),
        };
        a.settle_duel(record.clone());
        a.settle_duel(record.clone());
        assert_eq!(
            a.progress(record.players[0].clone(),None),
            Progress {
                xp: 20,
                wins: 1,
                losses: 0
            }
        );
        assert_eq!(
            a.progress(record.players[1].clone(),None),
            Progress {
                xp: 0,
                wins: 0,
                losses: 1
            }
        );
        let bytes = near_sdk::borsh::to_vec(&a).unwrap();
        let a: Arena = near_sdk::borsh::from_slice(&bytes).unwrap();
        assert_eq!(a.result(record.match_id.clone()), Some(record.clone()));
        let mut a = a;
        let mut conflict = record.clone();
        conflict.winner = Some(record.players[1].clone());
        assert!(catch_unwind(AssertUnwindSafe(|| a.settle_duel(conflict))).is_err());
        let mut second=record.clone();second.match_id="20000000-0000-4000-8000-000000000002".into();
        second.saves=Some(["save-one".into(),"save-two".into()]);
        a.settle_duel(second.clone());
        assert_eq!(a.progress(second.players[0].clone(),Some("save-one".into())).xp,20);
        assert_eq!(a.progress(second.players[0].clone(),Some("different-save".into())).xp,0);
        assert_eq!(a.progress(second.players[0].clone(),None).xp,20);
        context("alice.test.near");
        assert!(catch_unwind(AssertUnwindSafe(|| a.settle_duel(record))).is_err());
    }
    #[test]
    fn progression_matches_the_game_for_all_levels() {
        for l in 1..=20 {
            assert_eq!(level(20 * ((1u64 << (l - 1)) - 1)), l);
            for o in 1..=20 {
                assert!(reward(l, o) <= 1_000_000);
            }
        }
        assert_eq!(reward(1, 20), 62);
        assert_eq!(reward(20, 20), 0);
    }
}
