# Hackathon submission

Track: **Games With Real Economies** (`games`). Deadline: **14 November 2026, 23:59 UTC**, checked against the [official rules](https://nearhackathon.com/HACKATHON.md) on 12 November.

Submitted on **12 November 2026** after the owner approved the exact application and contact notice. The organizer’s API returned **HTTP 201**, confirming the entry was saved. Personal submission details and the receipt are stored privately outside Git. See the [requirements checklist](HACKATHON_CHECKLIST.md) for product verification status.

## Project description

Copper Acorn is a pixel-art alchemy shop game with turn-based player duels, built for Games With Real Economies. Players gather ingredients, brew potions, set shelf prices, trade with three NPC merchants and complete guild commissions and side quests. Each merchant has its own balance and inventory; stock and recent demand affect its prices, and an underfunded stall can close until working capital is contributed. Players can also enter a shared arena, challenge another player or practise against a passive training chicken. A NEAR multi-token contract tracks ingredients, potions and Copper and validates the economy actions. A separate referee contract records approved PvP results and progression once; the game server runs combat. Hosted shops use testnet, and the free local demo runs actual contracts in an isolated Sandbox. Player-to-player item trading is not implemented.

## Demo material

- [Public demo post on X](https://x.com/3615crypto/status/2120878487804289264)
- [Owner-recorded demo (MP4, 2 minutes 44 seconds)](demo/demo-near-hack.mp4)
- [Town](demo/town.png), [completed crafted sale](demo/crafted-sale.png), [arena](demo/arena.png)

The demo is the owner's replacement recording, converted from MOV to H.264 MP4 at its original 3446 × 2000 resolution, with the full duration and audio retained. It shows the shop, crafting and arena. The original MOV remains unchanged. [Media checks](verification/2026-11-12-owner-demo.json) record the conversion separately from the automated gameplay checks.

The screenshots are actual captures from an isolated local Sandbox using the approved game artwork and browser-held disposable keys. They do not demonstrate real Google consent, live inference or public-testnet transactions. The capture uses reduced motion for stable screenshots. No player credentials or private source packs are included.

## Prepared caption

Built Copper Acorn at NEAR HACKATHON: gather herbs, brew potions, run a shop and challenge players to turn-based duels.

NEAR contracts track items, trades and duel results.

@NEARProtocol #NEARHackathon

Play: https://bafybeiaps7mv4ote6v2hlu6okemli63rpqqxb5y6nublenxrino77d6ehe.ipfs.aleph.sh/

Code: https://github.com/san-npm/copper-acorn

The owner has published the [demo post](https://x.com/3615crypto/status/2120878487804289264). X’s public embed confirms the hackathon name, @NEARProtocol and #NEARHackathon; X’s media metadata confirms an attached gameplay video (2 minutes 44 seconds). The text above is the prepared caption; the published wording is visible in the linked post.

## Submission status

The application includes the public repository and demo-post links above. Team/contact/payout details and the organizers' contact notice were explicitly approved before sending. Judging is pending.

If a submitted field needs correction, use the organizers' [request-changes page](https://nearhackathon.com/request-changes). The project should not be submitted a second time.

New-player creation/signing/recovery remains a product verification limit, documented in the [verification report](VERIFICATION.md). The free local route is reproducible without Google.

No mainnet deployment, fast-forward feature or NEAR Intents integration is required by the official rules. The [judge guide](JUDGE_GUIDE.md) explains the actual contracts and service trust boundaries.
