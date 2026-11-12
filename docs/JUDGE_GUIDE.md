# Try Copper Acorn

Copper Acorn is a pixel-art alchemy shop game with turn-based player duels, built for **Games With Real Economies** (`games`). Run a shop, supply the town and take your character into the arena.

[Hosted game](https://bafybeiaps7mv4ote6v2hlu6okemli63rpqqxb5y6nublenxrino77d6ehe.ipfs.aleph.sh/) · [Recorded demo](demo/demo-near-hack.mp4) · [Verification](VERIFICATION.md)

## Run the local demo

Use Node **24+**, npm and Rust/rustup on macOS/Linux, or WSL. No account, API key, purchase or mainnet funds are needed. This route runs the current contracts in an isolated NEAR Sandbox.

```sh
npm ci
cargo build --locked -p briarbridge-alchemy -p briarbridge-arena --target wasm32-unknown-unknown --release
cargo build --locked -p alchemy-sandbox --bin game-api
npm run dev:ownership
```

Open **http://127.0.0.1:5181/?owned=1**. If the default ports are occupied, run `GAME_API_PORT=3903 GAME_WEB_PORT=5183 npm run dev:ownership` and open `http://127.0.0.1:5183/?owned=1`.

## Actions and expected results

1. **Create a game.** Choose a character and nickname. Each save keeps its own identity and shop.
2. **Brew a Healing Tonic.** Open Cauldron and brew using the starting ingredients. The recipe consumes ingredients and one Copper: the starting balance changes from **40 to 39**.
3. **Complete a sale.** Put the tonic on a shelf for **13 Copper**, open Customers and serve the gardener. Copper reaches **52**, and the sold tonic leaves the player's inventory. Reload to check persistence while this Sandbox is running.
4. **Read the guild letter.** The first crafted sale starts the potion commissions: two Focus Draughts, then one Restoration Elixir. Mira's tonic order and Rowan's water order are optional side quests.
5. **Inspect merchant trading.** Visit a merchant, open “Why this price?”, then buy or sell a quantity. Check the quoted price, stock and Copper changes. The shared pricing rule is in [economy.rs](../contract/src/economy.rs).
6. **Advance the market.** Start the market in the ledger. Ten merchant turns advance the in-game day and replenish gathering allowances. Reloading does not reset the day.
7. **Practise combat.** Walk through the portal, click the chicken and choose Fight. Test movement and skills, then stop training. The chicken does not attack and training awards no XP.

## Check player duels

Open the same local URL in two independent browser profiles or contexts. Create a different saved game in each and enter the arena. Click the other character to send a challenge, then accept it from the invited player.

Move on the grid and cast skills within their action-point, range and line-of-sight limits. Turns last **60 seconds** and pass automatically when time expires. Combat ends at zero health. Each of the eight classes has three skills; levels are capped at 20. Items and Copper are not staked.

The game server validates turns and attests the result. The referee contract records that result and its progression award once. The [automated ownership tests](../web/tests/player-ownership.spec.ts) exercise actual Sandbox contracts; the browser suites also cover challenge, reconnect and timeout paths. This does not establish human playtest quality or production capacity.

## NEAR and service boundaries

- **Item contract:** NEP-245 balances for ingredients, potions and Copper; validates crafting, sales, merchant trades, investments and quest payments. Each saved world has its own economy.
- **Referee contract:** records approved player-duel results and progression. Training grants no XP.
- **Game services:** handle identity, saves, deterministic combat, durable requests and NPC/referee actions.
- **Jev:** interprets Mira's conversation intent when a server-side allowance is available. Application rules control goods and payments. Local authored choices require no live model requests.

The local demo uses disposable browser-held keys, with no social recovery. Hosted shops use NEAR testnet; older shops retain their original keys and contract versions. Google authorization startup and setup-message handling pass on the current hosted build. Completed first-time creation/signing and recovery still need a real-user retest. [Onboarding](ONBOARDING.md) explains that boundary and the hosted limits.

See the [requirements checklist](HACKATHON_CHECKLIST.md) and [security self-review](RELEASE_REVIEW.md). The project has not been submitted to the organizers.
