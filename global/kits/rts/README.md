# RTS kit

Real-time strategy layer: squad orders and their UI, building placement previews, fog of war, the minimap, match statistics, cheat codes, and the headless skirmish runner for AI-vs-AI simulations.

**Requires kits:** [units](../units/README.md)

## Systems

| System | Services it provides |
|---|---|
| `BaseNetworkSystem` | `broadcastToRoom`, `replaceUnit` |
| `CheatCodeSystem` | `executeCheat`, `validateCheat`, `listCheats`, `cheat`, `cheats` |
| `FogOfWarSystem` | `getExplorationTexture`, `getFogTexture`, `invalidateLOSCache`, `isVisibleInFogAt` |
| `InputSystem` | none |
| `MiniMapSystem` | none |
| `PlacementPreviewSystem` | `showPreviewAtWorldPositions`, `showPreviewMultiplePositionSets`, `showPreviewAtGridPositions`, `showPreviewWithUnitMarkers`, `hidePreview`, `clearPreview`, `updatePreviewConfig` |
| `StatisticsTrackingSystem` | none |
| `UnitOrderSystem` | `applySquadTargetPosition`, `applySquadsTargetPositions`, `applyUnitTargetPosition` |
| `UnitOrderUISystem` | none |

## Libraries

`HeadlessSkirmishRunner`

## What your game supplies

**Components.** These systems read or write these components, so your game defines their schemas in `collections/data/components`:

`aiHeuristicState`, `aiOpponent`, `aiState`, `buildingState`, `construction`, `health`, `pathfinding`, `placement`, `playerOrder`, `projectile`, `team`, `transform`, `unitType`, `velocity`

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

`addPlayerGold`, `broadcastGameEnd`, `canAffordCost`, `canAffordLevelUp`, `exitToMenu`, `getActivePlayerTeam`, `getEntityAbilities`, `getGoldVeinLocations`, `getLevelUpCost`, `getPlacementById`, `getPlayerGold`, `getPlayerStats`, `getSelectedSquads`, `getWorldPositionFromMouse`, `handleUnitSelectionChange`, `leaveGame`, `levelSquad`, `placePlacement`, `restartGame`, `resumeGame`, `selectEntity`, `sendCheatRequest`, `showGameModeSelect`, `showMainMenu`, `ui_assignBuilder`, `ui_handleCanvasClick`, `ui_hide`, `ui_holdPosition`, `ui_issueHideOrder`, `ui_issueMoveOrder`, `ui_transformUnit`

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["rts"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/NetworkSystem.js`:

```js
import Base from '@global/scripts/systems/js/BaseNetworkSystem.js';

class NetworkSystem extends Base {
    // override what you need
}
```
