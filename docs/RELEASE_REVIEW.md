# Release self-review — 11 November 2026

This is a source review and automated verification of a testnet prototype. Expected use is a small playtest: up to ten hosted saved worlds, with automated two-player checks. It is not an independent audit or a production capacity guarantee.

## Scope

Reviewed identity/session checks, Google subject binding, browser signing and recovery, per-owner database isolation, operation retries, item/Copper conservation, merchant pricing/investment, funded quests/NPC orders, arena permissions, deadlines and result settlement. The review started from `8c2180b`; the fixes and regressions are included with this report. Approved character artwork is unchanged.

## Findings fixed

| Case | Fix | Regression |
| --- | --- | --- |
| A completed chicken session hid a later completed PvP match and its result. | Valid PvP acceptance clears only the participants' completed practice slots. | `backend/arena-practice.test.ts`: knockout, reload, pending/confirmed settlement and old acceptance replay while newer training exists. |
| A new browser could not restore access while a prior action awaited acknowledgement; the ledger needed to check it was not connected yet. | Reconcile the exact durable action ID, reread authoritative state, and allow device replacement only after a terminal outcome and no remaining pending action. | `web/tests/privy-access.spec.ts`: unknown result, a different pending-action race, no early signature/key change and successful recovery. |
| Older online saves entered despite an initial `enter=false`, closing the chooser. | Hosted saves need explicit or remembered entry; initialized older saves have a visible Continue game control. An explicit setup intent survives a non-null legacy connection callback and is cleared on disconnection. Setup uses the existing entry guard, so an inactive preview or pending action cannot dismiss the chooser. | Hosted-save, startup and legacy shop browser scenarios cover explicit opening, reload, inactive previews and the local-hosted controller path. |
| A rejected lazy SDK promise prevented later in-page retries. | Clear the rejected SDK cache. | Browser fixture fails construction once and succeeds on the same page without signing or reloading. A failed network module load is not represented as tested. |
| A conversation could overwrite another message's history, or become unrecoverable after a saved inference/offer followed by a lost final write. | Read history/orders after claiming the turn; bind judgments to immutable input. Reuse older saved judgments without repeating inference. | `backend/hosted-npc.test.ts`: serialized race, lost final write, earlier-hash compatibility, exact offer reuse, changed-input rejection and unknown-result no-resend. |

No confirmed authentication bypass or cross-owner asset access was found in the reviewed source. This does not establish that no such issue exists.

## Scanner results and triage

- **Semgrep 1.176.0 OSS:** nine registry rulesets and 68 relevant-language community rules ran with telemetry off. The final combined scan covered 191 files. Community rules comprise 39 Trail of Bits, 2 Decurity Rust and 27 elttam rules. Whole-repository community configuration initially failed on non-rule workflow YAML; the retry selected actual rule entries. Four unparseable elttam YAML files were excluded. Two workflow rules could not fully parse the generated Stasho workflow's shell snippets; those steps were read manually. Pro cross-file analysis was unavailable.
- **Semgrep warnings:** two dynamic-URL warnings refer to an operator-controlled loopback demo checker. Nine panic/unwrap warnings refer to local Sandbox/demo invariants and fixed local account literals. They are not demonstrated cross-user security vulnerabilities; they remain visible review observations.
- **Gitleaks:** public Git history passed with zero detected leaks. Final source/build scan results are recorded in the release evidence. No scanner can prove absence of every secret.
- **Trivy/npm:** Trivy reports one low-severity `elliptic` advisory; npm reports four low-severity entries including affected dependency paths. No moderate/high/critical npm advisory was reported. The affected branch is the transitive SECP256k1 stack; this game signs with Ed25519. npm proposes a major NEAR SDK downgrade as its automatic fix, so that incompatible change was not applied.
- **Cargo audit:** `RUSTSEC-2026-0387` affects `crypto-bigint 0.5.5` through the native NEAR unit-test VM's `p256` dependency. The normal WebAssembly contract dependency tree does not contain it. The advisory requires 0.7.6+, which is not a compatible forced substitution for that 0.5 dependency. Keep this test-toolchain limitation under review. [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2026-0387.html).

## Authority and operational limits

New player-owned games do not obtain a backend-held player root key. Existing older hosted shops retain their prior custody; no migration is claimed. Normal owned-game actions use a bounded, revocable browser key; the root signer is needed for initial setup, renewal and recovery. Social-account and provider security remain part of that trust model.

Hosted development limits are 10 worlds globally, two owned saves per Google account, 1,000 durable economic operations per world, 128 NPC conversation requests per world, 128 arena profiles and 256 retained PvP matches in the shared room. These are application limits, not Stasho allowances or a measured concurrent-user capacity. Changing them requires checking budgets, journal storage and query bounds first. Live inference has a separate finite server-side request/token reservation.

The referee attests server-authoritative combat and enforces once-only awards. It does not establish trustless replay verification. Free request allowances and database protections do not replace a load test.

## Not verified

Real first-time Google/Privy consent, actual provider raw signing/recovery, a real two-human playtest, production-scale load and an independent review. Provider settings currently report an empty allowed-origin list; public ownership activation stays gated. The owner did not have time to complete manual onboarding during this review. An authenticated read of provider settings succeeded; the attempted minimal configuration PATCH returned 405 without changing the list. The documented Dashboard path is prepared in ONBOARDING.md. No owner browser was controlled, no existing hosted inventory was reset and no new model request was sent.
