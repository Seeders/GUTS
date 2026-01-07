# GUTS / Turn-Based Warfare Architecture

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              COMPLETE DATA FLOW                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  DESIGN TIME (JSON Files)                    RUNTIME
  ═══════════════════════                     ════════════════════════════════════       

  ┌─────────────────────┐
  │ Component Schemas   │──────────────────┐
  │ (data/components/)  │                  │
  │                     │                  │
  │ health.json:        │                  │    ┌───────────────────────┐
  │ { schema: {         │                  ├───▶│ ComponentGenerator    │
  │   max: 100,         │                  │    │                       │
  │   current: 100      │                  │    │ - Registers types     │
  │ }}                  │                  │    │ - Builds enum maps    │
  └─────────────────────┘                  │    │ - Expands schemas     │
                                           │    └───────────┬───────────┘
  ┌─────────────────────┐                  │                │
  │ Prefabs             │                  │                ▼
  │ (prefabs/units/)    │                  │    ┌───────────────────────┐
  │                     │                  │    │ ECS Storage           │
  │ peasant.json:       │                  │    │                       │
  │ { hp: 60,           │──────────────────┼───▶│ Entity 42:            │───────┐
  │   damage: 6,        │                  │    │ ├─ health: {60, 60}   │       │
  │   armor: 8,         │                  │    │ ├─ combat: {6, 8,...} │       │
  │   abilities: [...]} │                  │    │ ├─ transform: {...}   │       │
  └─────────────────────┘                  │    │ └─ team: {1}          │       │
                                           │    └───────────────────────┘       │
  ┌─────────────────────┐                  │                                    │
  │ Game Data           │                  │                                    │
  │ (data/buffTypes/)   │                  │                                    │
  │                     │──────────────────┘                                    │
  │ poison.json:        │                                                       │
  │ { damage: 5,        │                       ┌───────────────────────┐       │
  │   duration: 5 }     │──────────────────────▶│ Systems               │◀──────┘
  │                     │                       │                       │
  │ (data/abilities/)   │                       │ DamageSystem:         │
  │ (data/effects/)     │─────────────────────▶ │ - reads buffTypes     │
  │ (data/behaviors/)   │                       │ - queries entities    │
  └─────────────────────┘                       │ - modifies health     │
                                                │                       │
                                                │ MovementSystem:       │
                                                │ - queries transform   │
                                                │ - updates position    │
                                                │                       │
                                                │ BehaviorSystem:       │
                                                │ - reads behaviorTrees │
                                                │ - queries aiState     │
                                                │ - executes AI         │
                                                └───────────────────────┘
