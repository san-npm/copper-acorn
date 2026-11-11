# Asset credits

Original project code and coordinate-drawn pixel artwork are covered by the root Apache-2.0 license. Third-party resources keep their own terms.

- The town, arena, portal, chicken and painted skill atlas were generated for the project using OpenAI's image tools. Reference images supplied by the owner guided composition/style; external franchise art is not included as a source pack.
- On 11 November2026 the owner requested restoration and publication of the approved eight character sheets, seated spectators, matching merchants and action artwork. These rendered files derive from the owner-supplied Mana Seed samples and Gentle Forest materials; the original source packs remain excluded. `deploy/approved-art.json` pins the exact approved files. They are **not** covered by the project's Apache-2.0 license.
- The three merchant sprites retain the original coordinate drawings from the preceding release. `original_actors.py` and the retired redraw helpers are retained for provenance; the helpers refuse to replace the pinned character/action files.
- The earlier humanoid source archive under `assets/characters/source/` was generated using PixelLab. It is not used by the current character/action renderer. Its provenance JSON records prompts/hashes. PixelLab's [terms](https://www.pixellab.ai/termsofservice) and applicable Open RAIL-M terms remain relevant to that archive.
- **Pixelify Sans** by The Pixelify Sans Project Authors is bundled under SIL Open Font License1.1; the license is at `web/public/assets/fonts/OFL.txt`.
- **Mana Seed** is by **Seliel the Shaper**. Its publisher's [terms](https://selieltheshaper.weebly.com/user-license.html), checked11November2026, exclude Web3/GenAI projects and restrict redistribution, including edited assets. The owner's publication request does not clear those restrictions or establish hackathon eligibility. Permission remains unresolved; no educational exception is asserted. Older immutable releases retain their historical files.
- Interface frames, item icons, dialogue and gameplay rules are project-authored. No external game sprites or music are bundled.

NEAR SDK, Supabase, Phaser, Vite, TypeScript, Playwright and other dependencies retain their upstream licenses. Lockfiles pin versions. Model fixtures contain fictional prompts and recorded judgments; they are not live inference and contain no API keys.
