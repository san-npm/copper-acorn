# Working on Copper Acorn

- Keep the project free to build and test. Use local Sandbox/testnet; no mainnet, purchases or live model requests without explicit authorization.
- Never generate backend-held keys for new real players or relabel legacy custody as player ownership. Preserve existing keys, assets and progress.
- Keep blockchain/provider labels out of the player interface; explain technology in repository docs.
- Read `docs/HACKATHON_CHECKLIST.md` before making eligibility/completion claims. New social onboarding and final submission remain incomplete.
- Use the existing code and minimal changes. Preserve request IDs/bytes on unknown outcomes; confirm authoritative state before payouts/progression/portal exit.
- `npm test` and `npm run build` verify Node rules/types/frontend. Rust contract tests are listed in README. Use focused browser checks for changed flows.
- Private packs and `.local/` stay out of git. Playtest artwork staging verifies pinned hashes; its third-party terms remain separate.
- Never operate/restart an owner's browser or preserved game servers to test a change. Use disposable ports; the local demo ports can be overridden.
- Stasho's native GitHub import needs owner setup. Verify its generated workflow and hosted result; do not replace setup with guessed API endpoints or extra keys.
