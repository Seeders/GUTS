# GUTS Project Deep Dive Summary

> **Purpose**: This document provides AI agents with comprehensive context about the GUTS project to enable faster understanding and more effective assistance.

## Executive Summary

**GUTS (Gamedev Ultimate Toolkit System)** is a comprehensive, data-driven game development framework with a visual editor. The current game project is **Turn-Based Warfare**, a tactical strategy game with multiplayer and single-player modes.

---

## Quick Reference

| Aspect | Details |
|--------|---------|
| **Project Type** | Game Engine + Visual Editor + Framework |
| **Primary Language** | JavaScript (ES6+) |
| **Rendering** | Three.js (3D) |
| **Physics** | Rapier |
| **Networking** | Socket.io |
| **Architecture** | Entity Component System (ECS) |
| **Build System** | Webpack 5 |
| **Max Entities** | 16,384 |
| **Game Loop** | Fixed 20 TPS (ticks per second) |

---

## Directory Structure

```
GUTS/
├── engine/                          # Core engine implementations
│   ├── Engine.js                   # Client-side engine (fixed 20 TPS)
│   ├── BaseEngine.js               # Abstract base class
│   ├── ServerEngine.js             # Server variant
│   ├── EditorController.js         # Editor MVC controller
│   ├── EditorModel.js              # Editor data management
│   ├── EditorView.js               # Editor UI rendering
│   └── FileSystemSyncService.js    # Project filesystem sync
│
├── global/collections/             # Shared engine libraries
│   └── scripts/libraries/js/
│       ├── BaseECSGame.js          # Core ECS implementation (2000+ lines)
│       ├── ECSGame.js              # Game-specific ECS extensions
│       ├── MultiplayerECSGame.js   # Multiplayer variant with network sync
│       ├── BaseSystem.js           # System base class
│       ├── GameServices.js         # Service registry pattern
│       ├── GameState.js            # State management
│       ├── ComponentGenerator.js   # Component factories & schema analysis
│       ├── ImageManager.js         # Sprite generation from 3D models
│       ├── EntityRenderer.js       # 3D rendering (GLTF, VAT, billboards)
│       ├── GameLoader.js           # Asset loading pipeline
│       └── [80+ utility libraries]
│
├── projects/TurnBasedWarfare/      # Current game project
│   ├── collections/
│   │   ├── settings/configs/game.json  # Main game configuration
│   │   ├── scripts/systems/js/     # 59 game systems (registered in game.json)
│   │   ├── scripts/abilities/js/   # 40+ ability implementations
│   │   ├── scripts/libraries/js/   # Game-specific utilities
│   │   ├── data/                   # Component/ability/enum definitions
│   │   ├── environment/scenes/     # Level definitions (JSON)
│   │   ├── resources/              # Units, buildings, items prefabs
│   │   └── ui/interfaces/          # HTML/CSS for game UI
│   ├── resources/                  # Asset files (models, textures, audio)
│   └── dist/                       # Build output
│
├── build/                          # Custom build system
│   ├── build.js                   # Main build orchestrator
│   ├── config-parser.js           # Parses game.json for bundling
│   └── entry-generator.js         # Generates webpack entry points
│
├── docs/                           # Documentation
│   └── AI_PROJECT_SUMMARY.md      # This file
│
└── webpack.config.js              # Webpack configuration
```

---

## Core Architecture

### 1. Entity Component System (ECS)

**High-performance ECS with TypedArrays:**

```javascript
// Entity Management
const entityId = game.createEntity();  // Returns numeric ID (0-16383)

// Components - stored in Float32Arrays for performance
game.addComponent(entityId, 'transform', { position: {x: 0, y: 0, z: 0} });
game.addComponent(entityId, 'health', { current: 100, max: 100 });

// Querying - uses bitmask for O(1) component checks
const entities = game.getEntitiesWith('health', 'velocity');

// Component access via proxies (reads directly from TypedArrays)
const health = game.getComponent(entityId, 'health');
health.current -= 10;  // Direct modification updates TypedArray

// Fast-path field updates
game.setField(entityId, 'transform', 'position.x', 100);
```

**Storage Strategy:**
- **Numeric components**: Float32Arrays (Structure of Arrays layout for cache efficiency)
- **Object components**: Regular object arrays (for complex/nested data)
- **Entity tracking**: Uint8Array for alive flags, Uint32Array pairs for 64-bit component bitmasks
- **Proxy caching**: Reuses proxy objects per entity+component to reduce GC

### 2. System Architecture

