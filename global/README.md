# Engine collections: core and kits

Everything a GUTS game runs on, besides your project's own files, lives here.

```
global/
├── collections/          core: every game uses this
│   ├── scripts/
│   │   ├── libraries/    ECS (BaseECSGame), scenes, loaders, rendering, models, audio,
│   │   │                 networking, terrain, UI (UIKit, notifications), the desync
│   │   │                 debugger, editor tools, three.js add-ons
│   │   └── systems/      rendering, world, terrain, cameras, keyboard, audio and music,
│   │                     animation, particles and effects, lighting, post-processing,
│   │                     scheduling, loading, pause, UI, chat
│   ├── data/             component schemas and enums the core systems use
│   ├── editor/           editor modules and themes
│   └── ui/               shared interfaces and modals
└── kits/                 optional: pick the ones that fit your game
    ├── ai/               behavior trees
    ├── units/            grid, pathfinding, movement, unit creation, vision   (needs ai)
    ├── combat/           damage, projectiles, death, health bars             (needs ai, units)
    ├── rts/              orders, placement, fog of war, minimap, lockstep    (needs units)
    │                     network system, RTS input
    ├── cards/            deck, dragging, card rendering
    └── physics/          Rapier bodies, joints, characters, ragdolls, debris
```

Each kit has a README listing its systems, the services they provide, and what your game
has to supply (component schemas, and services such as `getActivePlayerTeam` that only a
game can answer).

| Kit | What it's for |
|---|---|
| [ai](kits/ai/README.md) | Behavior trees and the system that runs them |
| [units](kits/units/README.md) | Units on a grid map: spatial queries, A* pathfinding, steering, creation from prefabs, vision |
| [combat](kits/combat/README.md) | Damage, armor and resistances, projectiles, death, health bars, damage numbers |
| [rts](kits/rts/README.md) | Squad orders, building placement, fog of war, minimap, match stats, lockstep networking of placements and orders, RTS input, AI-vs-AI simulations |
| [cards](kits/cards/README.md) | Card games: deck, dragging, rendering |
| [physics](kits/physics/README.md) | Rigid bodies, colliders, joints and character controllers on Rapier; collision events, raycasts, terrain collision, explosions; ragdolls and debris |

## What the core asks of a game

Nothing is required. Core systems use these services when something provides them:

- `isVisibleAt`, `isEntityVisibleToTeam` (units kit, VisionSystem) and `isVisibleInFogAt`
  (rts kit, FogOfWarSystem): RenderSystem hides what the local team can't see. Without
  them everything is drawn.
- `createEntityFromPrefab` (units kit, UnitCreationSystem): TerrainSystem makes a level's
  terrain and world-object entities with it.
- `updateCoordinateConfig` (units kit, GridSystem): WorldSystem passes it the loaded
  terrain's size.
- `getActivePlayerTeam`, `getLocalPlayerStats`, `getCameraPositionForTeam` (your game):
  fog-of-war rendering and the orthographic camera's starting view.

## How the build uses them

A kit's `collections/` folder has the same layout as the core's. The build merges the core
and the kits into one set of engine collections, so a game names systems in its game.json
`systems` list the same way whichever folder holds them, and a project file with the same
name as an engine file replaces it.

By default every kit is available. A project can name the kits it uses in game.json:

```json
{ "kits": ["combat"] }
```

Kits a listed kit requires come along (`combat` brings `ai` and `units`).

A project that lists its kits also gets the engine's component schemas and enums: those of
the core (`transform`, `velocity`, `renderable`, `unitType`, `team`, `health`, `deathState`,
`animationState`, ...; enums such as `team`, `deathState`, `element`) and of each kit it
uses, from their `data/components` and `data/enums` folders. A file of the same name in the
project replaces the engine's. Projects without a `kits` list define all their own, as
before.

Imports of engine files use `@global/...`, which searches the core and then each kit:

```js
import BaseMovementSystem from '@global/scripts/systems/js/BaseMovementSystem.js';
```

## Adding a kit

Create `global/kits/<name>/` with a `kit.json` and a `collections/` folder laid out like
the core's:

```json
{
  "title": "My kit",
  "description": "What it does",
  "requires": ["units"]
}
```

A kit may use the core and the kits it requires. A kit's systems can call services from
other kits or from the game; a call to a service nobody provides does nothing and logs one
warning, so list the services a game must provide in the kit's README.
