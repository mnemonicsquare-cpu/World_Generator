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

// Every world must have a bounded fog corridor; humidity pulls it close without exposing terrain edges.
const fogSource=section(current,"function makeFogProfile(dna,wet,terrainRadius=TERRAIN_RADIUS){","function makeWorldDNA(seedHash){");
let fogTools;
try{
  fogTools=new Function(`
    const CHUNK_SIZE=160,TERRAIN_RADIUS=6;
    const clamp=(x,a,b)=>Math.min(b,Math.max(a,x)),mix=(a,b,t)=>a+(b-a)*t,smooth=x=>x*x*(3-2*x);
    ${fogSource}
    return {makeFogProfile};
  `)();
}catch(error){fail("Fog profile test harness could not be built: "+error.message);}
const dryFog=fogTools.makeFogProfile({humidity:0,oceanicity:0},0,6);
const wetFog=fogTools.makeFogProfile({humidity:1,oceanicity:1},1,6);
const mobileDryFog=fogTools.makeFogProfile({humidity:0,oceanicity:0},0,5);
for(const profile of [dryFog,wetFog,mobileDryFog]){
  for(const key of ["moisture","humidityFog","near","far"])if(!Number.isFinite(profile[key]))fail("Fog profile produced non-finite "+key);
  if(profile.moisture<0||profile.moisture>1||profile.humidityFog<0||profile.humidityFog>1)fail("Fog climate trait left normalized range");
  if(profile.near<12||profile.far<=profile.near+65)fail("Fog corridor collapsed or inverted");
}
if(dryFog.near<480||dryFog.far>900||dryFog.far>=6*160-55)fail("Desktop dry haze no longer hides the distant terrain boundary");
if(mobileDryFog.near<390||mobileDryFog.far>=5*160-55)fail("Mobile dry haze no longer hides the closer terrain boundary");
if(wetFog.near>40||wetFog.far>190)fail("Maximum-humidity worlds no longer surround the player with close fog");
if(!(wetFog.near<dryFog.near*.12&&wetFog.far<dryFog.far*.25))fail("Humidity no longer has a strong fog-distance effect");
for(let i=0;i<=100;i++){
  const h=i/100,p=fogTools.makeFogProfile({humidity:h,oceanicity:h},h,6);
  if(p.near>dryFog.near+.001||p.far>dryFog.far+.001||p.near<17.9||p.far<144.9)fail("Fog profile exceeded safety bounds across humidity sweep");
  if(i&&p.near>fogTools.makeFogProfile({humidity:(i-1)/100,oceanicity:(i-1)/100},(i-1)/100,6).near+.001)fail("Fog near distance is not monotonic with humidity");
}

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
  if(Math.abs(a.hueShift)>.0525||Math.abs(a.tipShift)>.0325||Math.abs(a.saturationShift)>.04)fail("Grass colour DNA exceeded safety bounds");
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


// Seamless-world layer: region geometry must be deterministic, normalized, broad, and continuous.
const seamlessSource=section(current,"function waterLevelAt(x=0,z=0){","function update(dt){");
for(const required of [
  "WORLD_PROFILE_CACHE_MAX","regionBlendGeometry","worldBlendAt","makeRegionalProfile","regionalPaletteAt",
  "regionalGrassAt","regionalEnvironmentAt","initRegionalWorlds","heightOffset"
])if(!current.includes(required))fail("missing seamless-world primitive: "+required);
const startupSchedulePos=current.indexOf("scheduleChunks(true);"),regionalInitPos=current.indexOf("initRegionalWorlds(seed,sky,horizon);");
if(startupSchedulePos<0||regionalInitPos<0||regionalInitPos<startupSchedulePos)fail("regional layer must activate only after legacy spawn chunks are generated");
const clearSection=section(current,"function clear(){","function instances(");
for(const marker of ["regionalEnabled=false","originProfile=null","originFastRadius=0","universeOriginX=universeOriginZ=0","regionProfiles.clear()","universeHash=0","universeSeaLevel=0"])if(!clearSection.includes(marker))fail("new-seed reset lost regional state guard: "+marker);
if(!current.includes("universeOriginX=cam.position.x;universeOriginZ=cam.position.z"))fail("regional origin is not anchored to the actual spawn point");
if(!current.includes("Math.round((wx-universeOriginX)/WORLD_CELL)"))fail("region indexing is not relative to the spawn-anchored origin");
if(!current.includes("Math.hypot(x-universeOriginX,z-universeOriginZ)"))fail("origin fast path is not measured from the spawn-anchored center");
if(!current.includes("if(originProfile&&originDistance<originFastRadius)"))fail("atmosphere lost the direct origin-world fast path");
if(!current.includes('document.body.dataset.frameContrast'))fail("browser visual contrast diagnostic is missing");

