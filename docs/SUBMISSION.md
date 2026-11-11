# Submission preparation

Track: **Games With Real Economies** (`games`). Deadline: **14 November 2026, 23:59 UTC**, checked against the [official rules](https://nearhackathon.com/HACKATHON.md) on 11 November.

Repository and a reproducible local demo are prepared. This is not a submitted or fully cleared entry. See the [requirements checklist](HACKATHON_CHECKLIST.md) for remaining checks.

## Project description

Copper Acorn is a pixel-art alchemy shop game. Players gather ingredients, brew potions, set shelf prices and trade with three NPC merchants. Each merchant has its own balance and inventory; stock and recent demand change its prices. A NEAR multi-token contract tracks items and validates crafting, sales and merchant investment. A quest chain and two side orders guide the shop loop. A shared turn-based arena records once-only duel results through a separate referee contract. The prototype uses testnet and a free local Sandbox; player-to-player item trading is not implemented.

## Demo material

- [Recorded walkthrough (MP4)](demo/walkthrough.mp4)
- [Town](demo/town.png), [completed crafted sale](demo/crafted-sale.png), [arena](demo/arena.png)

These are actual captures from an isolated local Sandbox using the approved game artwork and browser-held disposable keys. The recorder asserts that a Healing Tonic is crafted, listed and sold, Copper changes from 40 to 52, and the arena opens without page errors. They do not demonstrate real Google consent, live inference or public-testnet transactions. The local capture uses reduced motion for stable screenshots. No player credentials or private source packs are included.

To reproduce after the README's build steps, start a disposable demo in one terminal:

```sh
GAME_API_PORT=3906 GAME_WEB_PORT=5196 npm run dev:ownership
```

In another terminal:

```sh
npx playwright install chrome ffmpeg
node scripts/record-local-walkthrough.mjs
```

Outputs go to `.local/submission-demo/`. The linked MP4 is a format conversion of the recorded WebM. Use `GAME_DEMO_URL=http://127.0.0.1:<port>` if you changed the demo's web port. The recorder refuses non-loopback URLs and must not target an existing saved game. The capture creates a new disposable save; stop the demo processes afterward.

## Draft X post

Built Copper Acorn at NEAR HACKATHON: gather herbs, brew potions and run a shop. NPC prices react to stock and demand; NEAR contracts track items and trades.

@NEARProtocol #NEARHackathon

Play: https://bafybeico4f7hgkeu6kafrhzrz2ez5q4maog5nvlygwsemedkirjfdfa2gm.ipfs.aleph.sh/

Code: https://github.com/san-npm/copper-acorn

Attach the walkthrough or screenshots. This draft has not been posted.

## Before sending

1. Confirm completed new-player Google setup/signing and recovery; only authorization startup is verified on the hosted build. The free local route is reproducible without Google.
2. Resolve the published artwork restrictions described in [asset credits](ASSET_CREDITS.md). No exception or permission is assumed.
3. Publish the demo post and retain its public URL. A video is required if judges rely on a local-only demo.
4. Supply the team lead, email, team size and an owner-controlled NEAR payout account. Disclose another entry if applicable. Keep personal submission data out of Git.
5. Review the final fields and explicitly agree to the organizers' contact notice before sending the form. Nothing has been submitted, and no X post has been sent.

No mainnet deployment, fast-forward feature or NEAR Intents integration is required by the official rules. The [judge guide](JUDGE_GUIDE.md) explains the actual contracts and service trust boundaries.
