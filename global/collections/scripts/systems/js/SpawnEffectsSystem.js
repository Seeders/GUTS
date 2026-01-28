/**
 * SpawnEffectsSystem - Handles persistent particle effects and ambient sounds for world objects
 *
 * When entities with particleEffectSystem or ambientSound defined in their worldObject spawn,
 * this system starts the appropriate effects at the entity's position.
 */
class SpawnEffectsSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'getAmbientSound',
        'getCamera',
        'getUnitTypeDef',
        'playEffectSystem',
        'setListenerPosition',
        'startAmbientSound',
        'stopAmbientSound'
    ];

    static services = [
        'startSpawnEffect',
        'stopSpawnEffect'
    ];

    constructor(game) {
        super(game);
        this.game.spawnEffectsSystem = this;

        // Track active effects: entityId -> { controller, offset }
        this.activeEffects = new Map();

        // Track active ambient sounds: entityId -> { soundName, position }
        this.activeAmbientSounds = new Map();
    }

    init() {
    }

    onSceneLoad(sceneData) {
    }

    /**
     * Update loop - update listener position for distance-based audio
     */
    update() {
        // Update audio listener position based on camera
        if (this.activeAmbientSounds.size > 0) {
            const camera = this.call.getCamera();
            if (camera?.position) {
                this.call.setListenerPosition( {
                    x: camera.position.x,
                    y: camera.position.y,
                    z: camera.position.z
                });
            }
        }
    }

    /**
     * Event handler for billboardSpawned (called by game.triggerEvent)
     * Checks if the entity has particle effects or ambient sounds defined
     */
    billboardSpawned(eventData) {
        const { entityId } = eventData;

        // Get the entity's unitType component to find its definition
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        if (!unitTypeComp) return;

        // Use the getUnitTypeDef service to get the full definition
        const entityDef = this.call.getUnitTypeDef( unitTypeComp);
        if (!entityDef) return;

        console.log(`[SpawnEffectsSystem] billboardSpawned entity ${entityId}, has ambientSound:`, !!entityDef.ambientSound, entityDef.ambientSound);

        // Start particle effect if defined
        if (entityDef.particleEffectSystem) {
            this.startSpawnEffect(entityId, entityDef);
        }

        // Start ambient sound if defined
        if (entityDef.ambientSound) {
            this.startEntityAmbientSound(entityId, entityDef);
        }
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

        const controller = this.call.playEffectSystem( entityDef.particleEffectSystem, effectPos);
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
        this.stopEntityAmbientSound(entityId);
    }

    // ========== AMBIENT SOUND METHODS ==========

    /**
     * Start an ambient sound for an entity
     */
    startEntityAmbientSound(entityId, entityDef) {
        console.log(`[SpawnEffectsSystem] startEntityAmbientSound called for entity ${entityId}`, entityDef.ambientSound);

        // Don't start duplicate sounds
        if (this.activeAmbientSounds.has(entityId)) return;

        // Get entity position
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position) return;

        const ambientConfig = entityDef.ambientSound;
        const offset = ambientConfig.offset || { x: 0, y: 0, z: 0 };
        const soundPos = {
            x: transform.position.x + offset.x,
            y: transform.position.y + offset.y,
            z: transform.position.z + offset.z
        };

        // Get the sound definition from collections
        console.log(`[SpawnEffectsSystem] Looking for ambient sound: ${ambientConfig.sound}`);

        const soundDef = this.call.getAmbientSound( ambientConfig.sound);
        console.log('[SpawnEffectsSystem] Got soundDef:', soundDef);
        if (!soundDef) {
            console.warn(`[SpawnEffectsSystem] Ambient sound not found: ${ambientConfig.sound}`);
            return;
        }

        // Start the ambient sound
        const ambientId = `entity_${entityId}`;
        const ambient = this.call.startAmbientSound( ambientId, soundDef, soundPos);

        if (ambient) {
            this.activeAmbientSounds.set(entityId, {
                ambientId,
                soundName: ambientConfig.sound,
                offset
            });
        }
    }

    /**
     * Stop an entity's ambient sound
     */
    stopEntityAmbientSound(entityId) {
        const soundData = this.activeAmbientSounds.get(entityId);
        if (!soundData) return;

        this.call.stopAmbientSound( soundData.ambientId);
        this.activeAmbientSounds.delete(entityId);
    }

    /**
     * Cleanup on scene unload
     */
    onSceneUnload() {
        // Stop all particle effects
        for (const [entityId, effectData] of this.activeEffects) {
            if (effectData.controller?.stop) {
                effectData.controller.stop();
            }
        }
        this.activeEffects.clear();

        // Stop all ambient sounds
        for (const [entityId] of this.activeAmbientSounds) {
            this.stopEntityAmbientSound(entityId);
        }
        this.activeAmbientSounds.clear();
    }

    destroy() {
        this.onSceneUnload();
    }
}
