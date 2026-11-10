import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Navigation, inside, type Point } from '../web/src/navigation.ts';
import { WORLD, ACTOR, surfaces, solids, portalBase, spots, occluders } from '../web/src/isometric-layout.ts';

const navigation = new Navigation(WORLD.width, WORLD.height, surfaces, [...solids,portalBase], ACTOR.radius);

test('the wood essence worker stands clear of the supplier awning and faces the barrel', () => {
  const tap = spots.find(s => s.id === 'wood_essence')!;
  const awning = occluders.find(s => s.name === 'bram-awning')!;
  assert.ok(navigation.walkable(tap.approach));
  assert.ok(!inside(tap.approach, awning.outline));
  assert.ok(tap.ground![0] - tap.approach[0] > Math.abs(tap.ground![1] - tap.approach[1]));
});

test('walk mesh uses the production image dimensions and stays inside the scene', () => {
  const png = readFileSync(new URL('../web/public/assets/isometric/world.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), WORLD.width); assert.equal(png.readUInt32BE(20), WORLD.height);
  for (const point of [...surfaces.flat(), ...solids.flat(), ...spots.flatMap(s => [s.at, s.approach])]) {
    assert.ok(point[0] >= 0 && point[0] <= WORLD.width && point[1] >= 0 && point[1] <= WORLD.height);
  }
});

test('all twelve isometric approach points are connected, with clear steps between them', () => {
  assert.equal(spots.length, 12);
  for (const start of [WORLD.spawn, ...spots.map(s => s.approach)]) for (const spot of spots) {
    const path = navigation.path(start, spot.approach);
    assert.ok(path, `No route from ${start} to ${spot.id}`);
    let previous = start;
    for (const point of path) { assert.ok(navigation.clear(previous, point), `Route crossed a solid to ${spot.id}`); previous = point; }
    assert.deepEqual(path.at(-1), spot.approach);
  }
});

test('walls, water, counter and garden beds cannot be destinations', () => {
  for (const point of [[20, 20], [980, 350], [450, 355], [880, 640], [680, 820], [1065, 800]] as Point[]) {
    assert.equal(navigation.walkable(point), false, `Unexpected floor at ${point}`);
    assert.equal(navigation.path(WORLD.spawn, point), null);
  }
});

test('routes go around raised garden beds instead of crossing the direct line', () => {
  const from: Point = [700, 725], to: Point = [1090, 650];
  assert.equal(navigation.clear(from, to), false);
  const route = navigation.path(from, to); assert.ok(route && route.length > 1);
  assert.equal(solids.some(s=>inside([870, 620], s)), true);
});

test('grid navigation cannot cut diagonally across a blocked corner or leave disconnected islands', () => {
  const nav = new Navigation(120, 120, [[[0, 0], [119, 0], [119, 119], [0, 119]]], [[[40, 0], [60, 0], [60, 119], [40, 119]]]);
  assert.equal(nav.path([20, 20], [90, 90]), null);
  assert.equal(nav.clear([35, 10], [65, 30]), false);
});

test('a body cannot skim the flower bed at the screenshot location or squeeze through a narrow gap', () => {
  // Previously the feet were outside the diamond, but the player was clipped inside its flowers.
  assert.equal(navigation.walkable([942, 683]), false);
  assert.equal(navigation.walkable([1005, 702]), true);
  const corridor = [[[0, 0], [100, 0], [100, 100], [0, 100]]] as Point[][];
  const blocks = [[[0, 0], [42, 0], [42, 100], [0, 100]], [[68, 0], [100, 0], [100, 100], [68, 100]]] as Point[][];
  assert.equal(new Navigation(100, 100, corridor, blocks).walkable([55, 50]), true);
  assert.equal(new Navigation(100, 100, corridor, blocks, ACTOR.radius).walkable([55, 50]), false);
});

test('the relocated portal stands on the southern path and leaves the stairs clear',()=>{
  const portal=spots.find(s=>s.kind==='arena')!;assert.ok(portal.at[1]>800);
  assert.ok(portalBase.every(p=>!inside(p,surfaces[1])));assert.equal(navigation.walkable([720,550]),true);
});
