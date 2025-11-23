class AttackAction extends GUTS.BaseAction {
    static TYPE = "ATTACK";
    static PRIORITY = 30;

    canExecute(entityId, controller, game) {
        const targetId = controller.actionTarget;
        if (!targetId) return false;

        const targetHealth = game.getComponent(targetId, game.componentTypes.HEALTH);
        const targetDeathState = game.getComponent(targetId, game.componentTypes.DEATH_STATE);

        if (!targetHealth || targetHealth.current <= 0) return false;
        if (targetDeathState && targetDeathState.isDying) return false;

        return true;
    }

    execute(entityId, controller, game, dt) {
        const combat = game.getComponent(entityId, game.componentTypes.COMBAT);
        const targetId = controller.actionTarget;

        // Check if in range
        if (!game.combatAISystem.isInAttackRange(entityId, targetId, combat)) {
            // Move closer
            const targetPos = game.getComponent(targetId, game.componentTypes.POSITION);
            const vel = game.getComponent(entityId, game.componentTypes.VELOCITY);
            vel.targetX = targetPos.x;
            vel.targetZ = targetPos.z;
            return { complete: false };
        }

        // In range, attack handled by CombatAISystem
        return { complete: false };
    }

    onEnd(entityId, controller, game) {
        const vel = game.getComponent(entityId, game.componentTypes.VELOCITY);
        vel.targetX = null;
        vel.targetZ = null;
    }
}
