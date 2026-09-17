import assert from 'node:assert/strict';
import {particleGroundHeight} from '../../lib/particle-ground.mjs';
const surface={width:5,height:5,extentMeters:[40,40],position:[100,200,30],elevations:Array.from({length:25},(_,i)=>.1*(i%5*10-20)+.2*(Math.floor(i/5)*10-20))};
for(let i=0;i<100;i++){const x=80+i*.4,y=180+(i*17%100)*.4;assert(Math.abs(particleGroundHeight(surface,x,y)-(30+.1*(x-100)+.2*(y-200)))<1e-10);}
assert.equal(particleGroundHeight(surface,121,200),null);
assert.equal(particleGroundHeight({width:2,height:2,extentMeters:[2,2],position:[0,0,0],elevations:[0,10,20,0]},0,0),15);
console.log('PASS: ground-bound effects sample sloped, translated and non-planar mesh triangles; out-of-coverage samples are rejected.');
