// Keep service diagnostics in developer tooling, while preserving useful game-rule feedback.
export function gameMessage(value: unknown, fallback = 'Your game could not be confirmed. Try again; your saved progress is kept.'): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return /\b(?:near|jev|privy|wallets?|crypto\w*|blockchain|testnet|sandbox|on[ -]?chain|gas|tokens?|supabase|auth0|rpc|api|nonce|contracts?|relayers?|transactions?|signatures?|signing|seed phrases?|private keys?|public keys?|device keys?|inference)\b|https?:\/\/|ed25519:|\b[a-f0-9]{64}\b/i.test(value) ? fallback : value;
}
