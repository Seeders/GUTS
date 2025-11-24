class IdleBehaviorAction extends GUTS.BaseBehaviorAction {

    canExecute(entityId, controller, game) {
        return true;
    }

    execute(entityId, controller, game, dt) {
        // Just idle
        return { complete: false };
    }

    onEnd(entityId, controller, game) {
        // Nothing to clean up
    }
}
