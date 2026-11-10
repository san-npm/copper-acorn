import {Navigation,type Point} from './navigation.ts';

export const ARENA={width:1536,height:1024,chicken:[1120,560] as Point,exit:[430,650] as Point,exitApproach:[500,680] as Point};
// Floor follows the new courtyard paving; the stands, flowers and parapets stay outside it.
export const arenaFloor:Point[][]=[[[160,405],[570,275],[915,265],[1420,405],[1410,555],[1050,785],[790,810],[420,715],[190,585]]];
export const arenaNavigation=new Navigation(ARENA.width,ARENA.height,arenaFloor,[[[350,618],[430,573],[510,620],[430,663]]],18);
export function arenaSpawn(id:string):Point{
  const index=[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%5;
  return [600+index*60,650];
}

export const COMBAT_GRID={min:-4,size:15,stepX:80,stepY:40};
export function combatPoint(x:number,y:number):Point{return [768+(x-y)*COMBAT_GRID.stepX,250+(x+y)*COMBAT_GRID.stepY];}
export const combatCells=Array.from({length:COMBAT_GRID.size**2},(_,i)=>({x:COMBAT_GRID.min+i%COMBAT_GRID.size,y:COMBAT_GRID.min+Math.floor(i/COMBAT_GRID.size)})).filter(({x,y})=>arenaNavigation.walkable(combatPoint(x,y)));
export const cellName=(x:number,y:number)=>String.fromCharCode(65+x-COMBAT_GRID.min)+(y-COMBAT_GRID.min+1);
