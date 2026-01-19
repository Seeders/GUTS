# UseYourIllusions - Puzzle Game Implementation Plan

## Overview

Create a new puzzle game project where a player controls a single character navigating levels to find exits. The player has a magic belt that stores up to 3 objects from the environment, which can be used to create illusions that manipulate enemy AI.

## Project Setup

### 1. Copy TurnBasedWarfare to UseYourIllusions

Copy `projects/TurnBasedWarfare/` to `projects/UseYourIllusions/`

### 2. Modify game.json

File: `collections/settings/configs/game.json`

Changes:
- Set `title` to "Use Your Illusions"
- Keep multiplayer infrastructure intact (MultiplayerECSGame, networking systems)
- Add new puzzle systems to the systems list
- Add new component registrations

### 3. Create New Components

Location: `collections/data/components/`

| Component | Purpose |
|-----------|---------|
| `playerController.json` | Marks player entity, stores movement speed, interaction radius |
| `magicBelt.json` | 3 slots array, selectedSlot index |
| `collectible.json` | Object type reference (prefab key) |
| `illusion.json` | Source prefab key, creator entity, creation time, duration - inherits all properties from source prefab |
| `exitZone.json` | Radius, isActive flag |

**Important:** The `illusion` component only tracks illusion-specific data (duration, creator). When spawning an illusion, the system copies all relevant components (collision, render, size) directly from the source prefab. The illusion IS a copy of the object - it naturally blocks vision if it has collision, attracts aggro if it looks like a unit, etc.

### 4. Create New Systems

Location: `collections/scripts/systems/js/`

| System | Purpose |
|--------|---------|
| `PlayerControlSystem.js` | WASD movement, click-to-move, interaction key |
| `IllusionSystem.js` | Manage illusion lifetime/cleanup (spawning done via PlaceIllusionAbility) |
| `ExitSystem.js` | Detect player reaching exit, trigger level complete |
| `BeltUISystem.js` | Display belt slots UI, handle 1-2-3 key selection, update belt component |
| `PuzzleGameSystem.js` | Game flow coordination, spawn player/collectibles/exit using existing level data |
| `PuzzleLobbyUISystem.js` | Main menu and level selection UI |

**Note:**
- Belt data (slots array, selected slot) is stored in the `magicBelt` component on the player entity
- Systems read/write to the component - no separate "MagicBeltSystem" needed
- Level loading uses existing `TerrainSystem` infrastructure

### 5. Unit Definitions

**Player Unit Prefab:** `collections/prefabs/units/illusionist.json`

Create the player character using an existing model (e.g., scout or apprentice):

```json
{
  "title": "Illusionist",
  "hp": 100,
  "speed": 50,
  "visionRange": 400,
  "behaviorTree": null,
  "render": {
    "model": { "shapes": [{ "type": "gltf", "model": "scout" }] },
    "animations": { "idle": [...], "walk": [...] }
  }
}
```

The player has no behavior tree (direct player control) and gets the `playerController` and `magicBelt` components added on spawn.

**Guard Unit Prefab:** `collections/prefabs/units/guard.json`

Create a guard unit prefab using existing soldier model/animations with patrol behavior:

```json
{
  "title": "Guard",
  "hp": 100,
  "speed": 30,
  "damage": 10,
  "visionRange": 300,
  "behaviorTree": "GuardBehaviorTree",
  "render": {
    "model": { "shapes": [{ "type": "gltf", "model": "soldier" }] },
    "animations": { ... }
  }
}
```

**AI Behavior:** Use existing behavior trees and actions - since illusions are full copies of objects (same components, same appearance), enemies interact with them naturally using existing AI:

- Existing `FindNearestEnemyBehaviorAction` will find illusions that look like enemies
- Existing `VisionSystem` will be blocked by illusions that have collision
- May create a `GuardBehaviorTree.json` for patrol patterns if needed, using existing behavior actions

### 6. VisionSystem (Likely No Changes Needed)

The existing `VisionSystem.js` already checks collision/obstacles for line-of-sight. Since illusions are full copies of objects with proper collision components, they should naturally block vision without any code changes.

### 7. Create Collectible Prefabs

Location: `collections/prefabs/collectibles/`

Collectible objects are regular world objects with a `collectible` component. When turned into illusions, they retain all their properties:

| Prefab | Inherent Behavior | Use Case |
|--------|-------------------|----------|
| `barrel.json` | Has collision/size - blocks movement and vision naturally | Block enemy sight lines |
| `crate.json` | Has collision/size - blocks movement and vision naturally | Block enemy sight lines |
| `decoy_soldier.json` | Looks like enemy unit - enemies may investigate or attack | Bait enemies away |

Illusions are full copies of these prefabs with an added `illusion` component for tracking duration. They behave exactly like the real object would.

### 8. Create Level Format

Location: `collections/terrain/levels/`

Extend existing level format (with tileMap for terrain) and add puzzle-specific fields:

