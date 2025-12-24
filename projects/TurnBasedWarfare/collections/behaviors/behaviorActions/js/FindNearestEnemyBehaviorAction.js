/**
 * FindNearestEnemyBehaviorAction - Targeting action
 * Finds the nearest enemy and stores it in shared state
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Search range
 *   targetKey: string (default: 'target') - Key to store target in shared state
 *
 * Returns SUCCESS if enemy found, FAILURE otherwise
 */
class FindNearestEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team) {
            return this.failure();
        }

        // Use unit's visionRange first, then fall back to params.range or default 300
        const range = combat?.visionRange || params.range || 300;

        const nearestEnemy = this.findNearestEnemy(entityId, game, pos, team, range);

        // Debug logging
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.call('getUnitTypeDef', unitTypeComp);
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[team.team] || team.team;

        if (nearestEnemy) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = nearestEnemy.id;

            if (unitDef?.id === '1_d_archer' || unitDef?.id === '1_di_scout') {
                console.log(`[FindNearestEnemy] ${unitDef?.id} (${teamName}) found enemy ${nearestEnemy.id} at distance ${nearestEnemy.distance.toFixed(0)}`);
            }

            return this.success({
                target: nearestEnemy.id,
                distance: nearestEnemy.distance,
                range
            });
        }

        if (unitDef?.id === '1_d_archer' || unitDef?.id === '1_di_scout') {
            console.log(`[FindNearestEnemy] ${unitDef?.id} (${teamName}) found no enemy in range ${range}`);
        }
        return this.failure();
    }

    findNearestEnemy(entityId, game, pos, team, range) {
        // Use spatial grid for efficient lookup - returns array of entityIds
        const nearbyEntityIds = game.call('getNearbyUnits', pos, range, entityId);

        // Debug: Log what getNearbyUnits returns for scout and archer
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.call('getUnitTypeDef', unitTypeComp);
        const reverseEnums = game.getReverseEnums();
        if (unitDef?.id === '1_di_scout' || unitDef?.id === '1_d_archer') {
            // Also show what entities are nearby
            const nearbyInfo = nearbyEntityIds?.map(id => {
                const utype = game.getComponent(id, 'unitType');
                const udef = game.call('getUnitTypeDef', utype);
                const uteam = game.getComponent(id, 'team');
                const teamStr = reverseEnums.team?.[uteam?.team] || uteam?.team;
                return `${id}:${udef?.id}(${teamStr})`;
            });
            console.log(`[FindNearestEnemy DEBUG] ${unitDef.id} at (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}) range=${range} nearby: [${nearbyInfo?.join(', ') || 'none'}]`);
        }

        if (!nearbyEntityIds || nearbyEntityIds.length === 0) {
            return null;
        }

        const unitType = game.call('getUnitTypeDef', unitTypeComp);
        const hasLOSCheck = game.hasService('hasLineOfSight');

        // First pass: collect valid enemies with their positions and directions
        const enemies = [];

        const teamName = reverseEnums.team?.[team.team] || team.team;
        for (const targetId of nearbyEntityIds) {
            const targetTeam = game.getComponent(targetId, 'team');

            // Debug: log team comparison for archers
            if (unitDef?.id === '1_d_archer') {
                const targetUnitType = game.getComponent(targetId, 'unitType');
                const targetUnitDef = game.call('getUnitTypeDef', targetUnitType);
                console.log(`[FindNearestEnemy] ${unitDef.id} (${teamName}) checking target ${targetId}: targetTeam=${targetTeam?.team}, myTeam=${team.team}, targetType=${targetUnitDef?.id}`);
            }

            if (!targetTeam || targetTeam.team === team.team) {
                continue;
            }

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) {
                if (unitDef?.id === '1_d_archer') {
                    console.log(`[FindNearestEnemy] ${unitDef.id} (${teamName}) target ${targetId} SKIP - health ${targetHealth?.current}/${targetHealth?.max}`);
                }
                continue;
            }

            const targetDeathState = game.getComponent(targetId, 'deathState');
            // deathState.state: 0=alive, 1=dying, 2=corpse
            if (targetDeathState && targetDeathState.state > 0) {
                if (unitDef?.id === '1_d_archer') {
                    console.log(`[FindNearestEnemy] ${unitDef.id} (${teamName}) target ${targetId} SKIP - deathState ${targetDeathState.state}`);
                }
                continue;
            }

            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            if (!targetPos) {
                continue;
            }

            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            enemies.push({ id: targetId, pos: targetPos, distance, dx, dz });
        }

        if (enemies.length === 0) {
            return null;
        }

        // If no LOS check available, just return nearest
        if (!hasLOSCheck) {
            enemies.sort((a, b) => a.distance - b.distance);
            return { id: enemies[0].id, distance: enemies[0].distance };
        }

        // Second pass: group enemies by direction sector, raycast once per direction
        const NUM_SECTORS = 16;
        const sectorAngle = (Math.PI * 2) / NUM_SECTORS;

        // Group enemies by sector
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

            // Raycast in this sector's direction to the max enemy distance
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
                // Full visibility to max distance
                sector.visibleDistance = rayDist;
            } else {
                // Binary search to find visible distance (4 iterations)
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

        // Third pass: find nearest visible enemy
        let nearest = null;
        let nearestDistance = Infinity;

        for (let i = 0; i < NUM_SECTORS; i++) {
            const sector = sectors[i];
            if (!sector.raycastDone) continue;

            for (const enemy of sector.enemies) {
                if (enemy.distance <= sector.visibleDistance && enemy.distance < nearestDistance) {
                    nearestDistance = enemy.distance;
                    nearest = { id: enemy.id, distance: enemy.distance };
                }
            }
        }

        return nearest;
    }
}
