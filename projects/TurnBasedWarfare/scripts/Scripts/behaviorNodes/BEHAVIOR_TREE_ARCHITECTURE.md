# Behavior Tree Architecture

## Overview

The behavior tree system integrates **player orders**, **autobattle combat**, and **passive abilities** to control unit behavior during battle phases.

## Tree Hierarchy

```
SelectBehaviorTree (Root)
├── AbilitiesBehaviorTree (Priority 1: Passive abilities)
│   └── Evaluates all passive abilities from unit
│
├── PlayerOrderBehaviorTree (Priority 2: Player commands)
│   ├── [Check: IsEnemyNearbyAction for normal moves]
│   ├── BuildSequence (Build orders from peasants)
│   ├── HoldPositionAction (Hold position command)
│   └── MoveBehaviorAction (Move to target position)
│
├── NewCombatBehaviorTree (Priority 3: Autobattle AI)
│   ├── AttackSequence (if target exists and in range)
│   │   ├── HasTargetAction
│   │   ├── IsInAttackRangeAction
│   │   └── AttackEnemyAction
│   ├── ChaseSequence (if target exists but out of range)
│   │   ├── HasTargetAction
│   │   └── MoveToEnemyAction
│   └── FindNearestEnemyAction (find new target)
│
└── IdleBehaviorAction (Priority 4: Default fallback)
    └── Stand idle
```

## Priority System

The behavior tree uses a **selector pattern** that evaluates children in order and returns the first non-null result:

1. **Passive Abilities** (Always evaluated first)
   - Auras, regeneration, temporary buffs
   - Can run in parallel with other behaviors
   - Defined in unit's `abilities` array

2. **Player Orders** (Manual commands can override AI)
   - Build commands (peasant construction)
   - Hold position (prevent movement)
   - Move orders (relocate unit)
     - **Normal moves**: Interrupted by combat when enemies are nearby
     - **Force moves**: Ignore enemies and go to destination regardless
   - Stored in `playerOrder` component

3. **Autobattle Combat** (AI decision making)
   - Find and engage enemies
   - Chase targets
   - Attack when in range
   - Uses `combat` and `aiState` components

4. **Idle** (Fallback when nothing else applies)
   - Unit stands still
   - Plays idle animation

## Component Flow

### Player Order Component
```json
{
  "targetPosition": { "x": 100, "z": 200 },
  "meta": {
    "isMoveOrder": true,
    "preventEnemiesInRangeCheck": false,
    "allowMovement": true
  },
  "issuedTime": 1234567890
}
```

- `targetPosition`: World coordinates to move to
- `meta.isMoveOrder`: Flag for move commands
- `meta.preventEnemiesInRangeCheck`: If true, this is a **force move** - unit ignores enemies and goes to destination. If false/omitted, this is a **normal move** - unit will engage enemies if they come into vision range.
- `meta.allowMovement`: If false, unit holds position
- `issuedTime`: Timestamp when order was issued

#### Move Order Types

