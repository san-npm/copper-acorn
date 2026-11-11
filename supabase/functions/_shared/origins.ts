export const publishedOrigin = 'https://bafybeid6rjjrd62guu463w7irbp3g6zf5sunhui7xxmh6gvtdawnvgvree.ipfs.aleph.sh';
export const previousOrigins = [
  'https://bafybeievcuwakpltpmgz5gw3hdvstygempknjj27wy7tgj7jzmf2ynnp4a.ipfs.aleph.sh',
  'https://bafybeidntahfg4ojtmb4ub433kqiufiunfivincqzfzuliegk5okpq6s5i.ipfs.aleph.sh',
  'https://bafybeif4dj4wtc6feoiws4qt7oevbhc5o6s7gikcjz4fwvhozqsjqru6kq.ipfs.aleph.sh',
  'https://bafybeibxx5pauq5fyffbziuhmabcxd6ok6bxnvksbv6cholnmqlib46v4m.ipfs.aleph.sh',
  'https://bafybeifwduhv7q5d7nquxtt32rypnwv4z23tzxgh3zzhhnn2wsctg2tzzy.ipfs.aleph.sh',
  'https://bafybeieov4fss3eubq26glx6vqpsoum3yoktxoee5k6ulyyoc672zjedaa.ipfs.aleph.sh',
  'https://bafybeierb4sy6zileruh5gvi55q7yryg6y4tyjx7zcjxydmiegx3i4mhiu.ipfs.aleph.sh',
  'https://bafybeihwforx2ytzwuhrltusdmguntj5beg64ljwvkdrx4zupykydx4qxe.ipfs.aleph.sh',
  'https://bafybeiduqa6zo6iue7la6x6d2b6zyd2bgwd63sm5lqnmzljwulxt6gh3cy.ipfs.aleph.sh',
  'https://bafybeiccefv5d2aobzb7iojrl536y5yxpiemhwtfo6s5k6nyjjq544lggu.ipfs.aleph.sh',
  'https://bafybeiascbwejbm27o6of4tzsjnxjjvpqnkbb57partfxncsq2czhukbxu.ipfs.aleph.sh',
  'https://bafybeib4bcn5gbveriucgpuzsecvopp6odhoj3ks3kvhagx7zkgcwgxzie.ipfs.aleph.sh',
  'https://bafybeib6y7ymt7gb2j3gegqz3hqgg73j5tjyjskbbsrf2k5jr43xr27uti.ipfs.aleph.sh',
  'https://bafybeihkit6jzbiknemmufju4ocib32a35mfcvskrdqwq6aa5p4cxioymu.ipfs.aleph.sh',
  'https://bafybeihma4dg7dlglejpmoawnkiea7m5hlir3wiw2ux7onxajvdqqtmeji.ipfs.aleph.sh',
  'https://bafybeian3wjnbnbuyutlk3qyc7czhqifjorhxymyakck7ul6imenzbxb7q.ipfs.aleph.sh',
];

export function gameOrigins(configured = '') {
  return [...new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5175', 'http://localhost:5175', 'http://127.0.0.1:5189', 'http://127.0.0.1:5194', publishedOrigin, ...previousOrigins,
    ...configured.split(',').map(s => s.trim()).filter(Boolean)])];
}
