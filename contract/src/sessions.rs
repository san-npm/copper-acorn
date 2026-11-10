use super::*;
use near_sdk::PublicKey;

const SESSION: &[u8] = b"player-session-v1";
pub(super) const OWNED: &[u8] = b"player-owned-v1";

#[near(serializers = [json])]
pub struct GameSession {
    pub public_key: PublicKey,
    pub expires_at_ms: u64,
    pub actions_left: u32,
    pub copper_left: U128,
}

impl Alchemy {
    // Zero-deposit calls require a wallet-authorized key, not just the caller's account name.
    pub(super) fn authorize_gameplay(&self, copper: u128) {
        if env::attached_deposit() == NearToken::from_yoctonear(1) {
            return;
        }
        require!(
            env::attached_deposit().is_zero(),
            "Attach zero or one yoctoNEAR"
        );
        self.assert_player();
        require!(
            env::signer_account_id() == self.player_id,
            "Direct player signature required"
        );
        let mut session = self
            .game_session_view()
            .expect("Authorize this device in your wallet first");
        require!(
            session.public_key == env::signer_account_pk(),
            "Device key is not authorized"
        );
        require!(
            env::block_timestamp_ms() < session.expires_at_ms,
            "Device authorization expired"
        );
        require!(session.actions_left > 0, "Device action limit reached");
        require!(
            session.copper_left.0 >= copper,
            "Device spending limit reached"
        );
        session.actions_left -= 1;
        session.copper_left.0 -= copper;
        env::storage_write(SESSION, &near_sdk::serde_json::to_vec(&session).unwrap());
    }
}

#[near]
impl Alchemy {
    pub fn game_session_view(&self) -> Option<GameSession> {
        env::storage_read(SESSION)
            .map(|v| near_sdk::serde_json::from_slice(&v).expect("Invalid session"))
    }

    #[payable]
    pub fn authorize_game_session(
        &mut self,
        public_key: PublicKey,
        expires_at_ms: u64,
        actions: u32,
        copper_limit: U128,
    ) {
        assert_one_yocto();
        self.assert_player();
        require!(
            env::signer_account_id() == self.player_id,
            "Direct player signature required"
        );
        let now = env::block_timestamp_ms();
        require!(
            expires_at_ms > now && expires_at_ms - now <= 86_400_000,
            "Authorize at most 24 hours"
        );
        require!(
            actions > 0 && actions <= 1_000 && copper_limit.0 <= 1_000,
            "Invalid device limits"
        );
        require!(
            public_key != env::signer_account_pk(),
            "Use a separate device key"
        );
        let session = GameSession {
            public_key,
            expires_at_ms,
            actions_left: actions,
            copper_left: copper_limit,
        };
        env::storage_write(SESSION, &near_sdk::serde_json::to_vec(&session).unwrap());
        // An upgrade authority could bypass player ownership; this is deliberately irreversible.
        env::storage_write(OWNED, &[1]);
    }

    #[payable]
    pub fn revoke_game_session(&mut self) {
        assert_one_yocto();
        self.assert_player();
        env::storage_remove(SESSION);
    }
}
