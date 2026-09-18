import fs from "node:fs";
import {execFileSync} from "node:child_process";

const current=fs.readFileSync("index.html","utf8");
const epsilonBeta=execFileSync("git",["show","origin/epsilon-beta:index.html"],{encoding:"utf8"});

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

// Wind work must not silently alter the World DNA that defines the Epsilon Beta checkpoint.
const betaDNA=section(epsilonBeta,"function makeWorldDNA(seedHash){","function generate(seed){");
const currentDNA=section(current,"function makeWorldDNA(seedHash){","function generate(seed){");
if(betaDNA!==currentDNA)fail("World DNA changed relative to Epsilon Beta during wind work");

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
  const cases=[
    {wet:0,relief:2,roughness:.08,terrainVariation:0,regionStrength:0,regionScale:.0015,freq:.003,warp:18,forestCover:0,forestPatchiness:0,forestScale:.0018,forestContrast:.25,slender:0},
    {wet:.5,relief:56,roughness:1.2,terrainVariation:.5,regionStrength:.5,regionScale:.004,freq:.007,warp:55,forestCover:.5,forestPatchiness:.5,forestScale:.0045,forestContrast:1,slender:.5},
    {wet:1,relief:110,roughness:3.18,terrainVariation:1,regionStrength:1,regionScale:.0075,freq:.014,warp:110,forestCover:1,forestPatchiness:1,forestScale:.0098,forestContrast:2,slender:1}
  ];
  for(const source of cases){
    const g={...source};
    dnaTools.applyWorldDNA(g,a);
    for(const key of ["wet","terrainVariation","regionStrength","forestCover","forestPatchiness","slender"]){
      if(!Number.isFinite(g[key])||g[key]<0||g[key]>1)fail(`DNA application broke normalized parameter ${key}`);
    }
    for(const key of ["relief","roughness","regionScale","freq","warp","forestScale","forestContrast"]){
      if(!Number.isFinite(g[key]))fail(`DNA application produced non-finite ${key}`);
    }
    if(g.relief<2||g.relief>110||g.roughness<.05||g.roughness>3.2||g.forestScale<.0014||g.forestScale>.0095||g.forestContrast<.25||g.forestContrast>2)fail("DNA application broke generator safety bounds");
    if(g.regionScale<=0||g.freq<=0||g.warp<=0)fail("DNA application broke positive terrain scale");
  }
}


// Sanity-check the intended causal direction of the DNA layer, not only its numeric bounds.
const baseG={
  wet:.5,relief:56,roughness:1.2,terrainVariation:.5,regionStrength:.5,regionScale:.004,
  freq:.007,warp:55,forestCover:.5,forestPatchiness:.5,forestScale:.0045,forestContrast:1,slender:.5
};
const baseDNA={
  age:.5,internalHeat:.5,oceanicity:.5,temperature:.5,humidity:.5,tectonics:.5,erosion:.5,
  fertility:.5,biosphere:.5,volatility:.5,geologicalContrast:.5,anomaly:0
};
function dnaCase(changes){
  const g={...baseG},dna={...baseDNA,...changes};dnaTools.applyWorldDNA(g,dna);return g;
}
const lowGeo=dnaCase({geologicalContrast:0}),highGeo=dnaCase({geologicalContrast:1});
if(!(highGeo.relief>lowGeo.relief&&highGeo.terrainVariation>lowGeo.terrainVariation&&highGeo.regionStrength>lowGeo.regionStrength))fail("geological contrast has lost its causal effect");
const lowTect=dnaCase({tectonics:0}),highTect=dnaCase({tectonics:1});
if(!(highTect.roughness>lowTect.roughness&&highTect.regionScale>lowTect.regionScale&&highTect.warp>lowTect.warp))fail("tectonics has lost its causal effect");
const lowErosion=dnaCase({erosion:0}),highErosion=dnaCase({erosion:1});
if(!(highErosion.roughness<lowErosion.roughness&&highErosion.freq<lowErosion.freq))fail("erosion has lost its smoothing effect");
const dryDNA=dnaCase({humidity:0}),wetDNA=dnaCase({humidity:1});
if(!(wetDNA.wet>dryDNA.wet&&wetDNA.forestScale<dryDNA.forestScale))fail("humidity has lost its climate effect");
const weakBio=dnaCase({biosphere:0}),richBio=dnaCase({biosphere:1});
if(!(richBio.forestCover>weakBio.forestCover&&richBio.slender>weakBio.slender))fail("biosphere has lost its vegetation effect");

