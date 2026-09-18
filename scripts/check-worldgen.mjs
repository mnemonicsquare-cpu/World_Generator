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

// World DNA must be deterministic, bounded, and safe before it is allowed to influence legacy systems.
const dnaSource=section(current,"function makeWorldDNA(seedHash){","function generate(seed){");
let dnaTools;
try{
  dnaTools=new Function(`
    const clamp=(x,a,b)=>Math.min(b,Math.max(a,x)),mix=(a,b,t)=>a+(b-a)*t;
    function rng(s){return()=>{s|=0;s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296}}
    ${dnaSource}
    return {makeWorldDNA,applyWorldDNA};
  `)();
}catch(error){fail("World DNA test harness could not be built: "+error.message);}

const dnaTraits=["age","internalHeat","oceanicity","temperature","humidity","tectonics","erosion","fertility","biosphere","volatility","geologicalContrast","anomaly"];
for(let seedHash=0;seedHash<512;seedHash++){
  const a=dnaTools.makeWorldDNA(seedHash),b=dnaTools.makeWorldDNA(seedHash);
  if(JSON.stringify(a)!==JSON.stringify(b))fail("World DNA is not deterministic for hash "+seedHash);
  for(const trait of dnaTraits){
    if(!Number.isFinite(a[trait])||a[trait]<0||a[trait]>1)fail(`World DNA trait out of range: ${trait}=${a[trait]}`);
  }
  const g={
    wet:.5,relief:56,roughness:1.2,terrainVariation:.5,regionStrength:.5,regionScale:.004,
    freq:.007,warp:55,forestCover:.5,forestPatchiness:.5,forestScale:.0045,forestContrast:1,slender:.5
  };
  dnaTools.applyWorldDNA(g,a);
  for(const key of ["wet","terrainVariation","regionStrength","forestCover","forestPatchiness","slender"]){
    if(!Number.isFinite(g[key])||g[key]<0||g[key]>1)fail(`DNA application broke normalized parameter ${key}`);
  }
  if(g.relief<2||g.relief>110||g.roughness<.05||g.roughness>3.2||g.forestScale<.0014||g.forestScale>.0095||g.forestContrast<.25||g.forestContrast>2)fail("DNA application broke generator safety bounds");
}

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
  "G.geology={",
  "function makeWorldDNA(seedHash)",
  "function applyWorldDNA(g,dna)",
  "G.dna=dna;applyWorldDNA(G,dna);",
  "dna.geologicalContrast",
  "dna.biosphere",
  "dna.volatility"
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
console.log("- World DNA determinism and bounds: OK");