```


## Collections → ECS → Systems Relationship

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           COLLECTIONS (JSON Data Files)                                      │
│                        c:\projects\GUTS\projects\TurnBasedWarfare\collections\              │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                    COMPONENT SCHEMAS (data/components/*.json)                        │    │
│  │           Define the SHAPE of data that can be attached to entities                  │    │
│  │                                                                                      │    │
│  │   transform.json          health.json           combat.json                          │    │
│  │   ┌──────────────────┐    ┌─────────────────┐   ┌────────────────────────────────┐   │    │
│  │   │ schema: {        │    │ schema: {       │   │ schema: {                      │   │    │
│  │   │   position: {    │    │   max: 100,     │   │   damage: 0,                   │   │    │
│  │   │     x: 0, y: 0,  │    │   current: 100  │   │   range: 1,                    │   │    │
│  │   │     z: 0         │    │ }               │   │   attackSpeed: 1,              │   │    │
│  │   │   },             │    └─────────────────┘   │   armor: 0,                    │   │    │
│  │   │   rotation: {...}│                          │   fireResistance: 0, ...       │   │    │
│  │   │   scale: {...}   │    (70+ component        │ }                              │   │    │
│  │   │ }                │     schemas defined)     └────────────────────────────────┘   │    │
│  │   └──────────────────┘                                                               │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                           │                                                  │
│                                           │ ComponentGenerator reads schemas                 │
│                                           ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                      PREFABS (prefabs/units/*.json, prefabs/buildings/*.json)        │    │
│  │            Define ENTITY TEMPLATES with default component values                     │    │
│  │                                                                                      │    │
│  │   peasant.json                           barracks.json                               │    │
│  │   ┌──────────────────────────────────┐   ┌──────────────────────────────────────┐   │    │
│  │   │ {                                │   │ {                                    │   │    │
│  │   │   title: "Peasant",              │   │   title: "Barracks",                 │   │    │
│  │   │   hp: 60,          ─────────────────▶│   hp: 400,                           │   │    │
│  │   │   speed: 40,           Values        │   buildTime: 3,                      │   │    │
│  │   │   damage: 6,           populate      │   spawnUnits: ["soldier", "archer"], │   │    │
│  │   │   armor: 8,            component     │   upgrades: [...],                   │   │    │
│  │   │   abilities: [         data when     │   render: {...}                      │   │    │
│  │   │     "BuildAbility",    entity is     │ }                                    │   │    │
│  │   │     "MineGoldAbility"  spawned       └──────────────────────────────────────┘   │    │
│  │   │   ],                                                                             │    │
│  │   │   render: {...}                      (35+ units, 11+ buildings defined)          │    │
│  │   │ }                                                                                │    │
│  │   └──────────────────────────────────┘                                               │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                           │                                                  │
│                                           │ UnitCreationSystem.spawnUnit() reads prefab     │
│                                           ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                      DATA COLLECTIONS (settings/, data/, etc.)                       │    │
│  │                  Game data that systems reference at runtime                         │    │
│  │                                                                                      │    │
│  │   configs/game.json     data/buffTypes/    data/abilities/    data/effects/          │    │
│  │   ┌────────────────┐    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐       │    │
│  │   │ systems: [...] │    │ poison: {    │   │ Fireball: {  │   │ explosion: { │       │    │
│  │   │ libraries:[...]│    │   damage: 5, │   │   damage: 50,│   │   particles, │       │    │
│  │   │ gridSize: 48   │    │   duration:5 │   │   range: 200 │   │   sound: ... │       │    │
│  │   │ ...            │    │ }            │   │ }            │   │ }            │       │    │
│  │   └────────────────┘    └──────────────┘   └──────────────┘   └──────────────┘       │    │
│  │                                                                                      │    │
│  │   data/enums/           data/behaviorTrees/     data/upgrades/                       │    │
│  │   ┌────────────────┐    ┌──────────────────┐    ┌──────────────────┐                 │    │
│  │   │ element: [     │    │ meleeUnit: {     │    │ swordDamage: {   │                 │    │
│  │   │   "physical",  │    │   nodes: [...],  │    │   cost: 100,     │                 │    │
│  │   │   "fire",      │    │   root: "attack" │    │   effect: +10dmg │                 │    │
│  │   │   "ice", ...   │    │ }                │    │ }                │                 │    │
│  │   │ ]              │    └──────────────────┘    └──────────────────┘                 │    │
│  │   └────────────────┘                                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
└──────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                           │
                                           │ game.getCollections() loads all JSON
                                           │ at startup into memory
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               ECS CORE (BaseECSGame.js)                                      │
│                         Runtime entity/component storage & queries                           │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          COMPONENT TYPE REGISTRY                                       │  │
│  │                    Maps component names → numeric IDs for fast lookups                 │  │
│  │                                                                                        │  │
│  │   _initComponentTypes() reads collections.components (schemas)                         │  │
│  │                              ↓                                                         │  │
│  │   _componentTypeId: Map { "transform" → 0, "health" → 1, "combat" → 2, ... }          │  │
│  │   _componentTypeNames: [ "transform", "health", "combat", ... ]                        │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                           │                                                  │
│                                           ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                             ENTITY STORAGE (65,536 max)                                │  │
│  │                                                                                        │  │
│  │   entityAlive: Uint8Array[65536]           // 1 = alive, 0 = dead                      │  │
│  │   entityComponentMask: Uint32Array[65536×2] // 64-bit bitmask per entity               │  │
│  │   nextEntityId: 1, 2, 3, ...               // Monotonically increasing                 │  │
│  │                                                                                        │  │
│  │   Entity 42:                                                                           │  │
│  │   ┌──────────────────────────────────────────────────────────────────────────────┐    │  │
│  │   │  entityAlive[42] = 1                                                          │    │  │
│  │   │  entityComponentMask[84..85] = 0b...00000111  (has transform, health, combat) │    │  │
│  │   └──────────────────────────────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                           │                                                  │
│                                           ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                        COMPONENT DATA STORAGE (SoA Layout)                             │  │
│  │                                                                                        │  │
│  │   NUMERIC FIELDS → TypedArrays (cache-friendly, fast iteration)                        │  │
│  │   ┌────────────────────────────────────────────────────────────────────────────────┐  │  │
│  │   │  _numericArrays: Map {                                                          │  │  │
│  │   │    "transform.position.x" → Float32Array[65536],  // entity 42 at index 42      │  │  │
│  │   │    "transform.position.y" → Float32Array[65536],                                │  │  │
│  │   │    "transform.position.z" → Float32Array[65536],                                │  │  │
│  │   │    "health.current"       → Float32Array[65536],                                │  │  │
│  │   │    "health.max"           → Float32Array[65536],                                │  │  │
│  │   │    "combat.damage"        → Float32Array[65536],                                │  │  │
│  │   │    ...                                                                          │  │  │
│  │   │  }                                                                              │  │  │
│  │   └────────────────────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                                        │  │
│  │   COMPLEX FIELDS → Object Arrays (abilities, buffs, orders, etc.)                      │  │
│  │   ┌────────────────────────────────────────────────────────────────────────────────┐  │  │
│  │   │  _objectComponents: Map {                                                       │  │  │
│  │   │    "abilityQueue"  → Array[65536],  // entity 42 → { abilities: [...] }         │  │  │
│  │   │    "playerOrder"   → Array[65536],  // entity 42 → { target: 55, type: "move" } │  │  │
│  │   │    "buff"          → Array[65536],  // entity 42 → { stacks: [...] }            │  │  │
│  │   │    ...                                                                          │  │  │
│  │   │  }                                                                              │  │  │
│  │   └────────────────────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                           │                                                  │
│                                           ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              QUERY SYSTEM                                              │  │
│  │                                                                                        │  │
│  │   getEntitiesWithComponents(['transform', 'health', 'combat'])                         │  │
│  │                              ↓                                                         │  │
│  │   1. Convert names to type IDs: [0, 1, 2]                                              │  │
│  │   2. Build query bitmask: 0b00000111                                                   │  │
│  │   3. For each alive entity: (entityMask & queryMask) === queryMask                     │  │
│  │   4. Return matching entity IDs: [42, 55, 108, ...]                                    │  │
│  │                                                                                        │  │
│  │   getComponent(42, 'health') → Proxy { current: 60, max: 60 }                          │  │
│  │   addComponent(42, 'poison', { stacks: 3 })                                            │  │
│  │   removeComponent(42, 'buff')                                                          │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
└──────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                           │
                                           │ Systems query entities and read/write components
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  SYSTEMS (57 Total)                                          │
│                   Each system processes entities with specific components                    │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              SYSTEM BASE CLASS                                         │  │
│  │                                                                                        │  │
│  │   class BaseSystem {                                                                   │  │
│  │     constructor(game) {                                                                │  │
│  │       this.game = game;                                                                │  │
│  │       this.collections = game.getCollections();  // ← Access to all JSON data         │  │
│  │     }                                                                                  │  │
│  │     update() { }   // Called every tick (20 TPS)                                       │  │
│  │     render() { }   // Called every frame                                               │  │
│  │   }                                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           EXAMPLE: DamageSystem                                        │  │
│  │                                                                                        │  │
│  │   class DamageSystem extends GUTS.BaseSystem {                                         │  │
│  │                                                                                        │  │
│  │     init() {                                                                           │  │
│  │       // Cache collection data for fast access                                         │  │
│  │       this.buffTypes = this.collections.buffTypes;  // ← Reads JSON data              │  │
│  │     }                                                                                  │  │
│  │                                                                                        │  │
│  │     applyDamage(sourceId, targetId, amount) {                                          │  │
│  │       // Query ECS for component data                                                  │  │
│  │       const health = this.game.getComponent(targetId, "health");                       │  │
│  │       const combat = this.game.getComponent(targetId, "combat");                       │  │
│  │       const deathState = this.game.getComponent(targetId, "deathState");               │  │
│  │                                                                                        │  │
│  │       // Calculate damage using combat stats                                           │  │
│  │       const armor = combat.armor;                                                      │  │
│  │       const resistance = combat.fireResistance;                                        │  │
│  │       const finalDamage = amount * (1 - armor/100);                                    │  │
│  │                                                                                        │  │
│  │       // Modify component data (writes to TypedArrays)                                 │  │
│  │       health.current -= finalDamage;                                                   │  │
│  │                                                                                        │  │
│  │       // Check if dead                                                                 │  │
│  │       if (health.current <= 0) {                                                       │  │
│  │         deathState.state = 1; // dying                                                 │  │
│  │       }                                                                                │  │
│  │     }                                                                                  │  │
│  │   }                                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           EXAMPLE: MovementSystem                                      │  │
│  │                                                                                        │  │
│  │   update() {                                                                           │  │
│  │     // Query all entities with required components                                     │  │
│  │     const entities = this.game.getEntitiesWithComponents([                             │  │
│  │       'transform', 'velocity', 'movementState'                                         │  │
│  │     ]);                                                                                │  │
│  │                                                                                        │  │
│  │     for (const entityId of entities) {                                                 │  │
│  │       const transform = this.game.getComponent(entityId, 'transform');                 │  │
│  │       const velocity = this.game.getComponent(entityId, 'velocity');                   │  │
│  │                                                                                        │  │
│  │       // Update position based on velocity                                             │  │
│  │       transform.position.x += velocity.x * this.game.FIXED_DELTA_TIME;                 │  │
│  │       transform.position.y += velocity.y * this.game.FIXED_DELTA_TIME;                 │  │
│  │     }                                                                                  │  │
│  │   }                                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                         EXAMPLE: UnitCreationSystem                                    │  │
│  │                                                                                        │  │
│  │   spawnUnit(unitTypeKey, position, team) {                                             │  │
│  │     // 1. Read prefab from collections                                                 │  │
│  │     const prefab = this.collections.units[unitTypeKey];  // ← peasant.json            │  │
│  │                                                                                        │  │
│  │     // 2. Create new entity                                                            │  │
│  │     const entityId = this.game.createEntity();                                         │  │
│  │                                                                                        │  │
│  │     // 3. Add components with prefab values                                            │  │
│  │     this.game.addComponent(entityId, 'transform', {                                    │  │
│  │       position: { x: position.x, y: position.y, z: 0 }                                 │  │
│  │     });                                                                                │  │
│  │     this.game.addComponent(entityId, 'health', {                                       │  │
│  │       max: prefab.hp,      // ← 60 from peasant.json                                   │  │
│  │       current: prefab.hp                                                               │  │
│  │     });                                                                                │  │
│  │     this.game.addComponent(entityId, 'combat', {                                       │  │
│  │       damage: prefab.damage,     // ← 6 from peasant.json                              │  │
│  │       armor: prefab.armor,       // ← 8 from peasant.json                              │  │
│  │       attackSpeed: prefab.attackSpeed                                                  │  │
│  │     });                                                                                │  │
│  │     this.game.addComponent(entityId, 'team', { team: team });                          │  │
│  │     // ... more components                                                             │  │
│  │                                                                                        │  │
│  │     return entityId;                                                                   │  │
│  │   }                                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```


