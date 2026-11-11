# Working on Copper Acorn

- Keep the project free to build and test. Use local Sandbox/testnet; no mainnet, purchases or live model requests without explicit authorization.
- Never generate backend-held keys for new real players or relabel legacy custody as player ownership. Preserve existing keys, assets and progress.
- Keep blockchain/provider labels out of the player interface; explain technology in repository docs.
- Read `docs/HACKATHON_CHECKLIST.md` before making eligibility/completion claims. The exact hosted origin and Google authorization startup are verified; completed new-player creation/signing/recovery and final submission remain unverified.
- Use the existing code and minimal changes. Preserve request IDs/bytes on unknown outcomes; confirm authoritative state before payouts/progression/portal exit.
- `npm test` and `npm run build` verify Node rules/types/frontend. Rust contract tests are listed in README. Use focused browser checks for changed flows.
- Private source packs and `.local/` stay out of git. The owner-approved compiled character/action sheets are pinned in `deploy/approved-art.json`; do not replace or regenerate their designs without review. Their third-party license restrictions remain documented in `docs/ASSET_CREDITS.md`.
- Never operate/restart an owner's browser or preserved game servers to test a change. Use disposable ports; the local demo ports can be overridden.
- Stasho's native GitHub import is configured. Verify the generated workflow and hosted result; use the existing connection rather than guessed API endpoints or extra keys.
