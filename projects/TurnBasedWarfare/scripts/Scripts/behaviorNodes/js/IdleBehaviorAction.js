class IdleBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game, dt) {
        // Just idle
        return {};
    }

    onEnd(entityId, game) {
        // Nothing to clean up
    }
}
