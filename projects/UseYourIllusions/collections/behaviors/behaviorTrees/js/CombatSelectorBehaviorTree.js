/**
 * CombatSelectorBehaviorTree - Pure combat selector logic
 *
 * This is the selector that tries combat actions in order:
 * 1. AttackSequence - Attack if target in range
 * 2. ChaseSequence - Chase target if out of range
 * 3. InvestigateSequence - Investigate attacker
 * 4. FindNearestEnemy - Find a new target
 */
class CombatSelectorBehaviorTree extends GUTS.BaseBehaviorTree {

    evaluate(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitTypeDef = game.call('getUnitTypeDef', unitTypeComp);
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;
        const unitName = unitTypeDef?.id || 'unknown';

        // Check if player order prevents combat
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (playerOrder?.meta?.preventCombat) {
            log.trace('CombatSelector', `${unitName}(${entityId}) [${teamName}] SKIP - combat prevented by player order`);
            this.runningState.delete(entityId);
            return null;
        }

        const combat = game.getComponent(entityId, 'combat');
        const health = game.getComponent(entityId, 'health');
        const placement = game.getComponent(entityId, 'placement');

        // Skip if building is under construction
        if (placement?.isUnderConstruction) {
            log.trace('CombatSelector', `${unitName}(${entityId}) [${teamName}] SKIP - building under construction`);
            this.runningState.delete(entityId);
            return null;
        }

        // Skip if unit can't fight
        if (!combat || !health || health.current <= 0) {
            log.trace('CombatSelector', `${unitName}(${entityId}) [${teamName}] SKIP - no combat/health or dead`, {
                hasCombat: !!combat,
                hasHealth: !!health,
                currentHealth: health?.current
            });
            this.runningState.delete(entityId);
            return null;
        }

        // Skip non-combat units (peasants mining, etc.)
        if (combat.damage === 0 && (!unitTypeDef?.abilities || unitTypeDef.abilities.length === 0)) {
            log.trace('CombatSelector', `${unitName}(${entityId}) [${teamName}] SKIP - non-combat unit (damage=0, no abilities)`);
            this.runningState.delete(entityId);
            return null;
        }

        // Get shared state for target info
        const shared = game.call('getBehaviorShared', entityId);
        log.debug('CombatSelector', `${unitName}(${entityId}) [${teamName}] evaluating combat`, {
            target: shared?.target,
            damage: combat.damage,
            range: combat.range,
            attackSpeed: combat.attackSpeed,
            visionRange: combat.visionRange,
            hasProjectile: combat.projectile !== null && combat.projectile !== -1 && combat.projectile !== undefined,
            projectileIndex: combat.projectile
        });

        // Use base class evaluate which handles the selector pattern
        const result = super.evaluate(entityId, game);

        log.debug('CombatSelector', `${unitName}(${entityId}) [${teamName}] result`, {
            action: result?.action,
            status: result?.status
        });

        return result;
    }
}
