/**
 * IllusionSystem - Manages illusion entities
 *
 * Handles:
 * - Tracking active illusions
 * - Cleanup of expired illusions
 * - Illusion visual effects (shimmer, fade)
 */
class IllusionSystem extends GUTS.BaseSystem {
    static services = [
        'getActiveIllusions',
        'removeIllusion',
        'isIllusion'
    ];

    constructor(game) {
        super(game);
        this.game.illusionSystem = this;
    }

    init() {
    }

    onSceneLoad(sceneData) {
    }

    update() {
        // Check for expired illusions (backup cleanup in case scheduling failed)
        this.cleanupExpiredIllusions();
    }

    cleanupExpiredIllusions() {
        const illusions = this.game.getEntitiesWith('illusion', 'transform');
        const now = this.game.state.now;

        for (const entityId of illusions) {
            const illusion = this.game.getComponent(entityId, 'illusion');
            if (!illusion) continue;

            const age = now - illusion.createdTime;
            if (age > illusion.duration) {
                this.removeIllusion(entityId);
            }
        }
    }

    getActiveIllusions() {
        return this.game.getEntitiesWith('illusion', 'transform');
    }

    removeIllusion(entityId) {
        if (!this.game.hasEntity(entityId)) return;

        const transform = this.game.getComponent(entityId, 'transform');
        const illusionPos = transform?.position;

        // Create fade effect via service
        if (illusionPos) {
            this.game.call('createParticleEffect',
                illusionPos.x,
                illusionPos.y,
                illusionPos.z,
                'smoke',
                { count: 15, scaleMultiplier: 1.0 }
            );
        }

        this.game.triggerEvent('onIllusionRemoved', { entityId });

        this.game.destroyEntity(entityId);
    }

    isIllusion(entityId) {
        return this.game.hasComponent(entityId, 'illusion');
    }

    onSceneUnload() {
    }
}
