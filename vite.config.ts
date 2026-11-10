import { defineConfig, loadEnv, type ProxyOptions, type ViteDevServer } from 'vite';
import { readFile,cp,mkdir } from 'node:fs/promises';
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
  const localArt = process.env.VITE_PUBLIC_LOCAL_ART === 'true';
  if (localArt && command === 'build' && mode!=='playtest') throw new Error('Accepted artwork requires the explicitly selected playtest build mode.');
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
  }]:[]), ...(localArt ? [{
    name: 'private-local-art',
    async closeBundle(){
      if(command!=='build')return;
      for(const folder of ['characters','actions'])await cp(resolve('.local/mana-review/assets',folder),resolve('web/dist/assets',folder),{recursive:true});
      await mkdir(resolve('web/dist/assets/market'),{recursive:true});
      for(const name of ['mira','rowan','bram'])await cp(resolve('.local/mana-review',name+'.png'),resolve('web/dist/assets/market',name+'.png'));
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = new URL(request.url || '/', 'http://localhost').pathname;
        let file = '';
        if (/^\/assets\/characters\/(manifest\.json|[a-z-]+\.png)$/.test(path)) file = path.slice(1);
        else if (/^\/assets\/actions\/(manifest\.json|[a-z-]+\.png)$/.test(path)) file = path.slice(1);
        else if (/^\/assets\/market\/(mira|rowan|bram)\.png$/.test(path)) file = path.split('/').pop()!;
        else return next();
        try {
          const body = await readFile(resolve('.local/mana-review', file));
          response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'image/png');
          response.setHeader('Cache-Control', 'no-store');
          response.end(body);
        } catch { response.statusCode = 404; response.end('Local artwork not built.'); }
      });
    },
  }] : []) ],
  root: 'web',
  resolve:{alias:{buffer:resolve('node_modules/buffer/index.js')}},
  base: './',
  envPrefix: 'VITE_PUBLIC_',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  build: { outDir: 'dist', sourcemap: false },
  };
});
