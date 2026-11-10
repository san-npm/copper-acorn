# Asset credits

Original project code and coordinate-drawn pixel artwork are covered by the root Apache-2.0 license. Third-party resources keep their own terms.

- The town, arena, portal, chicken and painted skill atlas were generated for the project using OpenAI's image tools. Reference images supplied by the owner guided composition/style; external franchise art is not included as a source pack.
- The eight character sheets, seated spectators, three merchants and working poses/tools/effects are original coordinate drawings. Regeneration uses `original_actors.py`, `build-characters.py` and `build-original-actions.py`; these scripts read no external sprite pack. The same original art is used by local and hosted builds.
- The earlier humanoid source archive under `assets/characters/source/` was generated using PixelLab. It is not used by the current character/action renderer. Its provenance JSON records prompts/hashes. PixelLab's [terms](https://www.pixellab.ai/termsofservice) and applicable Open RAIL-M terms remain relevant to that archive.
- **Pixelify Sans** by The Pixelify Sans Project Authors is bundled under SIL Open Font License1.1; the license is at `web/public/assets/fonts/OFL.txt`.
- Earlier playtest releases used **Mana Seed** by **Seliel the Shaper** and Gentle Forest samples supplied by the owner. The publisher's [terms](https://selieltheshaper.weebly.com/user-license.html) explicitly exclude Web3 and AI projects. Those rendered sprites and props are discontinued: current builds do not fetch, copy or package them. Original packs and private checksums remain excluded from GitHub. Older immutable IPFS versions retain their historical files; this update cannot erase those versions or grant permissions for them.
- Interface frames, item icons, dialogue and gameplay rules are project-authored. No external game sprites or music are bundled.

NEAR SDK, Supabase, Phaser, Vite, TypeScript, Playwright and other dependencies retain their upstream licenses. Lockfiles pin versions. Model fixtures contain fictional prompts and recorded judgments; they are not live inference and contain no API keys.
