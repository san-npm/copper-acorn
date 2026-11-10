# Release checks — 10 November 2026

[Current game](https://bafybeif4dj4wtc6feoiws4qt7oevbhc5o6s7gikcjz4fwvhozqsjqru6kq.ipfs.aleph.sh/) uses the original artwork. Native GitHub deployment [42879664780](https://github.com/san-npm/copper-acorn/actions/runs/42879664780), `deploy_jFX4UdZGw4XX`, succeeded; all96hosted files match the 24,294,718-byte build. CI passed119Node,34contract and9art checks. Hosted Google/S256 redirect routing, mocked existing-save opening,320px layout and held-response movement pass; controlled first motion26.9ms, not a network-latency claim. Session19/game21/arena13 retain JWT verification and all earlier origins; Google settings/returns are preserved and13public access checks pass. Four earlier worlds/wallets are unchanged. No human social-account setup is claimed.

## Original artwork update

Restricted character/action sprites are replaced with original coordinate art. Current builds use committed files and no artwork downloads. Eight character IDs, four directions, walking, seated spectators, three merchants and five working animations are retained. Tools are drawn with each character's pose so they remain in that character's hands. Retired pack-dependent build/review scripts and the download manifest are removed.

Local checks: 119 Node checks, six character-art checks, three action/blink checks, all24 skill animations (including reduced motion), and four gathering-animation/recovery cases pass. The disposable local demo exercised creation, crafting, listing, sale, reload and training. The production build passed desktop/mobile, simulated saved-game opening and held-response movement checks; the three merchant faces were visually checked in their stall openings.

No new public-network player account or key, model request, migration or purchase was made. Social onboarding remains gated. With the owner's approval, [upstream issue132](https://github.com/Peersyst/fast-auth/issues/132) requests the unavailable provider configuration and published signing API. No response or completed Google-only ownership is claimed.

The following section records the earlier GitHub export; its pinned third-party artwork download is historical.

## Initial GitHub export

Public source: [san-npm/copper-acorn](https://github.com/san-npm/copper-acorn). [Hosted game](https://bafybeibxx5pauq5fyffbziuhmabcxd6ok6bxnvksbv6cholnmqlib46v4m.ipfs.aleph.sh/).

The Stasho setup PR was reviewed, corrected and merged. Its [first GitHub deployment](https://github.com/san-npm/copper-acorn/actions/runs/42872260231) succeeded. Subsequent pushes to `main` use that workflow; backend deployment remains a separate operator step.

Verified for this export:

- 119 Node checks and 34 contract unit tests passed locally and in GitHub CI.
- A fresh SSH clone passed `npm ci && npm run build:stasho`, including 73 pinned artwork hashes. All 102 hosted files matched that build byte for byte.
- A disposable local Sandbox playthrough created an alchemist, brewed, listed and sold a potion, reloaded the same balance, entered training and stopped it. Copper moved 40 → 39 → 52. No live player account was used.
- Hosted desktop/mobile welcome screens, Google/S256 redirect target, simulated authenticated saved-game opening and arena walking passed without page errors or unexpected popups. First rendered movement was 35.1 ms with the server response held in that controlled browser check; this is not a production latency percentile.
- All three hosted APIs accept the new exact origin and preserve the previous one, reject an unrelated IPFS origin, and reject unauthenticated requests. Google remains enabled: 13 public access/settings checks passed. Session18/game20/arena12 retain JWT verification.
- The public Git history passed Gitleaks before initial publication. Secret scanning and push protection are enabled. Public Supabase browser configuration is intentional; server credentials and private development history are excluded.

No real Google consent, new noncustodial social-account creation, live two-player PvP, class-balance campaign or large-load test was performed for this release. Four existing worlds and their four legacy wallets were preserved. No new player key, migration, public-chain gameplay action, model request or purchase was made.

This is not a fresh full security audit. Four existing low-severity npm advisories remain. Restricted artwork is discontinued in the update above; older immutable versions retain their historical files and restrictions. Fresh Google-only player ownership remains unresolved. The [hackathon checklist](HACKATHON_CHECKLIST.md) distinguishes optional example features from official requirements; no entry or X post was submitted.
