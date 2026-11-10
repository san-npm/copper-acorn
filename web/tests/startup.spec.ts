import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createServer as createNetServer,type AddressInfo} from 'node:net';
import {createServer as createViteServer} from 'vite';
import {resolve} from 'node:path';
import {WORLD,spots} from '../src/isometric-layout';
import {makeDuel} from '../../backend/combat';

async function freePort(){
  const server=createNetServer();
  return new Promise<number>(resolve=>server.listen(0,'127.0.0.1',()=>{const port=(server.address() as AddressInfo).port;server.close(()=>resolve(port));}));
}

test('a fresh preview port starts with New game, saves the chosen alchemist once, and resumes without replacing it',async({page,request})=>{
  const apiPort=await freePort(),webPort=await freePort(),base=`http://127.0.0.1:${webPort}`;
  const api=spawn(resolve('target/debug/game-api'),[],{env:{...process.env,GAME_API_PORT:String(apiPort)},stdio:'ignore'});
  let server:Awaited<ReturnType<typeof createViteServer>>|undefined;
  const values={GAME_API_PORT:String(apiPort),VITE_PUBLIC_LOCAL_SANDBOX:'true',VITE_PUBLIC_SUPABASE_URL:'',VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''};
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  try{
    await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${apiPort}/api/state`)).status;}catch{return 0;}},{timeout:30_000}).toBe(200);
    Object.assign(process.env,values);
    server=await createViteServer({configFile:resolve('vite.config.ts'),server:{port:webPort,strictPort:true},logLevel:'silent'});await server.listen();
    expect((await request.get(base+'/api/state',{headers:{Origin:base}})).status()).toBe(200);
    expect((await request.post(base+'/api/action',{headers:{Origin:'https://untrusted.example'},data:{}})).status()).toBe(403);
    const state=async(world?:string)=>(await request.get(`http://127.0.0.1:${apiPort}/api/state${world?'?world_id='+world:''}`)).json();
    const initial=await state();const writes:object[]=[],newGames:string[]=[];
    page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/action')writes.push(r.postDataJSON());if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/new-game')newGames.push(r.url());});
    await page.goto(base);await expect(page.locator('#games-title')).toHaveText('Welcome to Copper Acorn');
    await expect(page.locator('#games-dialog')).toBeVisible();await expect(page.locator('#character-dialog')).not.toBeVisible();expect(writes).toEqual([]);
    await page.screenshot({path:'.local/start-flow/welcome.png',fullPage:true});
    await page.setViewportSize({width:320,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
    expect(await page.locator('#games-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:'.local/start-flow/welcome-mobile.png'});
    await page.setViewportSize({width:1440,height:1100});
    await page.locator('#new-game').click();await expect(page.locator('#character-dialog')).toBeVisible();
    await page.locator('#nickname').fill('Gobo');await page.getByRole('radio',{name:'Goblin',exact:true}).check();await page.locator('#use-character').click();
    await expect(page.locator('#character-dialog')).not.toBeVisible();await expect(page.locator('#character-name')).toHaveText('Gobo · Goblin');
    const saved=await state();expect(saved.alchemist).toEqual({nickname:'Gobo',character_id:'goblin'});expect(saved.player.next_action).toBe(initial.player.next_action+1);expect(newGames).toEqual([]);expect(writes).toHaveLength(1);
    await page.reload();await expect(page.locator('#character-name')).toHaveText('Gobo · Goblin');await expect(page.locator('#games-dialog')).not.toBeVisible();
    await page.evaluate(()=>sessionStorage.removeItem('copper-acorn.enter-world'));await page.reload();
    await expect(page.locator('#continue-game')).toHaveText('Continue Gobo');await page.locator('#continue-game').click();await expect(page.locator('#games-dialog')).not.toBeVisible();expect(writes).toHaveLength(1);
    await page.getByRole('button',{name:'Saved games',exact:true}).click();await page.locator('#new-game').click();await expect(page.locator('#character-dialog')).toBeVisible();
    expect(newGames).toHaveLength(1);expect((await state(initial.environment.world_id)).player).toEqual(saved.player);
    await page.locator('#cancel-character').click();await page.getByRole('button',{name:'Saved games',exact:true}).click();
    await page.getByRole('button',{name:/Gobo · Goblin/}).click();await expect(page.locator('#character-name')).toHaveText('Gobo · Goblin');
    expect((await state(initial.environment.world_id)).alchemist).toEqual(saved.alchemist);
    await page.screenshot({path:'.local/start-flow/started-game.png',fullPage:true});
  }finally{
    await server?.close();
    api.kill('SIGTERM');await new Promise<void>(resolve=>{if(api.exitCode!==null)resolve();else api.once('exit',()=>resolve());});
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('Google login is directly available and checks the provider before leaving the start screen',async({page})=>{
  let available=false,lookups=0,authorizations=0;
  await page.route('https://example.supabase.co/**',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
    const path=new URL(route.request().url()).pathname;
    if(path==='/auth/v1/settings')return route.fulfill({json:{external:{google:available}},headers:{'access-control-allow-origin':'*'}});
    if(path==='/auth/v1/authorize'){
      authorizations++;const address=new URL(route.request().url());
      expect(address.searchParams.get('provider')).toBe('google');expect(address.searchParams.get('code_challenge_method')).toBe('s256');
      return route.fulfill({contentType:'text/html',body:'<p>Simulated Google authorization</p>'});
    }
    lookups++;return route.fulfill({status:400,json:{error:'Unexpected account request'}});
  });
  try{
    await page.goto('/');await expect(page.locator('#games-dialog')).toBeVisible();
    await expect(page.locator('#account-signin')).toBeEnabled();await expect(page.locator('#character-dialog')).not.toBeVisible();
    await page.screenshot({path:'.local/start-flow/login.png'});
    await page.locator('#account-signin').click();await expect(page.locator('#account-status')).toContainText('Google login is not available');
    await expect(page.locator('#account-signin')).toBeEnabled();expect(authorizations).toBe(0);expect(lookups).toBe(0);
    available=true;await page.locator('#account-signin').click();
    await expect(page.getByText('Simulated Google authorization')).toBeVisible();expect(authorizations).toBe(1);expect(lookups).toBe(0);
  }finally{await page.unrouteAll({behavior:'wait'});}
});

for(const firstLogin of [true,false])test(`signed-in ${firstLogin?'first-time':'returning'} players choose a game before character creation`,async({page,request})=>{
  const state=await(await request.get('/api/state')).json(),world='20000000-0000-4000-8000-000000000001';
  const user={id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',user_metadata:{character_id:'goblin'}};
  const expires=Math.floor(Date.now()/1000)+3600,token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'simulated'].join('.');
  Object.assign(state.environment,{network:'testnet',world_id:world,is_active:true});state.player.account_id='ca-'+world.replaceAll('-','')+'.testnet';state.pending_operation=null;
  state.alchemist=firstLogin?null:{nickname:'Gobo',character_id:'goblin'};
  const methods:string[]=[];let prepared=!firstLogin,actions=0,arenaCalls=0;
  const arenaProfile={id:world,nickname:'Gobo',character:'goblin' as const,xp:0,wins:0,losses:0};let match:ReturnType<typeof makeDuel>|null=null;
  await page.addInitScript(({token,expires,user})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'simulated',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{token,expires,user});
  await page.route('https://example.supabase.co/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname;
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
    let body:unknown;
    if(path==='/auth/v1/user')body=user;
    else if(path.endsWith('/game-session')){methods.push(r.method());if(r.method()==='POST')prepared=true;body=prepared?{world:{id:world,status:'ready',is_active:true},wallet:{account_id:state.player.account_id,funded_at:'2026-11-05T00:00:00Z'}}:{world:null,wallet:null};}
    else if(path.endsWith('/game-api/state'))body=state;
    else if(path.endsWith('/game-api/saves'))body={saves:[{world_id:world,is_active:true,alchemist:state.alchemist}],limit:2,active_world_id:world};
    else if(path.endsWith('/arena-api')){
      arenaCalls++;expect(r.headers().authorization).toBe('Bearer '+token);expect(new URL(r.url()).searchParams.getAll('world_id')).toEqual([world]);
      if(r.method()==='POST'){
        const action=r.postDataJSON();expect(action.request_id).toMatch(/^[0-9a-f-]{36}$/);
        if(action.kind==='practice'){match=makeDuel('40000000-0000-4000-8000-000000000001',[arenaProfile,{...arenaProfile,id:'trainer-'+world,nickname:'Captain Cluck'}],Date.now(),0);match.training=true;}
        else if(action.kind==='stop-practice')match=null;
        else throw Error('Unexpected arena mutation');
      }
      body={now:Date.now(),profile:{...arenaProfile,level:1,position:[600,650]},players:[],invitations:[],match,acknowledged:[]};
    }
    else{if(r.method()==='POST')actions++;return route.fulfill({status:400,json:{error:'Unexpected mutation'}});}
    return route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
  });
  try{
    await page.goto('/');await expect(page.locator('#games-dialog')).toBeVisible();await expect(page.locator('#character-dialog')).not.toBeVisible();
    if(firstLogin){
      await expect(page.locator('#games-status')).toContainText('create your first shop');expect(methods).toEqual(['GET']);
      await page.locator('#new-game').click();await expect(page.locator('#character-dialog')).toBeVisible();expect(methods).toEqual(['GET','POST']);
      await expect(page.locator('#nickname')).toHaveValue('');
    }else{
      await expect(page.locator('#continue-game')).toHaveText('Continue Gobo');expect(methods).toEqual(['GET']);
      await page.locator('#continue-game').click();await expect(page.locator('#games-dialog')).not.toBeVisible();await expect(page.locator('#character-name')).toHaveText('Gobo · Goblin');
      const canvas=page.locator('#game canvas'),bounds=(await canvas.boundingBox())!,portal=spots.find(s=>s.kind==='arena')!;
      await canvas.click({position:{x:portal.at[0]*bounds.width/WORLD.width,y:portal.at[1]*bounds.height/WORLD.height}});
      await expect(page.locator('#arena-dialog')).toBeVisible();await expect(page.locator('.arena-profile')).toContainText('Gobo');
      await page.locator('[data-person=trainer]').click();await page.locator('[data-fight=trainer]').click();await expect(page.locator('.arena-board')).toBeVisible();
      await page.locator('#arena-stop').click();await expect(page.locator('[data-walkmap]')).toBeVisible();expect(arenaCalls).toBeGreaterThanOrEqual(3);
      delete state.batch_limit;delete state.alchemist;
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(()=>history.replaceState(null,'',location.pathname));await page.reload();
      await expect(page.locator('#character-name')).toHaveText('Goblin');
      const legacyBounds=(await canvas.boundingBox())!;
      await canvas.click({position:{x:portal.at[0]*legacyBounds.width/WORLD.width,y:portal.at[1]*legacyBounds.height/WORLD.height}});
      await expect(page.locator('#arena-dialog')).toBeVisible();await expect(page.locator('.arena-profile')).toContainText('Gobo');
    }
    expect(actions).toBe(0);
  }finally{await page.unrouteAll({behavior:'wait'});}
});

test('one explicit New game waits for free funding and pending setup before opening character creation',async({page,request})=>{
  const state=await(await request.get('/api/state')).json(),world='20000000-0000-4000-8000-000000000002',user={id:'10000000-0000-4000-8000-000000000002',aud:'authenticated',role:'authenticated',user_metadata:{}};
  const expires=Math.floor(Date.now()/1000)+3600,token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'simulated'].join('.');
  Object.assign(state.environment,{network:'testnet',world_id:world,is_active:true});state.player.account_id='ca-'+world.replaceAll('-','')+'.testnet';state.alchemist=null;state.pending_operation=null;
  let created=false,fundingReads=0,provisions=0,posts=0;
  await page.addInitScript(({token,expires,user})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'simulated',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{token,expires,user});
  await page.route('https://example.supabase.co/**',async route=>{
    const r=route.request(),url=new URL(r.url());
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
    let body:unknown;
    if(url.pathname==='/auth/v1/user')body=user;
    else if(url.pathname.endsWith('/game-session')){
      if(r.method()==='POST'){created=true;posts++;}else if(created){fundingReads++;expect(url.searchParams.get('world_id')).toBe(world);}
      body=created?{world:{id:world,status:'provisioning',is_active:true},wallet:{account_id:state.player.account_id,funding_requested_at:'2026-11-09T00:00:00Z',funded_at:fundingReads?'2026-11-09T00:00:01Z':null}}:{world:null,wallet:null};
    }else if(url.pathname.endsWith('/game-api/provision')){provisions++;body=provisions===1?{ready:false,step:'owner',operation:{status:'pending'}}:{ready:true};}
    else if(url.pathname.endsWith('/game-api/state'))body=state;
    else if(url.pathname.endsWith('/game-api/saves'))body={saves:[{world_id:world,is_active:true,alchemist:null}],limit:2,active_world_id:world};
    else return route.fulfill({status:400,json:{error:'Unexpected setup request'}});
    return route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
  });
  try{
    await page.goto('/');await expect(page.locator('#games-status')).toContainText('create your first shop');await page.locator('#new-game').click();
    await expect(page.locator('#account-status')).toContainText('Free account setup');await expect(page.locator('#character-dialog')).toBeVisible();
    expect(posts).toBe(1);expect(fundingReads).toBe(1);expect(provisions).toBe(2);await expect(page.locator('#nickname')).toHaveValue('');
  }finally{await page.unrouteAll({behavior:'wait'});}
});
