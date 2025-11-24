# Unit AI Redesign - Behavior Tree + Action System

## Core Principles

1. **Single Source of Truth**: `UnitController` component stores current action
2. **Declarative Actions**: Define goals, not steps
3. **Deterministic Execution**: All decisions based on game state, no randomness
4. **Clear Priorities**: Explicit priority system prevents conflicts
5. **Composable Behaviors**: Easy to add new unit types
6. **Network-Friendly**: Minimal state to sync

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BehaviorSystem (Master)                  │
│  - Evaluates behavior trees for all units                  │
│  - Selects highest priority action                         │
│  - Delegates to ActionExecutors                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   UnitController Component                  │
│  {                                                          │
│    currentAction: "MOVE_TO",                               │
│    actionTarget: {x, z},                                   │
│    actionData: {...},                                      │
│    actionPriority: 10,                                     │
│    actionStartTime: 1234.56,                              │
│    playerOrdered: true                                     │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────┴────────────────────┐
        │                                        │
        ▼                                        ▼
┌──────────────────┐                   ┌──────────────────┐
│  ActionExecutors │                   │ BehaviorTrees    │
│  - MoveAction    │                   │ - PeasantBT      │
│  - AttackAction  │                   │ - WarriorBT      │
│  - MineAction    │                   │ - ArcherBT       │
│  - BuildAction   │                   │ - TowerBT        │
└──────────────────┘                   └──────────────────┘
```

---

## 1. UnitController Component

**Single component** replaces AI_STATE, BUILDING_STATE, MINING_STATE, etc.

```javascript
Components.UnitController({
    // Current action
    currentAction: null,        // Action name: "MOVE_TO", "ATTACK", "MINE", "BUILD", etc.
    actionTarget: null,         // Entity ID or position {x, z}
    actionData: {},            // Action-specific data
    actionPriority: 0,          // Priority level (higher = more important)
    actionStartTime: 0,         // When action started

    // Player orders (persist between rounds)
    playerOrder: null,          // Saved player command

    // Internal state (computed, not synced)
    _behaviorTree: null,        // Reference to behavior tree
    _evaluationTime: 0          // Last time behaviors were evaluated
});
```

---

## 2. Action System

### Action Definition
Actions are **stateless** and **deterministic**:

```javascript
class MoveAction extends Action {
    static TYPE = "MOVE_TO";
    static PRIORITY = 10;

    // Can this action run?
    canExecute(entityId, controller, gameState) {
        const pos = gameState.getComponent(entityId, CT.POSITION);
        const target = controller.actionTarget;
        if (!pos || !target) return false;

        const dist = this.distance(pos, target);
        return dist > ARRIVAL_THRESHOLD;
    }

    // Execute one tick
    execute(entityId, controller, gameState, dt) {
        const pos = gameState.getComponent(entityId, CT.POSITION);
        const vel = gameState.getComponent(entityId, CT.VELOCITY);
        const target = controller.actionTarget;

        // Move toward target (handled by MovementSystem)
        vel.targetX = target.x;
        vel.targetZ = target.z;

        // Check completion
        if (this.distance(pos, target) <= ARRIVAL_THRESHOLD) {
            return { complete: true };
        }

        return { complete: false };
    }

    // Clean up when action ends
    onEnd(entityId, controller, gameState) {
        const vel = gameState.getComponent(entityId, CT.VELOCITY);
        vel.targetX = null;
        vel.targetZ = null;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
```

### Available Actions

```javascript
// Movement
MoveAction           - Priority: 10  - Move to position
FollowAction         - Priority: 10  - Follow entity

// Combat
AttackAction         - Priority: 30  - Attack enemy
FleeAction           - Priority: 40  - Run away

// Economy
MineAction           - Priority: 5   - Mine gold
BuildAction          - Priority: 20  - Construct building
RepairAction         - Priority: 15  - Repair building
GatherAction         - Priority: 5   - Gather resources

// Special
CastSpellAction      - Priority: 40  - Cast ability
PatrolAction         - Priority: 1   - Patrol route
IdleAction           - Priority: 0   - Do nothing
```

---

## 3. Behavior Trees

Each unit type has a **behavior tree** that evaluates priorities:

```javascript
class PeasantBehaviorTree extends BehaviorTree {
    evaluate(entityId, gameState) {
        const controller = gameState.getComponent(entityId, CT.UNIT_CONTROLLER);
        const pos = gameState.getComponent(entityId, CT.POSITION);

        // Selector: Pick highest priority that can run
        return this.select([
            // 1. Player orders always win (if valid)
            () => this.checkPlayerOrder(controller),

            // 2. Build if assigned to construction
            () => this.checkBuildOrder(entityId, gameState),

            // 3. Mine if idle (autocast)
            () => this.checkMining(entityId, gameState),

            // 4. Idle
            () => ({ action: "IDLE", priority: 0 })
        ]);
    }

    checkPlayerOrder(controller) {
        if (!controller.playerOrder) return null;

        const order = controller.playerOrder;
        if (order.action === "MOVE_TO") {
            return {
                action: "MOVE_TO",
                target: order.target,
                priority: 10,
                playerOrdered: true
            };
        }

        return null;
    }

    checkBuildOrder(entityId, gameState) {
        const buildState = gameState.getComponent(entityId, CT.BUILDER);
        if (!buildState || !buildState.assignedBuilding) return null;

        return {
            action: "BUILD",
            target: buildState.assignedBuilding,
            priority: 20,
            data: { buildingId: buildState.assignedBuilding }
        };
    }

    checkMining(entityId, gameState) {
        const team = gameState.getComponent(entityId, CT.TEAM);
        const nearbyMine = this.findNearestMine(entityId, team.team, gameState);

        if (!nearbyMine) return null;

        return {
            action: "MINE",
            target: nearbyMine,
            priority: 5,
            data: { mineId: nearbyMine }
        };
    }

    findNearestMine(entityId, team, gameState) {
        const pos = gameState.getComponent(entityId, CT.POSITION);
        const mines = gameState.goldMineSystem.getTeamMines(team);

        let nearest = null;
        let minDist = Infinity;

        // Sort for determinism
        const sortedMines = Array.from(mines).sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        for (const mineId of sortedMines) {
            const minePos = gameState.getComponent(mineId, CT.POSITION);
            const dist = this.distance(pos, minePos);

            if (dist < minDist) {
                minDist = dist;
                nearest = mineId;
            }
        }

        return nearest;
    }
}
```

### Warrior Behavior Tree
```javascript
class WarriorBehaviorTree extends BehaviorTree {
    evaluate(entityId, gameState) {
        return this.select([
            // 1. Player orders
            () => this.checkPlayerOrder(entityId, gameState),

            // 2. Attack enemies in range
            () => this.checkCombat(entityId, gameState),

            // 3. Move to player-ordered position
            () => this.checkMoveOrder(entityId, gameState),

            // 4. Idle
            () => ({ action: "IDLE", priority: 0 })
        ]);
    }

    checkCombat(entityId, gameState) {
        const pos = gameState.getComponent(entityId, CT.POSITION);
        const combat = gameState.getComponent(entityId, CT.COMBAT);
        const team = gameState.getComponent(entityId, CT.TEAM);

        const enemies = gameState.combatSystem.findEnemiesInRange(
            entityId, pos, combat.visionRange, team
        );

        if (enemies.length === 0) return null;

        // Pick closest enemy (deterministic)
        const target = this.selectTarget(pos, enemies, gameState);

        return {
            action: "ATTACK",
            target: target,
            priority: 30
        };
    }
}
```

---

## 4. BehaviorSystem (Master Controller)

Replaces the scattered AI logic:

```javascript
class BehaviorSystem extends BaseSystem {
    constructor(game) {
        super(game);

        // Register action executors
        this.actions = new Map();
        this.registerAction(new MoveAction());
        this.registerAction(new AttackAction());
        this.registerAction(new MineAction());
        this.registerAction(new BuildAction());
        this.registerAction(new IdleAction());

        // Register behavior trees
        this.behaviorTrees = new Map();
        this.registerBehaviorTree('peasant', new PeasantBehaviorTree());
        this.registerBehaviorTree('footman', new WarriorBehaviorTree());
        this.registerBehaviorTree('archer', new WarriorBehaviorTree());
    }

    update(dt) {
        const CT = this.game.gameManager.call('getComponentTypes');
        const entities = this.game.getEntitiesWith(CT.UNIT_CONTROLLER);

        // Sort for determinism
        entities.sort((a, b) => String(a).localeCompare(String(b)));

        for (const entityId of entities) {
            this.updateUnit(entityId, dt);
        }
    }

    updateUnit(entityId, dt) {
        const CT = this.game.gameManager.call('getComponentTypes');
        const controller = this.game.getComponent(entityId, CT.UNIT_CONTROLLER);
        const unitType = this.game.getComponent(entityId, CT.UNIT_TYPE);

        // Get behavior tree for this unit type
        const tree = this.behaviorTrees.get(unitType.id);
        if (!tree) {
            console.warn(`No behavior tree for unit type: ${unitType.id}`);
            return;
        }

        // Evaluate behaviors (returns desired action)
        const desiredAction = tree.evaluate(entityId, this.game);

        // Check if we need to switch actions
        if (this.shouldSwitchAction(controller, desiredAction)) {
            this.switchAction(entityId, controller, desiredAction);
        }

        // Execute current action
        if (controller.currentAction) {
            this.executeAction(entityId, controller, dt);
        }
    }

    shouldSwitchAction(controller, desiredAction) {
        // No current action, start new one
        if (!controller.currentAction) return true;

        // Different action type
        if (controller.currentAction !== desiredAction.action) {
            // Only switch if higher or equal priority
            return desiredAction.priority >= controller.actionPriority;
        }

        // Same action, different target
        if (controller.actionTarget !== desiredAction.target) {
            return desiredAction.priority >= controller.actionPriority;
        }

        return false;
    }

    switchAction(entityId, controller, desiredAction) {
        // End current action
        if (controller.currentAction) {
            const currentExecutor = this.actions.get(controller.currentAction);
            if (currentExecutor) {
                currentExecutor.onEnd(entityId, controller, this.game);
            }
        }

        // Start new action
        controller.currentAction = desiredAction.action;
        controller.actionTarget = desiredAction.target;
        controller.actionData = desiredAction.data || {};
        controller.actionPriority = desiredAction.priority;
        controller.actionStartTime = this.game.state.now;

        // Call onStart if exists
        const newExecutor = this.actions.get(controller.currentAction);
        if (newExecutor && newExecutor.onStart) {
            newExecutor.onStart(entityId, controller, this.game);
        }
    }

    executeAction(entityId, controller, dt) {
        const executor = this.actions.get(controller.currentAction);
        if (!executor) {
            console.warn(`No executor for action: ${controller.currentAction}`);
            return;
        }

        // Check if action can still run
        if (!executor.canExecute(entityId, controller, this.game)) {
            // Action is no longer valid, clear it
            controller.currentAction = null;
            controller.actionTarget = null;
            return;
        }

        // Execute action
        const result = executor.execute(entityId, controller, this.game, dt);

        // Handle completion
        if (result.complete) {
            executor.onEnd(entityId, controller, this.game);
            controller.currentAction = null;
            controller.actionTarget = null;

            // Clear player order if it was a one-time command
            if (controller.playerOrder && !controller.playerOrder.persistent) {
                controller.playerOrder = null;
            }
        }
    }

    // Public API for issuing commands
    issuePlayerCommand(entityId, action, target, data = {}) {
        const CT = this.game.gameManager.call('getComponentTypes');
        const controller = this.game.getComponent(entityId, CT.UNIT_CONTROLLER);

        controller.playerOrder = {
            action: action,
            target: target,
            data: data,
            issuedTime: this.game.state.now,
            persistent: false  // One-time command
        };
    }
}
```

---

## 5. Example: Mining Behavior

Old way (complex, brittle):
```javascript
// MineGoldAbility - 450+ lines
// - Manual state machine (6 states)
// - Direct AI manipulation
// - Interruption detection
// - Path management
// - Queue management
```

New way (simple, robust):
```javascript
class MineAction extends Action {
    static TYPE = "MINE";
    static PRIORITY = 5;

    canExecute(entityId, controller, game) {
        const mineId = controller.actionTarget;
        const mine = game.goldMineSystem.getMine(mineId);
        return mine && mine.isActive;
    }

    execute(entityId, controller, game, dt) {
        const state = controller.actionData.state || 'traveling_to_mine';

        switch (state) {
            case 'traveling_to_mine':
                return this.travelToMine(entityId, controller, game);
            case 'mining':
                return this.doMining(entityId, controller, game);
            case 'traveling_to_depot':
                return this.travelToDepot(entityId, controller, game);
            case 'depositing':
                return this.doDepositing(entityId, controller, game);
        }
    }

    travelToMine(entityId, controller, game) {
        const pos = game.getComponent(entityId, CT.POSITION);
        const minePos = game.getComponent(controller.actionTarget, CT.POSITION);

        if (this.distance(pos, minePos) < MINING_RANGE) {
            // Check if mine is available
            if (game.goldMineSystem.canMine(controller.actionTarget, entityId)) {
                controller.actionData.state = 'mining';
                controller.actionData.miningStartTime = game.state.now;
                return { complete: false };
            } else {
                // Wait in queue
                return { complete: false };
            }
        }

        // Keep moving
        const vel = game.getComponent(entityId, CT.VELOCITY);
        vel.targetX = minePos.x;
        vel.targetZ = minePos.z;
        return { complete: false };
    }

    doMining(entityId, controller, game) {
        const elapsed = game.state.now - controller.actionData.miningStartTime;

        if (elapsed >= MINING_DURATION) {
            controller.actionData.hasGold = true;
            controller.actionData.state = 'traveling_to_depot';
            game.goldMineSystem.releaseMine(controller.actionTarget, entityId);
            return { complete: false };
        }

        return { complete: false };
    }

    travelToDepot(entityId, controller, game) {
        const pos = game.getComponent(entityId, CT.POSITION);
        const depot = this.findNearestDepot(entityId, game);

        if (!depot) {
            return { complete: true, failed: true };
        }

        const depotPos = game.getComponent(depot, CT.POSITION);

        if (this.distance(pos, depotPos) < DEPOSIT_RANGE) {
            controller.actionData.state = 'depositing';
            controller.actionData.depositStartTime = game.state.now;
            return { complete: false };
        }

        const vel = game.getComponent(entityId, CT.VELOCITY);
        vel.targetX = depotPos.x;
        vel.targetZ = depotPos.z;
        return { complete: false };
    }

    doDepositing(entityId, controller, game) {
        const elapsed = game.state.now - controller.actionData.depositStartTime;

        if (elapsed >= DEPOSIT_DURATION) {
            const team = game.getComponent(entityId, CT.TEAM);
            game.goldSystem.addGold(team.team, GOLD_PER_TRIP);

            // Reset to mine again
            controller.actionData.state = 'traveling_to_mine';
            controller.actionData.hasGold = false;
            return { complete: false };
        }

        return { complete: false };
    }
}
```

---

## 6. Benefits

### ✅ Single Source of Truth
- Only `UnitController.currentAction` determines what unit is doing
- No more checking 5 different components

### ✅ Deterministic
- All actions are pure functions of game state
- Sorted entity iteration
- No random decisions

### ✅ Easy to Debug
```javascript
// See exactly what every unit is doing:
for (const entityId of units) {
    const controller = game.getComponent(entityId, CT.UNIT_CONTROLLER);
    console.log(`${entityId}: ${controller.currentAction} -> ${controller.actionTarget}`);
}
```

### ✅ Network-Friendly
```javascript
// Sync only what matters:
{
    entityId: "unit_123",
    currentAction: "MINE",
    actionTarget: "mine_456",
    actionPriority: 5,
    playerOrder: { action: "MOVE_TO", target: {x: 100, z: 200} }
}
```

### ✅ Composable
```javascript
// Add new unit type:
class MageBehaviorTree extends BehaviorTree {
    evaluate(entityId, game) {
        return this.select([
            () => this.checkPlayerOrder(entityId, game),
            () => this.checkCastSpell(entityId, game),  // New!
            () => this.checkCombat(entityId, game),
            () => this.checkMoveOrder(entityId, game),
            () => ({ action: "IDLE", priority: 0 })
        ]);
    }
}

// Register it:
behaviorSystem.registerBehaviorTree('mage', new MageBehaviorTree());
```

### ✅ Testable
```javascript
test('peasant mines when idle', () => {
    const game = createMockGame();
    const peasantId = createPeasant(game);
    const mineId = createGoldMine(game);

    const tree = new PeasantBehaviorTree();
    const action = tree.evaluate(peasantId, game);

    expect(action.action).toBe('MINE');
    expect(action.target).toBe(mineId);
});
```

---

## 7. Migration Path

### Phase 1: Add New System (Parallel)
1. Create `UnitController` component
2. Create `BehaviorSystem`
3. Implement basic actions (IDLE, MOVE_TO)
4. Add simple behavior tree (just idle/move)

### Phase 2: Migrate Combat
1. Create `AttackAction`
2. Update `WarriorBehaviorTree`
3. Remove combat logic from `CombatAISystem`
4. Keep old system as fallback

### Phase 3: Migrate Economy
1. Create `MineAction`, `BuildAction`
2. Update `PeasantBehaviorTree`
3. Remove `MineGoldAbility`, `BuildAbility`

### Phase 4: Remove Old Systems
1. Remove `CommandQueueSystem`
2. Remove ability-specific components
3. Clean up old AI manipulation code

---

## 8. Example Usage

### Player Issues Move Command
```javascript
// User clicks ground
unitOrderSystem.issueMoveOrder(selectedUnits, targetPosition);

// Internally:
behaviorSystem.issuePlayerCommand(unitId, "MOVE_TO", targetPosition);

// Next frame:
// 1. BehaviorTree evaluates
// 2. Sees playerOrder
// 3. Returns { action: "MOVE_TO", priority: 10, playerOrdered: true }
// 4. BehaviorSystem switches to MoveAction
// 5. MoveAction executes until arrival
// 6. playerOrder cleared
```

### Combat Automatically Starts
```javascript
// During update:
// 1. WarriorBehaviorTree evaluates
// 2. Finds enemies in range
// 3. Returns { action: "ATTACK", priority: 30, target: enemyId }
// 4. Priority 30 > 10, interrupts MOVE_TO
// 5. AttackAction starts
// 6. When enemy dies:
//    - AttackAction.canExecute() returns false
//    - Action cleared
//    - Next frame: tree sees playerOrder still exists
//    - Resumes MOVE_TO
```

### Peasant Auto-Mines
```javascript
// During update:
// 1. PeasantBehaviorTree evaluates
// 2. No player order, no build order
// 3. Finds nearby mine
// 4. Returns { action: "MINE", priority: 5 }
// 5. MineAction starts
// 6. Loops: mine -> deposit -> mine -> deposit
// 7. If player issues move command:
//    - Priority 10 > 5
//    - Mining interrupted
//    - After move completes, auto-resumes mining
```

---

## Conclusion

This architecture:
- ✅ Single source of truth (`UnitController`)
- ✅ Deterministic (sorted iteration, pure functions)
- ✅ Declarative (behavior trees express goals)
- ✅ Composable (easy to add units/actions)
- ✅ Testable (behavior trees are pure logic)
- ✅ Network-friendly (minimal state)
- ✅ Debuggable (clear action flow)

The key insight: **Don't tell units HOW to do things, tell them WHAT to do and let the action executors handle the how.**
