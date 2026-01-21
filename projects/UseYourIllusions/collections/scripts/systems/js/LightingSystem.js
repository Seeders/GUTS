/**
 * LightingSystem - Manages dynamic point lights for world objects
 *
 * Handles creation, tracking, and cleanup of point lights attached to entities.
 * World objects can define a pointLight config to emit light.
 * Also registers lights with EntityRenderer for billboard shader lighting.
 * Supports lighting effects (flicker, pulse, strobe, etc.) via lightingEffects collection.
 */
class LightingSystem extends GUTS.BaseSystem {
    static services = [
        'addPointLight',
        'removePointLight',
        'setLightIntensity',
        'setLightColor',
        'setLightEffect'
    ];

    constructor(game) {
        super(game);
        this.game.lightingSystem = this;

        // Track active lights: entityId -> { light, offset, config, lightPosition, effect, effectState }
        this.activeLights = new Map();

        // Reference to scene (set in onSceneLoad)
        this.scene = null;

        // Lighting effects collection (loaded in onSceneLoad)
        this.lightingEffects = null;

        // Time accumulator for effects
        this.time = 0;

        // Simple noise function for flicker effects
        this._noiseSeeds = new Map();
    }

    init() {
    }

    onSceneLoad(sceneData) {
        // Get scene reference from WorldSystem
        this.scene = this.game.worldSystem?.worldRenderer?.getScene();

        // Load lighting effects collection
        const collections = this.game.call('getCollections');
        console.log('[LightingSystem] onSceneLoad - collections keys:', Object.keys(collections || {}));
        console.log('[LightingSystem] collections.lightingEffects:', collections?.lightingEffects);
        this.lightingEffects = collections?.lightingEffects || {};
    }

    /**
     * Update loop - process lighting effects
     */
    update() {
        const deltaTime = this.game.state?.deltaTime;
        if (!deltaTime) {
            console.log('[LightingSystem] No deltaTime');
            return;
        }
        if (this.activeLights.size === 0) {
            return;
        }

        this.time += deltaTime;

        // Process effects for each light
        for (const [entityId, lightData] of this.activeLights) {
            if (lightData.effect) {
                this._processEffect(entityId, lightData, deltaTime);
            } else if (this._debugFrame === undefined || this._debugFrame++ % 120 === 0) {
                this._debugFrame = 1;
                console.log(`[LightingSystem] Light ${entityId} has no effect. Config:`, lightData.config);
            }
        }
    }

    /**
     * Process a lighting effect for a light
     */
    _processEffect(entityId, lightData, deltaTime) {
        const effect = lightData.effect;
        const state = lightData.effectState;
        const baseIntensity = lightData.config.intensity || 1.0;

        let intensityMultiplier = 1.0;

        switch (effect.type) {
            case 'flicker':
                intensityMultiplier = this._processFlicker(entityId, effect, state);
                break;
            case 'pulse':
                intensityMultiplier = this._processPulse(effect, state);
                break;
            case 'strobe':
                intensityMultiplier = this._processStrobe(effect, state);
                break;
        }

        // Apply intensity
        const newIntensity = baseIntensity * intensityMultiplier;
        lightData.light.intensity = newIntensity;

        // Update EntityRenderer
        this._updateEntityRendererIntensity(entityId, lightData, newIntensity);
    }

    /**
     * Process flicker effect - random noise-based intensity variation
     */
    _processFlicker(entityId, effect, state) {
        // Use multiple sine waves at different frequencies for organic flicker
        const speed = effect.flickerSpeed || 8;
        const noiseScale = effect.noiseScale || 0.3;
        const minIntensity = effect.minIntensity || 0.7;
        const maxIntensity = effect.maxIntensity || 1.1;

        // Get or create noise seed for this light
        if (!this._noiseSeeds.has(entityId)) {
            this._noiseSeeds.set(entityId, Math.random() * 1000);
        }
        const seed = this._noiseSeeds.get(entityId);

        // Combine multiple frequencies for organic look
        const t = this.time * speed + seed;
        const noise1 = Math.sin(t * 1.0) * 0.5;
        const noise2 = Math.sin(t * 2.3 + 1.7) * 0.3;
        const noise3 = Math.sin(t * 5.7 + 3.1) * 0.2;

        // Combine and scale noise
        const combinedNoise = (noise1 + noise2 + noise3) * noiseScale;

        // Map to intensity range
        const baseValue = (effect.baseIntensity || 1.0);
        const intensity = baseValue + combinedNoise;

        // Clamp to min/max
        return Math.max(minIntensity, Math.min(maxIntensity, intensity));
    }

