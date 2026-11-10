# Google-only player ownership

Existing Google login and older saved shops work. New noncustodial Google-only accounts are still gated; no server-held player key is used as a fallback.

On 10 November 2026, a read-only authorization request to the shared NEAR Auth testnet client returned HTTP403, "Callback URL mismatch", for the published game address. The current npm browser-sdk1.4.2/javascript-provider1.4.1 also lack the message-signing method shown in the documentation. Upstream PR104 adds it but is not yet merged/published.

The owner authorized a support request, posted as [Peersyst/fast-auth issue132](https://github.com/Peersyst/fast-auth/issues/132). It requests exact callback access, a supported pinned SDK, mandatory consent/branding details and free testnet limits. No player data or secrets were sent. No provider response or working onboarding is claimed.

After supported access is available:

1. Integrate the embedded social provider and bind its real signing proof to the existing Google session, selected save, nonce and exact origin. Email alone is not authority.
2. Exercise first setup and other-browser recovery with a user-authorized bounded device key; verify renewal, expiry, cancellation and revocation.
3. Preserve unknown signed requests byte for byte, old shops/assets and immutable ownership modes. Verify normal gather/craft/sell play has no approval prompts.
4. Verify the actual provider consent screen and free limits before enabling new games publicly.

Do not replace this with a backend JWT issuer that can impersonate every player, derive a secret from an email, or claim a browser-only key provides cross-browser recovery. The remaining provider setting cannot be changed with this game's Supabase or GitHub credentials.
