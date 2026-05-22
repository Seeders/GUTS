class IdleBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game, dt) {
        // Return proper success response so behavior system can track this action
        return this.success({ idle: true });
    }

    onEnd(entityId, game) {
        // Nothing to clean up
    }
}
