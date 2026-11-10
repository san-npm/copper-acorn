import Phaser from 'phaser';
import type { Action, GameState } from './types';
import { characterUrl, type Character } from './characters';
import { itemUrl } from './icons';
import { Navigation, distance, inside, type Point } from './navigation';
import { WORLD, ACTOR, ARENA_GATE, spots, surfaces, solids, portalBase, occluders, merchants, displays, type Spot } from './isometric-layout';
import { actionUrl, localArt, workKind, type WorkArt } from './action-art';
import {TownAmbient} from './ambient';

type Work = { art: WorkArt; spot: Spot; stage: 'approach' | 'pending' | 'confirmed'; frame: number; elapsed: number; ready: ((value: boolean) => void) | null; finished: (() => void) | null };

export class MarketScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private character: string | null = null;
  private facing = 0;
  private paused = false;
  private merchantSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private shadow!: Phaser.GameObjects.Ellipse;
  private stock: Phaser.GameObjects.Image[] = [];
  private actors: { sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; holes: Point[][]; mask: Phaser.Display.Masks.GeometryMask }[] = [];
  private keys = new Set<string>();
  private route: Point[] = [];
  private pendingSpot: Spot | null = null;
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private latest: GameState | null = null;
  private nav = new Navigation(WORLD.width, WORLD.height, surfaces, [...solids,portalBase], ACTOR.radius);
  private region = '';
  private work: Work | null = null;
  private tools!: Phaser.GameObjects.Sprite;
  private effects!: Phaser.GameObjects.Sprite;
  private ambient?:TownAmbient;

  constructor(private interact: (kind: Spot['kind'], target: string) => void, private characters: Character[], private ready: () => void, private workArt: WorkArt[] = []) { super('market'); }

  preload() {
    this.load.image('arena-portal',new URL('assets/ui/arena-portal.png',document.baseURI).href);
    this.load.image('isometric-world', new URL('assets/isometric/world.png', document.baseURI).href);
    for (const name of ['mira', 'rowan', 'bram']) this.load.image(`merchant-${name}`, new URL(`assets/market/${name}.png`, document.baseURI).href);
    for (const c of this.characters) this.load.spritesheet(`character-${c.id}`, characterUrl(c.file), { frameWidth: ACTOR.frame, frameHeight: ACTOR.frame });
    for (const id of ['healing_tonic', 'focus_draught', 'restoration_elixir']) this.load.image(`stock-${id}`, itemUrl(id));
    for (const art of this.workArt) {
      for (const c of this.characters) this.load.spritesheet(`work-${c.id}-${art.id}`, actionUrl(art.files[c.id]), { frameWidth: 256, frameHeight: 256 });
      for (const layer of ['tools', 'effects']) this.load.spritesheet(`work-${art.id}-${layer}`, actionUrl(`${art.id}-${layer}.png`), { frameWidth: 256, frameHeight: 256 });
    }
  }

  characterAvailable(id: string) { return this.characters.some(c => c.id === id) && this.textures?.exists(`character-${id}`) === true; }

  setCharacter(id: string | null) {
    this.cancelMovement();
    this.character = id;
    if (!this.player) return;
    this.player.stop(); this.facing = 0;
    const available = !!id && this.characterAvailable(id);
    this.player.setVisible(available); this.shadow.setVisible(available);
    if (available) this.player.setTexture(`character-${id}`, 0).setScale(ACTOR.scale).setOrigin(.5, ACTOR.feet / ACTOR.frame);
    this.announce();
  }

  private announce() {
    const name = this.character && this.characterAvailable(this.character) ? this.characters.find(c => c.id === this.character)!.name : 'No character selected';
    const stock = this.latest?.listings.filter(l => BigInt(this.latest!.player.balances[l.token_id] || '0') > 0n).map(l => `${this.latest!.player.balances[l.token_id]} ${this.latest!.catalog.find(i => i.token_id === l.token_id)?.name}`).join(', ');
    this.game.canvas.setAttribute('aria-label', `Isometric pixel market. ${name}. ${this.region || 'Courtyard'}. Cabinets: ${stock || 'empty'}. Click a destination or object. Use WASD or arrow keys to move; E to interact. The Arena of Eight portal stands on the southern courtyard path; approach it and press E.`);
  }

  pauseMovement(paused: boolean) {
    this.paused = paused; if (paused) this.cancelMovement();
  }

  cancelMovement() {
    this.keys.clear(); this.route = []; this.pendingSpot = null;
    this.clearWork();
    if (this.player) this.idle();
  }

  private tell(text: string) {
    const status = document.getElementById('map-status')!;
    if (status.textContent !== text) status.textContent = text;
  }

  private idle() {
    this.player.stop();
    if (this.characterAvailable(this.character || '')) this.player.setTexture(`character-${this.character}`, this.facing * 7).setOrigin(.5, ACTOR.feet / ACTOR.frame).setScale(ACTOR.scale);
  }

  async prepareWork(action: Action): Promise<boolean> {
    const kind = workKind(action);
    if (!localArt || !kind) return true;
    const art = this.workArt.find(a => a.id === kind);
    if (!art || !this.player || !this.character || !this.textures.exists(`work-${this.character}-${kind}`)) throw new Error('Action artwork is unavailable. No action was submitted.');
    const spot = spots.find(s => s.id === (action.kind === 'brew' ? 'cauldron' : 'token_id' in action ? action.token_id : ''))!;
    const path = spot && this.nav.path([this.player.x, this.player.y], spot.approach);
    if (!path) throw new Error('This gathering spot cannot be reached. No action was submitted.');
    this.cancelMovement(); this.paused = false;
    return new Promise(resolve => {
      this.work = { art, spot, stage: 'approach', frame: 1, elapsed: 0, ready: resolve, finished: null };
      this.route = path;
      this.game.canvas.focus();
      this.game.canvas.dataset.work = 'approach';
      this.tell(`Walking to ${spot.label}. Escape cancels before submission.`);
      if (this.motion.matches || distance([this.player.x, this.player.y], spot.approach) < 1) {
        this.player.setPosition(...spot.approach); this.route = []; this.beginWork(); this.location();
      }
    });
  }

  finishWork(success: boolean): Promise<void> {
    if (!this.work) return Promise.resolve();
    if (!success || this.motion.matches) { this.clearWork(); return Promise.resolve(); }
    this.work.stage = 'confirmed';
    this.work.frame = this.work.art.resultFrame; this.work.elapsed = 0; this.drawWork();
    return new Promise(resolve => { this.work!.finished = resolve; });
  }

  private beginWork() {
    const work = this.work;
    if (!work || work.stage !== 'approach') return;
    const target = work.spot.ground || work.spot.at;
    const dx = target[0] - this.player.x, dy = target[1] - this.player.y;
    this.facing = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 1 : 2 : dy < 0 ? 3 : 0;
    work.stage = 'pending'; this.player.stop(); this.drawWork();
    this.shadow.setPosition(this.player.x, this.player.y + 2);
    work.ready?.(true); work.ready = null;
    this.tell(`${work.art.name} · working. Your goods update when confirmed.`);
  }

  private drawWork() {
    const work = this.work; if (!work) return;
    const frame = this.facing * 8 + work.frame;
    this.player.setTexture(`work-${this.character}-${work.art.id}`, frame).setOrigin(.5, 176 / 256).setScale(ACTOR.scale);
    for (const [sprite, layer] of [[this.tools, 'tools'], [this.effects, 'effects']] as const) {
      sprite.setTexture(`work-${work.art.id}-${layer}`, frame).setPosition(this.player.x, this.player.y).setOrigin(.5, 176 / 256).setScale(ACTOR.scale).setDepth(this.facing === 3 ? 1.5 : 3).setVisible(true);
    }
    const canvas = this.game.canvas;
    canvas.dataset.work = work.stage; canvas.dataset.workAction = work.art.id;
    canvas.dataset.workFrame = String(work.frame); canvas.dataset.facing = ['south', 'west', 'east', 'north'][this.facing];
  }

  private updateWork(delta: number) {
    const work = this.work; if (!work || this.motion.matches) return;
    work.elapsed += Math.min(delta, 100);
    if (work.elapsed < work.art.durations[work.frame]) return;
    if (work.frame + 1 === work.art.resultFrame && work.stage === 'pending') {
      // Repeat the working motion without showing the unconfirmed result frames.
      work.frame = work.art.id === 'brew' ? 2 : 1; work.elapsed = 0; this.drawWork();
      return;
    }
    work.elapsed = 0; work.frame++;
    if (work.frame === 8) { this.clearWork(); return; }
    this.drawWork();
  }

  private clearWork() {
    const work = this.work; this.work = null;
    work?.ready?.(false); work?.finished?.();
    this.tools?.setVisible(false); this.effects?.setVisible(false);
    if (this.player) this.idle();
    if (work) this.tell('Ready to gather, brew or trade.');
    if (this.game?.canvas) { this.game.canvas.dataset.work = 'idle'; delete this.game.canvas.dataset.workAction; delete this.game.canvas.dataset.workFrame; }
  }

  private actor(x: number, y: number, texture: string, scale: number) {
    const shadow = this.add.ellipse(x, y, 59, 16, 0x253b31, .25).setDepth(1);
    const sprite = this.add.sprite(x, y, texture).setOrigin(.5, ACTOR.feet / ACTOR.frame).setScale(scale).setDepth(2);
    const graphics = this.add.graphics().setVisible(false);
    const mask = graphics.createGeometryMask();
    const actor = { sprite, shadow, holes: [] as Point[][], mask };
    // Intersect outside clips so overlapping foreground silhouettes still hide the actor.
    mask.preRenderCanvas = renderer => {
      const context = renderer.currentContext; context.save();
      // Sprite batches may call masks after applying their transform; silhouettes stay in camera space.
      // shortcut: this scene uses a fixed 1× camera; include its view transform if pan/zoom is added.
      const transform = context.getTransform(); context.setTransform(1, 0, 0, 1, 0, 0);
      for (const outline of actor.holes) {
        context.beginPath(); context.rect(0, 0, WORLD.width, WORLD.height);
        context.moveTo(...outline[0]); outline.slice(1).forEach(([x, y]) => context.lineTo(x, y)); context.closePath();
        context.clip('evenodd');
      }
      context.setTransform(transform);
    };
    this.actors.push(actor);
    return { sprite, shadow };
  }

  create() {
    this.cameras.main.setRoundPixels(true);
    this.add.image(0, 0, 'isometric-world').setOrigin(0);
    const activeSpots=spots;
    const portal=activeSpots.some(s=>s.kind==='arena')?this.add.image(...ARENA_GATE.feet,'arena-portal').setOrigin(.5,1216/1293).setDisplaySize(ARENA_GATE.width,ARENA_GATE.height).setDepth(1.5):null;
    for (const c of this.characters) if (this.characterAvailable(c.id)) for (let row = 0; row < 4; row++) {
      this.anims.create({ key: `${c.id}-${row}`, frames: this.anims.generateFrameNumbers(`character-${c.id}`, { start: row * 7 + 1, end: row * 7 + 6 }), frameRate: 8, repeat: -1 });
    }
    for (const merchant of merchants) this.merchantSprites.set(merchant.id, this.actor(merchant.feet[0], merchant.feet[1] - (localArt && merchant.id !== 'rowan' ? 15 : 0), `merchant-${merchant.id}`, ACTOR.scale).sprite);
    const actor = this.actor(...WORLD.spawn, '__WHITE', 1);
    this.player = actor.sprite; this.shadow = actor.shadow;
    this.tools = this.add.sprite(0, 0, '__WHITE').setVisible(false);
    this.effects = this.add.sprite(0, 0, '__WHITE').setVisible(false);
    this.ambient=new TownAmbient(this,this.merchantSprites,localArt);
    const atSpot = (point: Point) => {
      if(portal?.getBounds().contains(...point))return activeSpots.find(s=>s.kind==='arena');
      const npc = [...this.merchantSprites].find(([, sprite]) => sprite.getBounds().contains(...point));
      return npc ? spots.find(s => s.id === npc[0]) : activeSpots.filter(spot => distance(point, spot.at) < spot.radius).sort((a, b) => distance(point, a.at) - distance(point, b.at))[0];
    };
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const spot = atSpot([pointer.worldX, pointer.worldY]);
      this.game.canvas.style.cursor = spot ? 'pointer' : this.nav.walkable([pointer.worldX, pointer.worldY]) ? 'crosshair' : 'default';
      this.tell(spot?.label || 'Click to walk · WASD or arrows · E to interact.');
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.paused) return;
      if (this.work?.stage === 'approach') this.cancelMovement();
      else if (this.work) return;
      const point: Point = [pointer.worldX, pointer.worldY], spot = atSpot(point);
      this.go(spot?.approach || point, spot || null); this.game.canvas.focus();
    });
    const canvas = this.game.canvas; canvas.tabIndex = 0;
    const down = (event: KeyboardEvent) => {
      if (this.paused || event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (this.work?.stage === 'approach' && (key === 'escape' || ['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright'].includes(key))) { this.cancelMovement(); this.tell('Action canceled before submission.'); }
      else if (this.work) return;
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) {
        event.preventDefault(); this.keys.add(key); this.route = []; this.pendingSpot = null;
      }
      if (key === 'e' || key === 'enter') {
        event.preventDefault(); if (event.repeat) return;
        const feet: Point = [this.player.x, this.player.y];
        const nearest = [...activeSpots].sort((a, b) => distance(feet, a.approach) - distance(feet, b.approach))[0];
        if (distance(feet, nearest.approach) < 90 && this.nav.clear(feet, nearest.approach)) this.interact(nearest.kind, nearest.target);
        else this.tell('Move closer to a counter, cauldron or resource.');
      }
    };
    const up = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());
    const blur = () => this.keys.clear();
    canvas.addEventListener('keydown', down); window.addEventListener('keyup', up); canvas.addEventListener('blur', blur);
    this.events.once('shutdown', () => { canvas.removeEventListener('keydown', down); window.removeEventListener('keyup', up); canvas.removeEventListener('blur', blur); });
    this.events.once('shutdown', () => this.cancelMovement());
    this.setCharacter(this.character);
    if (this.latest) this.refresh(this.latest);
    this.occlude(); this.ready();
  }

  private go(point: Point, spot: Spot | null) {
    const path = this.nav.path([this.player.x, this.player.y], point);
    if (!path) { this.tell('That spot is blocked. Choose a clear path or use the shop controls.'); return; }
    this.keys.clear(); this.pendingSpot = spot;
    if (this.motion.matches) {
      this.player.setPosition(...point); this.shadow.setPosition(...point); this.route = []; this.pendingSpot = null;
      this.idle(); this.occlude(); this.location();
      if (spot) this.interact(spot.kind, spot.target);
    } else this.route = path;
  }

  refresh(state: GameState | null) {
    this.latest = state;
    if (!this.player) return;
    this.stock.forEach(item => item.destroy()); this.stock = [];
    this.announce();
    if (!state) return;
    state.listings.slice(0, 2).forEach((listing, shelf) => {
      const amount = BigInt(state.player.balances[listing.token_id] || '0');
      const count = Number(amount > BigInt(displays[shelf].length) ? BigInt(displays[shelf].length) : amount);
      if (!['healing_tonic', 'focus_draught', 'restoration_elixir'].includes(listing.token_id)) return;
      for (let index = 0; index < count; index++) {
        const [x, y] = displays[shelf][index];
        this.stock.push(this.add.image(x, y, `stock-${listing.token_id}`).setScale(1).setOrigin(.5, 45 / 48).setDepth(1));
      }
    });
  }

  private location() {
    const feet: Point = [this.player.x, this.player.y];
    const region = inside(feet, surfaces[0]) ? 'Shop floor' : inside(feet, surfaces[1]) ? 'Shop steps' : 'Courtyard';
    if (region !== this.region) { this.region = region; this.announce(); }
  }

  private occlude() {
    for (const actor of this.actors) {
      // The player stays visible; body clearance routes their feet around solid props.
      if (actor.sprite === this.player) continue;
      actor.holes = [];
      for (const object of occluders) {
        const [[ax, ay], [bx, by]] = object.front;
        const line = ay + (by - ay) * (actor.sprite.x - ax) / (bx - ax);
        if (actor.sprite.y >= line) continue;
        actor.holes.push(object.outline);
      }
      if (actor.holes.length) { actor.sprite.setMask(actor.mask); actor.shadow.setMask(actor.mask); }
      else { actor.sprite.clearMask(); actor.shadow.clearMask(); }
    }
  }

  update(_time: number, delta: number) {
    if (!this.player || this.paused) return;
    this.ambient?.update(_time,this.motion.matches);
    if (this.work && this.work.stage !== 'approach') { this.updateWork(delta); return; }
    const before: Point = [this.player.x, this.player.y], step = 230 * Math.min(delta, 50) / 1000;
    if (this.route.length) {
      const next = this.route[0], remaining = distance(before, next);
      if (remaining <= step) { this.player.setPosition(...next); this.route.shift(); }
      else this.player.setPosition(before[0] + (next[0] - before[0]) * step / remaining, before[1] + (next[1] - before[1]) * step / remaining);
      if (!this.route.length && this.pendingSpot) { const spot = this.pendingSpot; this.pendingSpot = null; this.interact(spot.kind, spot.target); }
    } else {
      const dx = Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft'));
      const dy = Number(this.keys.has('s') || this.keys.has('arrowdown')) - Number(this.keys.has('w') || this.keys.has('arrowup'));
      const length = Math.hypot(dx, dy) || 1;
      const next: Point = [before[0] + dx * step / length, before[1] + dy * step / length];
      if (this.nav.clear(before, next)) this.player.setPosition(...next);
      else {
        const horizontal: Point = [next[0], before[1]];
        if (this.nav.clear(before, horizontal)) this.player.setPosition(...horizontal);
        const vertical: Point = [this.player.x, next[1]];
        if (this.nav.clear([this.player.x, this.player.y], vertical)) this.player.setPosition(...vertical);
      }
    }
    const dx = this.player.x - before[0], dy = this.player.y - before[1];
    if (this.character && this.characterAvailable(this.character)) {
      if (dx || dy) this.facing = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 1 : 2 : dy < 0 ? 3 : 0;
      if ((dx || dy) && !this.motion.matches) this.player.play(`${this.character}-${this.facing}`, true);
      else this.idle();
    }
    this.shadow.setPosition(this.player.x, this.player.y + 2);
    this.occlude(); this.location();
    if (!this.route.length && this.work?.stage === 'approach') this.beginWork();
  }
}
