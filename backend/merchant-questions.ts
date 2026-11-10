import { requestBody, type NoulRequest } from './jev.ts';

export type MerchantId = 'mira' | 'rowan' | 'bram';
export const potionDescriptions = {
  healing_tonic: 'A mild restorative for scrapes and ordinary physical fatigue. It does not improve concentration.',
  focus_draught: 'Supports sustained concentration and steady attention during careful work. It does not mend injuries.',
  restoration_elixir: 'A potent restorative for severe exhaustion and significant physical injuries. It does not specifically improve concentration.',
};
export type PotionId = keyof typeof potionDescriptions;
export type MerchantNeed = { id: string; merchant: MerchantId; text: string };
export const merchantNeeds: MerchantNeed[] = [
  { id:'mira-gardeners',merchant:'mira',text:'The gardeners have small thorn scratches and feel tired after a normal morning tending the herb beds. They want a modest restorative.' },
  { id:'mira-study',merchant:'mira',text:'An apprentice keeps losing their place while studying a difficult botanical text. They are healthy and rested, and need steady concentration.' },
  { id:'mira-fall',merchant:'mira',text:'A fictional orchard worker fell from a ladder and returned with substantial injuries and profound exhaustion. They need a strong restorative.' },
  { id:'rowan-labels',merchant:'rowan',text:'Healthy distillers are making mistakes reading precise bottle labels during a complicated inventory check. They need sustained attention, not healing.' },
  { id:'rowan-furnace',merchant:'rowan',text:'In the fantasy town, a worker injured by a furnace accident is severely exhausted. A mild restorative is insufficient for this request.' },
  { id:'rowan-shift',merchant:'rowan',text:'The bottling crew have light physical fatigue and small scrapes after an ordinary shift. They ask for a modest restorative.' },
  { id:'bram-expedition',merchant:'bram',text:'An injured fictional expedition returned from the old silver mine with significant wounds and severe exhaustion. They request a potent restorative.' },
  { id:'bram-ledger',merchant:'bram',text:'An uninjured, rested clerk is distracted while checking a delicate silver-dust ledger. The clerk needs better sustained concentration.' },
  { id:'bram-carriers',merchant:'bram',text:'Delivery carriers have a few scraped knuckles and ordinary physical tiredness. They ask for a mild, everyday restorative.' },
];

export function needForDay(merchant: MerchantId, day: number): MerchantNeed {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error('Invalid market day.');
  const needs = merchantNeeds.filter(n => n.merchant === merchant);
  if (needs.length !== 3) throw new Error('Unknown merchant.');
  return needs[(day - 1) % needs.length];
}

export function merchantQuestion(need: string): NoulRequest {
  if (typeof need !== 'string' || !need.trim() || new TextEncoder().encode(need).length > 1_000) throw new Error('Invalid merchant need.');
  const request: NoulRequest = {
    model: 'jev-latest',
    state: { setting: 'Fictional alchemy shop game. Judge only the stated potion descriptions and request.', request: need, potions: potionDescriptions },
    questions: Object.fromEntries(Object.keys(potionDescriptions).map(id => [id, { type: 'noul' as const, instructions: `Does ${id} meet the stated request under these fictional game descriptions?` }])),
  };
  requestBody(request);
  return request;
}

export function merchantExperiment() {
  return [...merchantNeeds, { id:'holdout-crate',text:'A traveller wants only a sturdy, dry wooden shipping crate. No potion or consumable is requested.' }]
    .map(need => ({ id: need.id, request: merchantQuestion(need.text) }));
}
