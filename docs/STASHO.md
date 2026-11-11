# Deploy from GitHub

Connected and verified on 10 November 2026. The [reviewed setup PR](https://github.com/san-npm/copper-acorn/pull/1) is merged; the [first native deployment](https://github.com/san-npm/copper-acorn/actions/runs/42872260231) succeeded. [Current game](https://bafybeif4dj4wtc6feoiws4qt7oevbhc5o6s7gikcjz4fwvhozqsjqru6kq.ipfs.aleph.sh/).

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

`build:stasho` builds the current source with the original character, merchant and animation art committed under `web/public/assets`. It performs no external artwork download. `deploy/public-env.json` contains the Supabase URL and intentionally public publishable browser key; it also permits a public Privy App ID and optional Client ID after onboarding verification. Never add a secret/service-role key there.

Stasho's [documented GitHub import](https://docs.stasho.xyz/guides/import-a-repo.html) requires the owner's dashboard. Agent keys cannot import a repository or edit encrypted build settings. In Stasho, choose **New Project**, install/authorize **stasho-deploy** for this repository if needed, select the repo, enter the settings above and choose **Deploy**. The app opens a setup PR containing its deployment workflow.

The generated workflow uses Node 24, `npm ci`, `npm run build:stasho` and `web/dist`. Pushes to main trigger native Stasho builds using GitHub OIDC. No agent publish key belongs in source or workflow files. Native GitHub deployment has its own documented account quotas.

Each static version gets a new CID URL. Before testing sign-in on a new URL, the operator must add its exact origin to backend CORS, Supabase Auth returns and Privy allowed origins, preserving earlier URLs. No wildcard IPFS origins. Do not report a deployment complete until its actual hosted assets, Google return target, API access and movement are verified.

The prior upload project `proj_dIavceHXD77z` is an uploaded site, not a GitHub project. Its agent-key publication budget was exhausted. Keep it and its previous URLs available while the new GitHub project is prepared; no existing saves or player keys should be migrated or deleted.
