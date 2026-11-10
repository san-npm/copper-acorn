import type { Action } from './types';

export const localArt = import.meta.env.VITE_PUBLIC_LOCAL_ART === 'true';
export const actionUrl = (file: string) => new URL(`assets/actions/${file}`, document.baseURI).href;
export type WorkKind = 'brew' | 'mine' | 'harvest' | 'water' | 'tap';
export type WorkArt = { id: WorkKind; name: string; durations: number[]; files: Record<string, string>; resultFrame: number };
const results = { brew: 6, mine: 4, harvest: 3, water: 3, tap: 4 };
const gatherings: Record<string, WorkKind> = { sunleaf: 'harvest', moonmint: 'harvest', emberbloom: 'harvest', spring_water: 'water', wood_essence: 'tap', silver_dust: 'mine' };

export function workKind(action: Action): WorkKind | null {
  return action.kind === 'brew' ? 'brew' : action.kind === 'gather' ? gatherings[action.token_id] || null : null;
}

export async function loadWorkArt(ids: string[]): Promise<WorkArt[]> {
  if (!localArt) return [];
  const response = await fetch(actionUrl('manifest.json'), { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!response.ok) throw new Error('Local action artwork is unavailable.');
  const value = await response.json();
  if (value.frameSize !== 256 || value.columns !== 8 || JSON.stringify(value.anchor) !== '[128,176]'
    || JSON.stringify(value.directions) !== '["south","west","east","north"]'
    || !Array.isArray(value.actions) || value.actions.length !== 5) throw new Error('Unsupported action artwork.');
  const seen = new Set<string>();
  return value.actions.map((entry: any) => {
    if (!Object.hasOwn(results, entry.id) || seen.has(entry.id) || typeof entry.name !== 'string'
      || !Array.isArray(entry.durations) || entry.durations.length !== 8
      || !entry.durations.every((t: unknown) => Number.isInteger(t) && Number(t) >= 50 && Number(t) <= 2_000)
      || !entry.files || ids.some(id => entry.files[id] !== `${id}-${entry.id}.png`)) throw new Error('Unsupported action frames.');
    seen.add(entry.id);
    return { id: entry.id, name: entry.name, durations: entry.durations, files: entry.files, resultFrame: results[entry.id as WorkKind] };
  });
}
