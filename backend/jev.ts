export type NoulRequest = {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, {
    type: 'noul';
    instructions: string | Record<string, unknown>;
  }>;
};

export type NoulResult = {
  model: string;
  probabilities: Record<string, number>;
  usage: { input_tokens: number; output_tokens: number };
};

const MAX_REQUEST_BYTES = 6_000;
const MAX_RESPONSE_BYTES = 32_768;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function judgment(probability: number): 'suitable' | 'unsuitable' | 'uncertain' {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('Jev probability must be between zero and one.');
  }
  return probability > 0.7 ? 'suitable' : probability < 0.3 ? 'unsuitable' : 'uncertain';
}

export function requestBody(request: NoulRequest): string {
  if (!object(request) || typeof request.model !== 'string' || !request.model.trim()
      || !object(request.state) || !object(request.questions)) {
    throw new Error('Invalid Jev request.');
  }
  const questions = Object.values(request.questions);
  if (questions.length < 1 || questions.length > 3 || questions.some(question =>
    !object(question) || question.type !== 'noul'
    || !(typeof question.instructions === 'string' || object(question.instructions)))) {
    throw new Error('A request must contain one to three Noul questions.');
  }
  const body = JSON.stringify({ model: request.model, state: request.state, questions: request.questions });
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    throw new Error('Jev request exceeds the game payload limit.');
  }
  return body;
}

async function responseBody(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('TypeSafe returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('TypeSafe response exceeds the game response limit.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new Error('TypeSafe returned invalid JSON.');
  }
}

export async function evaluate(
  request: NoulRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<NoulResult> {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('A TypeSafe API key is required.');
  const body = requestBody(request);
  let response: Response;
  try {
    response = await fetcher('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('TypeSafe request failed or timed out; no result was produced.');
  }
  // A failed request is an error, never an unsuitable-product judgment. Do not retry automatically.
  if (!response.ok) throw new Error(`TypeSafe request failed (HTTP ${response.status}).`);
  const result = await responseBody(response);
  if (!object(result) || typeof result.model !== 'string' || !result.model.trim()
      || !object(result.answers) || !object(result.usage)) {
    throw new Error('TypeSafe returned an invalid result.');
  }
  const expected = Object.keys(request.questions);
  if (Object.keys(result.answers).length !== expected.length) {
    throw new Error('TypeSafe answer count does not match the request.');
  }
  const probabilities: Record<string, number> = {};
  for (const name of expected) {
    const answer = result.answers[name];
    if (!object(answer) || answer.type !== 'noul' || typeof answer.noul !== 'number') {
      throw new Error('TypeSafe returned a missing or invalid Noul answer.');
    }
    judgment(answer.noul);
    Object.defineProperty(probabilities, name, { value: answer.noul, enumerable: true });
  }
  const { input_tokens, output_tokens } = result.usage;
  if (typeof input_tokens !== 'number' || typeof output_tokens !== 'number'
      || !Number.isSafeInteger(input_tokens) || input_tokens < 0
      || !Number.isSafeInteger(output_tokens) || output_tokens < 0) {
    throw new Error('TypeSafe returned invalid token usage.');
  }
  return { model: result.model, probabilities, usage: { input_tokens, output_tokens } };
}