**Normal Move** (preventEnemiesInRangeCheck: false or omitted):
- PlayerOrderBehaviorTree uses IsEnemyNearbyAction to check for enemies
- If enemies in vision range → tree fails → CombatBehaviorAction takes over
- If no enemies → MoveBehaviorAction executes the move
- After combat, unit remains at combat location (doesn't resume move)

**Force Move** (preventEnemiesInRangeCheck: true):
- Set by existing force move action in unit action panel
- PlayerOrderBehaviorTree skips enemy check
- MoveBehaviorAction executes regardless of enemies
- Does not engage in combat
- Continues to destination

### AI State Component
```json
{
  "currentAction": "CombatBehaviorAction",
  "status": "running",
  "meta": {
    "target": "enemy-123",
    "targetPosition": { "x": 150, "z": 180 }
  }
}
```

- `currentAction`: Currently executing action
- `status`: 'success', 'running', or 'failure'
- `meta`: Action-specific data (target, position, etc.)

## Behavior States

### MoveBehaviorAction
- **Success**: Reached target position
- **Running**: Moving toward target
- **Failure**: No valid move order

Note: Enemy checking is handled by PlayerOrderBehaviorTree, not this action.

### HoldPositionAction
- **Success**: Holding position (anchored)
- **Failure**: No hold order present

### NewCombatBehaviorTree
Modular combat tree using composition of focused actions:

**Sequences:**
- **AttackSequence**: Returns running while attacking target in range
- **ChaseSequence**: Returns running while moving toward target

**Actions:**
- **FindNearestEnemyAction**: Finds nearest enemy in vision range, stores in `aiState.shared.target`
- **HasTargetAction**: Checks if `shared.target` exists and is alive
- **IsInAttackRangeAction**: Checks if target is within `combat.range`
- **MoveToEnemyAction**: Moves toward `shared.target`, succeeds when in range
- **AttackEnemyAction**: Attacks `shared.target`, anchors unit, continuous (returns running)

### AbilitiesBehaviorTree
- Evaluates each ability's `behaviorAction`
- Returns first ability that can execute
- Abilities checked in order from unit definition

## Creating Custom Behaviors

### 1. Create Action Node

**Data file** (`data/MyAction.json`):
```json
{
  "title": "My Action",
  "description": "Custom behavior action",
  "behaviorNodeType": "action",
  "filePath": "/path/to/MyAction.js",
  "fileName": "MyAction",
  "parameters": {},
  "memory": {}
}
```

**JavaScript file** (`js/MyAction.js`):
```javascript
class MyAction extends GUTS.BaseBehaviorAction {
    execute(entityId, game) {
        // Check preconditions
        if (!this.canExecute(entityId, game)) {
            return this.failure(); // Try next action
        }

        // Perform action logic
        // ...

        // Return status
        return this.success({ /* meta data */ });
        // or
        return this.running({ /* meta data */ });
    }

    canExecute(entityId, game) {
        // Check if action can run
        return true;
    }
}
```

### 2. Create Behavior Tree

**Data file** (`data/MyTree.json`):
```json
{
  "title": "My Tree",
  "description": "Custom behavior tree",
  "behaviorNodeType": "selector",
  "filePath": "/path/to/MyTree.js",
  "fileName": "MyTree",
  "behaviorActions": [
    "FirstAction",
    "SecondAction",
    "FallbackAction"
  ]
}
```

**JavaScript file** (`js/MyTree.js`):
```javascript
class MyTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        // Custom logic before evaluation
        // ...

        // Use base class selector
        return super.evaluate(entityId, game);
    }
}
```

### 3. Add to Root Tree

Edit `SelectBehaviorTree.json`:
```json
{
  "behaviorActions": [
    "AbilitiesBehaviorTree",
    "MyTree",              // Your custom tree
    "PlayerOrderBehaviorTree",
    "CombatBehaviorAction",
    "IdleBehaviorAction"
  ]
}
```

## Status Return Values

Actions must return one of:
- `this.success(meta)` - Action completed successfully
- `this.running(meta)` - Action in progress (will continue next tick)
- `this.failure()` - Action cannot execute (returns `null`)

## Debugging

The behavior tree system includes debugging support:
- Each node evaluation is traced
- Performance metrics tracked
- State snapshots recorded
- Access via `game.gameManager.call('getDebugger')`

## Best Practices

1. **Keep actions focused** - One action per responsibility
2. **Use failure correctly** - Return `null` when action doesn't apply
3. **Leverage running state** - For multi-tick actions (movement, combat)
4. **Clean up on end** - Use `onEnd()` to reset state
5. **Check preconditions early** - Fail fast if action can't execute
6. **Use memory for state** - Store per-entity data in action memory
7. **Use shared state** - Store cross-action data in `aiState.shared`

## Integration with Systems

### MovementSystem
- Reads `aiState.meta.targetPosition`
- Moves unit toward target
- Handles pathfinding

### DamageSystem
- Triggered by combat actions
- Handles damage calculation
- Applies elemental effects

### AbilitySystem
- Provides abilities to `AbilitiesBehaviorTree`
- Manages cooldowns
- Executes ability effects

### UnitOrderSystem
- Creates player orders
- Sets `playerOrder` component
- Handles UI for commands

## Files

### Core Behavior Trees
- `SelectBehaviorTree.js` - Root tree for all units
- `PlayerOrderBehaviorTree.js` - Player command handling
- `AbilitiesBehaviorTree.js` - Passive ability execution
- `UnitBattleBehaviorTree.js` - Example comprehensive tree

### Actions
- `MoveBehaviorAction.js` - Move to target position
- `HoldPositionAction.js` - Stay in place
- `CombatBehaviorAction.js` - Autobattle combat
- `IdleBehaviorAction.js` - Default idle state
- `BuildSequence.js` - Building construction
- And many more in `behaviorNodes/js/`

### Systems
- `BehaviorSystem.js` - Main behavior tree processor
- `MovementSystem.js` - Handles unit movement
- `AbilitySystem.js` - Manages abilities
- `UnitOrderSystem.js` - Player commands