All systems extend `BaseSystem` with lifecycle methods:

```javascript
class MySystem extends BaseSystem {
  // Auto-registered to GameServices
  static services = ['myPublicMethod', 'anotherMethod'];

  postAllInit() { }             // Called after ALL systems initialized
  onSceneLoad(sceneData) { }    // Scene-specific setup
  onSceneUnload() { }           // Cleanup when leaving scene
  update(dt) { }                // Per-tick logic (20 TPS)
  render() { }                  // Per-tick rendering (client only)
  isRequiredForScene(scene) { } // Enable/disable per scene
}
```

**Service Registration Pattern:**
```javascript
// In system class - methods auto-bound and registered
static services = ['getPlayerStats', 'addPlayerGold'];

// Calling from anywhere in codebase
this.game.call('getPlayerStats', playerId);

// Check if service exists
if (this.game.hasService('someService')) { ... }
```

**Direct System Access:**
```javascript
// Systems auto-register themselves
this.game.animationSystem.someMethod();
this.game.damageSystem.applyDamage(entityId, amount);
```

### 3. Game Loop

```javascript
// Fixed 20 TPS with accumulator-based catch-up
gameLoop() {
  deltaTime = now - lastTime;
  accumulator += deltaTime;

  // Catch up gradually (max 3 ticks per frame to prevent spiral)
  while (accumulator >= tickRate) {  // tickRate = 0.05s (50ms)
    systems.forEach(s => s.update(tickRate));
    accumulator -= tickRate;
  }

  // Render every frame (not tied to tick rate)
  systems.forEach(s => s.render());
  requestAnimationFrame(gameLoop);
}
```

**Tab Visibility Handling:**
- Switches to `setInterval` when tab hidden
- Returns to `requestAnimationFrame` when visible
- Prevents massive accumulator buildup

### 4. Networking

**Client-Server Architecture:**
- Server-authoritative with client prediction
- Delta synchronization (only changed values since last sync)
- Deterministic simulation (seeded RNG, fixed timestep)
- Sparse encoding (only non-default values transmitted)

**Key Network Events:**
```
Room Management:
- ROOM_CREATED, ROOM_JOINED, PLAYER_JOINED, PLAYER_LEFT

Game Flow:
- GAME_STARTED, BATTLE_END, GAME_END
- PLAYER_READY_UPDATE, READY_FOR_BATTLE_UPDATE

Gameplay:
- SUBMIT_PLACEMENT, SET_SQUAD_TARGET, SET_SQUAD_TARGETS
- PURCHASE_UPGRADE, UPGRADE_BUILDING, CANCEL_BUILDING
```

**Entity Sync Format:**
```javascript
{
  fullSync: boolean,           // Full state or delta only
  nextEntityId: number,        // For ID consistency
  entityAlive: { id: 1 },      // Entities that exist
  entityDead: [id, ...],       // Entities to remove
  entityComponentMask: { id: [low, high] },  // 64-bit bitmasks
  numericArrays: { "component.field": { id: value } },
  objectComponents: { type: { id: data } }
}
```

---

## Turn-Based Warfare Game

### Game Modes

| Mode | Description | Status |
|------|-------------|--------|
| **Skirmish** | Single-player vs AI | ✅ Active |
| **Arena** | 1v1 PvP multiplayer | ✅ Active |
| Campaign | 10 rounds, progressive | Disabled |
| Survival | Infinite, decreasing gold | Disabled |
| Challenge | Preset enemies | Disabled |
| Endless | Infinite scaling | Disabled |
| Tournament | 8 rounds, bracket | Disabled |

### Game Flow

**Skirmish (Single-Player):**
```
LobbyUISystem.showSkirmishLobby()
    ↓ Player selects team + level
SkirmishGameSystem.startSkirmishGame()
    ↓ Creates game scene, spawns players
AIPlacementSystem.generateAIPlacement()
    ↓ AI builds balanced army within budget
30-second Placement Phase
    ↓ Player places units, AI already placed
30-second Battle Phase
    ↓ Units fight automatically
Victory/Defeat Screen
```

**Multiplayer (Arena):**
```
Create/Join Room → Server assigns teams
    ↓
Both Players Ready → GAME_STARTED
    ↓
30-second Placement Phase
    ↓ Squad targets synced via network
30-second Deterministic Battle
    ↓ Identical simulation on client/server
Server checks victory → BATTLE_END with entity sync
    ↓
Victory/Defeat OR next round
```

### Key Systems (59 registered in game.json)

