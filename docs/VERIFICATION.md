# Current release verification — 11 November 2026

The release review covers the public source and the fixes described in [RELEASE_REVIEW.md](RELEASE_REVIEW.md). [Judge instructions](JUDGE_GUIDE.md) provide the free reproducible route. Older version-specific checks remain in Git history; they are not claims about current onboarding.

## Automated checks

- Node tests cover request validation, account/session isolation, economic rules, NPC conversations, arena actions, retries and once-only settlement.
- Rust tests cover the item and referee contracts. Browser ownership tests execute actual Sandbox contracts for crafting, sales, funded NPC orders, PvP settlement and revocation.
- The default browser suite covers map/artwork, interactions, quests, shelf stock, saved-game UI, market turns and recovery. Separate configurations cover the hosted controller and Privy adapter using fictional provider identities.
- Two independent browser contexts create different saved alchemists, join the same arena, challenge, move, cast, reconnect and finish. Backend tests verify deadline expiry and replay handling. This is not a two-human usability or load test.
- Artwork checks and the Stasho build verify the 76 pinned files. Source/private packs are not downloaded at build time.
- Fresh Semgrep, Gitleaks, Trivy, npm and Cargo audit results are triaged in the self-review. Automated scanners are not a proof of security.

Exact counts and source fingerprints for the reviewed implementation are recorded in [release evidence](verification/2026-11-11-release.json). CI runs Node/build/artwork and Rust checks plus the four browser configurations without real player credentials or inference credits.

## Hosted checks

The last published version and its exact-URL access checks are linked from the README and STASHO guide. Publication verification compares the compiled files byte for byte, checks Google return routing, rejects unrelated origins and retains JWT protection. Checking the Google redirect URL does not verify human consent, root signatures or recovery.

Existing hosted saves, inventories, contracts and keys are preserved. No owner browser was controlled and no economic action was performed on an owner's hosted shop during release verification.

## Remaining external checks

Public first-time Privy activation is gated. Exact allowed origins are not yet configured, and real Google consent/provider signing/recovery remain unverified. The owner's existing automatic login restores an older saved game and does not validate that new flow. The code fixes prevent unentered legacy saves from dismissing the chooser and allow pending old actions to reconcile before new-browser access is restored.

No human two-player playtest, large-load benchmark, mainnet deployment, X post or hackathon submission is claimed.
