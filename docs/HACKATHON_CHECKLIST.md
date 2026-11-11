# NEAR Hackathon check — 11 November 2026

Sources: [official rules](https://nearhackathon.com/HACKATHON.md), [Games track](https://nearhackathon.com/#tracks), [example prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md).

The official rules say the track hints/integrations and example prompts are optional (Q-011). Testnet-only entries qualify (Q-010). This is a requirements review, not certification or a submission.

| Official requirement | Evidence / remaining work |
| --- | --- |
| A working NEAR prototype fitting the track | Economy contract, NPC merchant wallets, stock/demand prices, crafting/sales and funded orders. Local Sandbox and Node checks cover the rules. |
| Work within the eligible period | Project work began in November 2026. The official window starts 19 October and ends 14 November 2026 at 23:59 UTC (Q-001). |
| Public repository, reproducible README, license | This repository, lockfiles, local commands, CI and Apache-2.0 license. Public export excludes keys/private source packs. |
| Disclose templates/libraries/AI assistance | README and asset credits identify dependencies and generated/original artwork. |
| Respect third-party rights | **Unresolved.** The owner requested the approved Mana Seed-derived character/action sheets be restored and published. The publisher excludes Web3/GenAI projects and restricts redistribution. This restoration does not clear those rights; see `ASSET_CREDITS.md`. |
| Public demo post on X | **Pending; the owner must publish it.** It must identify NEAR HACKATHON, tag @NEARProtocol and #NEARHackathon, and include a video/screenshots. A local-only demo requires video (Q-012). |
| Submit repository and demo-post links before deadline | **Not submitted or authorized by this task.** Team/contact details, the owner's mainnet payout account and consent are still submission inputs. No mainnet deployment is required for this prototype. |
| Public repo through judging; independent projects disclosed | Keep it public through judging. Each person may submit up to two independent projects; if another entry exists, both READMEs must name it (Q-015). No second entry is asserted here. |

## Example prompt and product choices

| Example feature | Current implementation |
| --- | --- |
| One contract for all item types | NEP-245 methods, transfers, metadata and callback resolution in `contract/src/lib.rs`. One contract per world; no independent standards certification. |
| NPC wallet, inventory, adaptive price and bankruptcy | Contract and services enforce finite balances, stock/demand quotes, closure and investment. |
| Social login without normal-loop wallet/gas prompts | Existing Google-saved hosted shops work. Privy integration is in the public source; **real first-login signing and recovery remain unverified and gated pending exact-origin configuration.** Local demo skips OAuth. |
| Readable price file and reasoning tooltip | `contract/src/economy.rs`; UI has an expandable “Why this price?” explanation, rather than a literal hover tooltip. |
| Week-in-a-minute demo | Intentionally omitted at the owner's request. Optional example feature, not an eligibility requirement. |
| Design loop first | Original development followed a paper loop; the current loop is summarized in `GAMEPLAY.md`. |
| NEAR Intents | Not integrated; optional hint. |

Do not claim fully live autonomous AI, a shared player market, player-to-player trading, balanced combat, unlimited capacity or completed noncustodial Google onboarding. The published older hosted shops retain legacy custody until a separately verified handover.

## Release review

[Judge instructions](JUDGE_GUIDE.md), [current verification](VERIFICATION.md) and [security self-review](RELEASE_REVIEW.md) separate actual local contract/browser checks from real-provider and human-playtest gaps. Automated checks cover the core economy, quest chain, two-player arena, recovery and once-only XP. Demo media/X publication and submission remain separate pending owner tasks.
