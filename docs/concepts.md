# GUTS concepts

How a GUTS game is put together. For a hands-on start, see
[getting-started.md](getting-started.md).

- [Projects and collections](#projects-and-collections)
- [Entities](#entities)
- [Components](#components)
- [Systems](#systems)
- [Services](#services)
- [Scenes](#scenes)
- [game.json and other configs](#gamejson-and-other-configs)
- [Engine core, kits, and overriding engine files](#engine-core-kits-and-overriding-engine-files)
- [Build targets: client, server, headless, editor](#build-targets)
- [Multiplayer and determinism](#multiplayer-and-determinism)
- [Performance notes](#performance-notes)

## Projects and collections

A project is a folder with a `collections/` directory. Everything in it is organised as
**collections**: `collections/<category>/<collection>/`. A collection holds JSON data, scripts,
or both:

```
collections/
├── settings/configs/          game.json, server.json, headless.json, state.json, ...
├── data/components/           component schemas
├── data/scenes/               scenes
├── data/enums/                enums (named value lists)
├── scripts/systems/js/        systems
├── scripts/libraries/js/      libraries (non-system classes)
├── ui/interfaces/{html,css,data}/   page layouts
└── <anything>/<anything>/     your own: units, items, abilities, levels, prefabs...
```

The category folder (`data`, `scripts`, `ui`, ...) is only for grouping; a collection is
known by its own folder name. A collection with `js/` and `data/` subfolders keeps scripts
and JSON apart; otherwise files sit directly in it.

At runtime every JSON collection is available as `game.getCollections().<collection>.<id>`,
for example `collections.units.archer`. Systems have it as `this.collections`.

Every collection also gets an **enum**: its item ids in a fixed order, so data can refer to
items by small integers. `this.enums.units.archer` is the archer's index;
`this.reverseEnums.units[3]` goes back. Files in `data/enums/` add named value lists of
their own (`team`, `deathState`, ...).

**Class collections.** Some collections hold classes rather than data, for example abilities
or behavior-tree nodes. List them in game.json `classes` with a base class:

```json
"classes": [{ "collection": "abilities", "baseClass": "BaseAbility" }]
```

Every class in them is compiled in and available as `GUTS.<ClassName>`.

## Entities

An entity is a number. `game.createEntity()` returns the next free id;
`game.destroyEntity(id)` removes it and its components, and calls `entityDestroyed(id)` on
every system that has that method.

Ids index typed arrays, so there is a maximum, `maxEntities` in game.json (default 65536).
IDs normally grow forever. A long-running game (an MMO server, say) can let them be reused
with `"entityIdReuse": { "quarantineTicks": 6000 }`. A reused id gets a new
**generation**: keep `game.getEntityGeneration(id)` beside an id you store, and check
`game.isEntityCurrent(id, generation)` before trusting it later.

## Components

A component is named data on an entity. Its schema lives in
`collections/data/components/<name>.json`:

```json
{
    "title": "Health",
    "schema": {
        "current": 100,
        "max": 100,
        "regenerating": false,
        "lastHitBy": null
    }
}
```

The schema gives every field and its default. Add components with defaults filled in:

```js
game.addComponent(id, 'health', { max: 250, current: 250 });
game.addComponents(id, { transform: {}, health: {}, team: { team: 1 } });
```

Read and write them through `game.getComponent(id, 'health')`, which returns a live view:
`health.current -= 10` writes straight to storage. Other calls are `hasComponent`,
`removeComponent`, `updateComponent(id, name, { ...fields })`, and
`game.getEntitiesWith('transform', 'health')`, which lists the entities that have all of
the named components.

**Storage.** A schema made only of numbers, booleans, `null`, enum values and nested
objects of those is **numeric**: each field is a `Float32Array` indexed by entity id.
Booleans read back as 0/1 and `null` as `null`. A schema with free strings or ordinary
arrays is stored as plain objects instead. Numeric components are what makes iterating
thousands of entities cheap.

Schema directives for numeric components:

| Directive | Meaning |
|---|---|
| `{ "$enum": "deathState" }` | field holds an index into the `deathState` enum |
| `{ "$fixedArray": { "size": 8, "default": null } }` | fixed-length array, `comp.list[i]`, `.length` |
| `{ "$fixedArray": { "size": 5, "fields": ["vx", "vz"] } }` | array of small records, `comp.list[i].vx` |
| `{ "$fixedArray": { "sizeFrom": "abilities" } }` | one slot per item of an enum |
| `{ "$bitmask": ... }` | set of enum values packed into bits |

**Hot loops.** For the tightest loops you can skip views and read the arrays:
`game.getFieldArray('transform', 'position.x')` returns the `Float32Array` for that field
(index it by entity id; `null` is stored as `-Infinity`). `game.getField` / `game.setField`
read or write a single field.

## Systems

A system is a class in `scripts/systems/js/` extending `GUTS.BaseSystem`. It has
`this.game`, `this.collections`, `this.enums`, `this.reverseEnums` and `this.call`
(see [Services](#services)). Hooks, all optional:

| Hook | When |
|---|---|
| `constructor(game)` | the system is created (the first time a scene lists it) |
| `init(params)` | right after it is created |
| `onSceneLoad(sceneData)` | a scene that uses it loads |
| `postSceneLoad(sceneData)` | after every system has run `onSceneLoad` |
| `update()` | every tick (`game.state.deltaTime` seconds; `game.state.now` is the clock) |
| `render()` | after `update` each tick, on clients only: draw, sync meshes, UI |
| `entityDestroyed(id)` | an entity was destroyed |
| `onSceneUnload()` | the scene is leaving |
| any other name | `game.triggerEvent('onSomething', data)` calls `onSomething(data)` on every system that has it |

Systems run in the order they are first created, which is the order of the scene's
`systems` list. The tick rate is `tickRate` in game.json (ticks per second, default 20).

A system can be switched off with `system.enabled = false`; a scene only enables the systems
it lists.

## Services

Systems don't import each other. A system **provides** named functions:

```js
class GridSystem extends GUTS.BaseSystem {
    static services = ['getNearbyUnits', 'reserveGridCells'];
    getNearbyUnits(pos, radius) { /* ... */ }
}
```

and others **declare** what they use, then call it through `this.call`:

```js
class MovementSystem extends GUTS.BaseSystem {
    static serviceDependencies = ['getNearbyUnits'];
    update() {
        const near = this.call.getNearbyUnits(pos, 50);
    }
}
```

Outside a system, use `game.call('getNearbyUnits', pos, 50)` and
`game.hasService('getNearbyUnits')`. A service that no running system provides is a no-op
returning `undefined`, logged once. Use `game.hasService(name)` when "nobody provides it"
should mean something specific.

## Scenes

A scene, `collections/data/scenes/<name>.json`, picks what runs:

```json
{
    "title": "Battle",
    "interface": "game",
    "systems": ["GridSystem", "MovementSystem", "RenderSystem"],
    "clientSystems": ["HealthBarSystem"],
    "serverSystems": ["ServerNetworkSystem"],
    "entities": [{ "spawnType": "unit", "type": "archer", "components": { "team": { "team": 1 } } }]
}
```

- `systems`: run here, in this order. `clientSystems` / `serverSystems` are added only on that side.
- `interface`: the `ui/interfaces` page shown with it.
- `entities`: made when the scene loads. Each names a prefab (`collections.prefabs[spawnType]`,
  which says which collection its `type` comes from and which components to build) and may
  override component values. Spawning goes through the `createEntityFromPrefab` service,
  which the units kit's UnitCreationSystem provides.

game.json `initialScene` is the first scene. `game.sceneManager.loadScene('name')` switches.

## game.json and other configs

`collections/settings/configs/game.json` describes the client build:

| Key | Meaning |
|---|---|
| `title` | name |
| `libraries` | library classes to compile in (`threejs`, `BaseECSGame`, `SceneManager`, ...) |
| `systems` | systems to compile in (scenes choose which run) |
| `classes` | class collections, see [Projects and collections](#projects-and-collections) |
| `kits` | engine kits this project uses; see below |
| `appLibrary` | the game class (`BaseECSGame`, `ECSGame`, `MultiplayerECSGame`, or yours) |
| `appLoaderLibrary` | the loader that starts it (`SimpleLoader`, `GameLoader`) |
| `initialScene` | first scene |
| `tickRate` | ticks per second |
| `maxEntities` | entity id limit |
| `entityIdReuse` | reuse destroyed ids, see [Entities](#entities) |
| `loadingScreen` | title, steps and labels for the loading screen (`GameLoader`) |
| `persistentStateFields` | `game.state` fields kept across scene changes |

`server.json` and `headless.json` have the same shape for the server and headless builds
(typically `ServerECSGame` / `HeadlessECSGame` with their loaders). `state.json` holds the
initial `game.state`. Other files in `configs/` are yours; they are available as
`collections.configs.<name>`.

## Engine core, kits, and overriding engine files

The engine's own collections live in `global/`: the **core** (`global/collections`) and
optional **kits** (`global/kits/<kit>/collections`). The build merges them with your
project: you name engine systems in game.json exactly like your own. See
[global/README.md](../global/README.md) for what is in each.

- **Choosing kits.** `"kits": ["combat"]` makes the combat kit available (plus the kits it
  requires, here `ai` and `units`) and adds its component schemas and enums to your project.
  Without a `kits` list every kit's systems are available and you define all components
  yourself.
- **Replacing.** A project file with the same name as an engine file replaces it, for
  example `collections/scripts/systems/js/GridSystem.js`.
- **Extending.** Subclass instead of copying, so you keep getting engine fixes:

  ```js
  import Base from '@global/scripts/libraries/js/ModelManager.js';
  class ModelManager extends Base {
      // your overrides
  }
  ```

  `@global/...` resolves against the core, then each kit.

`guts fork-diff <project>` lists the engine files a project replaces and how they differ from
the engine's, which helps keep copies from drifting.

## Build targets

`guts build` makes up to four bundles in `dist/`:

| Target | Config | What for |
|---|---|---|
| `client` | game.json | the browser game |
| `server` | server.json | Node server for multiplayer (authoritative simulation) |
| `headless` | headless.json | simulation without rendering: AI-vs-AI runs, balance tests, CI |
| `editor` | editor.json | the editor with your project's collections and modules |

`guts build --target client` builds one. `--production` minifies.

## Multiplayer and determinism

GUTS games can run the simulation on a server (`ServerECSGame`) with clients mirroring it,
or in lockstep where every peer runs the same simulation. Either way, the simulation must be
**deterministic**: the same inputs give the same state everywhere.

- Use the seeded random `game.rng` (a `SeededRandom`; `game.rng.strand('name')` gives an
  independent stream), never `Math.random`, for anything that affects game state.
- Iterate entities in id order (`getEntitiesWith` does) rather than over `Set`s or
  `Map`s whose order depends on history.
- Use `game.state.now` for time, not `Date.now()` or `performance.now()`.
- Keep rendering-only state (meshes, particles, UI) in `render()` and off components.

`system.isAuthority()` is true where state is decided: the server online, or the local game.

## Performance notes

- Prefer numeric component schemas for anything many entities have.
- Hold on to a component view only within a function; fetch it again next tick.
- Use `getFieldArray` in loops over thousands of entities.
- `getEntitiesWith` results are cached until a matching component is added or removed;
  don't modify the returned array.
- Spatial questions go through the units kit's `getNearbyUnits` (a grid), not loops over
  every entity.
