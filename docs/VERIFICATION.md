# Release checks — 10 November 2026

## Merchant and gathering correction — 11 November2026

The three market merchants now use the matching locally reviewed character artwork, including eye-only blink variants. Their full portraits remain intact; the scene clips them against the actual painted counters and awnings. All76 pinned artwork files pass the build check (the original70 character/action files are unchanged).

Read-only hosted inspection found one confirmed Silver Dust collection in each of two older saves, dated5/6November. Both remain on market day1. The two newer saves report0/1 collected. The oldest save also lacks the newer market clock; its ledger now exposes the existing Next market day action, which replenishes gathering without discarding inventory. These are persistent in-game gathering limits, not a hosting allowance or a calendar reset. No hosted progress or keys were changed. The popup and gather buttons now say “market day”, show the saved collection count, and explain replenishment. An oversized batch and an ingredient with no gathering allowance get distinct messages.

123Node tests, nine artwork checks, the release build and11focused browser scenarios pass. Browser coverage includes first silver collection, one request, reload persistence, a zero-allowance save, merchant dialogue, map targets and movement. One stale asset-count expectation was updated to include all three blink images. Tests use a disposable local world; owner browsers and game servers are untouched. This is a focused correction, not a new full security or live social-onboarding audit.

## Approved character restoration — 11 November2026

The owner rejected the replacement designs and authorized publication of the restored local character/action set. This release uses the exact 70 approved PNG/manifest files, including all eight characters, the seated spectator atlas and five action sets. Builds verify their hashes; the retired redraw helpers refuse to overwrite them. Private source packs remain excluded. The restoration does not resolve the third-party licensing restrictions documented in `ASSET_CREDITS.md`.

Published through the native GitHub → Stasho workflow [42989656886](https://github.com/san-npm/copper-acorn/actions/runs/42989656886), deployment `deploy_EeelxnLT8xDd`. All107hosted files match the 24,372,724-byte build, including all70approved files.121Node checks, nine artwork checks, eight existing-save browser cases and the GitHub web/contract checks pass. The compiled and hosted welcome screens and isolated character harness load all8appearances/four views without page errors. Google/S256 routing targets the new exact origin; this is not a completed human consent check.

Backend session21/game23/arena15 remain JWT-protected. Sixteen public origin/auth/settings checks pass for the new origin, previous origin, local preview and unrelated-site rejection. Supabase Google is enabled; earlier return URLs are preserved. Four earlier worlds/four legacy wallets/zero newly owned wallets remain after publication. No migration, economic action, model call or purchase was made for this release.

Privy activation remains gated pending real Google consent/signing/recovery; no Privy App ID is enabled in the public build. Existing saves, keys and contracts are preserved. Updating the published-origin metadata leaves all107frontend files byte-for-byte identical.

[Current game](https://bafybeidntahfg4ojtmb4ub433kqiufiunfivincqzfzuliegk5okpq6s5i.ipfs.aleph.sh/) uses the restored approved character/action artwork. Privy signing code is included but public activation remains gated. Earlier release records below are historical.

## Privy integration — local preview

The selected provider is implemented on the local `work/privy-login` branch. Checks pass: 121 Node tests, nine new browser cases and eight existing hosted-save browser cases, plus builds with social access both enabled and absent. The new tests cover per-user root creation, ownership proof replay, exact setup bytes after lost responses/reload, non-exportable device keys, normal signed actions without root signatures, renewal, another-browser restoration, pending actions, account changes, callback rejection, iframe boundaries and the save controller's expired-challenge retry. Existing checks still cover opening an earlier shop, crafting, selling and reloading it.

The real Privy SDK initialized with the owner's public App ID and no Client ID, and started Google authorization successfully. Google is enabled in the provider's public configuration. This checks routing, not completed consent, live signing or recovery. No Privy app secret or verification PEM is used. No new Jev/model request or paid signature was made.

Backend session20/game22/arena14 are active with JWT verification retained. The local preview origin `http://127.0.0.1:5189` is allowed; previous origins and Google returns are preserved. All 13 public origin/authentication/settings checks pass. The pre-test inventory count remains four older worlds/four legacy wallets/zero newly owned wallets. No player assets or keys were migrated. The local preview's Google/S256 return target and visible game language passed an isolated headless-browser check. Preserved owner previews on ports5178/5181 still return200; their browsers were not operated.

Manual Google consent, actual root signatures, starter funding and real recovery remain required before public activation. Restrict the Privy application's allowed origins before publishing. Four existing low-severity npm advisories remain; the dependency check found no moderate/high/critical advisory. This was a focused integration review, not another full security audit. Contract and artwork source were not changed.

## Previously published original-art release

Native GitHub deployment [42879664780](https://github.com/san-npm/copper-acorn/actions/runs/42879664780), `deploy_jFX4UdZGw4XX`, succeeded; all96hosted files matched the 24,294,718-byte build. CI passed119Node,34contract and9art checks. Hosted Google/S256 redirect routing, mocked existing-save opening,320px layout and held-response movement passed; controlled first motion26.9ms was not a network-latency claim. Backend versions at that checkpoint were session19/game21/arena13. Four earlier worlds/wallets were unchanged. No human social-account setup was claimed.

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
