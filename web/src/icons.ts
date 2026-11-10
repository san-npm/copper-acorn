const items = ['sunleaf','moonmint','emberbloom','spring_water','wood_essence','silver_dust','healing_tonic','focus_draught','restoration_elixir','copper'];
export function itemUrl(id: string) {
  if (!items.includes(id)) throw new Error('Unknown item artwork');
  return new URL(`assets/items/${id}.png`, document.baseURI).href;
}

export function icon(id: string, size = 32): string {
  return `<img class="item-icon" src="${itemUrl(id)}" width="${size}" height="${size}" alt="" aria-hidden="true">`;
}
