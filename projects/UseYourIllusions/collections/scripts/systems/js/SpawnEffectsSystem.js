/**
 * SpawnEffectsSystem - Handles persistent particle effects for world objects
 *
 * When entities with particleEffectSystem defined in their worldObject spawn,
 * this system starts the appropriate particle effect at the entity's position.
 */
class SpawnEffectsSystem extends GUTS.BaseSystem {
    static services = [
        'startSpawnEffect',
        'stopSpawnEffect'
    ];

    constructor(game) {
        super(game);
        this.game.spawnEffectsSystem = this;

        // Track active effects: entityId -> { controller, offset }
        this.activeEffects = new Map();
    }

    init() {
    }

    onSceneLoad(sceneData) {
    }

    /**
     * Event handler for billboardSpawned (called by game.triggerEvent)
     * Checks if the entity has particle effects defined
     */
    billboardSpawned(eventData) {
        const { entityId } = eventData;

        // Get the entity's unitType component to find its definition
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        if (!unitTypeComp) return;

        // Use the getUnitTypeDef service to get the full definition
        const entityDef = this.game.call('getUnitTypeDef', unitTypeComp);
        if (!entityDef?.particleEffectSystem) return;

        this.startSpawnEffect(entityId, entityDef);
    }

    /**
     * Start a persistent particle effect for a world object
     */
    startSpawnEffect(entityId, entityDef) {
        // Don't start duplicate effects
        if (this.activeEffects.has(entityId)) return;

        // Get entity position
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position) return;

        const offset = entityDef.particleEffectOffset || { x: 0, y: 0, z: 0 };
        const effectPos = {
            x: transform.position.x + offset.x,
            y: transform.position.y + offset.y,
            z: transform.position.z + offset.z
        };

        const controller = this.game.call('playEffectSystem', entityDef.particleEffectSystem, effectPos);
        if (controller) {
            this.activeEffects.set(entityId, {
                controller,
                offset
            });
        }
    }

    /**
     * Stop a world object's particle effect
     */
    stopSpawnEffect(entityId) {
        const effectData = this.activeEffects.get(entityId);
        if (!effectData) return;

        if (effectData.controller?.stop) {
            effectData.controller.stop();
        }
        this.activeEffects.delete(entityId);
    }

    /**
     * Called when an entity is destroyed
     */
    entityDestroyed(entityId) {
        this.stopSpawnEffect(entityId);
    }

    /**
     * Cleanup on scene unload
     */
    onSceneUnload() {
        for (const [entityId, effectData] of this.activeEffects) {
            if (effectData.controller?.stop) {
                effectData.controller.stop();
            }
        }
        this.activeEffects.clear();
    }

    destroy() {
        this.onSceneUnload();
    }
}
