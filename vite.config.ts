import { defineConfig, loadEnv, type ProxyOptions, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import {localNpc} from './backend/local-npc.ts';
import { localArena } from './backend/local-arena.ts';

const proxy:Record<string,ProxyOptions> = { '/api': {
  target: `http://127.0.0.1:${process.env.GAME_API_PORT || '3001'}`, changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq',(outgoing,request)=>{
      const host=request.headers.host,origin=request.headers.origin;
      // Validate this loopback frontend before proxying to a preserved backend with older preview ports.
      if(process.env.VITE_PUBLIC_LOCAL_SANDBOX==='true'&&host&&/^(127\.0\.0\.1|localhost):\d{1,5}$/.test(host)&&origin===`http://${host}`)outgoing.removeHeader('origin');
    });
  },
} };

export default defineConfig(({ command,mode }) => {
  if(command==='build'&&mode==='playtest'){
    const settings=loadEnv(mode,resolve('web'),'VITE_PUBLIC_'),key=settings.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';
    let publicKey=/^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    if(!publicKey)try{publicKey=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon';}catch{}
    if(settings.VITE_PUBLIC_LOCAL_SANDBOX!=='false'||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(settings.VITE_PUBLIC_SUPABASE_URL||'')||!publicKey)throw new Error('Authenticated playtest builds require public Supabase settings and Sandbox explicitly disabled.');
  }
  return {
  plugins: [ ...(process.env.VITE_PUBLIC_LOCAL_SANDBOX==='true'&&command==='serve'?[{
    name:'local-duel-arena',
    configureServer(server:ViteDevServer){
      if(process.env.PLAYER_OWNERSHIP==='true')server.middlewares.use(localNpc({apiBase:`http://127.0.0.1:${process.env.GAME_API_PORT||'3001'}`,file:resolve(`.local/npc-${process.env.GAME_API_PORT||'3001'}.json`),apiKey:process.env.TYPESAFE_API_KEY,requestLimit:Number(process.env.JEV_NPC_REQUEST_LIMIT||'0')}));
      server.middlewares.use(localArena({apiBase:`http://127.0.0.1:${process.env.GAME_API_PORT||'3001'}`,file:resolve(`.local/arena-${process.env.GAME_API_PORT||'3001'}.json`),refereeToken:process.env.LOCAL_REFEREE_TOKEN}));},
  }]:[]) ],
  root: 'web',
  resolve:{alias:{buffer:resolve('node_modules/buffer/index.js')}},
  base: './',
  envPrefix: 'VITE_PUBLIC_',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  build: { outDir: 'dist', sourcemap: false },
  };
});
