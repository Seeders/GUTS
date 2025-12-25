/**
 * IsEnemyNearbyBehaviorAction - Condition action
 * Checks if there are enemies within range
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Detection range
 *   minCount: number (default: 1) - Minimum enemies required
 *   storeNearest: boolean (default: false) - Store nearest enemy in shared state
 *   targetKey: string (default: 'target') - Key for storing nearest enemy
 *
 * Returns SUCCESS if enemies found, FAILURE otherwise
 */
class IsEnemyNearbyBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const minCount = params.minCount || 1;
        const storeNearest = params.storeNearest || false;
        const targetKey = params.targetKey || 'target';

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.call('getUnitTypeDef', unitTypeComp);
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[team?.team] || team?.team;
        const unitName = unitDef?.id || 'unknown';

        if (!pos || !team) {
            log.trace('IsEnemyNearby', `${unitName}(${entityId}) [${teamName}] FAILURE - missing pos or team`);
            return this.failure();
        }

        const range = combat.visionRange;

        const enemies = this.findEnemiesInRange(entityId, game, pos, team, range, log, unitName, teamName);

        if (enemies.length >= minCount) {
            const result = {
                enemyCount: enemies.length,
                range
            };

            if (storeNearest && enemies.length > 0) {
                const shared = this.getShared(entityId, game);
                shared[targetKey] = enemies[0].id;
                result.nearestEnemy = enemies[0].id;
                result.nearestDistance = enemies[0].distance;
            }

            log.trace('IsEnemyNearby', `${unitName}(${entityId}) [${teamName}] SUCCESS - ${enemies.length} enemies found`, {
                range,
                enemyCount: enemies.length,
                nearest: enemies[0]?.id
            });

            return this.success(result);
        }

        log.trace('IsEnemyNearby', `${unitName}(${entityId}) [${teamName}] FAILURE - not enough enemies`, {
            range,
            found: enemies.length,
            required: minCount
        });

        return this.failure();
    }

    findEnemiesInRange(entityId, game, pos, team, range, log, unitName, teamName) {
        // Use spatial grid for efficient lookup - returns array of entityIds
        const nearbyEntityIds = game.call('getNearbyUnits', pos, range, entityId);

        log.trace('IsEnemyNearby', `${unitName}(${entityId}) [${teamName}] getNearbyUnits returned ${nearbyEntityIds?.length || 0} entities`);

        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return [];

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitType = game.call('getUnitTypeDef', unitTypeComp);
        const hasLOSCheck = game.hasService('hasLineOfSight');

        // Get searcher's awareness for stealth check
        const searcherCombat = game.getComponent(entityId, 'combat');
        const awareness = searcherCombat?.awareness ?? 50;

        // First pass: collect valid enemies with positions
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

            if (targetStealth > awareness) {
                log.trace('IsEnemyNearby', `${unitName}(${entityId}) [${teamName}] SKIP target ${targetId} - stealthed`, {
                    targetStealth,
                    awareness
                });
                continue;
            }

            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            enemies.push({ id: targetId, pos: targetPos, distance, dx, dz });
        }

        if (enemies.length === 0) return [];

        // If no LOS check available, just sort and return
        if (!hasLOSCheck) {
            enemies.sort((a, b) => a.distance - b.distance);
            return enemies;
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

        // Third pass: collect visible enemies
        const visibleEnemies = [];
        for (let i = 0; i < NUM_SECTORS; i++) {
            const sector = sectors[i];
            if (!sector.raycastDone) continue;

            for (const enemy of sector.enemies) {
                if (enemy.distance <= sector.visibleDistance) {
                    visibleEnemies.push({ id: enemy.id, distance: enemy.distance });
                }
            }
        }

        // Sort by distance
        visibleEnemies.sort((a, b) => a.distance - b.distance);

        return visibleEnemies;
    }
}
