import { KeyPair, KeyType } from '@near-js/crypto';
import { actionCreators as actions, createTransaction, encodeTransaction, Signature, SignedTransaction, type Action } from '@near-js/transactions';
import { baseDecode, baseEncode } from '@near-js/utils';
import { Buffer } from 'node:buffer';

export { actions };
export type { Action };
export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
export const rpcUrl = 'https://test.rpc.fastnear.com';
export class RpcError extends Error {
  causeName: string;
  constructor(causeName: string) { super('Testnet RPC could not confirm the request.'); this.causeName = causeName; }
}
export async function rpc(method: string, params: unknown, fetcher: typeof fetch = fetch): Promise<any> {
  const response = await fetcher(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'shop', method, params }), signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new RpcError('HTTP_ERROR');
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 2_000_000) { await reader.cancel(); throw new RpcError('OVERSIZED'); }
    chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (data.error) throw new RpcError(data.error.cause?.name || 'RPC_ERROR');
  if (!data.result) throw new RpcError('INVALID_RESPONSE');
  return data.result;
}
export async function view(contract: string, method: string, args: object = {}, fetcher: typeof fetch = fetch) {
  const value = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract,
    method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }, fetcher);
  if (!Array.isArray(value.result)) throw new RpcError('INVALID_VIEW');
  return JSON.parse(Buffer.from(value.result).toString('utf8'));
}
export async function account(accountId: string, fetcher: typeof fetch = fetch) {
  try { return await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId }, fetcher); }
  catch (error) { if (error instanceof RpcError && error.causeName === 'UNKNOWN_ACCOUNT') return null; throw error; }
}
export async function access(accountId: string, key: KeyPair, fetcher: typeof fetch = fetch) {
  const result = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: key.getPublicKey().toString() }, fetcher);
  if (result.permission !== 'FullAccess' || !Number.isSafeInteger(result.nonce) || !Number.isSafeInteger(result.block_height)) throw new RpcError('INVALID_KEY');
  return result;
}
export async function digest(bytes: Uint8Array) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))); }
export function signature(key: KeyPair, hash: Uint8Array) {
  return new Signature({ keyType: KeyType.ED25519, data: key.sign(hash).signature });
}
export async function sign(signer: string, receiver: string, key: KeyPair, txActions: Action[], fetcher: typeof fetch = fetch) {
  const state = await access(signer, key, fetcher);
  const tx = createTransaction(signer, key.getPublicKey(), receiver, BigInt(state.nonce) + 1n, txActions, baseDecode(state.block_hash));
  const hash = await digest(encodeTransaction(tx));
  const signed = new SignedTransaction({ transaction: tx, signature: signature(key, hash) });
  return { signed_tx: Buffer.from(signed.encode()).toString('base64'), tx_hash: baseEncode(hash), signer_id: signer };
}
