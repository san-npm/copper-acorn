import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const apiPort=process.env.GAME_API_PORT||'3902',webPort=process.env.GAME_WEB_PORT||'5181',localArt=process.env.VITE_PUBLIC_LOCAL_ART==='true';
const target=process.env.CARGO_TARGET_DIR||'target';
if(localArt)assert.ok(existsSync('.local/mana-review'),'Run npm run assets:playtest first.');
for(const path of ['debug/game-api','wasm32-unknown-unknown/release/briarbridge_alchemy.wasm','wasm32-unknown-unknown/release/briarbridge_arena.wasm'])assert.ok(existsSync(resolve(target,path)),'Build the contracts and local API first: '+path);
const env={...process.env,PLAYER_OWNERSHIP:'true',LOCAL_REFEREE_TOKEN:randomBytes(32).toString('hex'),GAME_API_PORT:apiPort,VITE_PUBLIC_LOCAL_ART:String(localArt),VITE_PUBLIC_LOCAL_SANDBOX:'true',VITE_PUBLIC_SUPABASE_URL:'',VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',JEV_NPC_REQUEST_LIMIT:'0'};
// This preview has no remaining live inference allowance; do not pass a provider credential to either process.
delete env.TYPESAFE_API_KEY;
const children=[spawn(resolve(target,'debug/game-api'),[],{env,stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--port',webPort],{env,stdio:'inherit'})];
let stopping=false;
function stop(code:number){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');}
for(const child of children){child.once('error',()=>stop(1));child.once('exit',code=>stop(code||0));}
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
console.log('Local demo: http://127.0.0.1:'+webPort+'/?owned=1 (disposable Sandbox; browser-only keys; no live chat).');
