# Verification — 12 November 2026

The latest full runtime check at [`68dc77f`](https://github.com/san-npm/copper-acorn/actions/runs/43214202799) passed all CI jobs. The documentation revision that follows it changes repository information only.

| Check | Result | Coverage |
| --- | --- | --- |
| Node tests | 130 passed | Request validation, account isolation, economy rules, NPC orders, arena actions and retry handling. |
| Rust contract tests | 34 passed | Item contract and arena referee. |
| Artwork checks | 9 passed | Character/action regressions; builds also check all 76 pinned asset hashes. |
| Browser scenarios | 98 passed | 73 default, 13 social-signing fixtures, 10 hosted-controller checks and 2 actual Sandbox ownership scenarios. |

## What the checks demonstrate

The local ownership scenarios execute actual Sandbox contracts for crafting, shelf sales, funded NPC orders, duel settlement and device-access revocation. Two independent browser contexts create different saved characters, join the shared arena, challenge, move, cast, reconnect and finish a match. Tests also cover turn deadlines and once-only progression.

The login fixtures use fictional provider identities. They test callback resumption, account matching, exact-window/origin checks and recovery after uncertain requests. Automated browser scenarios establish tested behaviour; human playtest quality and capacity require separate evaluation.

## Hosted version

The [current game](https://bafybeiaps7mv4ote6v2hlu6okemli63rpqqxb5y6nublenxrino77d6ehe.ipfs.aleph.sh/) matches **121 compiled files / 25,051,491 bytes**. The 19 API access/configuration checks pass, including rejection of unrelated origins and unauthenticated requests. Backend functions retain JWT verification.

Public provider settings confirm Google enabled and both the current and previous game addresses allowed. Separate isolated checks of the published version pass the setup-iframe readiness handshake and reach real Google authorization, with zero page errors and zero backend writes. They stop before human consent and do not request real-player signatures. [Login evidence](verification/2026-11-12-social-return.json).

Existing hosted saves and inventories were preserved. Release checks did not operate an owner's browser or perform economic actions on an owner's hosted shop.

## Verification limits

- Completed first-time Google game creation, player signing and recovery still need a real-user retest. An existing saved shop opening successfully does not establish these steps.
- Earlier hosted shops retain their original backend-held keys and immutable contract versions. The local ownership demo exercises the current contracts with disposable browser-held keys. [Onboarding details](ONBOARDING.md).
- Human two-player usability, class balance and concurrent-player capacity have not been established. Automated two-browser tests are the current multiplayer evidence.
- The referee records the server-attested outcome; it does not independently replay combat. Each shop has its own economy, and player-to-player item trading is not implemented.

## Repeat the checks

Install/build with the [README](../README.md#try-it-locally--free-no-api-keys), then run:

```sh
npm test
npm run build
cargo test --locked -p briarbridge-alchemy -p briarbridge-arena --lib
npx playwright install chrome
npx playwright test
PRIVY_TEST_ORIGIN=http://127.0.0.1:5190 npx playwright test --config playwright.privy.config.ts
npx playwright test --config playwright.hosted-owned.config.ts
npx playwright test --config playwright.owned.config.ts
```

These suites use disposable local data and fictional sign-in identities. They do not require inference credits or real-player credentials. The [security self-review](RELEASE_REVIEW.md) records scanner findings and their treatment; automated scanners do not establish that the game is free of vulnerabilities.

## Supporting records

| Record | Evidence |
| --- | --- |
| New-game callback and provider messages | [Live readiness comparison, callback regression and hosted startup](verification/2026-11-12-social-return.json). |
| Map/quest fixture synchronization | [Delayed-ledger reproduction and focused checks](verification/2026-11-12-map-refresh.json). |
| Arena pending-request recovery | [Exact request preservation across background polling](verification/2026-11-12-arena-polling.json). |
| Mira dialogue initialization | [Delayed-response regression and corrected checks](verification/2026-11-11-mira-opening.json). |
| Earlier security/build review | [Source fingerprints and results](verification/2026-11-11-release.json). |
| Owner-recorded demo | [Conversion and playback checks](verification/2026-11-12-owner-demo.json). The recording is separate from automated verification. |

[Judge walkthrough](JUDGE_GUIDE.md) · [Hackathon checklist](HACKATHON_CHECKLIST.md) · [Submission preparation](SUBMISSION.md)
