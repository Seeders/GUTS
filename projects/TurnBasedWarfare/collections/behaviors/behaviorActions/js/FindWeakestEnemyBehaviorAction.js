/**
 * FindWeakestEnemyBehaviorAction - Targeting action
 * Finds the enemy with lowest health and stores it in shared state
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Search range
 *   targetKey: string (default: 'target') - Key to store target in shared state
 *   usePercentage: boolean (default: true) - Sort by health percentage vs absolute
 *   maxHealthPercent: number (default: 1.0) - Only target enemies below this health %
 *
 * Returns SUCCESS if enemy found, FAILURE otherwise
 */
class FindWeakestEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const usePercentage = params.usePercentage !== false;
        const maxHealthPercent = params.maxHealthPercent !== undefined ? params.maxHealthPercent : 1.0;

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team) {
            return this.failure();
        }

        const range = params.range !== undefined ? params.range : (combat?.visionRange || 300);

        const weakestEnemy = this.findWeakestEnemy(entityId, game, pos, team, range, usePercentage, maxHealthPercent);

        if (weakestEnemy) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = weakestEnemy.id;

            return this.success({
                target: weakestEnemy.id,
                distance: weakestEnemy.distance,
                healthPercent: weakestEnemy.healthPercent,
                range
            });
        }

        return this.failure();
    }

    findWeakestEnemy(entityId, game, pos, team, range, usePercentage, maxHealthPercent) {
        // Use spatial grid for efficient lookup - returns array of entityIds
        const nearbyEntityIds = game.call('getNearbyUnits', pos, range, entityId);
        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return null;

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitType = game.call('getUnitTypeDef', unitTypeComp);
        const hasLOSCheck = game.hasService('hasLineOfSight');

        // Get searcher's awareness for stealth check
        const searcherCombat = game.getComponent(entityId, 'combat');
        const awareness = searcherCombat?.awareness ?? 50;

        // First pass: collect valid enemies with positions and health
        const enemies = [];
        for (const targetId of nearbyEntityIds) {
            const targetTeam = game.getComponent(targetId, 'team');
            if (!targetTeam || targetTeam.team === team.team) continue;

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) continue;

            const targetDeathState = game.getComponent(targetId, 'deathState');
            const enums = game.call('getEnums');
            if (targetDeathState && targetDeathState.state !== enums?.deathState?.alive) continue;

            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            if (!targetPos) continue;

            // Stealth check: skip targets with stealth > searcher's awareness
            const targetCombat = game.getComponent(targetId, 'combat');
            let targetStealth = targetCombat?.stealth ?? 0;

            // Apply terrain stealth bonus
            const terrainTypeIndex = game.call('getTerrainTypeAtPosition', targetPos.x, targetPos.z);
            if (terrainTypeIndex !== null && terrainTypeIndex !== undefined) {
                const terrainType = game.call('getTileMapTerrainType', terrainTypeIndex);
                if (terrainType?.stealthBonus) {
                    targetStealth += terrainType.stealthBonus;
                }
            }

            // Apply hiding stealth bonus (+20)
            const targetPlayerOrder = game.getComponent(targetId, 'playerOrder');
            if (targetPlayerOrder?.isHiding) {
                targetStealth += 20;
            }

            if (targetStealth > awareness) continue;

            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            const healthPercent = targetHealth.current / targetHealth.max;
            if (healthPercent > maxHealthPercent) continue;

            enemies.push({
                id: targetId,
                pos: targetPos,
                distance,
                dx,
                dz,
                healthPercent,
                healthCurrent: targetHealth.current
            });
        }

        if (enemies.length === 0) return null;

        // If no LOS check available, just sort and return weakest
        if (!hasLOSCheck) {
            enemies.sort((a, b) => {
                const healthDiff = usePercentage
                    ? a.healthPercent - b.healthPercent
                    : a.healthCurrent - b.healthCurrent;
                if (Math.abs(healthDiff) > 0.01) return healthDiff;
                return a.distance - b.distance;
            });
            return enemies[0];
        }

        // Second pass: group enemies by direction sector, raycast once per direction
        const NUM_SECTORS = 16;
        const sectorAngle = (Math.PI * 2) / NUM_SECTORS;

        const sectors = new Array(NUM_SECTORS);
        for (let i = 0; i < NUM_SECTORS; i++) {
            sectors[i] = { enemies: [], maxDistance: 0, raycastDone: false, visibleDistance: 0 };
        }

        for (const enemy of enemies) {
            const angle = Math.atan2(enemy.dz, enemy.dx);
            const normalizedAngle = angle < 0 ? angle + Math.PI * 2 : angle;
            const sectorIndex = Math.floor(normalizedAngle / sectorAngle) % NUM_SECTORS;

            sectors[sectorIndex].enemies.push(enemy);
            if (enemy.distance > sectors[sectorIndex].maxDistance) {
                sectors[sectorIndex].maxDistance = enemy.distance;
            }
        }

        // Raycast only for sectors that have enemies
        for (let i = 0; i < NUM_SECTORS; i++) {
            const sector = sectors[i];
            if (sector.enemies.length === 0) continue;

            const sectorCenterAngle = (i + 0.5) * sectorAngle;
            const dirX = Math.cos(sectorCenterAngle);
            const dirZ = Math.sin(sectorCenterAngle);
            const rayDist = sector.maxDistance;

            const targetX = pos.x + dirX * rayDist;
            const targetZ = pos.z + dirZ * rayDist;

            const hasLOS = game.call('hasLineOfSight',
                { x: pos.x, z: pos.z },
                { x: targetX, z: targetZ },
                unitType,
                entityId
            );

            if (hasLOS) {
                sector.visibleDistance = rayDist;
            } else {
                let minDist = 0;
                let maxDist = rayDist;
                for (let iter = 0; iter < 4; iter++) {
                    const midDist = (minDist + maxDist) / 2;
                    const midX = pos.x + dirX * midDist;
                    const midZ = pos.z + dirZ * midDist;
                    if (game.call('hasLineOfSight',
                        { x: pos.x, z: pos.z },
                        { x: midX, z: midZ },
                        unitType,
                        entityId
                    )) {
                        minDist = midDist;
                    } else {
                        maxDist = midDist;
                    }
                }
                sector.visibleDistance = minDist;
            }
            sector.raycastDone = true;
        }

        // Third pass: collect visible enemies and sort by health
        const visibleEnemies = [];
        for (let i = 0; i < NUM_SECTORS; i++) {
            const sector = sectors[i];
            if (!sector.raycastDone) continue;

            for (const enemy of sector.enemies) {
                if (enemy.distance <= sector.visibleDistance) {
                    visibleEnemies.push(enemy);
                }
            }
        }

        if (visibleEnemies.length === 0) return null;

        visibleEnemies.sort((a, b) => {
            const healthDiff = usePercentage
                ? a.healthPercent - b.healthPercent
                : a.healthCurrent - b.healthCurrent;
            if (Math.abs(healthDiff) > 0.01) return healthDiff;
            return a.distance - b.distance;
        });

        return visibleEnemies[0];
    }
}