// Thousands of seeds should produce a broad continuum rather than a handful of hidden presets.
const traitStats=Object.fromEntries(dnaTraits.map(k=>[k,{min:Infinity,max:-Infinity,sum:0,sum2:0}]));
const fingerprints=new Set();
for(let seedHash=10000;seedHash<14096;seedHash++){
  const d=dnaTools.makeWorldDNA(seedHash);
  fingerprints.add(dnaTraits.map(k=>d[k].toFixed(5)).join("|"));
  for(const k of dnaTraits){const s=traitStats[k],v=d[k];s.min=Math.min(s.min,v);s.max=Math.max(s.max,v);s.sum+=v;s.sum2+=v*v;}
}
if(fingerprints.size<4080)fail("World DNA unexpectedly collapsed into repeated presets");
for(const [k,s] of Object.entries(traitStats)){
  const n=4096,mean=s.sum/n,variance=s.sum2/n-mean*mean;
  if(s.max-s.min<.12||variance<.001)fail(`World DNA trait lacks useful variation: ${k}`);
}

// Wind climate is a deterministic world trait: rare gales must stay rare, bounded, and reproducible.
const windSource=section(current,"function makeWindClimate(seedHash,dna){","function makeWeather(type,c){");
let windTools;
try{
  windTools=new Function(`
    const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
    function rng(s){return()=>{s|=0;s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296}}
    ${windSource}
    return {makeWindClimate};
  `)();
}catch(error){fail("Wind climate test harness could not be built: "+error.message);}
let galeCount=0,strongCount=0,minSpeed=Infinity,maxSpeed=-Infinity;
const referenceDNA={volatility:.5,oceanicity:.5};
for(let seedHash=0;seedHash<4096;seedHash++){
  const a=windTools.makeWindClimate(seedHash,referenceDNA),b=windTools.makeWindClimate(seedHash,referenceDNA);
  for(const key of ["windClimate","windSpeed","windAngle","gustiness"]){
    if(a[key]!==b[key])fail("Wind climate is not deterministic for "+key+" at hash "+seedHash);
    if(!Number.isFinite(a[key]))fail("Wind climate produced non-finite "+key);
  }
  if(a.windClimate<0||a.windClimate>1.42||a.windSpeed<.28||a.windSpeed>3.475||a.windAngle<0||a.windAngle>=Math.PI*2)fail("Wind climate exceeded safety bounds");
  if(a.gale)galeCount++;
  if(a.windClimate>.9)strongCount++;
  minSpeed=Math.min(minSpeed,a.windSpeed);maxSpeed=Math.max(maxSpeed,a.windSpeed);
}
if(galeCount<450||galeCount>850)fail("Gale worlds are no longer a rare minority: "+galeCount+"/4096");
if(strongCount<350||strongCount>900)fail("Strong-wind world frequency is implausible: "+strongCount+"/4096");
if(maxSpeed-minSpeed<1.5)fail("Wind climate lacks meaningful speed variation");

// Grass DNA must be deterministic, broad, and bounded without altering World DNA.
const grassSource=section(current,"function makeGrassDNA(seedHash,dna){","function grassDensity(x,z,y,slope){");
let grassTools;
try{
  grassTools=new Function(`
    const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
    function rng(s){return()=>{s|=0;s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296}}
    ${grassSource}
    return {makeGrassDNA};
  `)();
}catch(error){fail("Grass DNA test harness could not be built: "+error.message);}
let sparseGrassWorlds=0,denseGrassWorlds=0,almostBareWorlds=0,minGrassCover=Infinity,maxGrassCover=-Infinity;
for(let seedHash=0;seedHash<4096;seedHash++){
  const dna=dnaTools.makeWorldDNA(seedHash),a=grassTools.makeGrassDNA(seedHash,dna),b=grassTools.makeGrassDNA(seedHash,dna);
  if(JSON.stringify(a)!==JSON.stringify(b))fail("Grass DNA is not deterministic at hash "+seedHash);
  for(const key of ["cover","patchiness","clumpiness","dryness"]){
    if(!Number.isFinite(a[key])||a[key]<0||a[key]>1)fail("Grass DNA normalized trait out of range: "+key);
  }
  if(a.shadeTolerance<.28||a.shadeTolerance>.86||a.height<.24||a.height>1.6||a.heightVariation<.18||a.heightVariation>.66)fail("Grass morphology exceeded safety bounds");
  if(a.width<.055||a.width>.14||a.flexibility<.72||a.flexibility>1.28||a.hueSpan<.012||a.hueSpan>.064)fail("Grass render trait exceeded safety bounds");
  if(a.macroScale<=0||a.midScale<=a.macroScale)fail("Grass spatial scales are invalid");
  if(a.sparseWorld)sparseGrassWorlds++;
  if(a.cover>.7)denseGrassWorlds++;
  if(a.cover<.08)almostBareWorlds++;
  minGrassCover=Math.min(minGrassCover,a.cover);maxGrassCover=Math.max(maxGrassCover,a.cover);
}
if(sparseGrassWorlds<350||sparseGrassWorlds>650)fail("Sparse-grass worlds are no longer a rare minority: "+sparseGrassWorlds+"/4096");
if(denseGrassWorlds<300)fail("Grass DNA no longer produces enough genuinely grassy worlds");
if(almostBareWorlds<180)fail("Grass DNA no longer produces enough nearly bare worlds");
if(maxGrassCover-minGrassCover<.75)fail("Grass cover lacks meaningful world-to-world variation");

