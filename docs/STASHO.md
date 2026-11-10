# Deploy from GitHub

The repository root is the application root. Stasho publishes the static frontend; Supabase provides Auth, persistence and the shared arena backend.

| Wizard setting | Value |
| --- | --- |
| Repository | `san-npm/copper-acorn` |
| Production branch | `main` |
| Root directory | repository root / empty |
| Framework | None / static HTML (custom Vite build) |
| Build command | `npm ci && npm run build:stasho` |
| Output directory | `web/dist` |
| Deploy target | Static site (IPFS) |
| Node | 24 or newer |

`build:stasho` verifies and downloads the pinned, previously hosted playtest sprites into ignored `.local/`, then builds the current source. Original third-party packs are not in GitHub. `deploy/public-env.json` contains only the Supabase URL and intentionally public publishable browser key; never add a secret/service-role key there.

Stasho's [documented GitHub import](https://docs.stasho.xyz/guides/import-a-repo.html) requires the owner's dashboard. Agent keys cannot import a repository or edit encrypted build settings. In Stasho, choose **New Project**, install/authorize **stasho-deploy** for this repository if needed, select the repo, enter the settings above and choose **Deploy**. The app opens a setup PR containing its deployment workflow.

After import, review the generated workflow and its configured project/branch/build settings, then merge it. Pushes to main can then trigger native Stasho builds. No agent publish key belongs in source or workflow files. Native GitHub deployment has its own documented account quotas; this is not a key-rotation workaround.

Each static version gets a new CID URL. Before testing sign-in on a new URL, the operator must add its exact origin to backend CORS and Supabase Auth returns, preserving earlier URLs. No wildcard IPFS origins. Do not report a deployment complete until its actual hosted assets, Google return target, API access and movement are verified.

The prior upload project `proj_dIavceHXD77z` is an uploaded site, not a GitHub project. Its agent-key publication budget was exhausted. Keep it and its previous URLs available while the new GitHub project is prepared; no existing saves or player keys should be migrated or deleted.
