# Try Copper Acorn

Copper Acorn is an alchemy shop prototype for Games With Real Economies (`games`). Gather ingredients, brew potions, set a shelf price and sell actual stock. Three merchants have separate balances and inventories; their stock and recent consumption change prices.

## Free reproducible route

Use Node24+, npm and Rust/rustup on macOS/Linux, or WSL. No account, API key, purchase or mainnet funds are needed.

```sh
npm ci
cargo build --locked -p briarbridge-alchemy -p briarbridge-arena --target wasm32-unknown-unknown --release
cargo build --locked -p alchemy-sandbox --bin game-api
npm run dev:ownership
```

Open `http://127.0.0.1:5181/?owned=1`. If these ports are occupied, use `GAME_API_PORT=3903 GAME_WEB_PORT=5183 npm run dev:ownership` and open `http://127.0.0.1:5183/?owned=1`.

1. Create a new game. Choose a character and nickname; both stay with that game.
2. Open the Cauldron and brew a Healing Tonic. Its recipe consumes ingredients and one Copper.
3. Put it on a shelf for 13 Copper. Open Customers and serve the gardener. Starting Copper moves 40→39→52; the tonic leaves your inventory. Reload to confirm persistence while this Sandbox is running.
4. Read the guild letter. The main commission progresses through the first crafted sale, Focus Draught trial and Restoration Elixir delivery. Mira's and Rowan's orders are separate side quests.
5. Visit a merchant. Read “Why this price?”, trade a chosen quantity and inspect the actual stock/balance changes. The price rule is `contract/src/economy.rs`.
6. Run the market from the ledger. Ten merchant turns advance its in-game day and replenish gathering. Reopening the page does not reset the day.
7. Walk through the courtyard portal. Click the chicken, then Fight, to test skills; stop training whenever you want. Training has no XP or retaliation.

## Two-player arena

Open the same local URL in two independent browser profiles or contexts. Create different saved games and enter the arena in each. Click the other player, send a challenge and accept it from the invited player. Each turn has 60 seconds; movement uses grid cells and skills use AP, range and line-of-sight rules. Combat ends at zero health. Items and Copper are not staked.

The two-browser and ownership test suites exercise challenges, movement, casting, reconnect, timeout, completion and once-only progression. They are automated players, not a human usability or load study. The referee contract records the server-attested result; it does not replay the fight independently.

## What runs where

| Component | Role |
| --- | --- |
| NEAR item contract | NEP-245 item balances, crafting, sales, merchant trades, investments and funded quest orders; one contract per saved world. |
| Arena referee contract | Once-only PvP result/progression records. Training grants no XP. |
| Game service | Validates identity and requests, runs deterministic combat, keeps durable operation records and submits NPC/referee actions. |
| Jev | Classifies free-text NPC intent when a server-side allowance is available. Code controls goods, prices and payments. Authored choices/recorded judgments support free repeatable checks. |

The local route uses actual contracts on an isolated Sandbox, not public testnet receipts. Its browser-held signing keys are for a disposable local game and have no social recovery. Hosted older shops use NEAR testnet and retain their original immutable contract versions. The local route exercises the current contracts. The public Google/Privy app now allows the exact hosted origin, and Google authorization startup was checked. Completed first-time provisioning/signing and recovery remain unverified; existing hosted saves are preserved. Do not share an owner's login to let judges in.

## Checks and limitations

See [release verification](VERIFICATION.md), [security self-review](RELEASE_REVIEW.md), [onboarding](ONBOARDING.md) and the [hackathon checklist](HACKATHON_CHECKLIST.md).

There is no player-to-player item market, combat stake, proven class balance, production load benchmark, NEAR Intents integration or seven-day game ending. The example fast-forward feature was removed by product choice; the official integration hints are optional. Nothing has been submitted to the organizers.
