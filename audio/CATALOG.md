# Runtime sound catalog

| Context | Runtime implementation | Source |
| --- | --- | --- |
| Wind: calm, light, strong, gusts | One procedural noise bed; gain and filter follow `WindState.force` | Web Audio synthesis |
| Forest, open plain, desert, wetland, snow | One procedural ambience bed; filter and gain follow forest cover and moisture | Web Audio synthesis |
| Rain | Local loop with a short seam crossfade | `rain.mp3` |
| Asphalt, interior floor, stone, wood | Short filtered noise step with randomized pitch and gain | Web Audio synthesis |
| Soil, grass, sand | Randomized short excerpts layered with a filtered step | `gravel.mp3` |
| Snow | Randomized short excerpts layered with a filtered step | `snow.mp3` |
| Engine idle, rise, sustained RPM, load | Two oscillator layers driven by speed and throttle | Web Audio synthesis |
| Tyre roll, off-road noise, slip | Filtered noise layer driven by speed, surface and lateral velocity | Web Audio synthesis |
| Distant birds | Rare distance-attenuated pitch-swept call near a bird agent | Web Audio synthesis |

Missing dedicated recordings: water, insects, non-bird animal calls, collision, suspension, and distinct biome field recordings. They are not represented by unrelated or unlicensed files. The procedural ambience is deliberately quiet and should be replaced or supplemented with licensed recordings before calling the soundscape complete.
