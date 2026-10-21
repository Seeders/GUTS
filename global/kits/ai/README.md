# AI kit

Behavior trees: the tree/node/processor classes, a blackboard, the debugger and editor, and BaseBehaviorSystem, which runs each unit's tree every tick.

**Requires kits:** none (core only)

## Systems

| System | Services it provides |
|---|---|
| `BaseBehaviorSystem` | `getBehaviorMeta`, `getBehaviorShared`, `setBehaviorMeta`, `clearBehaviorState`, `getBehaviorNodeId`, `getNodeByType`, `getDebugger` |

## Libraries

`BaseBehaviorNode`, `BaseBehaviorTree`, `BehaviorTreeBlackboard`, `BehaviorTreeDebugger`, `BehaviorTreeEditor`, `BehaviorTreeProcessor`

## What your game supplies

**Components.** These systems read or write these components, so your game defines their schemas in `collections/data/components` (this kit ships `behaviorState` as a reference):

`aiHeuristicState`, `aiOpponent`, `aiState`, `behaviorState`, `deathState`, `leaping`, `team`, `unitType`

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

`serviceName`

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["ai"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/BehaviorSystem.js`:

```js
import Base from '@global/scripts/systems/js/BaseBehaviorSystem.js';

class BehaviorSystem extends Base {
    // override what you need
}
```