if(!current.includes("rawTerrainHeightFor(item.profile,x,z)+item.profile.heightOffset"))fail("regional terrain is not height-aligned to the common sea level");
if(!current.includes("waterLevelAt(x,z)"))fail("regional ecology is not using the common water level");

const blendGeometrySource=section(current,"function universeRandom(x,z,salt=0){","function rawTerrainHeightFor(profile,x,z){");
let blendTools;
try{
  blendTools=new Function(`
    const CHUNK_SIZE=160,WORLD_CELL=CHUNK_SIZE*22,WORLD_BLEND=CHUNK_SIZE*3.5;
    let universeHash=0x12345678,regionalEnabled=true,universeOriginX=413.25,universeOriginZ=-287.5;
    const clamp=(x,a,b)=>Math.min(b,Math.max(a,x)),mix=(a,b,t)=>a+(b-a)*t,smooth=x=>x*x*(3-2*x);
    ${blendGeometrySource}
    return {regionBlendGeometry,regionCenter,warpedUniversePoint};
  `)();
}catch(error){fail("Seamless region geometry harness could not be built: "+error.message);}
for(const [x,z] of [[0,0],[3519,0],[-3519,1221],[7040,-5280],[12345,6789]]){
  const a=blendTools.regionBlendGeometry(x,z),b=blendTools.regionBlendGeometry(x,z);
  if(JSON.stringify(a)!==JSON.stringify(b))fail("region blend is not deterministic at "+x+","+z);
  const total=a.reduce((s,v)=>s+v.weight,0);
  if(Math.abs(total-1)>1e-9)fail("region weights do not normalize at "+x+","+z+": "+total);
  if(!a.length||a.length>4)fail("unexpected active region count at "+x+","+z+": "+a.length);
  for(const item of a)if(!Number.isFinite(item.weight)||item.weight<=0||item.weight>1||!Number.isFinite(item.distance))fail("invalid region blend item");
}
const TEST_WORLD_CELL=160*22;
let mixedSamples=0,dominantSamples=0,changes=0,lastKey=null;
for(let x=-TEST_WORLD_CELL*3;x<=TEST_WORLD_CELL*3;x+=80){
  const a=blendTools.regionBlendGeometry(x,137);
  if(a.length>1)mixedSamples++;else dominantSamples++;
  if(lastKey!==null&&a[0].key!==lastKey)changes++;
  lastKey=a[0].key;
  const b=blendTools.regionBlendGeometry(x+.5,137);
  const wa=new Map(a.map(v=>[v.key,v.weight])),wb=new Map(b.map(v=>[v.key,v.weight]));
  let delta=0;for(const key of new Set([...wa.keys(),...wb.keys()]))delta+=Math.abs((wa.get(key)||0)-(wb.get(key)||0));
  if(delta>.035)fail("region weights change too sharply across half a world unit: "+delta);
}
if(mixedSamples<12)fail("transition bands are too narrow or absent");
if(dominantSamples<20)fail("world interiors disappeared into permanent blending");
if(changes<4)fail("long travel does not cross enough distinct worlds");

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
if(!grassRenderSection.includes("new T.MeshLambertMaterial"))fail("grass material is no longer using the lightweight lit path");
if(grassRenderSection.includes("pow(vGrassHeight"))fail("grass vertex shader regained an avoidable pow() cost");
if(!grassRenderSection.includes("float oscillation=sin("))fail("grass wind shader lost its single-wave optimized path");
if(!grassRenderSection.includes("LOW_POWER?900:2200"))fail("grass instance safety caps are missing");
if(!grassRenderSection.includes("makeGrassGeometry(g.width)"))fail("Grass DNA width is not applied to geometry");
if(!grassRenderSection.includes("),.12,2.1)"))fail("grass per-instance height clamp is missing");
if(!grassRenderSection.includes("positions=[],blades=9,golden=2.399963229728653"))fail("grass blade geometry complexity changed unexpectedly");
if(!grassRenderSection.includes("castShadow=false")||!grassRenderSection.includes("receiveShadow=false"))fail("grass shadow cost guard is missing");

