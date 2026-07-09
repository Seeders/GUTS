/**
 * EditorECSGame - ECS game context for editors
 * Extends BaseECSGame similar to how ECSGame extends it for runtime
 * Used by TerrainMapEditor and any other editors
 */
class EditorECSGame extends GUTS.BaseECSGame {
    constructor(app, canvas) {
        super(app);
        this.canvas = canvas;
        this.isServer = false;
        this.isEditor = true;  // Flag for systems to detect editor mode

        // Entity labels for editor display
        this.entityLabels = new Map();

        // Editor-specific state (required by systems)
        this.state = {
            isPaused: false,
            now: 0,
            deltaTime: 0.016,
            gameOver: false,
            victory: false,
            level: null,
            selectedEntity: {
                entityId: null,
                collection: null
            }
        };

        // Game services
        this.gameSystem = new GUTS.GameServices();

        this.register("getCollections", () => this.getCollections());
        this.register("isVisibleAt", () => true);

        // Animation loop - uses tickRate from config (default 20 TPS)
        this.animationFrameId = null;
        const gameConfig = app?.collections?.configs?.game;
        this.tickRate = 1 / (gameConfig?.tickRate || 20);
        this.accumulator = 0;
        this.lastTick = 0;

        // Event listeners for editor UI callbacks
        this.eventListeners = new Map();
    }

    /**
     * Initialize - called by EditorLoader after assets are loaded
     * Mirrors ECSGame.init() pattern
     */
    async init(isServer = false, config = {}) {
        this.isServer = isServer;

        // Load game scripts (sets up SceneManager, systems)
        await this.loadGameScripts(config);
    }

    /**
     * Override loadGameScripts to use ONLY the passed config (not game config)
     * and skip loading initial scene (editors handle scene loading explicitly)
     */
    async loadGameScripts(config) {
        // Use ONLY the passed config - don't fall back to game config
        // Pass skipInitialScene since editors handle scene loading explicitly
        await super.loadGameScripts(config, { skipInitialScene: true });
    }

    /**
     * Remove an entity
     */
    removeEntity(entityId) {
        this.triggerEvent('onEntityDestroyed', entityId);
        this.destroyEntity(entityId);
        this.entityLabels.delete(entityId);
    }

    /**
     * Clear all entities (uses SceneManager)
     */
    clearAllEntities() {
        if (this.sceneManager) {
            this.sceneManager.unloadCurrentScene();
        }
        this.entityLabels.clear();
    }

    /**
     * Start the render/update loop with fixed tick rate (matches Engine)
     */
    startRenderLoop() {
        this.lastTick = performance.now();
        this.accumulator = 0;

        const loop = async () => {
            const now = performance.now();
            const deltaTime = (now - this.lastTick) / 1000;
            this.lastTick = now;

            // Accumulate time for fixed timestep
            this.accumulator += deltaTime;

            // Process ticks at fixed rate (same as Engine)
            const maxTicksPerFrame = 3;
            let ticksProcessed = 0;

            while (this.accumulator >= this.tickRate && ticksProcessed < maxTicksPerFrame) {
                await this.update(this.tickRate);
                this.accumulator -= this.tickRate;
                ticksProcessed++;
            }

            this.animationFrameId = requestAnimationFrame(loop);
        };

        loop();
    }

    /**
     * Stop the render loop
     */
    stopRenderLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // ============ Editor-specific Utility Methods ============

    getEntityLabel(entityId) {
        return this.entityLabels.get(entityId) || entityId;
    }

    setEntityLabel(entityId, label) {
        this.entityLabels.set(entityId, label);
    }

    /**
     * Register an event listener callback
     */
    on(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
    }

    /**
     * Remove an event listener
     */
    off(eventName, callback) {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * Override triggerEvent to also call custom event listeners
     */
    triggerEvent(eventName, data) {
        // Call parent (notifies systems)
        super.triggerEvent(eventName, data);

        // Also notify custom event listeners
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(data);
                } catch (err) {
                    console.error(`[EditorECSGame] Error in event listener for ${eventName}:`, err);
                }
            }
        }
    }

    /**
     * Export scene to JSON format
     */
    exportScene() {
        const entities = [];

        for (const entityId of this.getAllEntities()) {
            const componentTypes = this.getEntityComponentTypes(entityId);
            const componentsObj = {};

            for (const componentType of componentTypes) {
                const componentData = this.getComponent(entityId, componentType);
                if (componentData) {
                    componentsObj[componentType] = componentData;
                }
            }

            entities.push({
                id: entityId,
                name: this.entityLabels.get(entityId) || entityId,
                components: componentsObj
            });
        }

        return {
            title: this.sceneManager?.currentSceneName || 'Untitled Scene',
            systems: this.availableSystemTypes || [],
            entities
        };
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopRenderLoop();

        for (const system of this.systems) {
            if (system.onSceneUnload) {
                system.onSceneUnload();
            }
            if (system.destroy) {
                system.destroy();
            }
        }

        this.systems = [];

        const entityIds = this.getAllEntities();
        for (const entityId of entityIds) {
            this.destroyEntity(entityId);
        }

        // Clear event listeners
        this.eventListeners.clear();
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorECSGame;
}

if (typeof GUTS !== 'undefined') {
    GUTS.EditorECSGame = EditorECSGame;
}

export default EditorECSGame;
export { EditorECSGame };
