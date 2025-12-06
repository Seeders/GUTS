# Plan: Refactor TerrainMapEditor to use Mock Game Context

## Overview

Refactor the TerrainMapEditor to use a mock game context similar to SceneEditorContext, allowing proper ECS systems to run (AnimationSystem, RenderSystem, etc.) instead of manually managing rendering.

## Current Architecture

The TerrainMapEditor currently:
1. Uses `WorldRenderer` directly to setup 3D scene
2. Uses `EntityRenderer` directly to spawn entities
3. Has a simple render loop that only calls `worldRenderer.update()` and `render()`
4. No ECS systems running - entities don't have proper component-based updates
5. Billboard sprites with `spriteAnimationSet` don't animate (no AnimationSystem)

## Target Architecture

Follow the SceneEditorContext pattern:
1. Create `TerrainEditorContext` class that mimics the game's ECS structure
2. Initialize required systems: `AnimationSystem`, `RenderSystem`, potentially `GridSystem`
3. Run proper game loop with system updates
4. Entity spawning creates ECS entities with components
5. Systems detect entities and handle rendering/animation automatically

## Implementation Steps

### Step 1: Create TerrainEditorContext Class

Create `c:\projects\GUTS\global\libraries\js\TerrainEditorContext.js`:

- Extend or mirror the SceneEditorContext pattern
- Include:
  - ECS data structures (entities, components, systems)
  - GameServices/gameManager
  - ComponentGenerator
  - State object (isPaused, now, deltaTime)
  - Clock for delta time
  - Animation loop management

Key methods:
- `initialize(canvas, terrainData)` - setup systems
- `loadTerrain(tileMap, world)` - load terrain and spawn entities
- `spawnWorldObject(type, position)` - add world objects as ECS entities
- `removeWorldObject(entityId)` - remove entities
- `startRenderLoop()` / `stopRenderLoop()`
- `update()` - system update loop

### Step 2: Initialize Required Systems

Systems needed for terrain editor:
1. **AnimationSystem** - for billboard sprite animations
2. **RenderSystem** - for entity rendering (already used via EntityRenderer)

Systems NOT needed (editor-specific):
- GridSystem (handled by PlacementPreview)
- TerrainSystem (WorldRenderer handles terrain)
- PathfindingSystem
- Combat systems

### Step 3: Modify TerrainMapEditor.init3DRendering()

Replace current manual setup with TerrainEditorContext:

```javascript
async init3DRendering() {
    // Create context
    this.editorContext = new GUTS.TerrainEditorContext(this.gameEditor, this.canvasEl);

    // Initialize with required systems
    await this.editorContext.initialize(['AnimationSystem', 'RenderSystem']);

    // Load terrain data
    await this.editorContext.loadTerrain(this.tileMap, this.objectData.world);

    // Keep references for existing editor functionality
    this.worldRenderer = this.editorContext.worldRenderer;
    this.entityRenderer = this.editorContext.entityRenderer;
    this.raycastHelper = this.editorContext.raycastHelper;
}
```

### Step 4: Update Entity Spawning

Convert EnvironmentObjectSpawner to create proper ECS entities:

For each world object:
```javascript
const entityId = this.editorContext.createEntity();
this.editorContext.addComponent(entityId, 'transform', { position, rotation, scale });
this.editorContext.addComponent(entityId, 'unitType', { collection: 'worldObjects', type, ...unitTypeDef });
this.editorContext.addComponent(entityId, 'renderable', {});
// AnimationSystem will automatically pick this up and set animations
```

### Step 5: Update Render Loop

Replace simple render loop with system-aware loop:

```javascript
start3DRenderLoop() {
    const loop = () => {
        const deltaTime = this.editorContext.clock.getDelta();
        this.editorContext.state.deltaTime = deltaTime;
        this.editorContext.state.now += deltaTime;

        // Update all systems
        for (const system of this.editorContext.systems) {
            if (system.enabled && system.update) {
                system.update();
            }
        }

        // Render
        this.worldRenderer.render();

        this.animationFrameId = requestAnimationFrame(loop);
    };
    loop();
}
```

### Step 6: Handle Editor-Specific Functionality

Preserve existing functionality:
- Terrain editing (height map, terrain types)
- World object placement/deletion
- Placement preview
- Raycasting for mouse interaction
- Camera controls

## Files to Create/Modify

### New Files:
1. `global/libraries/js/TerrainEditorContext.js` - New mock game context

### Files to Modify:
1. `global/libraries/js/TerrainMapEditor.js`:
   - Replace `init3DRendering()` to use TerrainEditorContext
   - Update entity spawning to use ECS pattern
   - Update render loop to call system updates

2. `global/libraries/js/EnvironmentObjectSpawner.js`:
   - Add option to spawn as ECS entities (not just visual rendering)

### Files to Reference (no changes):
- `global/libraries/js/SceneEditorContext.js` - Pattern to follow
- `projects/TurnBasedWarfare/scripts/Scripts/systems/js/AnimationSystem.js` - System to initialize
- `projects/TurnBasedWarfare/scripts/Scripts/systems/js/RenderSystem.js` - System to initialize

## Considerations

### System Dependencies

AnimationSystem requires:
- `game.scene`, `game.camera`, `game.renderer`
- `game.renderSystem?.isInstanced()`
- `game.getEntitiesWith('transform', 'renderable')`
- `game.getComponent(entityId, 'unitType')`
- Access to collections for sprite animation data

RenderSystem requires:
- Scene from WorldSystem or direct reference
- EntityRenderer
- Collections

### Backward Compatibility

Keep existing interfaces working:
- `spawnWorldObjects()` still works
- `deleteWorldObject()` still works
- Terrain editing remains unchanged
- Camera controls remain unchanged

### Performance

- Systems update only what's needed (editor is paused state)
- AnimationSystem handles billboard updates efficiently
- No combat/AI/pathfinding overhead

## Testing Checklist

1. [ ] Terrain loads correctly in 3D view
2. [ ] Cliff meshes render properly
3. [ ] World objects with 3D models render
4. [ ] World objects with spriteAnimationSet render AND animate
5. [ ] Placing new world objects works
6. [ ] Deleting world objects works
7. [ ] Camera controls work (pan, rotate, zoom)
8. [ ] Height map editing works
9. [ ] Terrain type editing works
10. [ ] No console errors on load/save
