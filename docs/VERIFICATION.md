# Current release verification — 11 November 2026

The release review covers the public source and the fixes described in [RELEASE_REVIEW.md](RELEASE_REVIEW.md). [Judge instructions](JUDGE_GUIDE.md) provide the free reproducible route. Older version-specific checks remain in Git history; they are not claims about current onboarding.

## Map refresh test follow-up

The following [main run](https://github.com/san-npm/copper-acorn/actions/runs/43118870856) passed the arena recovery checks, then timed out waiting for Leave in the map journey. The fixture clicked a new resource while Refresh ledger was still busy and could read retained text from the previous closed dialog. The application intentionally blocks interactions during that refresh. The test now waits until the refresh control is enabled and verifies the visible resource dialog and its exact title. A private controlled four-second read delay reproduces the previous Leave timeout and passes with the corrected synchronization. All three map scenarios pass locally. Runtime code, artwork and the game address remain unchanged. Failed browser jobs also print their fictional fixture UI context to make later failures diagnosable. [Evidence](verification/2026-11-12-map-refresh.json).

## Arena recovery test follow-up

A later [readiness CI](https://github.com/san-npm/copper-acorn/actions/runs/43116452266) failed because a fixture expected the temporary “safe retry” diagnostic. A normal read-only arena refresh replaces that text with the persistent same-request guidance. Holding the fixture until that refresh reproduces the old assertion failure deterministically. The updated test waits for two refreshes and verifies that the exact original request is retained, no automatic POST is sent, and manual retry sends the same body. Both desktop/mobile walking and combat recovery cases pass locally. Runtime code and the hosted address are unchanged. [Evidence](verification/2026-11-12-arena-polling.json).

## Mira opening race follow-up

The subsequent [main CI run](https://github.com/san-npm/copper-acorn/actions/runs/43082137508/job/130737119042) passed build/contracts and 95 browser checks, then timed out in the second ownership scenario waiting for Mira's Accept order button. Choices were enabled during the initial read, before the automatic greeting disabled them; an early click could be lost. The fix keeps controls disabled through initialization and restores them on failure. A delayed-response regression fails before the fix and passes after it; ten hosted checks and both actual Sandbox ownership scenarios pass locally. [Detailed evidence](verification/2026-11-11-mira-opening.json). The [corrected source CI](https://github.com/san-npm/copper-acorn/actions/runs/43103554379) now passes all jobs, including the exact previously failing scenario. The old failed run remains in history. The [corrected hosted build](https://bafybeico4f7hgkeu6kafrhzrz2ez5q4maog5nvlygwsemedkirjfdfa2gm.ipfs.aleph.sh/) has 121 verified files and 19 passing backend access checks; the owner has now saved its exact Privy origin. A fresh isolated hosted check reached real Google authorization with zero page errors and no backend writes. The README and submission links point to this configured address. The previous Privy origin was removed; the backend and Supabase Auth still preserve earlier addresses, but new Privy authorization from an old address requires restoring its allowed-origin entry.

## Submission preparation

The [cleanup evidence](verification/2026-11-11-submission-prep.json) records a fresh 130-test pass, strict unused-code checking, production build and an actual local craft/sale/arena capture. All 121 frontend files are byte-identical to the deployed release. The recorder rejects non-local targets. The previous video was removed on 12 November at the owner's request. [Submission material](SUBMISSION.md) now includes the owner's replacement recording, screenshots and draft text. The [replacement media checks](verification/2026-11-12-owner-demo.json) cover conversion and playback validity; they do not independently verify the recorded gameplay or account setup. Nothing was submitted or posted.

## Onboarding follow-up

The [friend onboarding check](verification/2026-11-11-friend-onboarding.json) covers 27 focused browser cases and a fresh build. It verifies the initial loading screen, refresh, saved sessions and exact-origin access checks. Public app configuration and the exact hosted origin are enabled. A hosted check with a fictional game identity reached real provider Google authorization, without backend writes. Real Google consent/signing/recovery remain unverified.

## Automated checks

The [release CI at `aa46b5d`](https://github.com/san-npm/copper-acorn/actions/runs/43106161223) passed: 130 Node tests, 34 Rust tests, 9 artwork checks and 97 browser cases (73 default, 12 Privy fixtures, 10 hosted-controller and 2 actual Sandbox ownership scenarios).

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

The exact hosted origin is configured and real provider Google authorization startup is checked. Real Google consent/provider signing/recovery remain unverified. The owner reports that the configured build works; the precise fresh-game creation and different-browser recovery steps were not specified. The code fixes prevent unentered legacy saves from dismissing the chooser and allow pending old actions to reconcile before new-browser access is restored.

No human two-player playtest, large-load benchmark, mainnet deployment, X post or hackathon submission is claimed.
