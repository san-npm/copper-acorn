# Submission preparation

Track: **Games With Real Economies** (`games`). Deadline: **14 November 2026, 23:59 UTC**, checked against the [official rules](https://nearhackathon.com/HACKATHON.md) on 11 November.

Repository and a reproducible local demo are prepared. This is not a submitted or fully cleared entry. See the [requirements checklist](HACKATHON_CHECKLIST.md) for remaining checks.

## Project description

Copper Acorn is a pixel-art alchemy shop game. Players gather ingredients, brew potions, set shelf prices and trade with three NPC merchants. Each merchant has its own balance and inventory; stock and recent demand change its prices. A NEAR multi-token contract tracks items and validates crafting, sales and merchant investment. A quest chain and two side orders guide the shop loop. A shared turn-based arena records once-only duel results through a separate referee contract. The prototype uses testnet and a free local Sandbox; player-to-player item trading is not implemented.

## Demo material

- [Owner-recorded demo (MP4, 2 minutes 44 seconds)](demo/demo-near-hack.mp4)
- [Town](demo/town.png), [completed crafted sale](demo/crafted-sale.png), [arena](demo/arena.png)

The demo is the owner's replacement recording, converted from MOV to H.264 MP4 at its original 3446 × 2000 resolution, with the full duration and audio retained. It shows the shop, crafting and arena. The original MOV remains unchanged. [Media checks](verification/2026-11-12-owner-demo.json) record the conversion separately from the automated gameplay checks.

The screenshots are actual captures from an isolated local Sandbox using the approved game artwork and browser-held disposable keys. They do not demonstrate real Google consent, live inference or public-testnet transactions. The capture uses reduced motion for stable screenshots. No player credentials or private source packs are included.

## Draft X post

Built Copper Acorn at NEAR HACKATHON: gather herbs, brew potions and run a shop. NPC prices react to stock and demand; NEAR contracts track items and trades.

@NEARProtocol #NEARHackathon

Play: https://bafybeico4f7hgkeu6kafrhzrz2ez5q4maog5nvlygwsemedkirjfdfa2gm.ipfs.aleph.sh/

Code: https://github.com/san-npm/copper-acorn

Attach the owner-recorded demo or the screenshots. This draft has not been posted.

## Before sending

1. Confirm completed new-player Google setup/signing and recovery; only authorization startup is verified on the hosted build. The free local route is reproducible without Google.
2. Publish the demo post with the owner's recording and retain its public URL. A video is required if judges rely on a local-only demo.
3. Supply the team lead, email, team size and an owner-controlled NEAR payout account. Disclose another entry if applicable. Keep personal submission data out of Git.
4. Review the final fields and explicitly agree to the organizers' contact notice before sending the form. Nothing has been submitted, and no X post has been sent.

No mainnet deployment, fast-forward feature or NEAR Intents integration is required by the official rules. The [judge guide](JUDGE_GUIDE.md) explains the actual contracts and service trust boundaries.
