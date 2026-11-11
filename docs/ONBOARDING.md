# Google access with Privy

The owner selected Privy on 10 November 2026. The integration is included in the public source; live Google consent, root signing and recovery still need verification before public activation. Earlier hosted shops keep their existing keys and assets. No automatic custody migration is performed.

## Verified state

As of 11 November, the provider reports Google enabled and an empty `allowed_domains` list. The onboarding follow-up includes the existing public Privy App ID. Before initialization, the client requires Google enabled and the exact current origin in that list; no root signing starts while configuration is missing. Failed checks can retry in-page after configuration is saved. Browser fixtures cover creation, cancellation, exact-request recovery, identity rejection and two-browser replacement; they do not establish real Google consent or provider signatures. Do not mark first-time onboarding complete from an automatically restored older shop.

## Setup

1. Use the existing Copper Acorn Privy application; Google is already enabled. Keep paid upgrades, billing and automatic top-ups off. Use user-controlled wallet mode; do not add an application signer or developer-owned wallets.
2. Under Configuration → App settings → Domains, set allowed origins to the exact published game origin and `http://127.0.0.1:5194`. Use exact origins, not a wildcard shared IPFS gateway. Keep HttpOnly app-domain cookies disabled for this static hosting setup. A separate Web client is optional; the real browser SDK's default client was verified to initialize and start Google authorization with the App ID alone.
3. Copy the public App ID. **No Privy app secret or token-verification public key is used.** For a local test, put these public settings in the ignored `web/.env.privy-local`:

   ```dotenv
   VITE_PUBLIC_PRIVY_APP_ID=your_public_app_id
   VITE_PUBLIC_PLAYER_OWNERSHIP=true
   VITE_PUBLIC_LOCAL_SANDBOX=false
   ```

   Also copy the two public Supabase settings from `deploy/public-env.json` into that file. Run `npm run dev -- --mode privy-local --port 5194`. A separately configured Web client may use `VITE_PUBLIC_PRIVY_CLIENT_ID`. Never put server credentials in any `VITE_PUBLIC_` setting.
4. After saving the allowed origin, retry New game at that published address. The client checks current configuration without a rebuild. Test first setup, cancellation, another-browser recovery, renewal and normal play. `deploy/public-env.json` includes only public settings; use the existing GitHub → Stasho workflow for updates. A new CID requires exact-origin updates in Supabase and Privy; a stable domain avoids that repetition.

Without an App ID, existing saved games remain available and new social games remain disabled. Do not enable public onboarding merely because a build passes.

## Authority and signing

The existing Supabase Google session protects saved-game and arena APIs. Privy's own Google authentication protects the player's root signer. The client checks the Google account's stable subject in both sessions. Email alone or a backend-issued token is not proof of player authority. Initial setup may require a second Google authorization.

`web/src/privy.ts` uses pinned `@privy-io/js-sdk-core` and its browser Ed25519 provider, exposed under its Solana interface. It signs the NEP-413 challenge digest and serialized NEAR transaction digests, verifies the returned signatures, and broadcasts only to NEAR testnet. No Solana account, transaction, funding or network call is involved. The backend verifies the proof's nonce, origin, session, owner, expiry and signature. Before first funding, only the exact implicit account derived from that proven key may bypass the account-exists check. Other lookup failures are rejected.

The game does not receive a root private key or Privy authorization key. Normal actions use a non-exportable browser key in IndexedDB, limited to the selected contract, thirteen gameplay methods, 500 actions, 100 Copper and less than 24 hours. Gas allowance is capped at 0.1 testnet NEAR. Renewal uses the root signer; normal gathering, crafting and selling do not call Privy. Another browser restores the same root through Privy and replaces the earlier limited key for that save. There is one active game session per save.

Setup saves exact signatures and signed transaction bytes before sending. An unknown result is checked using the same hash and bytes, without a fresh signature. Pending economic actions block device replacement. Same-browser root setup is serialized with Web Locks. A permanently unconfirmable root request remains pending instead of guessing whether it executed.

These guarantees depend on the Google account, Privy's user-controlled configuration and the browser. No independent custody certification or completed real-user recovery test is claimed.

## Free limits and checks

Privy's published Developer free allowance is 0–499 monthly active users and 50,000 monthly signatures. Signature usage is a separate limit; 499 users alone does not guarantee zero charges. Keep billing upgrades disabled and check the provider's usage dashboard. The app uses root signatures during setup/recovery/renewal, rather than every game action. It does not implement a provider-wide usage meter or override Privy's billing settings.

The existing allocation cap is ten hosted worlds including older wallets, with two new player-owned slots per Google account. Each development world also has a 1,000-operation economic journal and128NPC-request allowance; the shared arena retains 128 profiles and 256 PvP matches. That is separate from Privy's allowance. Testnet funding and provider availability can also prevent setup.

Run `npx playwright test --config playwright.privy.config.ts` for isolated fixtures covering the actual SDK import, ownership proofs, lost acknowledgements, non-exportable keys, normal action signing, renewal, two-browser restoration, identity changes, callback rejection, iframe boundaries and the saved-game controller. These tests use fictional identities and no paid signatures. Real consent, recovery and provider configuration must still be exercised before calling this complete.

Primary references: [vanilla SDK](https://docs.privy.io/recipes/core-js), [chain integration](https://docs.privy.io/recipes/tier-2-wallet-integration), [authenticated signers](https://docs.privy.io/security/authentication/authenticated-signers), [app clients](https://docs.privy.io/basics/get-started/dashboard/app-clients), [pricing](https://www.privy.io/pricing). Privy describes its vanilla SDK as low-level and recommends discussing the integration with its team; no team approval or production certification is claimed.

The earlier NEAR Auth attempt is historical: its shared client rejected the callback and its published browser API lacked the required message signer. The authorized [support request](https://github.com/Peersyst/fast-auth/issues/132) remains separate from this integration.
