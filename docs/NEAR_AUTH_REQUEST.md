# Testnet callback access and published NEP-413 API

Posted with the owner's approval: https://github.com/Peersyst/fast-auth/issues/132. Provider response pending; do not treat this as working onboarding.

We are integrating Google-only NEAR Auth into Copper Acorn, a testnet-only alchemy game: https://github.com/san-npm/copper-acorn.

The documented shared testnet client returns HTTP 403, "Callback URL mismatch", for this callback:

```
https://bafybeibxx5pauq5fyffbziuhmabcxd6ok6bxnvksbv6cholnmqlib46v4m.ipfs.aleph.sh/
```

Public configuration: domain `login.testnet.fast-auth.com`, client ID `np8paqIpMWmNbzT4xAvOOapZBjsOpptl`, signing audience `auth0.jwt.fast-auth.testnet`. Reproduced on 10 November 2026 with authorization code flow and S256 PKCE, without completing a login.

Could you enable that exact callback/origin and `http://127.0.0.1:5183/`, or provide free testnet application configuration? Stasho gives each changed static build a new CID origin; please advise on your supported stable-callback approach without wildcard IPFS access.

We also need a published, pinned NEP-413 message-signing API. npm currently serves browser-sdk1.4.2/javascript-provider1.4.1; their declarations lack `requestMessageSignature`. We see PR104 is open. Is there a supported release for embedded applications, or should integration wait for that PR's release? We do not require a wallet-selector redirect callback.

Players must retain signing authority; our backend must never hold their keys or be able to mint signing authority for their identities. Ordinary gameplay already supports bounded device keys. Please confirm mandatory approval screens, game branding options and free testnet signing/relay limits; no billing or automatic top-ups can be enabled.

This requests development access only, not mainnet access or hackathon review. No user identities, keys or tokens are included.
