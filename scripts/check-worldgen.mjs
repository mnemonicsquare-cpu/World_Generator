import fs from "node:fs";
import {execFileSync} from "node:child_process";

const current=fs.readFileSync("index.html","utf8");
const epsilon=execFileSync("git",["show","origin/epsilon:index.html"],{encoding:"utf8"});

function fail(message){
  console.error("worldgen check failed:",message);
  process.exit(1);
}
function section(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  if(a<0||b<0)fail(`missing protected section: ${start}`);
  return source.slice(a,b);
}
function moduleBody(html){
  const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if(!match)fail("module script not found");
  return match[1].replace(/^\s*import\*as T from"[^"]+";\s*/,"");
}

// Parse without executing browser-dependent code.
try{new Function(moduleBody(current));}
catch(error){fail("JavaScript syntax error: "+error.message);}

const epsilonShape=section(epsilon,"function shape(","function height(x,z){");
const currentShapeEnd=current.includes("function naturalMountainShape")?"function naturalMountainShape":"function baseHeight(x,z){";
const currentShape=section(current,"function shape(",currentShapeEnd);
if(epsilonShape!==currentShape)fail("legacy shape() changed relative to Epsilon");

const epsilonFlora=section(epsilon,"function floraDensity","function makeFaunaCatalog");
const currentFlora=section(current,"function floraDensity","function makeFaunaCatalog");
if(epsilonFlora!==currentFlora)fail("protected flora generation changed relative to Epsilon");

for(const marker of [
  "function naturalMountainShape(x,z)",
  "function terrainShape(k,x,z)",
  "function plainsMacroRelief(x,z)",
  "function baseHeight(x,z)",
  "function geologicalHeight(x,z,h)",
  "function applyPathHeight(x,z,h)",
  "function applyHomeHeight(x,z,h)",
  "function naturalTerrainHeight(x,z)",
  "function terrainPatch(x,z,radius=10)",
  "function calibrateWaterLevel()",
  "function findNaturalSpawn()",
  "G.legacyPath=G.path;G.path=1e12;",
  "calibrateWaterLevel();",
  "G.plains={",
  "G.geology={"
]){
  if(!current.includes(marker))fail("missing terrain architecture marker: "+marker);
}

for(const legacyPattern of [
  "for(let z=140;z>-160;z-=4)",
  "z=80-i*220",
  "const center=G.path",
  "if(p.max<=G.water+.75)continue"
]){
  if(current.includes(legacyPattern))fail("legacy path-based placement returned: "+legacyPattern);
}

if(!current.includes("centerY<=G.water+.85"))fail("spawn center is not required to be dry");
if(!current.includes("G.water=Math.min(G.water,anchor.y-1.15)"))fail("absolute land guard is missing");

if(!current.includes("smooth(clamp((30-G.relief)/24,0,1))"))fail("flat-world relief gate is missing");
if(!current.includes("return h+plainsMacroRelief(x,z)"))fail("plains macro relief is not applied");

console.log("worldgen checks passed");
console.log("- JavaScript syntax: OK");
console.log("- Epsilon base shapes: unchanged");
console.log("- Epsilon flora block: unchanged");