```json
{
  "title": "Level 1 - Tutorial",
  "published": true,
  "world": "shire",
  "tileMap": {
    "size": 32,
    "terrainTypes": ["water", "lava", "dirt", "brick", "rock", "forest", "grass"],
    "terrainMap": [[6,6,6,...], [6,6,4,...], ...]
  },
  "heightMap": [[0,0,0,...], ...],
  "playerSpawn": { "x": -300, "z": -300 },
  "exitPosition": { "x": 300, "z": 300 },
  "collectibles": [
    { "objectType": "barrel", "position": { "x": 0, "z": -100 } }
  ],
  "enemies": [
    { "type": "guard", "position": {...}, "patrol": { "waypoints": [...] } }
  ]
}
```

Use existing terrain types from TurnBasedWarfare: water(0), lava(1), dirt(2), brick(3), rock(4), forest(5), grass(6). Creating new terrain types would require new art assets.

Puzzle-specific fields (playerSpawn, exitPosition, collectibles, enemies) are read by PuzzleGameSystem to spawn entities.

### 9. Scene Configuration

Location: `collections/data/scenes/`

**Menu Scene:** `menu.json`
- Systems for UI rendering and level selection
- No game logic systems

**Game Scene:** `game.json` (modify existing)
- Full game systems including puzzle-specific ones
- Terrain, movement, behavior, rendering systems

### 10. Create Puzzle UI

Location: `collections/ui/interfaces/`

**Main Menu / Level Select (menu scene):**
- Title screen with "Play" button
- Level selection grid showing available levels
- Level progress/completion status

**In-Game HUD (game scene):**
- Belt display (3 slots at bottom)
- Level info and objective text
- Controls hint (WASD: Move, E: Collect, 1-2-3: Select Slot, Click: Place Illusion)
- Pause menu with "Return to Menu" option

**Player Actions:**
- WASD or click: Move
- E key: Collect nearby object into belt (triggers CollectAbility)
- 1/2/3 keys: Select belt slot
- Click (with item selected): Place illusion at clicked location (triggers PlaceIllusionAbility)

### 11. Player Abilities

Location: `collections/scripts/abilities/js/`

**CollectAbility.js:**
- Triggered by E key when near a collectible
- Checks for nearby collectible within range
- Stores object type in belt component
- Removes collectible entity from world
- Plays collection particle effect

**PlaceIllusionAbility.js:**
- Triggered by click when belt slot has item
- Spawns illusion entity at target location (full copy of source prefab)
- Adds `illusion` component for lifetime tracking
- Consumes item from belt slot
- Plays illusion spawn particle effect

### 12. Particle Effects

Location: `collections/particles/`

- `collect_effect.json` - Visual feedback when collecting an object
- `illusion_spawn.json` - Visual feedback when placing an illusion
- `illusion_fade.json` - Visual feedback when illusion expires

## Systems to Reuse (No Changes)

- All existing TurnBasedWarfare systems remain - multiplayer, networking, etc.
- `MovementSystem.js` - Player/enemy movement
- `PathfindingSystem.js` - A* pathfinding
- `BehaviorSystem.js` - Enemy AI processing
- `RenderSystem.js`, `AnimationSystem.js` - Visuals
- `CameraControlSystem.js`, `InputSystem.js` - Controls
- `GridSystem.js`, `TerrainSystem.js` - World
- `SchedulingSystem.js` - Illusion timers
- Network systems - Keep multiplayer support

## Implementation Order

1. **Project scaffolding** - Copy project, clean game.json, create component JSONs
2. **Player control** - WASD movement, click-to-move with existing MovementSystem
3. **Belt system** - BeltUISystem + collection mechanic
4. **Illusions** - IllusionSystem for creation/placement/lifetime
5. **Enemy AI** - Guard behavior tree, illusion-aware targeting
6. **Level setup** - PuzzleGameSystem + ExitSystem + first tutorial level (using existing level loading)
7. **Polish** - Effects, additional levels, balancing

## Verification

1. Run `npm run build -- UseYourIllusions` to build project
2. Open `projects/UseYourIllusions/dist/client/index.html` in browser
3. Test: WASD moves player, E key collects nearby objects into belt
4. Test: 1-2-3 keys select belt slot, click places illusion
5. Test: Enemies patrol, chase illusions that look like units, blocked by illusions with collision
6. Test: Reaching exit triggers level complete

## Key Reference Files

- [game.json](../projects/TurnBasedWarfare/collections/settings/configs/game.json) - Config template
- [MirrorImagesAbility.js](../projects/TurnBasedWarfare/collections/scripts/abilities/js/MirrorImagesAbility.js) - Illusion creation pattern
- [VisionSystem.js](../projects/TurnBasedWarfare/collections/scripts/systems/js/VisionSystem.js) - Line-of-sight reference
- [PatrolBehaviorAction.js](../projects/TurnBasedWarfare/collections/behaviors/behaviorActions/js/PatrolBehaviorAction.js) - Patrol pattern
- [MovementSystem.js](../projects/TurnBasedWarfare/collections/scripts/systems/js/MovementSystem.js) - Movement integration
