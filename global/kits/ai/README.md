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

**Components.** This kit ships reference schemas for `aiState`, `behaviorState`. A project that lists its kits in game.json gets the schemas of the core and of those kits, except where it has its own file of the same name (yours wins). Its systems use these, which the core or this kit's required kits provide: `deathState`, `team`, `unitType`. They also read `aiHeuristicState`, `aiOpponent`, `leaping` when an entity has them; define those yourself if you use the feature.

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
