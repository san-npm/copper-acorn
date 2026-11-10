import {saveAccountCharacter} from './account-character';
import {gameMessage} from './game-message';
import { createClient } from '@supabase/supabase-js';
import {initOwnedAccount} from './owned-account';

export type GameConnection = <T>(path: string, init?: RequestInit) => Promise<T>;
export type CharacterAccount = { owner: string; version: number; character: unknown; loading: boolean; error?: string; save: (id: string) => Promise<void> };
export type AccountControls = {prepare:()=>Promise<boolean|void>;loading:()=>boolean;newGameAvailable?:boolean};
export function initAccount(connected: (connection: GameConnection | null, enter?:boolean) => void, appearance: (account: CharacterAccount | null) => void):AccountControls|undefined {
  if(import.meta.env.VITE_PUBLIC_PLAYER_OWNERSHIP==='true')return initOwnedAccount(connected,appearance);
  const root = document.getElementById('online-account')!;
  const url = import.meta.env.VITE_PUBLIC_SUPABASE_URL;
  const key = import.meta.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  root.innerHTML = '<h3>Your account</h3><p>Continue with Google to restore your shop, inventory and story.</p><p id="account-status" role="status">Sign in to find your games.</p><button id="account-signin" disabled>Continue with Google</button><button id="account-check" class="secondary">Check account setup</button><button id="account-save" hidden>Finish account setup</button><button id="account-signout" hidden>Sign out</button>';
  const status = document.getElementById('account-status')!;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const check = button('account-check'), signin = button('account-signin'), save = button('account-save'), signout = button('account-signout');
  if (!url || !key) {
    status.textContent = 'Online sign-in is unavailable in this build. Your practice shop is available.';
    check.disabled = true;
    return;
  }
  const setupKey = 'copper-acorn.setup-world', address = new URL(location.href);
  const validWorld = (value: string | null): value is string => !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  let selectedWorld = address.searchParams.get('world_id');
  try {
    const continuation = sessionStorage.getItem(setupKey);
    sessionStorage.removeItem(setupKey);
    if (selectedWorld === null && validWorld(continuation)) {
      selectedWorld = continuation; address.searchParams.set('world_id', continuation);
      history.replaceState(history.state, '', address);
    }
  } catch { /* An explicit setup link still works when continuation storage is unavailable. */ }
  if (selectedWorld !== null && (!validWorld(selectedWorld) || address.searchParams.getAll('world_id').length !== 1)) {
    status.textContent = 'This shop setup link is invalid. Open the normal game link to return.';
    check.disabled = true; return;
  }
  const selectShop = (path: string) => selectedWorld ? `${path}${path.includes('?') ? '&' : '?'}world_id=${selectedWorld}` : path;
  const client = createClient(url, key, { auth: { flowType: 'pkce' } });
  let signedIn = false;
  let checking = false;
  let generation = 0;
  let owner: string | null = null;
  let profileVersion = 0;
  let profile: CharacterAccount | null = null;
  const returnUrl = new URL(location.pathname, location.origin).href;
  function characterAccount(character: unknown, loading: boolean, error?: string): CharacterAccount {
    const identity = owner!, version = generation;
    return { owner: identity, version, character, loading, error, save: async id => {
      const current = () => identity === owner && version === generation;
      if (!current()) throw new Error('Account changed.');
      profileVersion++;
      const { data: { session } } = await client.auth.getSession();
      if (!current() || session?.user.id !== identity) throw new Error('Sign in again to save your character.');
      await saveAccountCharacter(url,key,session.access_token,identity,id,current);
      profileVersion++;
      profile = characterAccount(id, false);
    } };
  }
  async function loadCharacter() {
    const version = generation, revision = ++profileVersion, identity = owner;
    if (!identity) return;
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session || session.user.id !== identity || generation !== version) return;
      // Read the server profile: a cached session can contain an older cosmetic choice.
      const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!response.ok) throw new Error('Character could not be restored. Choose one to save again.');
      const result = await response.json(), user = result.user || result;
      if (user.id !== identity) throw new Error('Character could not be restored.');
      if (generation !== version || profileVersion !== revision) return;
      profile = characterAccount(user.user_metadata?.character_id, false); appearance(profile);
    } catch {
      if (generation !== version || profileVersion !== revision) return;
      profile = characterAccount(profile?.character, false, 'Character could not be restored. Choose one to save again.'); appearance(profile);
    }
  }
  async function gameRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const started = generation;
    const { data: { session } } = await client.auth.getSession();
    if (!session || started !== generation) throw new Error('Sign in to restore your saved shop.');
    if(path.startsWith('/arena?')&&selectedWorld&&new URLSearchParams(path.slice('/arena?'.length)).get('world_id')!==selectedWorld)throw new Error('Your saved game changed. Re-enter the arena.');
    const endpoint=path.startsWith('/arena?')?'arena-api'+path.slice('/arena'.length):'game-api'+selectShop(path);
    const response = await fetch(`${url}/functions/v1/${endpoint}`, { ...init,
      headers: { ...init?.headers, apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000), redirect: 'error' });
    const body = await response.json();
    if (started !== generation) throw new Error('Account changed; refresh your shop.');
    if (!response.ok) throw Object.assign(new Error(gameMessage(body.error,'The saved shop could not be reached.')), { status: response.status });
    return body as T;
  }

  async function loadAccount(create = false) {
    if (checking) return;
    const started = generation;
    checking = true; check.disabled = true; save.disabled = true;
    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw new Error('Sign-in could not be restored. Check the Google setup and sign in again.');
      signedIn = !!session;
      signin.hidden = signedIn; signout.hidden = !signedIn; save.hidden = true;
      if (!session) { connected(null); status.textContent = 'Not signed in. Continue with Google to find your saved games.'; return; }
      const response = await fetch(`${url}/functions/v1/${selectShop('game-session')}`, {
        method: create ? 'POST' : 'GET',
        headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: create ? '{}' : undefined,
        signal: AbortSignal.timeout(45_000), redirect: 'error',
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session needs a fresh sign-in.' : 'Saved account could not be checked. Use Check account setup before trying again.');
      let result = await response.json();
      if (started !== generation) return;
      if (selectedWorld && result.world?.id !== selectedWorld) throw new Error('The selected shop could not be confirmed. Your active shop has not been selected instead.');
      if(create&&validWorld(result.world?.id)&&result.wallet?.funding_requested_at&&!result.wallet.funded_at){
        const world=result.world.id,deadline=Date.now()+45_000;
        while(!result.wallet?.funded_at&&Date.now()<deadline){
          status.textContent='Opening your shop… Free account setup is in progress.';
          await new Promise(resolve=>setTimeout(resolve,1200));if(started!==generation)return;
          const checked=await fetch(`${url}/functions/v1/game-session?world_id=${world}`,{headers:{apikey:key,Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(15_000),redirect:'error'});
          if(!checked.ok)throw new Error('Free account setup could not be confirmed. Choose New game to check the saved setup.');
          result=await checked.json();if(started!==generation)return;
          if(result.world?.id!==world)throw new Error('Your saved game changed. Open saved games again.');
        }
      }
      const wallet = result.wallet;

      if (result.world === null) {
        status.textContent = 'Signed in. Choose New game to create your first shop.';
        save.hidden = false;
      } else if (typeof result.world?.id === 'string' && ['pending', 'provisioning', 'ready', 'paused'].includes(result.world.status)) {
        if (wallet && /^ca-[a-f0-9]{32}\.testnet$/.test(wallet.account_id)) {

          status.textContent = wallet.funded_at
            ? 'Your game account is ready.'
            : 'Your game account is reserved. Setup is pending; check again to see the result.';
          save.hidden = !!wallet.funding_requested_at || !!wallet.funded_at;
          if (wallet.funded_at) {
            let ready = result.world.status === 'ready';
            const setupDeadline=Date.now()+60_000;
            if (!ready && create) for (let step = 0; step < 30&&Date.now()<setupDeadline; step++) {
              status.textContent = 'Preparing your saved shop…';
              const setup = await gameRequest<{ ready: boolean; step?: string; operation?: { status: string; error?: string } }>('/provision', { method: 'POST', body: '{}' });
              if (started !== generation) return;
              if (setup.ready) { ready = true; break; }
              if (setup.operation?.status === 'failed') throw new Error(setup.operation.error || 'Shop setup needs another check.');
              if (setup.operation?.status !== 'confirmed')await new Promise(resolve=>setTimeout(resolve,1200));
              if(started!==generation)return;
            }
            save.hidden = ready;
            if (ready) { status.textContent = result.world.is_active === false ? 'Shop preview ready. Your current shop remains active.' : 'Your saved shop is ready. Your inventory and story restore when you sign in.'; connected(gameRequest);return true; }
            else status.textContent = 'Your shop needs to finish opening. Choose New game to continue the saved setup.';
          }
        } else {
          status.textContent = 'Signed in. Choose New game to prepare your shop.';
          save.hidden = false;
        }
      } else throw new Error('Account service returned an unsupported response.');
    } catch (error) {
      if (started === generation) status.textContent = error instanceof Error ? gameMessage(error.message) : 'Account connection failed. No game action was submitted.';
    } finally {
      checking = false; check.disabled = false; save.disabled = false;
      if(started===generation&&profile)appearance(profile);
      if (started !== generation) setTimeout(() => void loadAccount(), 0);
    }
  }

  check.addEventListener('click', async () => {
    check.disabled = true;
    try {
      const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!response.ok) throw new Error('Account setup could not be checked.');
      const settings = await response.json();
      signin.disabled = settings.external?.google !== true;
      status.textContent = signin.disabled ? 'Google sign-in is unavailable right now. Please try again later.' : 'Google sign-in is configured. Continue with your allowed Google account.';
      if (signedIn) await loadAccount(false);
    } catch { status.textContent = 'Account setup could not be checked. Try again when the connection returns.'; }
    finally { check.disabled = false; }
  });
  async function signIn() {
    signin.disabled = true;
    try {
      const response=await fetch(`${url}/auth/v1/settings`,{headers:{apikey:key},signal:AbortSignal.timeout(10_000),redirect:'error'});
      if(!response.ok||(await response.json()).external?.google!==true)throw new Error('Google login is not available yet. Please try again later.');
      if (selectedWorld) sessionStorage.setItem(setupKey, selectedWorld);
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl } });
      if (error) throw error;
    } catch(error) { status.textContent = error instanceof Error?gameMessage(error.message):'Google sign-in could not start. Try again.'; signin.disabled = false; }
  }
  signin.disabled=false;
  signin.addEventListener('click',()=>void signIn());
  save.addEventListener('click', () => void loadAccount(true));
  signout.addEventListener('click', async () => {
    const { error } = await client.auth.signOut({ scope: 'local' });
      status.textContent = error ? 'Sign-out could not be confirmed.' : 'Signed out. Your confirmed shop inventory remains saved.';
  });
  // Auth callbacks stay synchronous; SDK calls run after the callback releases its session lock.
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'USER_UPDATED' && session?.user.id !== owner) return;
    if ((session?.user.id || null) === owner && event !== 'INITIAL_SESSION') {
      if (owner) setTimeout(() => void loadCharacter(), 0);
      return;
    }
    generation++;
    profileVersion++;
    owner = session?.user.id || null;
    profile = owner ? characterAccount(undefined, true) : null;
    appearance(profile);
    connected(null);
    if (!session) { signedIn = false; save.hidden = true; signout.hidden = true; signin.hidden = false;  status.textContent = 'Not signed in. Continue with Google to find your saved games.'; }
    setTimeout(() => { void loadCharacter(); void loadAccount(); }, 0);
  });
  if (new URL(location.href).searchParams.has('error')) status.textContent = 'Google sign-in did not complete. Check the provider and return URL setup.';
  return {prepare:()=>loadAccount(true),loading:()=>checking};
}
