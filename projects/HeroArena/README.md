# Turn-Based Warfare

A tactical turn-based strategy game built with the GUTS engine, demonstrating the framework's capabilities for creating complex game systems.

---

## Quick Start

### Running the Game

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Start the game server:**
   ```bash
   npm run game:server
   ```

3. **Play the game:**
   Open http://localhost:3000/index.html in your browser

### Development Mode

For active development with auto-rebuild and hot-reload:
```bash
npm run game:dev
```

This runs three concurrent processes:
- **BUILD**: Auto-rebuilds on code changes
- **SERVER**: Auto-restarts on dist changes
- **RESOURCES**: Watches and syncs resource files

---

## Game Features

### Combat System
- Turn-based tactical combat with initiative order
- Multiple unit types with unique abilities
- Terrain-based positioning and strategy
- Death and corpse mechanics for necromancy

### Unit Types

**Melee Units:**
- **Barbarian** - High HP frontline fighter with sword attacks
- **Skeleton** - Undead warrior raised from corpses

**Ranged Units:**
- **Crossbowman** - Long-range archer with piercing attacks
- **Apprentice** - Magic caster with fireball abilities

**Support Units:**
- **Beast Master** - Summoner who raises skeletons from fallen enemies

### Abilities

**Offensive:**
- **Fireball** - Ranged fire damage projectile
- **Melee Attack** - Close-range physical damage

**Necromancy:**
- **Raise Dead** - Convert nearby corpses into skeleton warriors

---

## Project Structure

```
TurnBasedWarfare/
├── scripts/
│   ├── Prefabs/              # Game object definitions (JSON)
│   │   ├── units/           # Unit definitions (stats, animations)
│   │   ├── buildings/       # Structure definitions
│   │   ├── abilities/       # Ability configurations
│   │   └── behaviorTrees/   # AI behavior definitions
│   ├── Scripts/             # Game logic (JavaScript)
│   │   ├── systems/         # ECS systems
│   │   ├── abilities/       # Ability implementations
│   │   ├── behaviorTrees/   # AI behavior implementations
│   │   └── behaviorActions/ # AI action implementations
│   ├── Settings/
│   │   └── configs/
│   │       └── game.json    # Game configuration
│   ├── Sprites/             # Sprite animation definitions
│   └── Terrain/             # Level data
├── resources/               # Game assets
│   ├── textures/           # Images and sprites
│   ├── animations/         # 3D animation files (GLB)
│   └── audio/              # Sound effects and music
├── dist/                    # Build output
│   ├── client/             # Client game files
│   └── server/             # Server game files
└── server_game.js          # Game server entry point
```

---

## Game Configuration

### Core Settings

**File:** `scripts/Settings/configs/game.json`

Key configuration options:

```json
{
  "title": "Turn Based Warfare",
  "gridSize": 48,           // Tile grid size (48 units per tile)
  "imageSize": 128,         // Sprite/texture size
  "is3D": true,            // Enable 3D rendering
  "isIsometric": false,    // Top-down view
  "systems": [             // ECS systems (execution order)
    "GridSystem",
    "TerrainSystem",
    "BehaviorSystem",
    "AbilitySystem",
    "CombatSystem",
    "MovementSystem",
    "AnimationSystem",
    "DeathSystem",
    "RenderSystem"
  ]
}
```

### Grid Systems

The game uses two overlapping grids:
- **Tile Grid**: 48 units per tile (terrain, placement)
- **Pathfinding Grid**: 24 units per cell (movement, collisions)

---

## Systems Overview

### BehaviorSystem
Runs AI behavior trees for all units with `aiState` components. Behavior trees determine unit actions based on game state.

### AbilitySystem
Manages ability execution, cooldowns, and queueing. Handles both player-triggered and AI-triggered abilities.

### CombatSystem
Processes attacks, damage calculation, and combat resolution. Applies damage modifiers based on armor and resistances.