**Core Game:**
| System | Purpose |
|--------|---------|
| `GameSystem` | Main lifecycle, scene management |
| `GameModeSystem` | Mode configuration and rules |
| `RoundSystem` | Round transitions, order resets |
| `PlacementSystem` | Unit placement validation |
| `SquadSystem` | Squad formations, grid positioning |
| `SkirmishGameSystem` | Single-player game controller |

**Client-Specific:**
| System | Purpose |
|--------|---------|
| `ClientNetworkSystem` | Multiplayer networking |
| `LobbyUISystem` | Lobby screens (skirmish & multiplayer) |
| `GameUISystem` | In-game HUD, menus |
| `PlacementUISystem` | Placement phase UI, raycasting |
| `RenderSystem` | Three.js rendering |
| `CameraControlSystem` | Camera movement |
| `InputSystem` | Mouse/keyboard input |

**Server-Specific:**
| System | Purpose |
|--------|---------|
| `ServerNetworkSystem` | Server networking |
| `ServerBattlePhaseSystem` | Victory conditions, timing |

**Combat:**
| System | Purpose |
|--------|---------|
| `AbilitySystem` | Ability execution, cooldowns |
| `DamageSystem` | Damage calculation, resistances |
| `DeathSystem` | Entity destruction |
| `EffectsSystem` | Visual effects, particles |
| `HealthBarSystem` | Health bar rendering |

**AI:**
| System | Purpose |
|--------|---------|
| `AIPlacementSystem` | AI army generation |
| `BehaviorSystem` | Behavior tree execution |
| `MovementSystem` | Pathfinding, steering |
| `PathfindingSystem` | A* pathfinding |

### Important Files

| File | Purpose |
|------|---------|
| `settings/configs/game.json` | Main config (libraries, systems, settings) |
| `scripts/libraries/js/GameModeConfigs.js` | Game mode definitions |
| `scripts/systems/js/SkirmishGameSystem.js` | Single-player controller |
| `scripts/systems/js/ClientNetworkSystem.js` | Multiplayer client |
| `scripts/systems/js/LobbyUISystem.js` | Lobby UI logic |
| `ui/interfaces/html/main.html` | Game UI structure |
| `ui/interfaces/css/main.css` | Game styling |

### State Management

```javascript
// Game state access (via this.game.state)
this.game.state.phase      // 'lobby' | 'placement' | 'battle' | 'ended'
this.game.state.round      // Current round number (1-based)
this.game.state.now        // Game time in seconds (deterministic)
this.game.state.gold       // Player's current gold
this.game.state.mode       // Current game mode config

// Get player's team via PlayerStatsSystem
this.game.call('getActivePlayerTeam')  // 2 (left) | 3 (right)
```

### Teams

| Value | Name | Description |
|-------|------|-------------|
| 0 | `neutral` | No team affiliation |
| 1 | `hostile` | Enemy to all teams |
| 2 | `left` | Player 1 (left side of map) |
| 3 | `right` | Player 2 or AI (right side) |

---

## Data-Driven Design

**Everything is JSON:**
- Game objects defined in `collections/` folders
- Each folder type maps to a collection (units, abilities, buildings, etc.)
- Objects loaded at runtime into collections registry
- No recompilation needed - edit JSON, refresh browser

**Accessing Collections:**
```javascript
// Get all collections
const collections = this.game.getCollections();

// Access specific collections
const units = collections.units;
const abilities = collections.abilities;
const buildings = collections.buildings;

// Get enums
const enums = this.game.getEnums();
const phases = enums.gamePhase;  // { lobby: 0, placement: 1, battle: 2, ended: 3 }
```

**Collection Types:**
- `units/` - Unit type definitions (HP, damage, abilities)
- `buildings/` - Building definitions (production, upgrades)
- `abilities/` - Ability data (cooldowns, damage, effects)
- `effects/` - Visual effect definitions
- `upgrades/` - Upgrade paths and costs
- `behaviors/` - AI behavior trees
- `scenes/` - Level definitions
- `enums/` - Type-safe constant definitions

---

## Build & Development

**NPM Scripts:**
```bash
npm run build              # Build current project
npm run build:watch        # Build with file watching
npm run build:prod         # Production build (minified)
npm run dev                # Webpack dev server (hot reload)
npm run game:server        # Start game server
npm run start:editor       # Start visual editor
```

**Environment Variables:**
- `PROJECT_NAME` - Selects which project to build (default: TurnBasedWarfare)