const currentFlora=section(current,"function floraDensitySingle","function makeFaunaCatalog");
for(const marker of [
  "const broad=fbm(x*G.forestScale+G.phase*37,z*G.forestScale-G.phase*23);",
  "const fine=fbm(x*G.forestScale*3.7-71,z*G.forestScale*3.7+119);",
  "const field=broad*.76+fine*.24;",
  "const deviation=(field-.5)*G.forestContrast*mix(.18,1.55,G.forestPatchiness);",
  "const macro=fbm(x*G.forestScale*.22+283,z*G.forestScale*.22-347);",
  "const mid=fbm(x*G.forestScale*1.25-521,z*G.forestScale*1.25+193);",
  "const patchStrength=.7+G.forestPatchiness*.55;",
  "return smooth(clamp(background+forest*.62+clustered*.92,0,1));"
])if(!currentFlora.includes(marker))fail("legacy flora equation changed unexpectedly: "+marker);
if(!currentFlora.includes("function floraDensity(x,z,y)")||!currentFlora.includes("worldBlendAt(x,z)"))fail("flora no longer blends neighboring world profiles");
if(!currentFlora.includes("withWorldProfile(item.profile"))fail("flora blending no longer evaluates each world's own noise field");

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
  "slant=weather.drift*windSpeed*gust*ratio",
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
  "growGrass(group,chunk)",
  "function makeFogProfile(dna,wet,terrainRadius=TERRAIN_RADIUS)",
  "new T.Fog(horizon,G.fogNear,G.fogFar)",
  "scene.fog.near=Math.max(12,env.fogNear",
  "scene.fog.far=Math.max(scene.fog.near+68",
  "document.body.dataset.fogNear"
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

if(!current.includes("centerY<=(regionalEnabled?universeSeaLevel:G.water)+.85"))fail("spawn center is not required to be dry");
if(!current.includes("G.water=Math.min(G.water,anchor.y-1.15)"))fail("absolute land guard is missing");

if(!current.includes("smooth(clamp((30-G.relief)/24,0,1))"))fail("flat-world relief gate is missing");
if(!current.includes("return h+plainsMacroRelief(x,z)"))fail("plains macro relief is not applied");


const roadSection=section(current,"function roadRandom(i,salt=0){","function applyHomeHeight(x,z,h){");
for(const required of [
  "initInfiniteRoad","roadCenterX","roadFrame2D","roadDistance","roadReserved","roadElevation",
  "applyInfiniteRoadHeight","makeRoadChunk","roadDiagnostic","ROAD_HALF","ROAD_BLEND"
])if(!current.includes(required))fail("missing infinite-road primitive: "+required);
if(!current.includes("const base=worldTerrainWithoutRoad(x,z);return applyHomeHeight(x,z,applyInfiniteRoadHeight"))fail("road shaping is not composed after seamless-world terrain");
if(!current.includes("if(homes.some(h=>Math.hypot(x-h.x,z-h.z)<120)||roadReserved(x,z,34))continue;"))fail("buildings can still occupy the road corridor");
if(!current.includes("return roadReserved(x,z)||homes.some"))fail("vegetation/fauna reservation does not include the road");
if(!current.includes("const road=makeRoadChunk(cx,cz,group);"))fail("road surface is not chunk streamed");
if(!current.includes('document.body.dataset.roadSegments'))fail("road runtime diagnostics are missing");
if(!current.includes('document.body.dataset.roadMaxGrade'))fail("road grade diagnostics are missing");

