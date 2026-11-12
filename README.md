# Copper Acorn

A pixel-art browser game about running an alchemy shop and fighting turn-based duels. Built for **NEAR HACKATHON — Games With Real Economies** (`games`).

You inherit a shop in Briarbridge. Gather ingredients, brew potions, choose your selling prices and supply the town. Merchant stock and budgets affect what you can buy and sell. Between orders, enter the shared arena to practise skills or challenge another player.

[Play](https://bafybeiaps7mv4ote6v2hlu6okemli63rpqqxb5y6nublenxrino77d6ehe.ipfs.aleph.sh/) · [Demo on X](https://x.com/3615crypto/status/2120878487804289264) · [Video file](docs/demo/demo-near-hack.mp4) · [Judge walkthrough](docs/JUDGE_GUIDE.md)

## What you can do

- **Choose your alchemist.** Pick one of eight characters and a nickname. Each save keeps its character, shop and progress. Characters share alchemy recipes and have different combat skills.
- **Gather and craft.** Harvest herbs, collect spring water, tap wood essence and mine silver dust. Brew Healing Tonics, Focus Draughts and Restoration Elixirs. Select quantities for repeated tasks.
- **Run your shop.** Display potions on two shelves, set prices and serve buyers. Listing reserves the goods; serving a buyer completes the sale and pays Copper.
- **Trade with NPCs.** Buy and sell with Mira, Rowan and Bram. Their stock and budgets affect their prices. Read the explanation behind a quote, or contribute working capital to reopen a closed stall.
- **Complete quests.** Brew and sell a tonic to begin the guild's potion commissions. Mira's tonic order and Rowan's water order are optional side quests. Trading continues after the story objectives.
- **Fight other players.** Enter the arena through the portal, send a challenge, move on a grid and use three class skills. Turns last 60 seconds; combat ends at zero health. Levels are capped at 20, with no item or Copper stakes.

The passive training chicken lets you test skills without retaliation or XP rewards. You can stop training whenever you want. [Gameplay details](docs/GAMEPLAY.md).

## How the economy works

Copper is the shop currency. Brewing consumes recipe ingredients and a Copper fee; a completed sale transfers goods and payment. Each merchant has a separate inventory and balance. Prices respond to stock and recent demand, so a quoted price can change as the market changes.

Start the market from the ledger: ten merchant turns advance the in-game day and replenish gathering allowances. Reloading does not reset them. Each saved shop has its own economy; the arena is shared.

## What NEAR does

The prototype uses **NEAR testnet** for hosted shops and an isolated **NEAR Sandbox** locally. Contracts enforce inventories and payments and keep records of approved duel results.

| Part | Implementation |
| --- | --- |
| Ingredients, potions and Copper | One [NEP-245 multi-token contract](contract/src/lib.rs) per saved world holds every item type and its balances. |
| Crafting, sales and NPC trades | The item contract checks recipes, stock, balances and transfers, including quest payments and merchant investment. |
| Merchant prices | Quotes and trades share [one readable pricing file](contract/src/economy.rs). The game explains the stock and demand factors behind a quote. |
| Player duel results | A [separate referee contract](arena-contract/src/lib.rs) records each approved PvP result and its progression award once. The game server runs combat and attests the result. |

Movement, combat and conversation run outside the blockchain. Stasho hosts the website; Supabase handles hosted accounts and services. Privy supports new-game signing. Jev interprets Mira's messages when a server-side allowance is available; application rules control orders and payments. Local NPC choices need no live model requests.

## Try it locally — free, no API keys

Use Node **24+**, npm and Rust/rustup on macOS or Linux, or WSL on Windows. The repository pins the Rust toolchain and WebAssembly target.

```sh
npm ci
cargo build --locked -p briarbridge-alchemy -p briarbridge-arena --target wasm32-unknown-unknown --release
cargo build --locked -p alchemy-sandbox --bin game-api
npm run dev:ownership
```

Open **http://127.0.0.1:5181/?owned=1** and create a game. Starting ingredients let you brew a Healing Tonic: Copper changes **40 → 39**. List it for **13 Copper**, then open Customers and serve the gardener: Copper reaches **52** and the sold tonic leaves your inventory. Follow the [judge walkthrough](docs/JUDGE_GUIDE.md) to check quests, merchant prices and two-player combat.

The local demo runs actual contracts with disposable browser-held keys. Its saves are separate from hosted Google accounts and remain available while that Sandbox runs. The walkthrough includes port overrides.

## Verification and current limits

Automated checks cover crafting, sales, quests, merchant rules, two-player combat, reconnect and once-only result recording. Hosted setup-message handling and Google authorization startup pass. **Completed first-time Google game creation, signing and recovery still need a real-user retest.** Earlier hosted saves retain their original backend-held keys and contract versions. See [verification](docs/VERIFICATION.md) and [onboarding](docs/ONBOARDING.md).

Player-to-player item trading is not implemented. Class balance and concurrent-player capacity need human playtests and load testing. Hosted testing has finite save, action and conversation allowances, listed in the onboarding guide.

## Development checks

```sh
npm test
npm run build
cargo test --locked -p briarbridge-alchemy -p briarbridge-arena --lib
```

After contract changes, rebuild WebAssembly and run `node scripts/bundle-contract.ts`. See [browser test commands](docs/VERIFICATION.md#repeat-the-checks), the [security self-review](docs/RELEASE_REVIEW.md) and [vulnerability reporting](SECURITY.md).

## Hackathon information

Started in November 2026 during the [hackathon's eligible period](https://nearhackathon.com/HACKATHON.md). See the [submission draft](docs/SUBMISSION.md) and [requirements checklist](docs/HACKATHON_CHECKLIST.md). The project has not been submitted.

Built with AI coding assistance using NEAR SDK, Phaser, Supabase, Privy and TypeSafe/Jev. Dependencies are pinned. [Credits](docs/ASSET_CREDITS.md) list third-party material; builds use the committed game assets.

Project code is licensed under [Apache-2.0](LICENSE). Deployment instructions are in the [GitHub → Stasho guide](docs/STASHO.md).