### DeathSystem
Handles unit death, corpse state transitions, and cleanup:
- Entities transition: alive → dying → corpse
- Dead units cannot act or be damaged
- Corpses can be consumed by necromancy abilities
- All corpses cleaned up at battle end

### AnimationSystem
Manages sprite and 3D model animations:
- Single-play animations (attack, cast, death)
- Looping animations (idle, walk)
- Animation speed sync with game mechanics
- Billboard sprite rendering with directional support

### MovementSystem
Physics and movement processing:
- Velocity-based movement
- Collision detection and response
- Pathfinding integration
- Grid-aligned positioning

---

## Adding Content

### Creating a New Unit

1. **Create unit prefab:**
   `scripts/Prefabs/units/my_unit.json`
   ```json
   {
     "title": "My Unit",
     "size": 25,
     "height": 50,
     "hp": 100,
     "damage": 15,
     "speed": 40,
     "attackSpeed": 1.0,
     "range": 30,
     "render": {
       "sprites": {
         "collection": "myUnitSprites",
         "scale": 2.0
       }
     },
     "abilities": ["MeleeAttackAbility"]
   }
   ```

2. **Add sprites** (if using sprite rendering):
   - Create sprite collection in `scripts/Sprites/`
   - Define animations: idle, walk, attack, death
   - Export sprite frames to `resources/textures/`

3. **Configure AI** (optional):
   - Assign behavior tree in unit prefab
   - Or create custom behavior in `scripts/Scripts/behaviorTrees/`

### Creating a New Ability

1. **Create ability class:**
   `scripts/Scripts/abilities/js/MyAbility.js`
   ```javascript
   class MyAbility extends GUTS.BaseAbility {
     constructor(game, abilityData = {}) {
       super(game, {
         id: 'my_ability',
         name: 'My Ability',
         description: 'Does something cool',
         cooldown: 5.0,
         range: 100,
         manaCost: 20,
         targetType: 'enemy',
         castTime: 0.5,
         ...params
       });
     }

     canExecute(casterEntity) {
       // Check if ability can be used
       return true;
     }

     execute(casterEntity) {
       // Execute ability logic
       const target = this.findTarget(casterEntity);
       if (target) {
         this.dealDamage(target, 50);
       }
     }
   }
   ```

2. **Register ability** in `game.json`:
   ```json
   {
     "classes": [
       {
         "collection": "abilities",
         "baseClass": "BaseAbility"
       }
     ]
   }
   ```

3. **Add to unit** in unit prefab:
   ```json
   {
     "abilities": ["MyAbility"]
   }
   ```

---

## Multiplayer

The game includes built-in multiplayer support using Socket.IO:

- **Server authoritative**: All game logic runs on server
- **Client prediction**: Smooth local movement
- **Deterministic**: ECS systems process in consistent order
- **Lockstep**: Turn-based gameplay synchronized across clients

### Hosting a Server

```bash
npm run game:server
```

Server runs on port 3000 by default. Clients connect via Socket.IO to the same URL.

---

## Development Tips

### Debugging

Enable debug visualizations in the game:
- **F1**: Toggle behavior tree debug overlay
- **F2**: Toggle collision bounds
- **F3**: Toggle pathfinding grid
- **Console**: Use `game.getEntitiesWith()` to inspect entities

### Testing Changes

1. Make changes to scripts or prefabs
2. Build automatically rebuilds (if using `npm run game:dev`)
3. Refresh browser to see changes
4. Check console for errors

### Performance

- Use deterministic sorting in systems (`localeCompare` for entity IDs)
- Avoid creating objects in update loops
- Pool frequently created objects (projectiles, particles)
- Use `getEntitiesWith()` efficiently - cache queries when possible

---

## Known Issues

- Death animations may occasionally not freeze on last frame
- Corpse cleanup only happens at battle end (not placement phase)
- Billboard sprites face camera globally (not individually rotatable)

---

## Credits

Built with GUTS (Gamedev Ultimate Toolkit System)

**Assets:**
- 3D animations from Mixamo
- Sprite artwork: Custom pixel art

---

## License

MIT License - See main GUTS repository for details
