import type { CharacterAccount } from './account';
import type { GameState } from './types';
import { classes, type CharacterId } from '../../backend/combat.ts';

export type Character = { id: string; name: string; file: string };
export const characterUrl = (file: string) => new URL(`assets/characters/${file}`, document.baseURI).href;
// Keep the saved IDs when an appearance is renamed (skeleton → Liche, lizard → Lizardman).
const ids = ['goblin', 'magician', 'dwarf', 'skeleton', 'lizard', 'vampire', 'elf', 'dark-elf'];

export async function loadCharacters(): Promise<Character[]> {
  const response = await fetch(characterUrl('manifest.json'), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Character artwork could not load. Refresh to try again.');
  const manifest = await response.json();
  if (manifest.frameSize !== 128 || JSON.stringify(manifest.anchor) !== '[64,124]' || manifest.columns !== 7 || manifest.walkFps !== 8
    || JSON.stringify(manifest.directions) !== JSON.stringify(['south', 'west', 'east', 'north'])
    || !Array.isArray(manifest.characters) || manifest.characters.length !== ids.length
    || manifest.characters.some((c: Character, i: number) => c.id !== ids[i] || c.file !== `${c.id}.png` || typeof c.name !== 'string')) {
    throw new Error('Character artwork is unavailable. Refresh to try again.');
  }
  return manifest.characters;
}

type CharacterScene = {
  characterAvailable(id: string): boolean;
  setCharacter(id: string | null): void;
  pauseMovement(paused: boolean): void;
};

export function initCharacters(characters: Character[], scene: CharacterScene, sandbox: boolean, saveAlchemist?:(id:string,nickname:string)=>Promise<void>, newGame?:()=>void) {
  const dialog = document.getElementById('character-dialog') as HTMLDialogElement;
  const choices = document.getElementById('character-choices')!;
  const openButton = document.getElementById('choose-character') as HTMLButtonElement;
  const use = document.getElementById('use-character') as HTMLButtonElement;
  const cancel = document.getElementById('cancel-character') as HTMLButtonElement;
  const status = document.getElementById('character-status')!;
  const note = document.getElementById('character-note')!;
  const name = document.getElementById('character-name')!;
  const portrait = document.getElementById('character-portrait')!;
  const preview = document.getElementById('character-preview')!;
  const previewName = document.getElementById('character-preview-name')!;
  const nickname = document.getElementById('nickname') as HTMLInputElement;
  const nicknameField = document.getElementById('nickname-field')!;
  const newButton=document.getElementById('character-new-game') as HTMLButtonElement;
  let world:GameState|null=null;
  let identityStarted=false;
  const identityMode=()=>world?.batch_limit===10;
  const locked=()=>identityMode()&&!!world?.alchemist;
  const validName=()=>{const v=nickname.value.trim();return [...v].length>=3&&[...v].length<=20&&/^[\p{L}\p{N} _-]+$/u.test(v);};
  const storageKey = 'copper-acorn.sandbox-character';
  let account: CharacterAccount | null = null;
  let usedAccount = false, ready = false, saving = false, selected: string | null = null, draft = characters[0]?.id;
  let prompted = '';
  const valid = (id: unknown) => typeof id === 'string' && characters.some(c => c.id === id) ? id : null;
  const owner = () => identityMode() ? world!.environment.world_id : account ? `${account.owner}:${account.version}` : sandbox && !usedAccount ? 'sandbox' : '';
  const canSave = () => !!owner() && !account?.loading && (!identityMode() || identityStarted && world?.environment.is_active!==false && !world?.pending_operation);
  const contextReady=()=>!!world&&(!account||world.environment.network==='testnet');
  function sprite(element: HTMLElement, id: string | null) {
    element.style.backgroundImage = id ? `url("${characterUrl(`${id}.png`)}")` : 'none';
  }
  function render() {
    const combat=document.getElementById('character-combat')!;
    const kit=draft&&Object.hasOwn(classes,draft)?classes[draft as CharacterId]:null;
    combat.hidden=!sandbox||!!account||!identityMode();
    if(kit)combat.innerHTML=`<summary>${kit.role} · Three combat skills</summary><ul>${kit.skills.map(s=>`<li><strong>${s.name}</strong> · ${s.ap} AP · ${s.text}</li>`).join('')}</ul><p class="help">All three are available at level 1. Combat power grows to level 20. Alchemy and trading skills are the same for every character.</p>`;
    const character = characters.find(c => c.id === selected);
    name.textContent = locked() ? `${world!.alchemist!.nickname} · ${character?.name}` : character?.name || 'Choose your alchemist';
    sprite(portrait, selected);
    status.textContent = account?.loading ? 'Restoring your character…' : account?.error || (character
      ? owner() === 'sandbox' ? 'Saved in this browser' : 'Saved with your account'
      : 'All characters share the same alchemy and trading skills.');
    if(locked())status.textContent='Character and nickname saved for this game';
    openButton.textContent=locked()?'Your alchemist':'Choose character';
    openButton.disabled=!characters.length||!contextReady()||identityMode()&&!identityStarted;
    nicknameField.hidden=!identityMode();
    nickname.disabled=saving||locked();
    newButton.hidden=!identityMode();
    if (!characters.length) status.textContent = 'Character artwork could not load. Refresh to try again.';
    if (ready && selected && !scene.characterAvailable(selected)) status.textContent = 'Your saved artwork could not load. Refresh to try again; your choice is preserved.';
    sprite(preview, draft || null);
    previewName.textContent = characters.find(c => c.id === draft)?.name || '';
    choices.querySelectorAll<HTMLInputElement>('input').forEach(input => {
      input.checked = input.value === draft;
      input.disabled = locked() || saving || !ready || !scene.characterAvailable(input.value);
    });
    use.hidden=locked();
    use.disabled = locked() || identityMode()&&!validName() || saving || !canSave() || !ready || !draft || !scene.characterAvailable(draft);
    use.textContent = saving ? 'Saving…' : 'Use this character';
    cancel.disabled = saving;
  }
  function open() {
    if (!characters.length || dialog.open || !contextReady() || identityMode()&&!identityStarted) return;
    draft = selected || characters.find(c => scene.characterAvailable(c.id))?.id || characters[0].id;
    note.textContent = account?.loading ? 'Restoring your saved choice…' : account?.error || (!canSave() ? 'Sign in with Google to save your choice.' : 'Choose an appearance. You can change it later.');
    if(identityMode())note.textContent=locked()?'This identity stays with this game. Start a new game to choose another.':'Choose your character and nickname. Both become permanent for this saved game.';
    render(); scene.pauseMovement(true); dialog.showModal();
  }
  function restore() {
    const previousSelection=selected;
    if(identityMode()) selected=valid(world?.alchemist?.character_id);
    else if (account) selected = account.loading ? null : valid(account.character);
    else {
      selected = null;
      if (owner() === 'sandbox') try { selected = valid(localStorage.getItem(storageKey)); } catch { /* Saving reports unavailable storage. */ }
    }
    if(previousSelection!==selected)scene.setCharacter(selected); render();
    if (ready && contextReady() && canSave() && !selected && prompted !== owner()) { prompted = owner(); open(); }
  }
  for (const character of characters) {
    const label = document.createElement('label'); label.className = 'character-option';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'character'; input.value = character.id;
    const image = document.createElement('span'); image.className = 'character-sprite'; image.setAttribute('aria-hidden', 'true'); sprite(image, character.id);
    const text = document.createElement('span'); text.textContent = character.name;
    label.append(input, image, text); choices.append(label);
    input.addEventListener('change', () => { draft = input.value; render(); });
  }
  openButton.disabled = !characters.length;
  if (!characters.length) status.textContent = 'Character artwork could not load. Refresh to try again.';
  openButton.addEventListener('click', open);
  nickname.addEventListener('input',render);
  newButton.addEventListener('click',()=>{dialog.close();newGame?.();});
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => { scene.pauseMovement(!!document.querySelector('dialog[open]')); openButton.focus({ preventScroll: true }); });
  use.addEventListener('click', async () => {
    if (use.disabled || !draft) return;
    const identity = owner(), choice = draft;
    saving = true; note.textContent = 'Saving your appearance…'; render();
    try {
      if(identityMode())await saveAlchemist!(choice,nickname.value.trim());
      else if (account) await account.save(choice);
      else localStorage.setItem(storageKey, choice);
      if (identity !== owner()) return;
      selected = choice; scene.setCharacter(choice); dialog.close();
      if (account) account = { ...account, character: choice, error: undefined };
    } catch {
      if (identity === owner()) note.textContent = 'Save could not be confirmed. Your displayed character has not changed. Try again.';
    } finally {
      if (identity === owner()) { saving = false; render(); }
    }
  });
  restore();
  return {
    world(next:GameState|null) {
      const previous=world?.environment.world_id;world=next;
      if(!next){selected=null;scene.setCharacter(null);render();return;}
      if(previous!==next?.environment.world_id){identityStarted=false;nickname.value=next?.alchemist?.nickname||'';prompted='';if(dialog.open&&!saving)dialog.close();}
      if(next?.alchemist)nickname.value=next.alchemist.nickname;
      restore();
    },
    ready() { ready = true; restore(); },
    enter() {identityStarted=true;restore();},
    account(next: CharacterAccount | null) {
      const previous = owner();
      account = next; if (next) usedAccount = true;
      if (previous !== owner()) { saving = false; if (dialog.open) dialog.close(); }
      restore();
      if (dialog.open && !saving) { note.textContent = next?.error || (canSave() ? 'Choose an appearance. You can change it later.' : 'Sign in with Google to save your choice.'); render(); }
    },
    requireSelection() { if (selected && ready && scene.characterAvailable(selected) && !account?.loading) return true; open(); return false; },
  };
}
