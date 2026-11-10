import {classes} from '../../backend/combat.ts';

export const skillIds=Object.values(classes).flatMap(c=>c.skills.map(s=>s.id));
export const arenaAsset=(file:string)=>new URL(`assets/ui/${file}`,document.baseURI).href;
export function skillArt(id:string){
  const n=skillIds.indexOf(id);if(n<0)throw Error('Unknown skill art.');
  return `<span class="skill-art" aria-hidden="true" style="background-image:url('${arenaAsset('skills.png')}');background-position:${n%6*20}% ${Math.floor(n/6)*100/3}%"></span>`;
}
