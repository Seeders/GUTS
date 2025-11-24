class MoveBehaviorAction extends GUTS.BaseBehaviorAction {
    static TYPE = "MOVE_TO";
    static PRIORITY = 10;

    canExecute(entityId, controller, game) {
        const pos = game.getComponent(entityId, 'position');
        const target = controller.actionData?.targetPos;
        if (!pos || !target) return false;

        const dist = this.distance(pos, target);
        return dist > this.parameters.arrivalThreshold;
    }

    execute(entityId, controller, game, dt) {
        const pos = game.getComponent(entityId, 'position');
        const target = controller.actionData?.targetPos;

        if (!target) return { complete: true, failed: true };

        // Check completion
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance <= this.parameters.arrivalThreshold) {
            return { complete: true };
        }

        // MovementSystem will handle movement to target
        return { complete: false };
    }

    onEnd(entityId, controller, game) {
        // MovementSystem will stop movement when no target
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
