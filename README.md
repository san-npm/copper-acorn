# Copper Acorn

A pixel-art alchemy shop prototype for **NEAR Hackathon — Games With Real Economies**. Gather ingredients, brew potions and sell them from your shop or trade with NPC merchants. Each merchant has its own wallet and inventory; stock and consumption affect prices.

Includes a guild quest chain, two side orders, and a shared arena with eight classes, turn-based duels and a passive training chicken.

[Play the hosted build](https://bafybeif4dj4wtc6feoiws4qt7oevbhc5o6s7gikcjz4fwvhozqsjqru6kq.ipfs.aleph.sh/) · [Release checks](docs/VERIFICATION.md)

## Where NEAR fits

- One NEP-245 multi-token contract per saved world holds ingredients, potions and Copper. Contracts validate recipes, inventories, purchases and merchant investment.
- Merchant pricing lives in [one Rust file](contract/src/economy.rs). The interface explains the actual stock and demand factors.
- A separate referee contract records once-only PvP results and progression. Movement and combat turns run on the game server.
- Jev classifies NPC conversation intent; code limits orders and payments. Recorded merchant judgments support repeatable tests without model credits.

This uses NEAR testnet and local Sandbox. No NEAR Intents integration or real-money economy is claimed.

## Run locally — free, no API keys

Requires Node **24+**, npm, and Rust/rustup. The pinned Rust toolchain installs the WebAssembly target. The local node runs on macOS/Linux; use WSL on Windows.

```sh
npm ci
cargo build --locked -p briarbridge-alchemy -p briarbridge-arena --target wasm32-unknown-unknown --release
cargo build --locked -p alchemy-sandbox --bin game-api
npm run dev:ownership
```

Open **http://127.0.0.1:5181/?owned=1**. Create a game, choose an alchemist and nickname, brew a Healing Tonic, list it and serve its buyer. Walk through the portal and click the chicken to train. Local saves belong to this running disposable Sandbox; they are separate from hosted Google accounts.

The approved character and action sheets are included and pinned in `deploy/approved-art.json`. Builds verify their hashes and need no artwork downloads or model credits. The retired redraw scripts refuse to overwrite them. Character artwork has third-party licensing restrictions; see [asset credits](docs/ASSET_CREDITS.md).

## Check the code

```sh
npm test
npm run build
cargo test --locked -p briarbridge-alchemy -p briarbridge-arena --lib
npx playwright install chrome
npx playwright test web/tests/arena-recovery.spec.ts
npx playwright test --config playwright.privy.config.ts
```

Embedded backend WebAssembly modules are included for Node tests and Edge Function packaging. After changing a contract, rebuild the WebAssembly targets and run `node scripts/bundle-contract.ts`.

## Current limits

Google login restores existing hosted shops. A [Privy integration](docs/ONBOARDING.md) for new player-owned games is prepared locally; live social setup and recovery remain unverified and gated pending provider configuration. Existing older shops still use their original backend-held keys. The local ownership demo uses browser-held keys. No completed migration is claimed.

Each save has its own economy; player-to-player trading is not implemented. Mira's dynamic conversation path depends on configured provider access and a finite request budget. Class balance and large-scale multiplayer load are not established.

The hosted build includes the responsive walking correction and deploys from GitHub through Stasho. Backend origin/Auth settings still need an exact-URL update when a new build changes the CID.

## Project notes

- [Gameplay loop](docs/GAMEPLAY.md)
- [Hackathon requirements and gaps](docs/HACKATHON_CHECKLIST.md)
- [GitHub → Stasho setup](docs/STASHO.md)
- [Security reporting](SECURITY.md)

Started during the hackathon development window, in November 2026. Built with AI coding assistance, NEAR SDK, Phaser, Supabase, Privy and TypeSafe/Jev; lockfiles pin dependencies. This public snapshot omits private development logs, credentials and original third-party art packs.

Original project code is licensed under **Apache-2.0**. Third-party artwork, font and dependency terms remain separate; see [credits](docs/ASSET_CREDITS.md). Contributions are welcome through small pull requests with relevant checks.