    /**
     * Process pulse effect - smooth sine wave oscillation
     */
    _processPulse(effect, state) {
        const speed = effect.pulseSpeed || 2;
        const minIntensity = effect.minIntensity || 0.5;
        const maxIntensity = effect.maxIntensity || 1.0;

        // Smooth sine wave
        const t = this.time * speed * Math.PI * 2;
        const sineValue = (Math.sin(t) + 1) / 2; // 0 to 1

        // Map to intensity range
        return minIntensity + sineValue * (maxIntensity - minIntensity);
    }

    /**
     * Process strobe effect - sharp on/off switching
     */
    _processStrobe(effect, state) {
        const speed = effect.strobeSpeed || 4;
        const dutyCycle = effect.dutyCycle || 0.5;
        const onIntensity = effect.onIntensity || 1.0;
        const offIntensity = effect.offIntensity || 0.0;

        // Calculate position in cycle (0 to 1)
        const cyclePosition = (this.time * speed) % 1;

        // Sharp on/off based on duty cycle
        return cyclePosition < dutyCycle ? onIntensity : offIntensity;
    }

    /**
     * Update EntityRenderer with new intensity (optimized to avoid full re-registration)
     */
    _updateEntityRendererIntensity(entityId, lightData, intensity) {
        const entityRenderer = this.game.call('getEntityRenderer');
        if (!entityRenderer) return;

        const lightId = `entity_${entityId}`;
        // Update via addPointLight which handles updates
        entityRenderer.addPointLight(lightId, {
            position: lightData.lightPosition,
            color: lightData.config.color || '#ffaa44',
            intensity: intensity,
            distance: lightData.config.distance || 200,
            decay: lightData.config.decay || 2
        });
    }

    /**
     * Event handler for billboardSpawned (called by game.triggerEvent)
     * Checks if the entity has a point light defined
     */
    billboardSpawned(eventData) {
        const { entityId } = eventData;

        // Get the entity's unitType component to find its definition
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        if (!unitTypeComp) return;

        // Use the getUnitTypeDef service to get the full definition
        const entityDef = this.game.call('getUnitTypeDef', unitTypeComp);
        if (!entityDef?.pointLight) return;

        // Get entity position
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position) return;

