/**
 * TestGameContext - A minimal game context for unit testing systems
 *
 * This class extends the appropriate ECS game class and provides:
 * - Access to all collections from the compiled game
 * - Ability to instantiate and test systems in isolation
 * - Mock services for dependencies
 */

/**
 * Mock app object that provides getCollections()
 * This mimics what ServerEngine provides to the game
 */
class MockApp {
    constructor() {
        // Get collections from the compiled game bundle
        this.collections = globalThis.window?.COMPILED_GAME?.collections || window?.COMPILED_GAME?.collections || {};
    }

    getCollections() {
        return this.collections;
    }
}

// Get the appropriate base class - prefer ServerECSGame if available (for server tests),
// otherwise use BaseECSGame (available in both client and server)
const BaseGameClass = GUTS.ServerECSGame || GUTS.BaseECSGame;

/**
 * TestGameContext for unit testing ECS systems
 */
export class TestGameContext extends BaseGameClass {
    constructor() {
        super(new MockApp());

        // Initialize state with defaults needed for testing
        this.state = {
            isPaused: false,
            now: 0,
            deltaTime: 0,
            gameOver: false,
            victory: false,
            phase: 0,  // lobby
            gold: 1000,
            round: 1
        };

        // Register mock services for common dependencies that systems call
        this.registerMockServices();
    }

    /**
     * Register mock services that systems commonly depend on
     * Only registers services that don't already exist in the base game
     * Override these in tests if you need specific behavior
     */
    registerMockServices() {
        // Visual feedback - no-op in tests (only if not already registered)
        if (!this.hasService('showDamageNumber')) {
            this.register('showDamageNumber', () => {});
        }
        if (!this.hasService('playEffect')) {
            this.register('playEffect', () => {});
        }

        // Death handling - mark as dead but don't do full processing
        if (!this.hasService('startDeathProcess')) {
            this.register('startDeathProcess', (entityId) => {
                const deathState = this.getComponent(entityId, 'deathState');
                if (deathState) {
                    deathState.state = this.getEnums().deathState.dying;
                }
            });
        }

        // Unit type lookup - only mock if not already provided by the game
        if (!this.hasService('getUnitTypeDef')) {
            this.register('getUnitTypeDef', () => null);
        }
    }

    /**
     * Helper to advance game time for testing time-dependent logic
     */
    advanceTime(seconds) {
        this.state.now += seconds;
    }

    /**
     * Helper to create an entity with multiple components at once
     */
    createEntityWith(components) {
        const entityId = this.createEntity();
        for (const [type, data] of Object.entries(components)) {
            this.addComponent(entityId, type, data);
        }
        return entityId;
    }

    /**
     * Create and initialize a system for testing
     */
    createSystem(SystemClass) {
        const system = new SystemClass(this);

        // Register static services if defined
        if (SystemClass.services && Array.isArray(SystemClass.services)) {
            for (const serviceName of SystemClass.services) {
                if (typeof system[serviceName] === 'function') {
                    this.register(serviceName, system[serviceName].bind(system));
                }
            }
        }

        // Call init if it exists
        if (typeof system.init === 'function') {
            system.init();
        }

        return system;
    }
}

export default TestGameContext;