## Key Relationships

| Layer | Purpose | Examples |
|-------|---------|----------|
| **Collections (JSON)** | Static game data, loaded once at startup | component schemas, prefabs, configs, abilities, effects |
| **ECS Storage** | Runtime entity/component data, modified every tick | TypedArrays for position/health, Objects for abilities/orders |
| **Systems** | Logic that reads collections + queries/modifies ECS | DamageSystem, MovementSystem, BehaviorSystem |

## Collections Directory Structure

```
collections/
├── data/
│   ├── components/           ◀── COMPONENT SCHEMAS (70+ files)
│   │   ├── transform.json        Defines data shape: { position: {x,y,z} }
│   │   ├── health.json           Defines data shape: { max: 100, current: 100 }
│   │   ├── combat.json           Defines data shape: { damage, armor, range... }
│   │   └── ... (70+ schemas)
│   │
│   ├── buffTypes/            ◀── BUFF DEFINITIONS (referenced by DamageSystem)
│   ├── effects/              ◀── VISUAL EFFECTS (referenced by EffectsSystem)
│   ├── enums/                ◀── ENUM VALUES (element, team, deathState...)
│   └── behaviors/            ◀── AI BEHAVIOR TREES (referenced by BehaviorSystem)
│
├── prefabs/
│   ├── units/                ◀── UNIT TEMPLATES (35+ files)
│   │   ├── peasant.json          Template: hp=60, damage=6, armor=8
│   │   ├── soldier.json          Template: hp=100, damage=15, armor=20
│   │   └── ...
│   │
│   └── buildings/            ◀── BUILDING TEMPLATES (11+ files)
│       ├── barracks.json
│       └── ...
│
├── settings/
│   ├── configs/              ◀── GAME CONFIGURATION
│   │   ├── game.json             Systems list, libraries, canvas settings
│   │   └── server.json           Server tick rate, network settings
│   │
│   └── objectTypeDefinitions/ ◀── TYPE METADATA (not data)
│
└── scripts/
    └── systems/js/           ◀── SYSTEM IMPLEMENTATIONS (57 files)
        ├── DamageSystem.js       Reads buffTypes, queries health/combat
        ├── MovementSystem.js     Queries transform/velocity
        └── ...
```