**Build Output:**
```
projects/{ProjectName}/dist/
├── client/
│   ├── game.js           # Compiled client bundle
│   ├── cache/            # Collection data as JSON
│   │   ├── abilities.json
│   │   ├── units.json
│   │   └── ...
│   └── resources/        # Game assets
└── server/
    └── game.js           # Compiled server bundle
```

---

## Key Patterns to Remember

### 1. Service Registry Pattern
Systems expose methods via `static services` array - auto-registered on init:
```javascript
class MySystem extends BaseSystem {
  static services = ['doSomething'];
  doSomething(arg) { /* ... */ }
}
// Call from anywhere: this.game.call('doSomething', arg)
```

### 2. Component Proxies
`getComponent()` returns live proxy that reads/writes directly to TypedArrays:
```javascript
const health = this.game.getComponent(entityId, 'health');
health.current -= 10;  // Immediately updates TypedArray storage
```

### 3. Scene-Based Systems
Systems enable/disable per scene via `isRequiredForScene()`:
```javascript
isRequiredForScene(sceneData) {
  return sceneData.initialScene === 'client';  // Only run on client scene
}
```

### 4. Deterministic Networking
Same RNG seed + fixed timestep = identical simulation on client and server:
```javascript
// Server seeds RNG
this.game.seedRandom(roomId + round);
// Both sides get same random sequence
const roll = this.game.random();
```

### 5. Event Broadcasting
Systems implement handler methods by name, triggered via `triggerEvent()`:
```javascript
// In system
onKeyDown(event) { /* handle key */ }
onGameStarted(data) { /* setup */ }

// Trigger from anywhere
this.game.triggerEvent('onKeyDown', { key: 'Space' });
```

---

## Common Tasks

### Adding a New System
1. Create file: `collections/scripts/systems/js/MySystem.js`
2. Extend `BaseSystem`
3. Add to `game.json` systems array
4. Implement lifecycle methods
5. Optionally define `static services` for public API

### Adding a Component
1. Define schema in `collections/data/components/myComponent.json`
2. Schema determines storage type (numeric fields → TypedArray, objects → array)
3. Access via `game.addComponent()` / `game.getComponent()`

### Adding an Ability
1. Create class: `collections/scripts/abilities/js/MyAbility.js`
2. Extend `BaseAbility`
3. Define data: `collections/data/abilities/myAbility.json`
4. AbilitySystem auto-instantiates on entities with ability reference

### Modifying UI
1. Edit HTML: `collections/ui/interfaces/html/main.html`
2. Edit CSS: `collections/ui/interfaces/css/main.css`
3. UI systems (LobbyUISystem, GameUISystem) handle interactivity

### Adding a Game Mode
1. Add config to `GameModeConfigs.js`
2. Define gold progression, enemy scaling functions
3. Add UI elements in `main.html`
4. Handle mode in `GameModeSystem`

---

## Performance Considerations

| Optimization | Details |
|--------------|---------|
| **TypedArray Storage** | Numeric components in Float32Arrays for cache efficiency |
| **Query Caching** | `getEntitiesWith()` results cached, invalidated on structural changes |
| **Entity ID Recycling** | Minimum-ID reuse for deterministic networking |
| **Object Pooling** | Effects, particles, materials pooled and reused |
| **Batch Rendering** | VAT models and billboards use instanced rendering |
| **Fixed Timestep** | 20 TPS prevents physics instability |
| **Proxy Caching** | Component proxies reused per entity to reduce GC |
| **Delta Sync** | Only changed values transmitted over network |

---

## Debugging Tips

### Service Debugging
```javascript
// List all registered services
this.game.listServices();

// Check if service exists
this.game.hasService('someMethod');
```

### Entity Debugging
```javascript
// Get all components on entity
const mask = this.game.getEntityComponentMask(entityId);

// Check if entity has component
this.game.hasComponent(entityId, 'health');

// Get entity count
const count = this.game.getEntityCount();
```

### Network Debugging
```javascript
// Enable desync debugging
this.game.desyncDebugger.enable();

// Log all network events
this.game.clientNetworkSystem.debug = true;
```

---

## Summary for AI Agents

When working on this project:

1. **Understand the ECS**: Entities are IDs, components are data, systems are logic
2. **Use services**: Call `this.game.call('serviceName', args)` for cross-system communication
3. **Check collections**: Game data is in JSON - `this.game.getCollections()`
4. **Follow patterns**: Extend `BaseSystem`, use `static services`, implement lifecycle methods
5. **Test deterministically**: Same inputs must produce same outputs for networking
6. **Keep it data-driven**: Prefer JSON configuration over hardcoded values
