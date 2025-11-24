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
        const vel = game.getComponent(entityId, 'velocity');
        const target = controller.actionData?.targetPos;

        if (!target) return { complete: true, failed: true };

        // Calculate direction to target
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Check completion
        if (distance <= this.parameters.arrivalThreshold) {
            vel.vx = 0;
            vel.vz = 0;
            return { complete: true };
        }

        // Set velocity toward target
        const speed = vel.maxSpeed || 50;
        vel.vx = (dx / distance) * speed;
        vel.vz = (dz / distance) * speed;

        return { complete: false };
    }

    onEnd(entityId, controller, game) {
        // Stop movement
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.vx = 0;
            vel.vz = 0;
        }
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