        this.addPointLight(entityId, entityDef.pointLight, transform.position);
    }

    /**
     * Add a point light for an entity
     * @param {number} entityId - Entity to attach light to
     * @param {Object} lightConfig - Light configuration
     * @param {Object} position - Entity position {x, y, z}
     */
    addPointLight(entityId, lightConfig, position) {
        if (this.activeLights.has(entityId)) return;
        if (!this.scene || typeof THREE === 'undefined') return;

        const offset = lightConfig.offset || { x: 0, y: 0, z: 0 };

        // Calculate final light position
        const lightPosition = {
            x: position.x + offset.x,
            y: position.y + offset.y,
            z: position.z + offset.z
        };

        // Create THREE.js PointLight for scene (affects 3D models)
        const light = new THREE.PointLight(
            lightConfig.color || '#ffaa44',
            lightConfig.intensity || 1.0,
            lightConfig.distance || 200,
            lightConfig.decay || 2
        );

        light.position.set(lightPosition.x, lightPosition.y, lightPosition.z);

        this.scene.add(light);

        // Look up effect if specified
        let effect = null;
        let effectState = {};
        console.log(`[LightingSystem] addPointLight for entity ${entityId}, effect config:`, lightConfig.effect);
        console.log(`[LightingSystem] Available effects:`, Object.keys(this.lightingEffects || {}));
        if (lightConfig.effect && this.lightingEffects) {
            effect = this.lightingEffects[lightConfig.effect];
            console.log(`[LightingSystem] Looked up effect '${lightConfig.effect}':`, effect);
            if (!effect) {
                console.warn(`[LightingSystem] Unknown lighting effect: ${lightConfig.effect}`);
            }
        }

        this.activeLights.set(entityId, {
            light,
            offset,
            config: lightConfig,
            lightPosition,
            effect,
            effectState
        });

        // Also register with EntityRenderer for billboard shader lighting
        this._registerWithEntityRenderer(entityId, lightConfig, lightPosition);
    }

    /**
     * Set or change the effect for an existing light
     * @param {number} entityId - Entity whose light to modify
     * @param {string} effectName - Name of the effect from lightingEffects collection (or null to remove)
     */
    setLightEffect(entityId, effectName) {
        const lightData = this.activeLights.get(entityId);
        if (!lightData) return;

        if (effectName && this.lightingEffects) {
            lightData.effect = this.lightingEffects[effectName];
            lightData.effectState = {};
            if (!lightData.effect) {
                console.warn(`[LightingSystem] Unknown lighting effect: ${effectName}`);
            }
        } else {
            lightData.effect = null;
            lightData.effectState = {};
            // Reset to base intensity
            lightData.light.intensity = lightData.config.intensity || 1.0;
        }
    }

    /**
     * Register a light with EntityRenderer for billboard shader lighting
     */
    _registerWithEntityRenderer(entityId, lightConfig, lightPosition) {
        const entityRenderer = this.game.call('getEntityRenderer');
        if (!entityRenderer) return;

        const lightId = `entity_${entityId}`;
        entityRenderer.addPointLight(lightId, {
            position: lightPosition,
            color: lightConfig.color || '#ffaa44',
            intensity: lightConfig.intensity || 1.0,
            distance: lightConfig.distance || 200,
            decay: lightConfig.decay || 2
        });
    }

    /**
     * Unregister a light from EntityRenderer
     */
    _unregisterFromEntityRenderer(entityId) {
        const entityRenderer = this.game.call('getEntityRenderer');
        if (!entityRenderer) return;

        const lightId = `entity_${entityId}`;
        entityRenderer.removePointLight(lightId);
    }

    /**
     * Remove a point light for an entity
     * @param {number} entityId - Entity whose light to remove
     */
    removePointLight(entityId) {
        const lightData = this.activeLights.get(entityId);
        if (!lightData) return;

        if (this.scene) {
            this.scene.remove(lightData.light);
        }
        lightData.light.dispose?.();
        this.activeLights.delete(entityId);

        // Cleanup noise seed
        this._noiseSeeds.delete(entityId);

        // Also unregister from EntityRenderer
        this._unregisterFromEntityRenderer(entityId);
    }

    /**
     * Set intensity for an entity's light
     * @param {number} entityId - Entity whose light to modify
     * @param {number} intensity - New intensity value
     */
    setLightIntensity(entityId, intensity) {
        const lightData = this.activeLights.get(entityId);
        if (lightData) {
            lightData.light.intensity = intensity;
            lightData.config.intensity = intensity;

            // Update EntityRenderer as well
            const entityRenderer = this.game.call('getEntityRenderer');
            if (entityRenderer) {
                const lightId = `entity_${entityId}`;
                entityRenderer.addPointLight(lightId, {
                    position: lightData.lightPosition,
                    color: lightData.config.color || '#ffaa44',
                    intensity: intensity,
                    distance: lightData.config.distance || 200,
                    decay: lightData.config.decay || 2
                });
            }
        }
    }

    /**
     * Set color for an entity's light
     * @param {number} entityId - Entity whose light to modify
     * @param {string} color - New color (hex string)
     */
    setLightColor(entityId, color) {
        const lightData = this.activeLights.get(entityId);
        if (lightData) {
            lightData.light.color.set(color);
            lightData.config.color = color;

            // Update EntityRenderer as well
            const entityRenderer = this.game.call('getEntityRenderer');
            if (entityRenderer) {
                const lightId = `entity_${entityId}`;
                entityRenderer.addPointLight(lightId, {
                    position: lightData.lightPosition,
                    color: color,
                    intensity: lightData.config.intensity || 1.0,
                    distance: lightData.config.distance || 200,
                    decay: lightData.config.decay || 2
                });
            }
        }
    }

    /**
     * Called when an entity is destroyed
     */
    entityDestroyed(entityId) {
        this.removePointLight(entityId);
    }

    /**
     * Cleanup on scene unload
     */
    onSceneUnload() {
        // Clear all lights from EntityRenderer first
        const entityRenderer = this.game.call('getEntityRenderer');
        if (entityRenderer) {
            entityRenderer.clearPointLights();
        }

        for (const [entityId, lightData] of this.activeLights) {
            if (this.scene) {
                this.scene.remove(lightData.light);
            }
            lightData.light.dispose?.();
        }
        this.activeLights.clear();
        this._noiseSeeds.clear();
        this.scene = null;
        this.time = 0;
    }

    destroy() {
        this.onSceneUnload();
    }
}