const epsilonShapeEnd=epsilonBeta.includes("function naturalMountainShape")?"function naturalMountainShape":"function height(x,z){";
const currentShapeEnd=current.includes("function naturalMountainShape")?"function naturalMountainShape":"function height(x,z){";
const epsilonShape=section(epsilonBeta,"function shape(",epsilonShapeEnd);
const currentShape=section(current,"function shape(",currentShapeEnd);
if(epsilonShape!==currentShape)fail("legacy shape() changed relative to Epsilon Beta");

const populateFlora=section(current,"function populateChunkFlora(chunk){","function removeChunkFlora(chunk){");
const treePos=populateFlora.indexOf("growLSystemFlora"),windPos=populateFlora.indexOf("attachWindToFlora(group,chunk);"),groundPos=populateFlora.indexOf("growGroundFlora"),grassPos=populateFlora.indexOf("growGrass(group,chunk)");
if(!(treePos>=0&&windPos>treePos&&groundPos>windPos&&grassPos>groundPos))fail("flora layering order is unsafe for mushrooms or grass");

const grassRenderSection=section(current,"function makeGrassGeometry(width=G.grass.width){","function populateChunkFlora(chunk){");
if(grassRenderSection.includes("buildingSolids.push")||grassRenderSection.includes("collision")||grassRenderSection.includes("collider"))fail("grass unexpectedly participates in collision logic");
if(!grassRenderSection.includes("new T.InstancedMesh")||!grassRenderSection.includes("InstancedBufferAttribute"))fail("grass is not using the required instanced GPU path");
if(!grassRenderSection.includes("LOW_POWER?620:1320"))fail("grass instance safety caps are missing");
if(!grassRenderSection.includes("makeGrassGeometry(g.width)"))fail("Grass DNA width is not applied to geometry");
if(!grassRenderSection.includes("const blades=3,levels=[0,.54,1]"))fail("grass blade geometry complexity changed unexpectedly");
if(!grassRenderSection.includes("castShadow=false")||!grassRenderSection.includes("receiveShadow=false"))fail("grass shadow cost guard is missing");

const epsilonFlora=section(epsilonBeta,"function floraDensity","function makeFaunaCatalog");
const currentFlora=section(current,"function floraDensity","function makeFaunaCatalog");
if(epsilonFlora!==currentFlora)fail("protected flora generation changed relative to Epsilon Beta");

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
  "dna.volatility",
  "function makeWindReactiveMaterial(material,mode)",
  "function attachWindToFlora(group,chunk)",
  "attachWindToFlora(group,chunk);",
  "windForceUniform.value=windForce",
  "weather.currentWind=windForce",
  "slant=weather.drift*weather.windSpeed*gust*ratio",
  "function makeWindClimate(seedHash,dna)",
  "windClimate=clamp(",
  "gale=galeRoll<.16",
  "debrisCount=G.forestCover>.16",
  "living-wind-v2-",
  "weather.debris.material.opacity",
  "water.material.roughness=clamp(.17+windForce*.13",
  "function makeGrassDNA(seedHash,dna)",
  "G.grass=makeGrassDNA(G.hash,dna)",
  "function grassDensity(x,z,y,slope)",
  "function makeGrassGeometry(width=G.grass.width)",
  "function makeGrassMaterial(base,tip)",
  "function growGrass(parent,chunk)",
  "procedural-grass-v1",
  "grassData",
  "growGrass(group,chunk)"
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
console.log("- Epsilon Beta base shapes: unchanged");
console.log("- Epsilon Beta flora block: unchanged");
console.log("- World DNA determinism and bounds: OK");
console.log("- Epsilon Beta World DNA: unchanged");
console.log("- Living wind architecture markers: OK");
console.log("- Mushrooms excluded from wind binding: OK");
console.log("- Strong-wind climate and debris markers: OK");
console.log("- Wind climate determinism, rarity and bounds: OK");
console.log("- Grass DNA determinism, rarity and bounds: OK");
console.log("- Grass GPU instancing and no-collision architecture: OK");
console.log("- Mushroom/tree/grass layering order: OK");
