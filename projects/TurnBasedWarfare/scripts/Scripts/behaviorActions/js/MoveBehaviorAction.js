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
        if (this.distance(pos, target) <= this.parameters.arrivalThreshold) {
            return { complete: true };
        }

        return { complete: false };
    }

    onEnd(entityId, controller, game) {
        // No cleanup needed - actionData is managed by BehaviorSystem
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
