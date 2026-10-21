# Units kit

Units on a grid map: the spatial grid (getNearbyUnits), A* pathfinding, steering movement with separation and path following, unit creation from prefabs, collision radii, and team vision.

**Requires kits:** [ai](../ai/README.md)

## Systems

| System | Services it provides |
|---|---|
| `BaseMovementSystem` | none |
| `GridSystem` | `getNearbyUnits`, `isValidGridPlacement`, `reserveGridCells`, `releaseGridCells`, `getUnitGridCells`, `toggleSpatialGridDebug`, `getGridSize`, `getPlacementGridSize`, `placementGridToWorld`, `worldToPlacementGrid`, `tileToWorld`, `worldToTile`, `tileToWorldCorner`, `applyQuadrantOffset`, `tileToPixel`, `pixelToTile`, `pixelToWorld`, `worldToPixel`, `isValidTile`, `isValidWorldPosition`, `updateCoordinateConfig` |
| `PathfindingSystem` | `isPositionWalkable`, `isGridPositionWalkable`, `requestPath`, `hasRampAt`, `hasDirectWalkablePath`, `togglePathfindingDebug`, `getEntityPath`, `setEntityPath`, `clearEntityPath`, `getRampPositions` |
| `UnitCreationSystem` | `createPlacement`, `createUnit`, `createEntityFromPrefab`, `getTerrainHeight`, `incrementSquadsCreated` |
| `UnitRadiusSystem` | none |
| `VisionSystem` | `hasLineOfSight`, `canSeePosition`, `getVisibleEnemiesInRange`, `findNearestVisibleEnemy`, `findWeakestVisibleEnemy`, `isEntityVisibleToTeam`, `isVisibleAt` |

## Libraries

`MinHeap`

## What your game supplies

**Components.** This kit ships reference schemas for `collision`, `leaping`, `movementState`, `pathfinding`, `placement`, `playerOrder`. A project that lists its kits in game.json gets the schemas of the core and of those kits, except where it has its own file of the same name (yours wins). Its systems use these, which the core or this kit's required kits provide: `aiState`, `deathState`, `health`, `renderable`, `team`, `terrain`, `transform`, `unitType`, `velocity`. They also read `combat`, `illusion`, `projectile` when an entity has them; define those yourself if you use the feature.

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

`addAbilitiesToUnit`, `equipItem`, `getSquadCells`, `getSquadData`, `getSquadInfoFromType`, `invalidateSupplyCache`, `isValidGridPosition`, `removeSquadExperience`, `validateSquadConfig`

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["units"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/MovementSystem.js`:

```js
import Base from '@global/scripts/systems/js/BaseMovementSystem.js';

class MovementSystem extends Base {
    // override what you need
}
```