const roadMathSource=section(current,"function roadRandom(i,salt=0){","function worldTerrainWithoutRoad(x,z){");
let roadMath;
try{
  roadMath=new Function(`
    const roadHash=0x12345678,roadOriginX=317.25,roadOriginZ=-441.75,roadReady=true;
    const roadDNA={macroAmp:230,macroWave:3900,macroPhase:1.27,midAmp:105,midWave:1320,midPhase:2.31,fineAmp:34,fineWave:570,finePhase:.61};
    ${roadMathSource}
    return {roadCenterX,roadFrame2D,roadDistance};
  `)();
}catch(error){fail("Infinite-road math harness could not be built: "+error.message);}
let previous=null,maxStep=0,turning=0,lastDx=null,minX=Infinity,maxX=-Infinity;
for(let z=-12000;z<=12000;z+=20){
  const x=roadMath.roadCenterX(z),frame=roadMath.roadFrame2D(z);
  if(!Number.isFinite(x)||!Number.isFinite(frame.dx))fail("road centerline produced a non-finite value");
  if(Math.abs(roadMath.roadDistance(x,z))>1e-9)fail("road centerline does not have zero road distance");
  if(previous)maxStep=Math.max(maxStep,Math.hypot(x-previous.x,z-previous.z));
  if(lastDx!==null&&Math.sign(frame.dx)!==Math.sign(lastDx)&&Math.abs(frame.dx-lastDx)>.01)turning++;
  lastDx=frame.dx;previous={x,z};minX=Math.min(minX,x);maxX=Math.max(maxX,x);
}
if(maxStep>75)fail("road centerline has a discontinuous step: "+maxStep);
if(maxX-minX<220)fail("road is too straight over long travel: lateral range "+(maxX-minX));
if(turning<12)fail("road does not produce enough genuine turns over long travel: "+turning);


const clearanceSource=section(current,"function growLSystemFlora","function makeWindClimate");
for(const marker of [
  "}else if(!houseReserved(x,z)&&y>waterLevelAt(x,z)&&r()<.06+(1-baseDensity)*.18)",
  "if(roadReserved(X,Z,Math.max(w,d)*.7+2))return;",
  "if(roadReserved(X,Z,s+2))continue;",
  "if(!roadReserved(x,z,4))mesh(new T.OctahedronGeometry"
])if(!clearanceSource.includes(marker))fail("road clearance guard missing from rocks/ruins: "+marker);

const homeSection=section(current,"function planHomes","function buildHomes");
if(!homeSection.includes("roadReserved(x,z,34)"))fail("building placement road buffer is too small or missing");

const planeSection=section(current,"function createPlane","function planeInteractionDistance");
if(!planeSection.includes("roadReserved(x,z,8)"))fail("aircraft spawn can occupy the road corridor");

const faunaUpdate=section(current,"function updateFauna(dt){","const windTimeUniform");
if(!faunaUpdate.includes("!houseReserved(nx,nz)"))fail("moving fauna can enter reserved road space");

const generationSection=section(current,"const spawn=findNaturalSpawn();","const weatherRoll=");
if(!generationSection.includes("roadReserved(x,z,30)"))fail("ruin centers are not kept far enough from the road");
console.log("worldgen checks passed");
console.log("- JavaScript syntax: OK");
console.log("- Epsilon Beta base shapes: unchanged");
console.log("- Legacy flora equations preserved inside regional profiles: OK");
console.log("- World DNA determinism and bounds: OK");
console.log("- Epsilon Beta World DNA: unchanged");
console.log("- Living wind architecture markers: OK");
console.log("- Mushrooms excluded from wind binding: OK");
console.log("- Strong-wind climate and debris markers: OK");
console.log("- Wind climate determinism, rarity and bounds: OK");
console.log("- Grass DNA determinism, rarity and bounds: OK");
console.log("- Grass GPU instancing and no-collision architecture: OK");
console.log("- Mushroom/tree/grass layering order: OK");
console.log("- Universal haze and humidity fog distances: OK");
