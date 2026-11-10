# Release checks — 10 November 2026

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

This is not a fresh full security audit. Four existing low-severity npm advisories remain. Third-party artwork clearance and fresh Google-only player ownership remain unresolved. The [hackathon checklist](HACKATHON_CHECKLIST.md) distinguishes optional example features from official requirements; no entry or X post was submitted.
