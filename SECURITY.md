# Security

Report vulnerabilities using this repository's **Security → Report a vulnerability** form. Do not post credentials, player data or an exploit against a live saved shop in a public issue.

This is a testnet prototype. Hosted session/ownership checks and transaction validation are implemented, but no independent security certification or production-scale assessment is claimed. See the README for current ownership and onboarding limits.

Do not commit environment secrets, player private keys, database exports or signed operation records. The Supabase URL/publishable browser key and public Privy App ID (plus an optional public Client ID) are intentionally public in `deploy/public-env.json`. App secrets and service-role credentials are never public configuration.
