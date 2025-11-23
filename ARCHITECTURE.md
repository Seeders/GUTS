# GUTS Architecture Documentation

**GUTS (Gamedev Ultimate Toolkit System)** - Comprehensive Data-Driven Game Development Framework

Version: 1.0
Last Updated: 2025-11-23

---

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Core Concepts](#core-concepts)
4. [The Editor System](#the-editor-system)
5. [The Game Engine](#the-game-engine)
6. [Collections System](#collections-system)
7. [Library Loading System](#library-loading-system)
8. [Scene Management](#scene-management)
9. [Build and Compilation](#build-and-compilation)
10. [Workflow Examples](#workflow-examples)
11. [API Reference](#api-reference)

---

## Overview

GUTS is a web-based game development framework that enables rapid game creation through a data-driven approach. The entire game is defined in JSON collections, with visual and code editors for creating game logic without extensive programming.

### Key Features

- **Data-Driven Design**: All game content stored in JSON collections
- **Web-Based**: Runs entirely in the browser with Node.js backend
- **Visual Editor**: Create games without coding
- **Entity Component System**: Modular ECS architecture for game logic
- **Multiplayer Support**: Built-in server and client networking
- **2D & 3D**: Supports both 2D canvas and 3D WebGL/Three.js
- **Extensible**: Plugin system with editor modules and custom libraries

### Architecture Philosophy

GUTS follows the MVC pattern for the editor and ECS pattern for the game runtime:
- **Model**: Project data stored in JSON collections
- **View**: HTML/CSS interface rendered by EditorView
- **Controller**: EditorController coordinates between model and view
- **Entity-Component-System**: Game runtime uses ECS for performance and modularity

---

## Project Structure

```
/home/user/GUTS/
├── engine/                   # Core engine code
│   ├── BaseEngine.js         # Abstract engine base class
│   ├── Engine.js             # Client-side engine implementation
│   ├── ServerEngine.js       # Server-side engine implementation
│   ├── EditorController.js   # MVC Controller for editor
│   ├── EditorModel.js        # Data model for editor
│   ├── EditorView.js         # UI rendering for editor
│   ├── ModuleManager.js      # Dynamic script loading system
│   └── FileSystemSyncService.js  # Filesystem synchronization
│
├── global/                   # Shared resources
│   ├── libraries/js/         # Core library classes (80+ files)
│   │   ├── BaseECSGame.js    # ECS game foundation
│   │   ├── SceneManager.js   # Scene loading system
│   │   ├── ModuleManager.js  # Runtime module management
│   │   ├── GameLoader.js     # Asset and scene loader
│   │   ├── ImageManager.js   # Image/texture management
│   │   ├── ModelManager.js   # 3D model management
│   │   ├── Component.js      # Base component class
│   │   ├── Entity.js         # Entity class
│   │   └── ...               # Many more utilities
│   │
│   ├── components/js/        # Global component definitions
│   ├── renderers/js/         # Global renderer classes
│   ├── interfaces/           # UI definitions
│   ├── editorModules/        # Editor plugin configurations
│   ├── themes/               # Visual themes
│   └── modals/               # Modal dialog definitions
│
├── projects/                 # Game projects
│   ├── TurnBasedWarfare/     # Main example project
│   │   ├── config/           # Project configuration JSON
│   │   │   └── TURNBASEDWARFARE.json  # All collections
│   │   ├── scripts/          # Source code files
│   │   │   ├── Scripts/      # Game logic
│   │   │   │   ├── abilities/
│   │   │   │   ├── components/
│   │   │   │   ├── functions/
│   │   │   │   ├── libraries/
│   │   │   │   ├── managers/
│   │   │   │   ├── renderers/
│   │   │   │   └── systems/
│   │   │   ├── Settings/     # Configuration
│   │   │   │   ├── configs/
│   │   │   │   ├── editorModules/
│   │   │   │   └── themes/
│   │   │   └── Environment/  # Level/scene data
│   │   │       ├── scenes/
│   │   │       ├── worlds/
│   │   │       └── levels/
│   │   ├── dist/             # Compiled output
│   │   │   ├── client/       # Client bundle
│   │   │   └── server/       # Server bundle
│   │   └── resources/        # Assets (images, models, audio)
│   │
│   ├── Hello World/          # Starter project
│   ├── TowerDefense/
│   ├── Infiniworld/
│   └── SpaceRacer/
│
├── build/                    # Build system
│   ├── webpack.config.js     # Webpack configuration
│   ├── ConfigParser.js       # Parse project configs
│   └── EntryGenerator.js     # Generate webpack entries
│
├── style/                    # Global CSS
├── index.html                # Editor entry point
├── game.html                 # Game runtime entry point
├── server_editor.js          # Editor backend (Express)
└── server_game.js            # Game backend (Socket.io)
```

---

## Core Concepts

### Data-Driven Development

Everything in GUTS is defined by **collections** - groups of related objects stored in JSON format. A game project consists of:

1. **Object Type Definitions** - Metadata about collection types
2. **Object Types (Collections)** - Actual game data organized by type

Example project structure:
```json
{
  "objectTypeDefinitions": [
    {
      "id": "units",
      "name": "Units",
      "singular": "Unit",
      "category": "Game Data"
    }
  ],
  "objectTypes": {
    "units": {
      "archer": {
        "title": "Archer",
        "health": 100,
        "damage": 15,
        "script": "class Archer extends Unit { ... }"
      }
    }
  }
}
```

### MVC Architecture (Editor)

The editor follows the Model-View-Controller pattern:

- **EditorModel** (`/engine/EditorModel.js`)
  - Manages project data in `state.project`
  - Handles localStorage and file system persistence
  - Provides CRUD operations for objects and types
  - Strips scripts from JSON for file size optimization

- **EditorView** (`/engine/EditorView.js`)
  - Renders the UI (object list, property editors, etc.)
  - Handles user input events
  - Updates display when model changes

- **EditorController** (`/engine/EditorController.js`)
  - Coordinates model and view
  - Loads and initializes editor modules
  - Manages application lifecycle
  - Dispatches hooks for extensibility

### ECS Architecture (Game Runtime)

The game runtime uses Entity-Component-System for performance:

- **Entities** - Unique IDs with sets of component types
- **Components** - Data containers (Transform, Health, etc.)
- **Systems** - Logic processors (MovementSystem, RenderSystem, etc.)

```javascript
// Entity: just an ID
const entityId = game.createEntity();

// Components: add data to entity
game.addComponent(entityId, 'Transform', { x: 0, y: 0, z: 0 });
game.addComponent(entityId, 'Health', { current: 100, max: 100 });

// Systems: process entities with specific components
class HealthBarSystem {
  update() {
    const entities = this.game.getEntitiesWith('Transform', 'Health');
    entities.forEach(id => {
      const health = this.game.getComponent(id, 'Health');
      // Draw health bar...
    });
  }
}
```

---

## The Editor System

### Initialization Flow

```
1. User opens index.html
   ↓
2. EditorController constructed
   ├─ Creates EditorModel
   ├─ Creates EditorView
   └─ Creates FileSystemSyncService
   ↓
3. controller.init() called
   ├─ Determines initial project (from localStorage)
   ├─ Calls loadProject(projectName)
   │   ├─ EditorModel.loadProject()
   │   │   └─ Loads from localStorage or fetches JSON
   │   ├─ FileSystemSyncService.importProject()
   │   │   └─ Syncs scripts from filesystem (localhost only)
   │   ├─ Load editor modules
   │   │   ├─ Filter modules from configs.editor.editorModules
   │   │   ├─ Load module libraries
   │   │   ├─ Inject module interfaces (HTML/CSS)
   │   │   └─ Instantiate module classes
   │   └─ Apply theme
   ├─ renderObjectList()
   └─ selectInitialObject()
   ↓
4. Editor ready - user can edit collections
```

### EditorModel State

```javascript
{
  currentVersion: "1.0",
  project: {
    objectTypes: {},              // All collections
    objectTypeDefinitions: []     // Collection metadata
  },
  currentProject: "TurnBasedWarfare",
  selectedType: "configs",        // Current collection
  selectedObject: "game",         // Current object ID
  expandedCategories: {}          // UI state
}
```

### Saving Workflow

```
User clicks Save
   ↓
EditorController.saveProject()
   ↓
EditorModel.saveProject()
   ├─ Strip scripts from collections (reduces file size)
   ├─ Sort objectTypes alphabetically (deterministic output)
   ├─ Save to localStorage (remote) OR
   ├─ POST to /save-project endpoint (localhost)
   │   ↓
   │   server_editor.js receives request
   │   └─ Writes to projects/{name}/config/{NAME}.json
   ↓
FileSystemSyncService syncs scripts to filesystem
   └─ Writes individual .js files to projects/{name}/scripts/
```

### Editor Modules

Editor modules extend the editor with custom functionality:

**Module Configuration** (`editorModules` collection):
```json
{
  "sceneModule": {
    "title": "Scene Editor",
    "container": "scene-editor-container",
    "libraries": ["threejs", "ModelManager", "SceneEditor"],
    "propertyName": "sceneData",
    "interface": "sceneEditor",
    "loadHook": "renderSceneObject",
    "saveHook": "saveSceneObject"
  }
}
```

**Available Modules**:
- `sceneModule` - Visual 3D scene editor
- `scriptModule` - Code editor with syntax highlighting
- `graphicsModule` - Sprite/animation editor
- `terrainModule` - Terrain editing tools
- `audioModule` - Audio management
- `aiPromptModule` - AI-assisted code generation
- `compilerModule` - In-editor compilation

**Module Lifecycle**:
1. Defined in `editorModules` collection
2. Listed in `configs.editor.editorModules` array
3. Loaded by `EditorController.loadProject()`
4. Libraries imported by ModuleManager
5. Interface HTML/CSS injected into page
6. Module class instantiated with `new Module(controller, config, GUTS)`

---

## The Game Engine

### Engine Initialization

```
User opens game.html (or clicks Launch Game)
   ↓
Engine.init("TurnBasedWarfare")
   ├─ Load collections from JSON
   │   └─ Fetches projects/TurnBasedWarfare/config/TURNBASEDWARFARE.json
   │       (or uses webpack compiled COMPILED_GAME)
   ├─ Create ModuleManager
   ├─ Load libraries from configs.game.libraries
   │   └─ ModuleManager.loadModules()
   ├─ Load UI interface from configs.game.interface
   ├─ Create game instance
   │   └─ new GUTS[configs.game.appLibrary](engine)
   │       (e.g., MultiplayerECSGame)
   ├─ Create loader instance
   │   └─ new GUTS[configs.game.appLoaderLibrary](game)
   │       (e.g., GameLoader)
   └─ Call loader.load()
       ├─ Setup canvas
       ├─ Load assets (images, models, audio)
       ├─ Load scene via SceneManager.load(configs.game.initialScene)
       │   ├─ Load managers from scene.sceneData[].managers
       │   ├─ Load systems from scene.sceneData[].systems
       │   └─ Load classes from scene.sceneData[].classes
       └─ Call game.init()
   ↓
Engine.start()
   └─ Begin game loop
```

### Game Loop (Fixed Timestep)

GUTS uses a fixed timestep for deterministic gameplay:

```javascript
// BaseEngine.js
class BaseEngine {
  // Fixed at 20 ticks per second (0.05s per tick)
  TICK_RATE = 1/20;

  // Client: uses requestAnimationFrame
  tick() {
    const now = Date.now();
    const frameTime = (now - this.lastTime) / 1000;
    this.accumulator += frameTime;

    // Process fixed-size ticks
    while (this.accumulator >= this.TICK_RATE) {
      await this.update(this.TICK_RATE);
      this.accumulator -= this.TICK_RATE;
    }

    this.lastTime = now;
    requestAnimationFrame(() => this.tick());
  }
}
```

**Server** uses `setImmediate` instead of `requestAnimationFrame`.

### Update Cycle

```
Engine.tick()
   ↓
game.update(deltaTime)
   ├─ For each system in game.systems:
   │   ├─ system.update()
   │   │   └─ Process entities with required components
   │   └─ system.render() (client only)
   └─ game.postUpdate()
       └─ Add queued entities to game
```

### BaseECSGame

The core game class managing the ECS:

```javascript
class BaseECSGame {
  constructor(app) {
    this.app = app;
    this.entities = new Map();      // Map<entityId, Set<componentTypes>>
    this.components = new Map();    // Map<componentType, Map<entityId, data>>
    this.systems = [];              // Array of system instances
    this.classes = [];              // Registered class definitions
    this.FIXED_DELTA_TIME = 1/20;   // 20 TPS
  }

  // Entity management
  createEntity(id) {
    const entityId = id || this.getEntityId();
    this.entities.set(entityId, new Set());
    return entityId;
  }

  destroyEntity(entityId) {
    // Remove all components
    const componentTypes = this.entities.get(entityId);
    componentTypes.forEach(type => this.removeComponent(entityId, type));
    this.entities.delete(entityId);
  }

  // Component management
  addComponent(entityId, componentType, componentData) {
    if (!this.components.has(componentType)) {
      this.components.set(componentType, new Map());
    }
    this.components.get(componentType).set(entityId, componentData);
    this.entities.get(entityId).add(componentType);
  }

  getComponent(entityId, componentType) {
    return this.components.get(componentType)?.get(entityId) || null;
  }

  // Query entities
  getEntitiesWith(...componentTypes) {
    const result = [];
    for (const [entityId, entityComponents] of this.entities) {
      if (componentTypes.every(type => entityComponents.has(type))) {
        result.push(entityId);
      }
    }
    return result;
  }

  // System management
  addSystem(system, params) {
    system.game = this;
    this.systems.push(system);
    if (system.init) {
      system.init(params);
    }
  }

  // Main update loop
  async update(deltaTime) {
    this.tickCount++;
    this.currentTime = this.tickCount * this.FIXED_DELTA_TIME;
    this.state.now = this.currentTime;
    this.state.deltaTime = this.FIXED_DELTA_TIME;

    for (const system of this.systems) {
      if (system.update) {
        await system.update();
      }
      if (system.render && !this.isServer) {
        await system.render();
      }
    }

    this.postUpdate();
  }
}
```

---

## Collections System

Collections are the heart of GUTS - they define all game data.

### Collection Categories

Collections are organized into categories for the editor UI:

**Settings**:
- `configs` - Game, editor, server, AI configuration
- `editorModules` - Editor plugin definitions
- `themes` - Visual themes for editor
- `inputDataTypes` - Data type handlers
- `inputElementTypes` - UI input handlers

**Scripts** (contain executable code):
- `libraries` - Reusable classes and utilities
- `components` - Entity component classes
- `renderers` - Rendering classes
- `systems` - ECS system classes
- `managers` - Manager classes (lifecycle, input, etc.)
- `functions` - Utility functions

**Game Data**:
- `units` - Unit definitions
- `buildings` - Building definitions
- `abilities` - Ability definitions
- `projectiles` - Projectile definitions
- `items` - Item definitions

**Environment**:
- `scenes` - Scene definitions
- `levels` - Level layouts
- `worlds` - World configurations
- `terrainTypes` - Terrain tile definitions

**Graphics**:
- `models` - 3D model definitions
- `textures` - Texture definitions
- `materials` - Material definitions
- `animations` - Animation definitions

**Audio**:
- `sounds` - Sound effect definitions
- `music` - Music track definitions

**UI**:
- `interfaces` - UI layout definitions
- `modals` - Modal dialog definitions

### Object Type Definitions

Each collection has metadata in `objectTypeDefinitions`:

```json
{
  "id": "units",           // Collection ID (key in objectTypes)
  "name": "Units",         // Plural display name
  "singular": "Unit",      // Singular display name
  "category": "Game Data", // Category for organization
  "isCore": false          // If true, cannot be deleted
}
```

### Collection Object Format

Objects in collections have common and custom properties:

**Common Properties**:
```json
{
  "title": "Display Name",
  "fileName": "ClassName",     // For scripts
  "filePath": "/path/to/file", // Source file location
  "description": "..."         // Documentation
}
```

**Script Collections** (components, systems, managers, etc.):
```json
{
  "title": "Transform",
  "fileName": "Transform",
  "filePath": "/projects/TurnBasedWarfare/scripts/Scripts/components/js/Transform.js",
  "script": "class Transform extends Component { ... }",
  "parameters": {}
}
```

**Data Collections** (units, abilities, etc.):
```json
{
  "title": "Archer",
  "health": 100,
  "damage": 15,
  "range": 50,
  "speed": 5,
  "cost": 100
}
```

### How Collections Are Used

**In Editor**:
1. EditorModel loads all collections into `state.project.objectTypes`
2. EditorView renders collections in sidebar by category
3. User selects collection type (e.g., "units")
4. User selects object (e.g., "archer")
5. EditorView renders property editors
6. User edits properties
7. EditorController.saveObject() updates collection
8. EditorModel.saveProject() persists to storage

**In Game Runtime**:
1. Engine loads collections from JSON
2. SceneManager reads scene definition
3. Scene lists required classes from collections
4. ModuleManager compiles scripts from collections
5. Systems query entities and use class definitions
6. Game logic reads data properties from collections

---

## Library Loading System

Libraries provide reusable code for both the editor and game runtime.

### Library Definition Format

Libraries are objects in the `libraries` collection:

```json
{
  "BaseECSGame": {
    "title": "Base ECS Game",
    "filePath": "/global/libraries/js/BaseECSGame.js",
    "isModule": true,
    "importName": "BaseECSGame",
    "requireName": "BaseECSGame",
    "script": "class BaseECSGame { ... }"
  },
  "threejs": {
    "title": "Three.js",
    "href": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "isModule": true,
    "windowContext": "THREE",
    "importName": "THREE"
  }
}
```

**Library Properties**:
- `filePath` - Local file path (e.g., `/global/libraries/js/ClassName.js`)
- `href` - External URL (e.g., CDN)
- `isModule` - If true, use ES6 import
- `script` - Inline JavaScript code
- `windowContext` - Global namespace (e.g., "THREE", "RAPIER")
- `importName` - Name to import as
- `requireName` - Name to reference as

### Library Loading from game.json

The `configs.game.libraries` array specifies which libraries to load:

```json
{
  "libraries": [
    "threejs",
    "BaseECSGame",
    "Rapier",
    "SceneManager",
    "ShapeFactory",
    "ImageManager",
    "ModelManager",
    "Component",
    "Entity",
    "GameLoader"
  ]
}
```

**Loading Process**:

```
Engine.init()
   ↓
ModuleManager.loadModules(libraryNames)
   ↓
For each library:
   ├─ Check if already in webpack bundle (window.COMPILED_GAME)
   │   └─ If yes: use window.GUTS[libraryName]
   ├─ Check library definition in collections.libraries
   ├─ If isModule === true:
   │   └─ import(filePath or href)
   │       └─ Assign to window[windowContext][requireName]
   └─ Else:
       └─ Create <script> tag with library.script or library.href
           └─ Assign to window[requireName]
   ↓
All libraries available in ModuleManager.registeredLibraries
   └─ Also exposed as window.GUTS[libraryName]
```

### Library Loading from Scenes

Scenes can specify classes from collections, which automatically loads their libraries:

**Scene Definition** (`scenes/client.json`):
```json
{
  "sceneData": [{
    "classes": [
      {
        "collection": "abilities",
        "baseClass": "BaseAbility"
      }
    ]
  }]
}
```

**Loading Process**:
```
SceneManager.loadECS()
   ↓
For each sceneData.classes:
   ├─ Get collection name (e.g., "abilities")
   ├─ Get baseClass ID (e.g., "BaseAbility")
   ├─ Load baseClass from collections.abilities["BaseAbility"]
   ├─ Compile script: ModuleManager.getCompiledScript(baseClass, collection)
   │   └─ Compiles class from .script property
   ├─ Register class: game.addClass(baseClass, CompiledClass, params)
   │
   └─ For each object in collections[collection]:
       ├─ Skip baseClass (already loaded)
       ├─ Compile class from object.script
       └─ Register class: game.addClass(objectId, CompiledClass, params)
```

### ModuleManager Script Compilation

ModuleManager compiles script strings into executable classes:

```javascript
class ModuleManager {
  compileScript(scriptText, typeName) {
    // Create function that returns the class
    const scriptFunction = new Function(
      'engine',
      `return ${scriptText}`
    );

    // Execute function with script context
    const ScriptClass = scriptFunction(this.scriptContext);

    // Cache compiled class
    this.scriptCache.set(typeName.toLowerCase(), ScriptClass);

    return ScriptClass;
  }

  getCompiledScript(typeName, collectionType) {
    // Check cache
    if (this.scriptCache.has(typeName)) {
      return this.scriptCache.get(typeName);
    }

    // Get script from collection
    const scriptText = this.collections[collectionType][typeName].script;

    // Compile and cache
    return this.compileScript(scriptText, typeName);
  }
}
```

### Library Dependencies

Libraries can depend on other libraries by listing them in the scene or editor module:

**Example**: SceneEditor needs Three.js
```json
{
  "sceneModule": {
    "libraries": [
      "threejs",          // Loaded first
      "ShapeFactory",     // Can use THREE
      "ModelManager",     // Can use THREE and ShapeFactory
      "SceneEditor"       // Can use all above
    ]
  }
}
```

Libraries are loaded **sequentially** in the order specified to ensure dependencies are available.

---

## Scene Management

Scenes tie everything together - they define what systems, managers, and classes to load.

### Scene Structure

**Scene Definition** (`scenes/client.json`):
```json
{
  "title": "client",
  "type": "ECS",
  "sceneData": [
    {
      "id": 1,
      "objectType": "gamePrefabs",
      "spawnType": "multiplayer",
      "managers": [
        { "type": "ComponentManager", "parameters": {} },
        { "type": "GameManager", "parameters": {} },
        { "type": "InputManager", "parameters": {} }
      ],
      "systems": [
        { "type": "GridSystem", "parameters": {} },
        { "type": "RenderSystem", "parameters": {} },
        { "type": "AISystem", "parameters": {} }
      ],
      "classes": [
        {
          "collection": "units",
          "baseClass": "Unit"
        },
        {
          "collection": "abilities",
          "baseClass": "BaseAbility"
        }
      ]
    }
  ]
}
```

### Scene Loading Process

```
SceneManager.load("client")
   ↓
Load scene definition from collections.scenes["client"]
   ↓
Check scene.type:
   ├─ If "ECS": loadECS()
   └─ If "Legacy": loadLegacy()
   ↓
For "ECS" scenes:
   ↓
   For each sceneData entry:
      ├─ Load Classes
      │   └─ For each classes[]:
      │       ├─ Get collection (e.g., collections.units)
      │       ├─ Load baseClass if specified
      │       │   ├─ Check window.GUTS[baseClass] (webpack bundle)
      │       │   └─ Or compile from collections[collection][baseClass].script
      │       ├─ Register: game.addClass(baseClass, ClassDef, params)
      │       └─ Load all other classes in collection
      │           └─ game.addClass(classId, ClassDef, params)
      │
      ├─ Load Managers
      │   └─ For each managers[]:
      │       ├─ Get ManagerClass from window.GUTS or compile
      │       ├─ Instantiate: new ManagerClass(game, sceneManager)
      │       └─ Call manager.init(parameters)
      │
      └─ Load Systems
          └─ For each systems[]:
              ├─ Get SystemClass from window.GUTS or compile
              ├─ Instantiate: new SystemClass(game, sceneManager)
              ├─ Call: game.addSystem(systemInstance, parameters)
              └─ After all systems loaded: system.postAllInit()
```

### Scene Types

**ECS Scene**:
- Uses Entity-Component-System architecture
- Defines managers, systems, and classes
- Best for complex games with many entities

**Legacy Scene**:
- Uses traditional Entity class hierarchy
- Spawns entities from sceneData
- Best for simple games or prototypes

### Managers vs Systems

**Managers**:
- Singleton instances managing game-wide state
- Examples: GameManager, InputManager, ComponentManager
- Created once per scene
- Not part of the ECS update loop

**Systems**:
- Process entities with specific components each frame
- Examples: RenderSystem, MovementSystem, AISystem
- Multiple entities processed per system
- Called every update in game.update()

**Example Manager**:
```javascript
class GameManager {
  constructor(game, sceneManager) {
    this.game = game;
    this.sceneManager = sceneManager;
  }

  init(params) {
    this.game.gameManager = this;  // Make globally accessible
    this.setupGameState();
  }

  startGame() { ... }
  endGame() { ... }
  resetGame() { ... }
}
```

**Example System**:
```javascript
class MovementSystem {
  constructor(game, sceneManager) {
    this.game = game;
  }

  init(params) {
    // Setup
  }

  update() {
    // Process all entities with Transform and Velocity
    const entities = this.game.getEntitiesWith('Transform', 'Velocity');
    entities.forEach(id => {
      const transform = this.game.getComponent(id, 'Transform');
      const velocity = this.game.getComponent(id, 'Velocity');

      transform.x += velocity.x * this.game.deltaTime;
      transform.y += velocity.y * this.game.deltaTime;
    });
  }

  render() {
    // Optional: rendering logic
  }
}
```

---

## Build and Compilation

GUTS uses Webpack to bundle games into single files.

### Build Process

```
npm run build TurnBasedWarfare
   ↓
build/build.js executes webpack
   ↓
webpack.config.js (dynamic configuration)
   ├─ ConfigParser.parse("TurnBasedWarfare")
   │   └─ Reads projects/TurnBasedWarfare/config/TURNBASEDWARFARE.json
   ├─ EntryGenerator.generate(config)
   │   ├─ Collects all libraries from configs.game.libraries
   │   ├─ Collects all scripts from collections (components, systems, etc.)
   │   ├─ Creates import statements
   │   └─ Outputs to temp entry file
   └─ Webpack processes entry
       ├─ babel-loader transpiles code
       ├─ class-export-loader auto-exports classes
       └─ Bundles to output
           ├─ projects/TurnBasedWarfare/dist/client/game.js
           └─ projects/TurnBasedWarfare/dist/server/game.js
```

### Webpack Configuration

**Entry Generation**:
```javascript
// EntryGenerator creates an entry file like:
import BaseECSGame from '/global/libraries/js/BaseECSGame.js';
import SceneManager from '/global/libraries/js/SceneManager.js';
import Component from '/global/libraries/js/Component.js';
// ... all libraries

import Transform from '/projects/TurnBasedWarfare/scripts/Scripts/components/js/Transform.js';
import GridSystem from '/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GridSystem.js';
// ... all game scripts

// Export all to window.GUTS
window.GUTS = {
  BaseECSGame,
  SceneManager,
  Component,
  Transform,
  GridSystem,
  // ... all classes
};

// Flag that bundle is loaded
window.COMPILED_GAME_LOADED = true;
```

**Loaders**:
- `babel-loader` - Transpiles ES6+ to ES5
- `class-export-loader` - Automatically exports classes
- `json-loader` - Loads JSON files

**Output**:
- Client: `projects/{project}/dist/client/game.js`
- Server: `projects/{project}/dist/server/game.js`

### Using Compiled Bundles

**In game.html**:
```html
<script src="projects/TurnBasedWarfare/dist/client/game.js"></script>
<script>
  // All classes available in window.GUTS
  const engine = new Engine();
  engine.init("TurnBasedWarfare");
</script>
```

**Webpack bundle detection**:
```javascript
// ModuleManager checks for compiled bundle
if (window.COMPILED_GAME_LOADED && window.GUTS) {
  // Use bundled classes - skip dynamic loading
  const BaseECSGame = window.GUTS.BaseECSGame;
} else {
  // Dynamically load from collections
  const BaseECSGame = await import('/global/libraries/js/BaseECSGame.js');
}
```

### Development vs Production

**Development** (without webpack):
- Libraries loaded dynamically from collections
- Scripts compiled on-the-fly by ModuleManager
- Slower startup but instant reload on changes
- Good for rapid iteration

**Production** (with webpack):
- All code bundled into single file
- No dynamic loading needed
- Fast startup and execution
- Requires rebuild on changes

---

## Workflow Examples

### Creating a New Unit

**Step 1**: Select `units` collection in editor

**Step 2**: Click "New Object"
- ID: `knight`
- Title: Knight

**Step 3**: Edit properties
```json
{
  "title": "Knight",
  "health": 150,
  "damage": 20,
  "armor": 10,
  "speed": 3,
  "cost": 150
}
```

**Step 4**: (Optional) Add custom script
```javascript
class Knight extends Unit {
  init(params) {
    super.init(params);
    this.hasShield = true;
  }

  takeDamage(amount) {
    if (this.hasShield) {
      amount *= 0.5;  // 50% damage reduction
    }
    super.takeDamage(amount);
  }
}
```

**Step 5**: Save project

**Step 6**: Unit is now available in game

### Creating a New System

**Step 1**: Select `systems` collection

**Step 2**: Create new system
- ID: `MagicSystem`
- Category: Scripts

**Step 3**: Write system code
```javascript
class MagicSystem extends BaseSystem {
  init(params) {
    this.game = params.game;
  }

  update() {
    // Get all entities with Magic component
    const mages = this.game.getEntitiesWith('Transform', 'Magic');

    mages.forEach(id => {
      const magic = this.game.getComponent(id, 'Magic');

      // Regenerate mana
      magic.currentMana = Math.min(
        magic.currentMana + magic.manaRegen * this.game.deltaTime,
        magic.maxMana
      );
    });
  }
}
```

**Step 4**: Add to scene
Edit `scenes/client.json`:
```json
{
  "systems": [
    { "type": "GridSystem" },
    { "type": "MagicSystem" },  // Add here
    { "type": "RenderSystem" }
  ]
}
```

**Step 5**: Save and reload game

### Adding a Library to Your Project

**Step 1**: Create library definition in `libraries` collection

```json
{
  "MyUtility": {
    "title": "My Utility Library",
    "filePath": "/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/MyUtility.js",
    "isModule": true,
    "script": "class MyUtility { static helper() { return 42; } }"
  }
}
```

**Step 2**: Add to game config
Edit `configs/game.json`:
```json
{
  "libraries": [
    "BaseECSGame",
    "SceneManager",
    "MyUtility"  // Add here
  ]
}
```

**Step 3**: Use in your code
```javascript
class MyComponent extends Component {
  init() {
    const result = GUTS.MyUtility.helper();  // Access via GUTS namespace
  }
}
```

### Creating a Custom Editor Module

**Step 1**: Create module definition
```json
{
  "myModule": {
    "title": "My Custom Editor",
    "container": "my-editor-container",
    "libraries": ["MyEditorClass"],
    "propertyName": "myData",
    "interface": "myInterface",
    "loadHook": "loadMyEditor",
    "saveHook": "saveMyEditor"
  }
}
```

**Step 2**: Create editor class library
```javascript
class MyEditorClass {
  constructor(controller, config, GUTS) {
    this.controller = controller;
    this.config = config;
    this.GUTS = GUTS;
  }

  loadMyEditor(obj) {
    // Render UI for editing obj.myData
  }

  saveMyEditor() {
    // Save changes back to object
  }
}
```

**Step 3**: Create interface definition
```json
{
  "myInterface": {
    "html": "<div id='my-editor-container'>...</div>",
    "css": "#my-editor-container { ... }"
  }
}
```

**Step 4**: Add to editor config
Edit `configs/editor.json`:
```json
{
  "editorModules": [
    "sceneModule",
    "scriptModule",
    "myModule"  // Add here
  ]
}
```

---

## API Reference

### EditorController API

```javascript
// Get current state
controller.getCurrentObject()           // Get selected object
controller.getSelectedType()            // Get selected collection type
controller.getCollections()             // Get all collections
controller.getCollectionDefs()          // Get collection definitions

// Modify data
controller.createObject(type, id, data) // Create new object
controller.saveObject(data)             // Save current object
controller.deleteObject()               // Delete current object
controller.duplicateObject(newId, name) // Duplicate current object
controller.selectObject(objId)          // Select an object

// Project management
controller.saveProject()                // Save entire project
controller.loadProject(name)            // Load a project

// Type management
controller.createType(id, name, singular, category)
controller.removeSelectedType()         // Delete current type

// Hooks
controller.dispatchHook(hookName, params)  // Trigger custom event
```

### EditorModel API

```javascript
// Collections
model.getCollections()                  // All objectTypes
model.getCollectionDefs()               // All objectTypeDefinitions
model.getSingularType(typeId)           // Get singular form
model.getPluralType(typeId)             // Get plural form

// Object CRUD
model.createObject(type, id, properties)
model.updateObject(updates)
model.saveObject(complete)
model.deleteObject()
model.duplicateObject(newId, newName)
model.selectObject(objId)
model.getCurrentObject()

// Type CRUD
model.createType(id, name, singular, category)
model.deleteType(typeId)

// Project management
model.loadProject(name)
model.saveProject()
model.listProjects()
model.createProject(name, config)
model.deleteProject(name)

// Utility
model.findMatchingTypes(key)
model.findPropertyReferences(type, id, property)
```

### BaseECSGame API

```javascript
// Entity management
game.createEntity(id)                   // Create entity, returns ID
game.destroyEntity(entityId)            // Remove entity and all components
game.getEntityId()                      // Get next unique ID

// Component management
game.addComponent(entityId, type, data) // Add component to entity
game.removeComponent(entityId, type)    // Remove component from entity
game.getComponent(entityId, type)       // Get component data
game.hasComponent(entityId, type)       // Check if entity has component

// Queries
game.getEntitiesWith(...types)          // Get all entities with components

// System management
game.addSystem(system, params)          // Add system to game
game.systems                            // Array of all systems

// Class registration
game.addClass(id, ClassRef, params)     // Register a class
game.classes                            // Map of registered classes

// State
game.state                              // Game state object
game.deltaTime                          // Time since last update
game.currentTime                        // Current game time
game.tickCount                          // Number of ticks elapsed

// Lifecycle
game.init()                             // Initialize game
game.update(deltaTime)                  // Update all systems
game.postUpdate()                       // Post-update cleanup
```

### SceneManager API

```javascript
// Scene loading
sceneManager.load(sceneName)            // Load a scene by name
sceneManager.addEntityToScene(entity)   // Add entity to current scene

// Current scene
sceneManager.currentSceneName           // Name of loaded scene
sceneManager.currentSceneData           // Scene definition data
```

### ModuleManager API

```javascript
// Library management
moduleManager.loadModules(modules)      // Load array of libraries
moduleManager.registerModule(name, instance)
moduleManager.getModule(name)           // Get registered module

// Script compilation
moduleManager.compileScript(scriptText, typeName)
moduleManager.getCompiledScript(typeName, collectionType)

// Context
moduleManager.setupScriptEnvironment(app)
moduleManager.scriptContext             // Script execution context
moduleManager.registeredLibraries       // Loaded libraries
```

### Engine API

```javascript
// Initialization
Engine.init(projectName)                // Initialize engine
Engine.start()                          // Start game loop
Engine.stop()                           // Stop game loop

// Access
Engine.collections                      // All game collections
Engine.gameInstance                     // Game instance (ECSGame)
Engine.moduleManager                    // Module manager

// Lifecycle
Engine.tick()                           // Single game loop tick
Engine.update(deltaTime)                // Update game
```

---

## Advanced Topics

### Custom Components

Components are pure data containers:

```javascript
class Transform extends Component {
  constructor(game, parent) {
    super(game, parent);
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.rotation = 0;
    this.scale = 1;
  }

  init(params) {
    Object.assign(this, params);
  }

  // Network sync (for multiplayer)
  getNetworkData() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      rotation: this.rotation
    };
  }

  setNetworkData(data) {
    Object.assign(this, data);
  }
}
```

### Custom Systems

Systems process entities each frame:

```javascript
class PhysicsSystem extends BaseSystem {
  init(params) {
    this.gravity = params.gravity || 9.8;
  }

  update() {
    const entities = this.game.getEntitiesWith('Transform', 'Physics');

    entities.forEach(id => {
      const transform = this.game.getComponent(id, 'Transform');
      const physics = this.game.getComponent(id, 'Physics');

      // Apply gravity
      physics.velocityY -= this.gravity * this.game.deltaTime;

      // Apply velocity
      transform.y += physics.velocityY * this.game.deltaTime;

      // Ground collision
      if (transform.y <= 0) {
        transform.y = 0;
        physics.velocityY = 0;
      }
    });
  }
}
```

### Multiplayer Architecture

GUTS supports multiplayer via Socket.io:

**Server** (`server_game.js`):
```javascript
const ServerEngine = require('./engine/ServerEngine');

io.on('connection', (socket) => {
  const gameId = socket.handshake.query.gameId;

  // Create or join game room
  if (!games[gameId]) {
    games[gameId] = new ServerEngine();
    games[gameId].init(projectName);
    games[gameId].start();
  }

  // Sync state to client
  games[gameId].gameInstance.addPlayer(socket.id);

  // Handle client inputs
  socket.on('playerAction', (data) => {
    games[gameId].gameInstance.handleAction(socket.id, data);
  });
});
```

**Client**:
```javascript
class MultiplayerECSGame extends BaseECSGame {
  init() {
    this.socket = io();

    this.socket.on('stateUpdate', (state) => {
      this.syncState(state);
    });
  }

  sendAction(action) {
    this.socket.emit('playerAction', action);
  }
}
```

### File System Sync (Localhost)

On localhost, scripts sync between editor and filesystem:

**Editor → Filesystem**:
```javascript
// FileSystemSyncService.js
exportProject(projectName) {
  const collections = this.controller.getCollections();

  // Export each script collection
  ['components', 'systems', 'managers'].forEach(type => {
    Object.entries(collections[type]).forEach(([id, obj]) => {
      if (obj.script && obj.filePath) {
        // POST to server
        fetch('/save-script', {
          method: 'POST',
          body: JSON.stringify({
            filePath: obj.filePath,
            script: obj.script
          })
        });
      }
    });
  });
}
```

**Filesystem → Editor**:
```javascript
// FileSystemSyncService.js
importProject(projectName) {
  // GET from server
  fetch(`/load-scripts?project=${projectName}`)
    .then(res => res.json())
    .then(scripts => {
      scripts.forEach(({ filePath, script }) => {
        // Find matching object in collections
        const obj = this.findObjectByFilePath(filePath);
        if (obj) {
          obj.script = script;
        }
      });
    });
}
```

---

## Troubleshooting

### Common Issues

**Libraries not loading**:
- Check `configs.game.libraries` array
- Verify library exists in `libraries` collection
- Check browser console for import errors
- Ensure `isModule: true` for ES6 modules
- Check `windowContext` for global libraries

**Classes not found in scene**:
- Verify class exists in specified collection
- Check scene `classes` array references correct collection
- Ensure `baseClass` is spelled correctly
- Rebuild if using webpack bundle

**System not updating**:
- Check system is in scene `systems` array
- Verify `init()` method doesn't have errors
- Ensure entities have required components
- Check console for errors in `update()` method

**Component not working**:
- Verify component registered via scene `classes`
- Check component added to entity: `game.addComponent(id, 'Transform', data)`
- Ensure system queries for correct component type
- Check component `init()` called with params

**Editor module not appearing**:
- Check module in `configs.editor.editorModules` array
- Verify module definition exists in `editorModules` collection
- Ensure module libraries loaded
- Check browser console for instantiation errors

---

## Best Practices

### Code Organization

**Separate concerns**:
- Components: data only
- Systems: logic only
- Managers: game-wide state

**Name conventions**:
- Classes: PascalCase (Transform, MovementSystem)
- Instances: camelCase (transform, movementSystem)
- Collections: lowercase plural (components, systems)
- Files: match class name (Transform.js)

**File structure**:
```
scripts/
├── Scripts/
│   ├── components/      # Entity data
│   ├── systems/         # Game logic
│   ├── managers/        # Singletons
│   ├── libraries/       # Utilities
│   └── functions/       # Helper functions
├── Settings/
│   └── configs/         # Configuration
└── Environment/
    ├── scenes/          # Scene definitions
    └── levels/          # Level data
```

### Performance

**Entity queries**:
```javascript
// ❌ Bad: query every frame
update() {
  this.entities = this.game.getEntitiesWith('Transform', 'Velocity');
}

// ✅ Good: cache entities, update on add/remove
init() {
  this.entities = [];
}

entityAdded(id) {
  if (this.game.hasComponent(id, 'Transform') &&
      this.game.hasComponent(id, 'Velocity')) {
    this.entities.push(id);
  }
}
```

**Component access**:
```javascript
// ❌ Bad: access component multiple times
update() {
  this.entities.forEach(id => {
    const x = this.game.getComponent(id, 'Transform').x;
    const y = this.game.getComponent(id, 'Transform').y;
  });
}

// ✅ Good: cache component reference
update() {
  this.entities.forEach(id => {
    const transform = this.game.getComponent(id, 'Transform');
    const x = transform.x;
    const y = transform.y;
  });
}
```

### Debugging

**Use PerformanceMonitor**:
```javascript
// Add to game.libraries
"libraries": ["PerformanceMonitor"]

// Displays FPS and system timing
```

**Console logging**:
```javascript
class MySystem {
  update() {
    console.log('[MySystem]', 'Entities:', this.entities.length);
  }
}
```

**DesyncDebugger** for multiplayer:
```javascript
"libraries": ["DesyncDebugger"]

// Detects state desyncs between client/server
```

---

## Conclusion

GUTS is a powerful framework for data-driven game development. By organizing all game content into collections and using a modular ECS architecture, you can create complex games with rapid iteration.

Key takeaways:
- **Collections** define all game data
- **Scenes** specify what to load
- **Libraries** provide reusable code
- **ECS** separates data (components) from logic (systems)
- **Editor** provides visual tools
- **ModuleManager** loads and compiles code
- **Webpack** bundles for production

For questions or contributions, please refer to the project repository.

---

**Happy Game Development! 🎮**
