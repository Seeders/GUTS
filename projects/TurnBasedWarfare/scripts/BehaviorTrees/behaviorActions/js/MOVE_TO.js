class MoveAction extends GUTS.BaseAction {
    static TYPE = "MOVE_TO";
    static PRIORITY = 10;

    canExecute(entityId, controller, game) {
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);
        const target = controller.actionTarget;
        if (!pos || !target) return false;

        const dist = this.distance(pos, target);
        return dist > this.parameters.arrivalThreshold;
    }

    execute(entityId, controller, game, dt) {
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);
        const vel = game.getComponent(entityId, game.componentTypes.VELOCITY);
        const target = controller.actionTarget;

        // Set velocity target
        vel.targetX = target.x;
        vel.targetZ = target.z;

        // Check completion
        if (this.distance(pos, target) <= this.parameters.arrivalThreshold) {
            return { complete: true };
        }

        return { complete: false };
    }

    onEnd(entityId, controller, game) {
        const vel = game.getComponent(entityId, game.componentTypes.VELOCITY);
        vel.targetX = null;
        vel.targetZ = null;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
