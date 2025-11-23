# Behavior Tree System - Usage Guide

## Overview

The Behavior Tree system provides a data-driven approach to unit AI that is:
- **Deterministic**: No desyncs between clients
- **Debuggable**: See exactly what every unit is doing
- **Composable**: Easy to add new unit types and behaviors
- **Editor-friendly**: Edit behavior trees visually in the GUTS editor

## Collections

The system adds three new collections in the GUTS editor:

### 1. Actions (`/scripts/BehaviorTrees/actions/`)

Actions define **HOW** units perform specific behaviors.

**Example**: `MOVE_TO.json`
```json
{
  "title": "Move To Position",
  "type": "MOVE_TO",
  "priority": 10,
  "description": "Move unit to a target position",
  "parameters": {
    "arrivalThreshold": 20
  }
}
```

**Corresponding Script**: `actions/js/MOVE_TO.js`
- Must extend `BaseAction`
- Implements `canExecute()`, `execute()`, `onEnd()`
- Stateless execution

### 2. Behavior Trees (`/scripts/BehaviorTrees/behaviorTrees/`)

Behavior trees define **WHAT** units should do based on their current state.

**Example**: `peasant.json`
```json
{
  "title": "Peasant Behavior Tree",
  "unitType": "peasant",
  "description": "Worker unit that builds and mines",
  "nodes": {
    "root": {
      "type": "selector",
      "children": ["checkPlayerOrder", "checkBuildOrder", "checkMining", "idle"]
    },
    ...
  }
}
```

**Corresponding Script**: `behaviorTrees/js/peasant.js`
- Must extend `BaseBehaviorTree`
- Implements `evaluate()` method
- Returns action descriptors with priorities

### 3. Components

**UnitController** - Single source of truth for unit AI state
- Replaces: AI_STATE, BUILDING_STATE, MINING_STATE, etc.
- Properties:
  - `currentAction`: What is the unit doing?
  - `actionTarget`: What is it targeting?
  - `actionPriority`: How important?
  - `playerOrder`: Saved player command

## Editor Usage

### Editing Behavior Trees

1. **Select a Behavior Tree** in the editor sidebar
2. **Editor shows**:
   - Tree visualization
   - Available actions (from actions collection)
   - Node properties panel
   - JSON view for advanced editing
3. **Validate** the tree structure
4. **Export** to JSON if needed

### Creating New Actions

1. Navigate to **Actions** collection
2. Click **Add New Action**
3. Define:
   - Title
   - Type (e.g., "GATHER_WOOD")
   - Priority (0-100, higher = more important)
   - Parameters (JSON object)
4. Create corresponding `.js` file in `actions/js/` that:
   - Extends `BaseAction`
   - Implements the action logic

### Creating New Behavior Trees

1. Navigate to **Behavior Trees** collection
2. Click **Add New Behavior Tree**
3. Define:
   - Title
   - Unit Type (must match a unit type ID)
   - Nodes structure (JSON)
4. Create corresponding `.js` file in `behaviorTrees/js/` that:
   - Extends `BaseBehaviorTree`
   - Implements `evaluate()` method

## System Integration

### BehaviorSystem

The `BehaviorSystem` runs every frame and:
1. Evaluates behavior trees for all units with `UnitController`
2. Decides if action should switch based on priority
3. Executes current action via action executors
4. Handles action completion and cleanup

### Priority System

Actions have priorities that determine when they can interrupt each other:

```
Priority 0:  IDLE (default fallback)
Priority 5:  MINE (background task)
Priority 10: MOVE_TO (player order)
Priority 20: BUILD (assigned task)
Priority 30: ATTACK (combat)
Priority 40: FLEE (survival)
```

**Rule**: An action can only interrupt a lower or equal priority action.

### Player Commands

Use `BehaviorSystem.issuePlayerCommand()`:

```javascript
behaviorSystem.issuePlayerCommand(
    unitId,
    "MOVE_TO",           // Action type
    { x: 100, z: 200 },  // Target
    {}                   // Optional data
);
```

This sets `playerOrder` in the unit's `UnitController`, which behavior trees check first.

## Node Types

### Selector
Tries children in order, returns first that succeeds.
```json
{
  "type": "selector",
  "children": ["combat", "mine", "idle"]
}
```

### Sequence
Executes children in order until one fails.
```json
{
  "type": "sequence",
  "children": ["checkResource", "moveToResource", "gather"]
}
```

### Condition
Evaluates condition, executes onSuccess if true.
```json
{
  "type": "condition",
  "condition": "hasEnemiesInRange",
  "onSuccess": "attackAction"
}
```

### Action
Leaf node that returns an action descriptor.
```json
{
  "type": "action",
  "action": "MINE",
  "target": "nearestMine",
  "priority": 5
}
```

## Migration from Old System

To migrate existing unit AI:

1. **Identify current behaviors**:
   - What does this unit do?
   - When does it do it?
   - What's the priority?

2. **Create actions** for each behavior:
   - Extract logic from old abilities
   - Make stateless (use `actionData` for state)

3. **Create behavior tree**:
   - Map conditions to selector/sequence nodes
   - Define priority order

4. **Add UnitController** component to unit prefabs

5. **Test**: Old and new systems can run in parallel during migration

## Example: Peasant AI

**Old System** (scattered):
- `MineGoldAbility` (450+ lines)
- `BuildAbility` (300+ lines)
- Manual state machines
- Interruption flags

**New System** (unified):
```javascript
class PeasantBehaviorTree extends BaseBehaviorTree {
    evaluate(entityId, game) {
        return this.select([
            () => this.checkPlayerOrder(controller),      // Priority 10
            () => this.checkBuildOrder(entityId, game),   // Priority 20
            () => this.checkMining(entityId, game),       // Priority 5
            () => ({ action: "IDLE", priority: 0 })       // Priority 0
        ]);
    }
}
```

- Single source of truth: `UnitController`
- Clear priority: Build > Player Order > Mine > Idle
- No interruption flags needed
- Deterministic evaluation

## Debugging

Check what a unit is doing:
```javascript
const action = behaviorSystem.getCurrentAction(unitId);
console.log(action);
// { action: "MINE", target: "mine_123", priority: 5 }
```

Check all units:
```javascript
for (const unitId of units) {
    const controller = game.getComponent(unitId, CT.UNIT_CONTROLLER);
    console.log(`${unitId}: ${controller.currentAction} -> ${controller.actionTarget}`);
}
```

## Benefits

✅ **Single Source of Truth**: `UnitController` component
✅ **Deterministic**: Sorted iteration, pure functions
✅ **Debuggable**: See exactly what every unit is doing
✅ **Network-Friendly**: Minimal state to sync
✅ **Composable**: Easy to add new units/actions
✅ **Testable**: Behavior trees are pure logic
✅ **Editor-Friendly**: Visual editing in GUTS

## Next Steps

1. Create actions for your specific game behaviors
2. Create behavior trees for each unit type
3. Add `UnitController` components to units
4. Test in the editor
5. Gradually migrate old AI systems
