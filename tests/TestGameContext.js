/**
 * TestGameContext - A game context for unit testing systems
 *
 * Boots the project the way the engine does: the game config supplies the
 * available systems, and a scene decides which of them run. Systems are
 * created by the real SceneManager.configureSystems, so every service a
 * system depends on comes from the real provider in that scene.
 *
 * Scene: `new TestGameContext({ scene: 'hunt' })`, else the project's
 * `testScene` from its game config (see vitest.config.js).
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
    constructor(options = {}) {
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

        const sceneName = options.scene ?? process.env.GUTS_TEST_SCENE;
        if (!sceneName) {
            throw new Error('[TestGameContext] No scene: pass { scene } or set testScene in the project game config');
        }

        // Game config → available systems + SceneManager (synchronous with
        // skipInitialScene), then the scene's systems via the engine's own path.
        this.loadGameScripts(null, { skipInitialScene: true });
        const sceneData = this.getCollections().scenes?.[sceneName];
        if (!sceneData) {
            throw new Error(`[TestGameContext] Scene '${sceneName}' not found in collections.scenes`);
        }
        this.sceneName = sceneName;
        this.sceneManager.configureSystems(sceneData);

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
     * The scene's instance of a system. With a name string this is the engine's
     * own createSystem (SceneManager uses it); with a class it returns the
     * instance the scene created, and fails if the scene doesn't include it.
     */
    createSystem(SystemClassOrName) {
        if (typeof SystemClassOrName === 'string') {
            return super.createSystem(SystemClassOrName);
        }
        const system = this.systems.find(s => s.constructor === SystemClassOrName);
        if (!system) {
            throw new Error(`[TestGameContext] ${SystemClassOrName.name} is not in scene '${this.sceneName}' ` +
                `— pass { scene } for a scene that includes it`);
        }
        return system;
    }

    /**
     * A behavior-tree node wired like BehaviorTreeProcessor does it
     * (this.call.* resolved from the game's services).
     */
    createBehaviorNode(NodeClass) {
        const node = new NodeClass();
        this.getServiceDependencies(node);
        return node;
    }
}

export default TestGameContext;
