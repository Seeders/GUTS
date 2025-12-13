/**
 * FindAllyNeedingHelpBehaviorAction - Targeting action
 * Finds an allied unit that needs help (low health or in combat)
 *
 * Parameters:
 *   range: number (default: 500) - Search range
 *   targetKey: string (default: 'allyTarget') - Key to store target in shared state
 *   healthThreshold: number (default: 0.7) - Health % below which ally needs help
 *   prioritizeLowestHealth: boolean (default: true) - Target lowest health ally
 *   excludeSelf: boolean (default: true) - Don't target self
 *
 * Returns SUCCESS if ally needing help found, FAILURE otherwise
 */
class FindAllyNeedingHelpBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'allyTarget';
        const healthThreshold = params.healthThreshold !== undefined ? params.healthThreshold : 0.7;
        const prioritizeLowestHealth = params.prioritizeLowestHealth !== false;
        const excludeSelf = params.excludeSelf !== false;
        const range = params.range !== undefined ? params.range : 500;

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');

        if (!pos || !team) {
            return this.failure();
        }

        const ally = this.findAllyNeedingHelp(entityId, game, pos, team, range, healthThreshold, prioritizeLowestHealth, excludeSelf);

        if (ally) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = ally.id;

            return this.success({
                allyTarget: ally.id,
                distance: ally.distance,
                healthPercent: ally.healthPercent,
                inCombat: ally.inCombat
            });
        }

        return this.failure();
    }

    findAllyNeedingHelp(entityId, game, pos, team, range, healthThreshold, prioritizeLowestHealth, excludeSelf) {
        // Use spatial grid for efficient lookup - returns array of entityIds
        const excludeId = excludeSelf ? entityId : null;
        const nearbyEntityIds = game.call('getNearbyUnits', pos, range, excludeId);
        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return null;

        const alliesNeedingHelp = [];

        for (const allyId of nearbyEntityIds) {
            const allyTeam = game.getComponent(allyId, 'team');
            if (!allyTeam || allyTeam.team !== team.team) continue;

            const allyHealth = game.getComponent(allyId, 'health');
            if (!allyHealth || allyHealth.current <= 0) continue;

            const allyDeathState = game.getComponent(allyId, 'deathState');
            const enums = game.call('getEnums');
            if (allyDeathState && allyDeathState.state !== enums?.deathState?.alive) continue;

            const allyTransform = game.getComponent(allyId, 'transform');
            const allyPos = allyTransform?.position;
            if (!allyPos) continue;

            const dx = allyPos.x - pos.x;
            const dz = allyPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            const healthPercent = allyHealth.current / allyHealth.max;

            // Check if ally needs help
            const needsHelp = healthPercent < healthThreshold;
            const inCombat = this.isInCombat(allyId, game);

            if (needsHelp || inCombat) {
                alliesNeedingHelp.push({
                    id: allyId,
                    distance,
                    healthPercent,
                    inCombat,
                    needsHelp
                });
            }
        }

        if (alliesNeedingHelp.length === 0) return null;

        // Sort by priority
        alliesNeedingHelp.sort((a, b) => {
            // Prioritize low health allies
            if (prioritizeLowestHealth) {
                const healthDiff = a.healthPercent - b.healthPercent;
                if (Math.abs(healthDiff) > 0.1) return healthDiff;
            }
            // Then by combat status
            if (a.inCombat !== b.inCombat) return a.inCombat ? -1 : 1;
            // Then by distance
            return a.distance - b.distance;
        });

        return alliesNeedingHelp[0];
    }

    isInCombat(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const enums = game.call('getEnums');
        if (aiState && aiState.currentAction >= 0 &&
            aiState.currentActionCollection === enums.behaviorCollection.behaviorActions &&
            aiState.currentAction === enums.behaviorActions.CombatBehaviorAction) {
            return true;
        }
        return false;
    }

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
