# Combat kit

Damage with armor, resistances and status effects, accuracy, stat aggregation, projectiles, death and corpses, health bars, floating damage numbers, and timed lifetimes for summons and effects.

**Requires kits:** [ai](../ai/README.md), [units](../units/README.md)

## Systems

| System | Services it provides |
|---|---|
| `AccuracySystem` | `rollHitChance`, `calculateHitChance`, `rollBlock`, `rollCritical` |
| `DamageNumberSystem` | `showDamageNumber` |
| `DamageSystem` | `applyDamage`, `applySplashDamage`, `scheduleDamage`, `curePoison`, `getPoisonStacks`, `clearAllDamageEffects`, `clearAllStatusEffects`, `getAttackerModifiers`, `getBuffTypeDef`, `buildDamageTags` |
| `DeathSystem` | `startDeathProcess` |
| `HealthBarSystem` | none |
| `LifetimeSystem` | `addLifetime`, `destroyEntityImmediately`, `extendLifetime` |
| `ProjectileSystem` | `deleteProjectileTrail`, `fireProjectile` |
| `StatAggregationSystem` | `getAggregatedDamageModifiers`, `getAggregatedSpeedModifiers`, `getAggregatedCritModifiers`, `getEffectiveAttackSpeed`, `getAggregatedDefensiveStats`, `invalidateModifierCache` |

## What your game supplies

**Components.** This kit ships reference schemas for `combat`, `combatState`, `heroRosterInfo`, `homingTarget`, `lifetime`, `mindControlled`, `mirrorImage`, `neutralMonster`, `poison`, `projectile`, `statusEffect`, `summoned`, `temporaryEffect`, `trap`. A project that lists its kits in game.json gets the schemas of the core and of those kits, except where it has its own file of the same name (yours wins). Its systems use these, which the core or this kit's required kits provide: `aiState`, `animation`, `deathState`, `health`, `renderable`, `team`, `transform`, `unitType`, `velocity`. They also read `projectileVisual` when an entity has them; define those yourself if you use the feature.

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

`breakCloak`, `dropLoot`, `getActivePlayerTeam`, `getPlayerStatsByTeam`, `grantCombatExperience`

**Optional kits.** It also calls `isVisibleInFogAt` from `rts` when present.

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["combat"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/AccuracySystem.js` (a project file with the same name as an engine file replaces it):

```js
import Base from '@global/scripts/systems/js/AccuracySystem.js';

class AccuracySystem extends Base {
    // override what you need
}
```
