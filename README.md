
<p align="center">
   <img src="https://raw.githubusercontent.com/Seeders/GUTS/main/logo.png">
</p>

# GUTS - Gamedev Ultimate Toolkit System

A comprehensive data-driven game development framework providing a flexible ECS architecture, visual editor, and modular system for creating 2D and 3D games. Build everything from platformers to strategy games with pure data-driven design.

---

## Table of Contents
- [Installation & Setup](#installation--setup)
- [Example Projects](#example-projects)
- [Editor Basics](#editor-basics)
- [Configuration](#configuration)
- [Runtime Architecture](#runtime-architecture)
- [Deep Dive: GUTS Architecture](#deep-dive-guts-architecture)
- [Try it Online](#try-it-online)
- [License](#license)

---

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Seeders/GUTS.git
   cd GUTS
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the editor:**
   ```bash
   npm run start:editor
   ```
   Open http://localhost:5000/index.html to access the visual editor.

4. **Build and run a game project:**
   ```bash
   # Build the example game (TurnBasedWarfare)
   npm run build

   # Start game server
   npm run game:server
   ```
   Open http://localhost:3000/index.html to play the game.

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build game project (default: TurnBasedWarfare) |
| `npm run build:prod` | Production build with optimizations |
| `npm run build:watch` | Auto-rebuild on file changes |
| `npm run start:editor` | Start editor server (port 5000) |
| `npm run game:server` | Start game server (port 3000) |
| `npm run game:dev` | Full dev environment (build + server + watch) |
| `npm run dev` | Editor development with hot reload |

---

## Example Projects

### Turn-Based Warfare

A tactical strategy game demonstrating GUTS capabilities:
- Turn-based combat system with initiative
- Multiple unit types with unique abilities
- AI behavior trees for enemy units
- Necromancy system with corpse mechanics
- Multiplayer support with server authority

**[View Project Documentation](projects/TurnBasedWarfare/README.md)**

**Quick Start:**
```bash
npm run game:dev
# Visit http://localhost:3000/index.html
```

---

## Editor Basics

### Overview

At its core, **the GUTS Editor is a JSON editor** designed to manage all the data files in your game project. Every game object - units, buildings, abilities, levels, sprites - is defined in JSON files that the editor helps you create and modify.

**Key Concept:** The editor provides a structured interface for editing JSON data across your project's collections. When you edit a unit's properties or paint terrain tiles, you're directly modifying the underlying JSON files that define your game.

The editor is web-based, follows an MVC architecture, and supports:
- Real-time JSON editing with validation
- Manual save to filesystem via FileSystemSyncService (writes directly to project files)
- Specialized modules for visual editing (terrain, sprites, models)
- Hierarchical organization of game objects by collection type

### Project Structure
```
GUTS/
├── engine/              # Core engine runtime
├── global/              # Shared engine libraries
│   ├── libraries/      # Core engine classes (ECS, managers, systems)
│   ├── modals/         # Reusable UI modals
│   └── modules/        # Editor modules (terrain, sprite, model editors)
├── projects/           # Individual game projects
│   └── {ProjectName}/
│       ├── scripts/    # Game-specific code & data
│       │   ├── Prefabs/      # Game object definitions (JSON)
│       │   ├── Scripts/      # Game systems & logic (JS)
│       │   ├── Settings/     # Configuration files
│       │   ├── Sprites/      # Sprite definitions
│       │   └── Terrain/      # Level data
│       ├── resources/  # Assets (images, models, audio)
│       └── dist/       # Build output (client & server)
├── build/              # Custom build system
└── editor/             # Visual editor application
```

### Editor Interface

#### Sidebar
- **Project Selector**: Switch between projects
- **Object List**: Hierarchical view of all game objects organized by type
- **Actions**: Create objects, manage projects

#### Main Content Area
- **Module Content**: Context-specific views (terrain editor, sprite editor, etc.)
- **Split View**: Resizable panels for simultaneous editing

#### Editor Panel
- **Property Editor**: JSON-based property editing for selected objects
- **Save Button**: Save changes to filesystem via FileSystemSyncService

### How the Editor Works

1. **Browse Collections**: The sidebar shows all JSON files organized by collection type (units, buildings, abilities, etc.)

2. **Select an Object**: Click any object to load its JSON data into the editor panel

3. **Edit JSON Properties**:
   - Modify properties directly in the JSON editor
   - Changes validate against expected structure
   - Syncs changes to disk via FileSystemSyncService

4. **Create New Objects**:
   - Click "Add Object" in sidebar
   - Choose collection type (e.g., `units`)
   - Enter object ID (becomes the filename: `myUnit.json`)
   - Edit the new JSON object

5. **Visual Modules** (Optional):
   - Some collection types have specialized visual editors
   - These provide alternative UIs but still edit the same JSON data
   - Example: Terrain editor paints tiles, which updates terrain JSON

### Editor Modules

Modules provide specialized visual interfaces for editing certain JSON file types:

| Module | Purpose | Edits |
|--------|---------|-------|
| **Terrain Editor** | Visual level design with tile painting | Terrain JSON files (tile maps, object placement) |
| **Sprite Editor** | Define frame sequences and animations | Sprite JSON files (animation definitions) |
| **Model Viewer** | Preview and configure 3D models | Unit/building render properties in JSON |
| **Audio Manager** | Organize sound effects and music | Audio reference properties in JSON |

**Remember:** Modules are just alternative interfaces for editing JSON - you can always edit the raw JSON directly.

---

## Configuration

### Game Configuration File

#### game.json

**Location:** `projects/{ProjectName}/scripts/Settings/configs/game.json`

This is the central configuration file that defines your game's architecture:

```json
{
  "title": "My Game",
  "gridSize": 48,
  "imageSize": 128,
  "is3D": true,
  "isIsometric": false,
  "libraries": [
    "GameServices",
    "BaseECSGame",
    "ComponentManager",
    "..."
  ],
  "managers": [
    "GameManager",
    "ComponentManager"
  ],
  "systems": [
    "GridSystem",
    "MyCustomSystem",
    "RenderSystem"
  ],
  "classes": [
    {
      "collection": "abilities",
      "baseClass": "BaseAbility"
    },
    {
      "collection": "units",
      "baseClass": "BaseUnit"
    }
  ],
  "appLibrary": "MultiplayerECSGame",
  "appLoaderLibrary": "GameLoader",
  "initialScene": "client"
}
```

**Key Properties:**

| Property | Description |
|----------|-------------|
| `libraries` | Engine libraries loaded in dependency order |
| `managers` | Manager classes for coordinating game systems |
| `systems` | ECS systems executed each frame (in order) |
| `classes` | Collection definitions with their base classes |
| `appLibrary` | Main game application class |
| `initialScene` | Starting scene/mode (client, server, editor) |
| `gridSize` | World grid size in units |
| `is3D` | Enable 3D rendering with Three.js |
| `isIsometric` | Use isometric projection |

### Build Configuration

#### Webpack (webpack.config.js)

Controls the editor and library bundling:
- **Entry points**: Editor and library bundles
- **Dev server**: Hot reloading for editor development
- **Output**: Bundled editor files

#### Custom Build System (build/build.js)

Game-specific build process:
- Concatenates game libraries in dependency order
- Processes collections and generates runtime data
- Creates client and server bundles
- Copies resources to distribution folder
- Supports production minification and source maps

---

## Runtime Architecture

### Editor Runtime Flow

```
1. Load index.html
   ↓
2. Initialize EditorController.js
   ↓
3. Create EditorModel & EditorView
   ↓
4. Load project from localStorage
   ↓
5. Load project modules (terrain editor, sprite editor, etc.)
   ↓
6. Apply theme from project config
   ↓
7. Render UI (sidebar, editor panel)
   ↓
8. Setup event listeners
   ↓
9. Ready for user interaction
```

**Key Components:**
- **EditorModel**: Manages data storage, project loading/saving, object CRUD
- **EditorView**: Renders UI, handles user interactions, updates DOM
- **EditorController**: Coordinates model and view, dispatches hooks

**Data Persistence:**
- FileSystemSyncService writes edits to project files on disk when you save
- Click the save button in the editor to persist changes to the filesystem
- After saving, refresh your game to see the updated content

### Game Runtime Flow

```
1. Load game.html
   ↓
2. Fetch game config (game.json)
   ↓
3. Load GameLoader (appLoaderLibrary)
   ↓
4. GameLoader initializes Engine
   ↓
5. Load libraries in order (from config)
   ↓
6. Load managers (ComponentManager, etc.)
   ↓
7. Initialize systems (in config order)
   ↓
8. Load collections (prefabs, sprites, etc.)
   ↓
9. Initialize game class (appLibrary)
   ↓
10. Load initial scene (client/server/editor mode)
   ↓
11. Start game loop
    ├─ System updates (fixed timestep)
    ├─ Render frame
    └─ Loop
```

**Engine Initialization:**
```javascript
Engine.js
  ├─ Loads game.json config
  ├─ Creates library registry (GUTS namespace)
  ├─ Loads each library script
  ├─ Instantiates managers
  ├─ Initializes systems
  └─ Starts game instance
```

**Game Loop:**
```javascript
Game.update(dt)
  ├─ Update systems in order (as defined in game.json)
  │   ├─ InputSystem (process player input)
  │   ├─ PhysicsSystem (update positions)
  │   ├─ CollisionSystem (detect collisions)
  │   ├─ AnimationSystem (update animations)
  │   ├─ RenderSystem (draw frame)
  │   └─ ... (your custom systems)
  └─ Request next frame
```

---

## Deep Dive: GUTS Architecture

### Data-Driven Design Philosophy

GUTS follows a **pure data-driven approach** where game content is defined in JSON files rather than code.

**The core principle:** Everything that can be data, should be data. Units, buildings, abilities, levels, AI behaviors - all defined in JSON files that the GUTS Editor helps you create and manage.

This approach enables:
- **Non-programmer friendly**: Designers create content by editing JSON through the editor
- **No recompilation needed**: Edit JSON, refresh browser, see changes immediately
- **Version control friendly**: JSON diffs are readable and mergeable
- **Modularity**: Easy to add/remove/modify content without touching code
- **Separation of data and logic**: Game systems (code) process game content (JSON)

**Workflow:** The GUTS Editor is your primary tool for authoring game content - it's essentially a project-wide JSON file manager with specialized visual editors for complex data types (terrain, sprites, etc.).

### Collections System

Collections are typed groups of game objects stored as JSON files.

#### Collection Structure
```
projects/{ProjectName}/scripts/Prefabs/{collection}/
└── {objectId}.json
```

Example unit prefab:
```json
{
  "title": "Warrior",
  "size": 25,
  "hp": 100,
  "damage": 15,
  "speed": 40,
  "abilities": ["MeleeAttack"],
  "render": {
    "sprites": {
      "collection": "warriorSprites",
      "scale": 2.0
    }
  }
}
```

#### Common Collections

Collections are flexible and game-specific, but common patterns include:
- **units**: Character/entity types with stats and behaviors
- **buildings**: Structures in the game world
- **abilities**: Special skills or powers (class-based)
- **items/equipment**: Objects that modify entity properties
- **projectiles**: Ranged attack definitions
- **effects**: Visual effects and particles
- **behaviorTrees**: AI behavior logic
- **terrainTypes**: Tile/terrain definitions for levels

You can create any collection type your game needs.

#### Accessing Collections at Runtime
```javascript
const collections = game.getCollections();
const warriorData = collections.units['warrior'];
const fireballData = collections.abilities['fireball'];
```

### Entity Component System (ECS)

GUTS uses a pure ECS architecture for game objects.

#### What is ECS?

**Entities**: Simple IDs (strings or numbers)
```javascript
const entityId = game.createEntity();  // "entity_1234567890"
```

**Components**: Data containers (no logic)
```javascript
game.addComponent(entityId, "transform", {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }
});

game.addComponent(entityId, "health", {
  current: 100,
  max: 100
});
```

**Systems**: Logic that operates on components
```javascript
class HealthBarSystem extends BaseSystem {
  update() {
    // Get all entities with both transform and health
    const entities = this.game.getEntitiesWith("transform", "health");

    entities.forEach(entityId => {
      const transform = this.game.getComponent(entityId, "transform");
      const health = this.game.getComponent(entityId, "health");

      // Update health bar position and display
      this.updateHealthBar(entityId, transform.position, health);
    });
  }
}
```

#### Common Components

| Component | Purpose | Example Data |
|-----------|---------|--------------|
| `transform` | Position, rotation, scale | `{ position: {x,y,z}, rotation: {x,y,z} }` |
| `health` | HP tracking | `{ current: 80, max: 100 }` |
| `entityType` | Links to collection data | `{ collection: "units", id: "warrior" }` |
| `team` | Team/faction | `{ team: "player" }` |
| `velocity` | Movement physics | `{ vx: 0, vy: 0, vz: 0 }` |
| `combat` | Attack stats | `{ damage: 10, range: 50, attackSpeed: 1.0 }` |
| `aiState` | AI state/behavior | `{ state: "idle", target: null }` |
| `inventory` | Items held | `{ items: [], maxSlots: 10 }` |

#### System Architecture

Systems run in the order defined in `game.json`:

```javascript
// Example system
class MovementSystem extends BaseSystem {
  update(dt) {
    // Only process entities with required components
    const entities = this.game.getEntitiesWith("transform", "velocity");

    entities.forEach(entityId => {
      const transform = this.game.getComponent(entityId, "transform");
      const velocity = this.game.getComponent(entityId, "velocity");

      // Update position based on velocity
      transform.position.x += velocity.vx * dt;
      transform.position.y += velocity.vy * dt;
      transform.position.z += velocity.vz * dt;
    });
  }
}
```

**System Lifecycle Hooks:**
- `constructor(game)`: Initialize system
- `init()`: Setup after all systems loaded
- `update(dt)`: Called every frame
- `onBattleStart()`: Battle phase begins
- `onBattleEnd()`: Battle phase ends
- `destroy()`: Cleanup when system removed

#### System Interaction Example

How multiple systems coordinate to handle game logic:

```javascript
// Example: Entity takes damage

// 1. Combat System applies damage
CombatSystem.dealDamage(entityId, 50)
  └─ Reduces health.current by 50

// 2. Health System detects low health
HealthSystem.update()
  ├─ Checks if health.current <= 0
  └─ Triggers 'onEntityDied' event

// 3. Animation System responds
AnimationSystem.onEntityDied(entityId)
  └─ Plays death animation

// 4. AI System adjusts behavior
BehaviorSystem.update()
  └─ Skips dead entities (no deathState check)

// 5. Cleanup System removes entity
CleanupSystem.onEntityDied(entityId)
  └─ Schedules entity removal after animation
```

This demonstrates the **separation of concerns** principle - each system handles one responsibility.

### Editor Modules

Modules extend the editor with specialized functionality for specific content types.

#### Module Structure

**Location:** `global/modules/{moduleName}/`

```
modules/terrainEditor/
├── js/
│   └── TerrainEditor.js      # Module logic
├── html/
│   └── terrainEditor.html    # UI template
└── css/
    └── terrainEditor.css     # Styles
```

#### Creating a Module

```javascript
// TerrainEditor.js
class TerrainEditor {
  constructor(controller) {
    this.controller = controller;
    this.selectedTile = null;
  }

  // Called when module initializes
  async init() {
    this.canvas = document.getElementById('terrain-canvas');
    this.setupEventListeners();
  }

  // Called when an object of this type is selected
  async render(object) {
    this.currentLevel = object;
    this.drawTerrain(object.tileMap);
  }

  // Called when object data changes
  async onObjectUpdated(object) {
    if (object === this.currentLevel) {
      this.drawTerrain(object.tileMap);
    }
  }

  // Cleanup when module unloads
  destroy() {
    this.canvas.removeEventListener('click', this.handleClick);
  }
}

// Register module
window.TerrainEditor = TerrainEditor;
```

#### Built-in Modules

**Terrain Editor**
- Visual level editing with tile painting
- Multi-layer support (terrain, decoration, collision)
- Object placement (trees, rocks, buildings)
- Export to game-ready format

**Sprite Editor**
- Import sprite sheets
- Define frame sequences
- Configure animations (idle, walk, attack, death)
- Preview animations in real-time

**Model Viewer**
- Preview 3D models (GLTF/GLB)
- Configure materials and textures
- Set up animations
- Adjust lighting and camera

**Behavior Tree Editor** (Future)
- Visual AI behavior design
- Node-based editing
- Live preview with debug visualization

#### Module Hooks

Modules can respond to editor events:

```javascript
// Called when object saved
controller.dispatchHook('onObjectSaved', { object, collection });

// Called when project loaded
controller.dispatchHook('onProjectLoaded', { projectName });

// Called before object deleted
controller.dispatchHook('beforeObjectDeleted', { objectId, collection });
```

### Extending GUTS

#### Adding a New System

1. **Create system class:**
```javascript
// projects/{YourProject}/scripts/Scripts/systems/js/MySystem.js
class MySystem extends GUTS.BaseSystem {
  constructor(game) {
    super(game);
    // Register system reference on game object
    this.game.mySystem = this;
  }

  init() {
    // Called after all systems are loaded
    // Register public API functions
    this.game.gameManager.register('myPublicFunction',
      this.myPublicFunction.bind(this));
  }

  update(dt) {
    // Called every frame with delta time
    const entities = this.game.getEntitiesWith("myComponent");

    entities.forEach(entityId => {
      const component = this.game.getComponent(entityId, "myComponent");
      // Process component data...
    });
  }

  myPublicFunction(entityId, data) {
    // Public API that other systems can call
  }

  onBattleStart() {
    // Optional: Called when battle phase starts
  }

  onBattleEnd() {
    // Optional: Called when battle phase ends
  }

  destroy() {
    // Optional: Cleanup when system is removed
  }
}
```

2. **Register in game.json:**
```json
{
  "systems": [
    "InputSystem",
    "MySystem",
    "RenderSystem"
  ]
}
```

System order matters - systems execute in the order listed.

#### Adding a New Collection

1. **Create collection folder:**
```
projects/{ProjectName}/scripts/Prefabs/myCollection/
```

2. **Add objects:**
```json
// myCollection/myObject.json
{
  "title": "My Object",
  "customProperty": "value"
}
```

3. **Define base class (if needed):**
```javascript
// scripts/Scripts/myCollection/js/BaseMyObject.js
class BaseMyObject {
  constructor(game, params) {
    this.game = game;
    Object.assign(this, params);
  }

  // Shared methods
}
```

4. **Register in game.json:**
```json
{
  "classes": [
    {
      "collection": "myCollection",
      "baseClass": "BaseMyObject"
    }
  ]
}
```

---

## Try it Online

Live demos hosted on GitHub Pages:
- **Editor:** https://seeders.github.io/GUTS/index.html
- **Game:** https://seeders.github.io/GUTS/game.html

---

## Screenshots

![Editor Overview](https://github.com/user-attachments/assets/efcaa562-b040-4789-a5a4-14e14ddbe2a0)

*GUTS Editor with terrain editor module*

![Gameplay](https://github.com/user-attachments/assets/77f5a78d-bbfe-4d62-b26e-9479ca03dd84)

*Turn-based warfare game in action*

![Theme Customization](https://github.com/user-attachments/assets/3f63d70f-cdd1-43f6-97fc-65805144735d)

*Customizable editor themes*

---

## Contributing

Contributions are welcome! Feel free to:
- Submit bug reports and feature requests via [GitHub Issues](https://github.com/Seeders/GUTS/issues)
- Fork the repository and submit pull requests
- Improve documentation
- Share your games made with GUTS

---

## License

GUTS is available under the **MIT License** as open source software.

Copyright (c) 2024 GUTS Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

**Built with GUTS? Share your creations!**