---

## Client/Server Lockstep Determinism

Both client and server run the **same simulation systems** in lockstep at 20 TPS.
The client additionally runs rendering/UI systems. Scene configs define which systems run where.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                         SCENE CONFIGURATION (data/scenes/game.json)                          │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│   "systems": [                        ◀── SHARED (runs on BOTH client & server in lockstep) │
│     "GridSystem",        "RoundSystem",        "BehaviorSystem",                             │
│     "MovementSystem",    "ProjectileSystem",   "DamageSystem",                               │
│     "AbilitySystem",     "DeathSystem",        "PathfindingSystem",                          │
│     "VisionSystem",      "UnitCreationSystem", "PlacementSystem",                            │
│     "UnitOrderSystem",   "GoldMineSystem",     "SupplySystem", ...   (29 systems)            │
│   ]                                                                                          │
│                                                                                              │
│   "clientSystems": [                  ◀── CLIENT-ONLY (rendering, UI, input)                │
│     "RenderSystem",      "WorldSystem",        "AnimationSystem",                            │
│     "PostProcessingSystem", "EffectsSystem",   "ParticleSystem",                             │
│     "GameUISystem",      "InputSystem",        "ShopSystem",                                 │
│     "HealthBarSystem",   "MiniMapSystem",      "CameraControlSystem",                        │
│     "FogOfWarSystem",    "ClientNetworkSystem", ...                  (24 systems)            │
│   ]                                                                                          │
│                                                                                              │
│   "serverSystems": [                  ◀── SERVER-ONLY (authority, persistence)              │
│     "ServerBattlePhaseSystem",                                                               │
│     "ServerNetworkSystem",                                                                   │
│     "SaveSystem"                                                     (3 systems)             │
│   ]                                                                                          │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                           LOCKSTEP DETERMINISTIC ARCHITECTURE                              │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                            │
│                    ┌──────────────────────────────────────────────────┐                    │
│                    │           SHARED SIMULATION SYSTEMS (29)         │                    │
│                    │       Identical code runs on client AND server   │                    │
│                    │                                                  │                    │
│                    │  GridSystem, TerrainSystem, RoundSystem,         │                    │
│                    │  BehaviorSystem, MovementSystem, ProjectileSystem│                    │
│                    │  DamageSystem, AbilitySystem, DeathSystem,       │                    │
│                    │  PathfindingSystem, VisionSystem, SupplySystem,  │                    │
│                    │  UnitCreationSystem, PlacementSystem, ...        │                    │
│                    │                                                  │                    │
│                    │  Fixed timestep: 20 TPS (0.05s per tick)         │                    │
│                    │  Seeded RNG for determinism                      │                    │
│                    └──────────────────────────────────────────────────┘                    │
│                                                                                            │
│  ┌───────────────────────────────────┐             ┌───────────────────────────────────┐   │
│  │            CLIENT                 │             │            SERVER                 │   │
│  │                                   │             │                                   │   │
│  │  ┌─────────────────────────────┐  │             │  ┌─────────────────────────────┐  │   │
│  │  │  SHARED SYSTEMS (29)        │  │             │  │  SHARED SYSTEMS (29)        │  │   │
│  │  │  (runs full simulation)     │  │             │  │  (authoritative copy)       │  │   │
│  │  └─────────────────────────────┘  │             │  └─────────────────────────────┘  │   │
│  │              +                    │             │              +                    │   │
│  │  ┌─────────────────────────────┐  │             │  ┌─────────────────────────────┐  │   │
│  │  │  CLIENT SYSTEMS (24)        │  │             │  │  SERVER SYSTEMS (3)         │  │   │
│  │  │                             │  │             │  │                             │  │   │
│  │  │  RenderSystem               │  │             │  │  ServerBattlePhaseSystem    │  │   │
│  │  │  WorldSystem                │  │             │  │  SaveSystem                 │  │   │
│  │  │  AnimationSystem            │  │             │  │                             │  │   │
│  │  │  PostProcessingSystem       │  │             │  │  ┌───────────────────────┐  │  │   │
│  │  │  EffectsSystem              │  │             │  │  │ ServerNetworkSystem   │  │  │   │
│  │  │  ParticleSystem             │  │             │  │  │ (Socket.IO server)    │  │  │   │
│  │  │  FogOfWarSystem             │  │             │  │  └───────────┬───────────┘  │  │   │
│  │  │  GameUISystem               │  │             │  └──────────────┼──────────────┘  │   │
│  │  │  InputSystem                │  │             │                 │                 │   │
│  │  │  ShopSystem                 │  │             │  Headless execution               │   │
│  │  │  HealthBarSystem            │  │             │  No Three.js / No UI              │   │
│  │  │  MiniMapSystem              │  │             └─────────────────┼─────────────────┘   │
│  │  │  CameraControlSystem        │  │                               │                     │
│  │  │  DamageNumberSystem         │  │                               │                     │
│  │  │  ...                        │  │                               │                     │
│  │  │                             │  │                               │                     │
│  │  │  ┌───────────────────────┐  │  │         ┌─────────────────────┘                     │
│  │  │  │ ClientNetworkSystem  │  │  │         │                                            │
│  │  │  │ (Socket.IO client)   │──┼──┼─────────┘                                            │
│  │  │  └───────────────────────┘  │  │     Network Communication                           │
│  │  └─────────────────────────────┘  │     - Full sync on connect                          │
│  │                                   │     - Delta sync during game                        │
│  │  Three.js Rendering               │     - Player inputs/orders                          │
│  │  User Input → Visual Effects      │     - State reconciliation                          │
│  └───────────────────────────────────┘                                                     │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                          NETWORK COMMUNICATION DETAIL                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│     CLIENT                                              SERVER                               │
│  ┌──────────────────────┐                         ┌──────────────────────┐                  │
│  │  ClientNetworkSystem │                         │  ServerNetworkSystem │                  │
│  │                      │                         │                      │                  │
│  │  networkRequest()  ──┼── Socket.IO emit ──────▶│  handleEvent()       │                  │
│  │                      │                         │                      │                  │
│  │  handleResponse() ◀──┼── Socket.IO emit ──────┤  respond()           │                  │
│  │                      │                         │                      │                  │
│  │  applyServerState()◀─┼── Delta/Full Sync ─────┤  broadcastState()    │                  │
│  │                      │                         │                      │                  │
│  └──────────────────────┘                         └──────────────────────┘                  │
│                                                                                              │
│  Message Types:                                                                              │
│  ├─ submitPlacement     → Player places units during placement phase                        │
│  ├─ submitOrder         → Player issues move/attack orders                                  │
│  ├─ startBattle         → Player ready, begin battle phase                                  │
│  ├─ syncState           ← Server pushes ECS state (delta or full)                           │
│  └─ gameEvent           ← Server broadcasts game events (round end, victory, etc.)          │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 DETERMINISM GUARANTEES                                       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  1. FIXED TIMESTEP         │  FIXED_DELTA_TIME = 1/20 = 0.05s per tick                      │
│                            │  No floating-point time accumulation drift                     │
│                                                                                              │
│  2. SEEDED RNG             │  this.rng = new SeededRandom(seed)                             │
│                            │  Same seed → same random sequence on client & server           │
│                                                                                              │
│  3. SORTED ITERATION       │  Component types registered alphabetically                     │
│                            │  Entity queries return consistent order                        │
│                                                                                              │
│  4. INTEGER ENTITY IDs     │  Monotonically increasing, no recycling                        │
│                            │  Prevents reference bugs across network                        │
│                                                                                              │
│  5. ENUM INDICES           │  Strings converted to numeric indices                          │
│                            │  "fire" → 1, "ice" → 2 (sorted alphabetically)                 │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Full System Architecture


┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    GAME STATE                                                │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  state = {                                                                             │  │
│  │    phase: 'placement' | 'battle' | 'round_end',                                        │  │
│  │    round: number,                                                                      │  │
│  │    isPaused: boolean,                                                                  │  │
│  │    now: float (simulation time),                                                       │  │
│  │    deltaTime: 0.05s (fixed 20 TPS)                                                     │  │
│  │  }                                                                                     │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              PHASE TRANSITIONS                                         │  │
│  │                                                                                        │  │
│  │   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐                        │  │
│  │   │  PLACEMENT   │─────▶│    BATTLE    │─────▶│  ROUND END   │───┐                   │  │
│  │   │              │      │              │      │              │   │                   │  │
│  │   │ - Buy units  │      │ - AI runs    │      │ - Cleanup    │   │                   │  │
│  │   │ - Position   │      │ - Combat     │      │ - Victory?   │   │                   │  │
│  │   │ - Upgrades   │      │ - Movement   │      │ - Upgrades   │   │                   │  │
│  │   └──────────────┘      └──────────────┘      └──────┬───────┘   │                   │  │
│  │          ▲                                           │           │                   │  │
│  │          └───────────────────────────────────────────┴───────────┘                   │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  DATA COLLECTIONS                                            │
│                                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────────────────┐  │
│  │     PREFABS         │  │    DEFINITIONS      │  │          CONFIGS                    │  │
│  │  ┌───────────────┐  │  │  ┌───────────────┐  │  │  ┌───────────────────────────────┐  │  │
│  │  │ units/        │  │  │  │ components    │  │  │  │ game.json (client systems)    │  │  │
│  │  │  - peasant    │  │  │  │ units         │  │  │  │ server.json (server systems)  │  │  │
│  │  │  - soldier    │  │  │  │ abilities     │  │  │  │ state.json (initial state)    │  │  │
│  │  │  - mage       │  │  │  │ effects       │  │  │  │ multiplayer.json              │  │  │
│  │  │  - dragon     │  │  │  │ buffs         │  │  │  └───────────────────────────────┘  │  │
│  │  │  - (35+ more) │  │  │  │ projectiles   │  │  │                                     │  │
│  │  ├───────────────┤  │  │  │ upgrades      │  │  │  ┌───────────────────────────────┐  │  │
│  │  │ buildings/    │  │  │  │ behaviors     │  │  │  │ RESOURCES                     │  │  │
│  │  │  - barracks   │  │  │  └───────────────┘  │  │  │  - models/ (glTF)             │  │  │
│  │  │  - mage_tower │  │  │                     │  │  │  - textures/                  │  │  │
│  │  │  - gold_mine  │  │  │                     │  │  │  - sprites/                   │  │  │
│  │  │  - (11+ more) │  │  │                     │  │  │  - animations/                │  │  │
│  │  └───────────────┘  │  │                     │  │  └───────────────────────────────┘  │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               DATA FLOW: UNIT ATTACK                                         │
│                                                                                              │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐    │
│  │ Behavior   │───▶│ Ability    │───▶│ Damage     │───▶│ Buff       │───▶│ Death      │    │
│  │ System     │    │ System     │    │ System     │    │ System     │    │ System     │    │
│  │            │    │            │    │            │    │            │    │            │    │
│  │ AI decides │    │ Queue &    │    │ Calculate  │    │ Apply      │    │ Handle     │    │
│  │ to attack  │    │ execute    │    │ damage     │    │ effects    │    │ death      │    │
│  └────────────┘    └────────────┘    └────────────┘    └────────────┘    └────────────┘    │
│        │                │                  │                │                │             │
│        ▼                ▼                  ▼                ▼                ▼             │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                            ECS COMPONENT UPDATES                                      │  │
│  │    aiState ──▶ abilityQueue ──▶ health.current ──▶ buffState ──▶ deathState          │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
│                                          │                                                  │
│                                          ▼                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              NETWORK SYNC                                             │  │
│  │              Delta sync changed components to all connected clients                   │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DIRECTORY STRUCTURE                                             │
│                                                                                              │
│  c:\projects\GUTS\                                                                           │
│  │                                                                                           │
│  ├── global/collections/scripts/libraries/js/    ◀── Shared Engine Libraries                │
│  │   ├── BaseECSGame.js                              (ECS core, networking, utilities)      │
│  │   ├── BaseSystem.js                                                                       │
│  │   ├── BehaviorTreeProcessor.js                                                            │
│  │   ├── ClientNetworkManager.js                                                             │
│  │   ├── CoordinateTranslator.js                                                             │
│  │   └── ... (25+ shared libraries)                                                          │
│  │                                                                                           │
│  └── projects/TurnBasedWarfare/collections/      ◀── Game Project                           │
│      │                                                                                       │
│      ├── scripts/systems/js/                     ◀── 57 Game Systems                        │
│      │   ├── RoundSystem.js                                                                  │
│      │   ├── DamageSystem.js                                                                 │
│      │   ├── MovementSystem.js                                                               │
│      │   └── ... (53+ systems)                                                               │
│      │                                                                                       │
│      ├── prefabs/                                ◀── Entity Templates                        │
│      │   ├── units/ (35+ unit types)                                                         │
│      │   └── buildings/ (11+ building types)                                                 │
│      │                                                                                       │
│      ├── settings/                               ◀── Configuration                           │
│      │   ├── configs/ (game.json, server.json)                                               │
│      │   └── objectTypeDefinitions/                                                          │
│      │       ├── components.json                                                             │
│      │       ├── units.json                                                                  │
│      │       └── abilities.json                                                              │
│      │                                                                                       │
│      └── data/                                   ◀── Game Data                               │
│          ├── behaviors/                              (AI, animations, sprites)               │
│          └── spriteAnimationSets/                                                            │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key Architectural Patterns

| Pattern | Usage |
|---------|-------|
| **ECS** | BaseECSGame with bitmask queries, TypedArray storage |
| **Service Registry** | `game._services` for shared services |
| **Behavior Trees** | AI decision making via BehaviorTreeProcessor |
| **Delta Sync** | Only changed component values sent over network |
| **Fixed Timestep** | Deterministic 20 TPS simulation |
| **Instanced Rendering** | Three.js instancing for 100s of entities |

## Performance Optimizations

- **TypedArrays**: Numeric components in Float32Array for cache locality
- **Bitmask Queries**: O(1) component matching with 64-bit masks
- **Object Pooling**: Reusable objects in movement, damage systems
- **Path Caching**: A* results cached (1000 entries, 5s expiry)
- **GPU Fog of War**: Line-of-sight computed on GPU
