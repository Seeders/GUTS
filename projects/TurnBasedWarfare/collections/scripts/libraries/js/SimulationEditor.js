/**
 * SimulationEditor - Visual simulation runner for the editor
 *
 * Creates an EditorECSGame instance to run simulations with full 3D rendering,
 * similar to how TerrainMapEditor uses EditorECSGame for terrain editing.
 */
class SimulationEditor {
    constructor(gameEditor, config = {}) {
        console.log('[SimulationEditor] Constructor called with config:', config);
        console.log('[SimulationEditor] gameEditor:', gameEditor);

        this.gameEditor = gameEditor;
        this.editorSettings = config;
        this.collections = this.gameEditor.getCollections();

        // Editor context (ECS game instance)
        this.editorContext = null;
        this.editorLoader = null;

        // Simulation state
        this.simulationData = null;
        this.isRunning = false;
        this.isPaused = true;
        this.playbackSpeed = 1;

        // DOM elements
        this.canvasEl = document.getElementById('simulation-canvas');
        console.log('[SimulationEditor] Canvas element:', this.canvasEl);

        if (this.canvasEl) {
            this.canvasEl.width = 1536;
            this.canvasEl.height = 768;
            this.canvasEl.style.width = '';
            this.canvasEl.style.height = '';
        } else {
            console.error('[SimulationEditor] Canvas element not found! Looking for #simulation-canvas');
        }

        // UI update interval
        this.uiUpdateInterval = null;

        // Camera controller (shared with TerrainMapEditor)
        this.cameraController = null;

        this.init();
    }

    async init() {
        console.log('[SimulationEditor] init() called');
        this.setupEventListeners();
        this.setupEditorHooks();
        console.log('[SimulationEditor] Event listeners and hooks set up');
    }

    /**
     * Set up editor load/unload hooks
     * These are triggered by the editor when the module is loaded/unloaded
     */
    setupEditorHooks() {
        // Handle editSimulation event (loadHook from simulationModule.json)
        document.body.addEventListener('editSimulation', async (event) => {
            console.log('[SimulationEditor] editSimulation event received', event.detail);
            const objectData = event.detail.objectData;
            await this.loadSimulation(objectData);
        });

        // Handle unloadSimulation event (unloadHook)
        document.body.addEventListener('unloadSimulation', () => {
            console.log('[SimulationEditor] unloadSimulation event received');
            this.destroy();
        });
    }

    setupEventListeners() {
        // Play button
        const playBtn = document.getElementById('sim-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => this.startSimulation());
        }

        // Pause button
        const pauseBtn = document.getElementById('sim-pause-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => this.pauseSimulation());
        }

        // Restart button
        const restartBtn = document.getElementById('sim-restart-btn');
        if (restartBtn) {
            restartBtn.addEventListener('click', () => this.restartSimulation());
        }

        // Speed selector
        const speedSelect = document.getElementById('sim-speed');
        if (speedSelect) {
            speedSelect.addEventListener('change', (e) => {
                this.setPlaybackSpeed(parseFloat(e.target.value));
            });
        }

        // Camera controls
        const cameraToggleBtn = document.getElementById('sim-camera-toggle');
        if (cameraToggleBtn) {
            cameraToggleBtn.addEventListener('click', () => this.toggleCameraMode());
        }

        const cameraRotateLeftBtn = document.getElementById('sim-camera-rotate-left');
        if (cameraRotateLeftBtn) {
            cameraRotateLeftBtn.addEventListener('click', () => this.rotateCameraLeft());
        }

        const cameraRotateRightBtn = document.getElementById('sim-camera-rotate-right');
        if (cameraRotateRightBtn) {
            cameraRotateRightBtn.addEventListener('click', () => this.rotateCameraRight());
        }
    }

    /**
     * Toggle between game and scene camera modes
     */
    toggleCameraMode() {
        if (!this.cameraController) return;

        this.cameraController.toggleCameraMode();
        this.updateCameraToggleButton();
    }

    /**
     * Update the camera toggle button text based on current mode
     */
    updateCameraToggleButton() {
        const btn = document.getElementById('sim-camera-toggle');
        if (!btn || !this.cameraController) return;

        const mode = this.cameraController.getCameraMode();
        btn.querySelector('span').textContent = mode === 'game' ? 'Scene Cam' : 'Game Cam';
    }

    /**
     * Rotate camera left (counter-clockwise)
     */
    rotateCameraLeft() {
        if (this.cameraController) {
            this.cameraController.rotateGameCamera('left');
        }
    }

    /**
     * Rotate camera right (clockwise)
     */
    rotateCameraRight() {
        if (this.cameraController) {
            this.cameraController.rotateGameCamera('right');
        }
    }

    /**
     * Load simulation data from the object being edited
     * Called by the editor module load hook
     */
    async loadSimulation(simulationData) {
        console.log('[SimulationEditor] loadSimulation called with:', simulationData);
        this.simulationData = simulationData;

        // Update info display
        this.updateSimulationInfo();

        // Initialize the editor context
        try {
            await this.initEditorContext();
            this.updateStatus('Ready - Click Play to start');
        } catch (err) {
            console.error('[SimulationEditor] Error in initEditorContext:', err);
            this.updateStatus('Error loading - check console');
        }
    }

    /**
     * Initialize EditorECSGame with the simulation scene
     */
    async initEditorContext() {
        console.log('[SimulationEditor] initEditorContext called');

        if (!this.canvasEl) {
            console.error('[SimulationEditor] Canvas element not found');
            return;
        }

        this.updateStatus('Loading...');

        // Create editor context (like TerrainMapEditor)
        console.log('[SimulationEditor] Creating EditorECSGame...');
        console.log('[SimulationEditor] GUTS.EditorECSGame:', GUTS.EditorECSGame);
        this.editorContext = new GUTS.EditorECSGame(this.gameEditor, this.canvasEl);
        console.log('[SimulationEditor] EditorECSGame created:', this.editorContext);

        // Use EditorLoader to load assets
        console.log('[SimulationEditor] Creating EditorLoader...');
        console.log('[SimulationEditor] GUTS.EditorLoader:', GUTS.EditorLoader);
        this.editorLoader = new GUTS.EditorLoader(this.editorContext);
        console.log('[SimulationEditor] Loading assets for level:', this.simulationData.level);
        await this.editorLoader.load({
            systems: [],
            levelName: this.simulationData.level
        });
        console.log('[SimulationEditor] Assets loaded');

        // Get enum index for level
        const enums = this.editorContext.getEnums();
        console.log('[SimulationEditor] Enums:', enums);
        const levelIndex = enums.levels?.[this.simulationData.level] ?? 0;
        console.log('[SimulationEditor] Level index:', levelIndex, 'for level:', this.simulationData.level);

        // Set level in game state BEFORE loading scene
        // This is critical - TerrainSystem.onSceneLoad reads game.state.level
        this.editorContext.state.level = levelIndex;
        console.log('[SimulationEditor] Set game.state.level to:', this.editorContext.state.level);

        // Load the simulation editor scene
        const sceneName = this.editorSettings.scene || 'simulationEditor';
        console.log('[SimulationEditor] Loading scene:', sceneName);
        console.log('[SimulationEditor] SceneManager:', this.editorContext.sceneManager);
        await this.editorContext.sceneManager.loadScene(sceneName);
        console.log('[SimulationEditor] Scene loaded');

        // Debug: Check if terrain entity was created
        const terrainEntities = this.editorContext.getEntitiesWith('terrain');
        console.log('[SimulationEditor] Terrain entities after scene load:', terrainEntities.length);
        if (terrainEntities.length > 0) {
            const terrainComp = this.editorContext.getComponent(terrainEntities[0], 'terrain');
            console.log('[SimulationEditor] Terrain component:', terrainComp);
        }

        // Debug: Check for units with placement
        const placementEntities = this.editorContext.getEntitiesWith('placement');
        console.log('[SimulationEditor] Placement entities after scene load:', placementEntities.length);
        for (const entityId of placementEntities) {
            const unitTypeComp = this.editorContext.getComponent(entityId, 'unitType');
            const teamComp = this.editorContext.getComponent(entityId, 'team');
            const unitDef = this.editorContext.call('getUnitTypeDef', unitTypeComp);
            console.log('[SimulationEditor] Entity', entityId, '- type:', unitDef?.id, 'team:', teamComp?.team);
        }

        // Start render loop (paused state - will only render, not update game logic)
        console.log('[SimulationEditor] Starting render loop...');
        this.editorContext.startRenderLoop();

        // Setup camera controls (like TerrainMapEditor)
        this.setupCameraControls();

        console.log('[SimulationEditor] Editor context initialized successfully');
    }

    /**
     * Setup camera controls using shared EditorCameraController
     * Provides same controls as TerrainMapEditor (game mode with Q/E rotation)
     */
    setupCameraControls() {
        console.log('[SimulationEditor] Setting up camera controls...');

        // Get WorldSystem to access the WorldRenderer
        const worldSystem = this.editorContext.worldSystem;
        if (!worldSystem) {
            console.warn('[SimulationEditor] WorldSystem not available');
            return;
        }

        const worldRenderer = worldSystem.worldRenderer;
        if (!worldRenderer) {
            console.warn('[SimulationEditor] WorldRenderer not available');
            return;
        }

        // Get terrain size for camera positioning
        const terrainDataManager = this.editorContext.terrainSystem?.terrainDataManager;
        const terrainSize = terrainDataManager?.extendedSize || terrainDataManager?.terrainSize || 1024;

        // Create camera controller with game mode (orthographic isometric)
        this.cameraController = new GUTS.EditorCameraController(
            worldRenderer,
            this.canvasEl,
            this.collections
        );
        this.cameraController.initialize(terrainSize);

        console.log('[SimulationEditor] Camera controls set up with terrain size:', terrainSize);
    }

    /**
     * Start or resume the simulation
     */
    async startSimulation() {
        console.log('[SimulationEditor] startSimulation called');
        console.log('[SimulationEditor] editorContext:', this.editorContext);
        console.log('[SimulationEditor] isRunning:', this.isRunning);

        if (!this.editorContext) {
            console.error('[SimulationEditor] Editor context not initialized');
            return;
        }

        if (!this.isRunning) {
            // First time starting - set up the simulation
            console.log('[SimulationEditor] First run - calling setupSimulation...');
            try {
                await this.setupSimulation();
            } catch (err) {
                console.error('[SimulationEditor] Error in setupSimulation:', err);
                return;
            }
        }

        this.isPaused = false;
        this.editorContext.state.isPaused = false;

        // Update UI
        const playBtn = document.getElementById('sim-play-btn');
        const pauseBtn = document.getElementById('sim-pause-btn');
        if (playBtn) playBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'block';

        this.updateStatus('Running...');
        this.startUIUpdates();
    }

    /**
     * Set up the simulation (create players, spawn AI opponents)
     * Similar to HeadlessSkirmishRunner.setup()
     */
    async setupSimulation() {
        console.log('[SimulationEditor] setupSimulation called');
        const game = this.editorContext;
        const enums = game.getEnums();
        const config = this.simulationData;

        console.log('[SimulationEditor] Config:', config);
        console.log('[SimulationEditor] Enums:', enums);

        // Reset game state
        game.state.gameOver = false;
        game.state.winner = null;
        game.state.phase = enums.gamePhase.placement;
        game.state.round = 1;

        // Set up game state - buildOrders[0] is left team, buildOrders[1] is right team
        const leftBuildOrder = config.buildOrders[0];
        const rightBuildOrder = config.buildOrders[1];
        console.log('[SimulationEditor] Build orders - Left:', leftBuildOrder, 'Right:', rightBuildOrder);

        game.state.skirmishConfig = {
            level: config.level,
            selectedLevel: config.level,
            startingGold: config.startingGold,
            seed: config.seed,
            leftBuildOrder: leftBuildOrder,
            rightBuildOrder: rightBuildOrder
        };
        game.state.gameSeed = config.seed;

        // Set up RNG
        if (game.rng) {
            game.rng.initialSeed = game.state.gameSeed;
            game.rng.strands.clear();
        }

        // Set simulation mode flags
        game.state.isHeadlessSimulation = true;
        game.state.isLocalGame = true;
        game.state.localPlayerId = 0;

        // Create player entities
        const leftTeam = enums.team.left;
        const rightTeam = enums.team.right;
        console.log('[SimulationEditor] Teams - Left:', leftTeam, 'Right:', rightTeam);

        console.log('[SimulationEditor] hasService createPlayerEntity:', game.hasService('createPlayerEntity'));
        if (game.hasService('createPlayerEntity')) {
            console.log('[SimulationEditor] Creating player entities...');
            game.call('createPlayerEntity', 0, {
                team: leftTeam,
                gold: config.startingGold,
                upgrades: 0
            });

            game.call('createPlayerEntity', 1, {
                team: rightTeam,
                gold: config.startingGold,
                upgrades: 0
            });
            console.log('[SimulationEditor] Player entities created');
        }

        // Initialize game
        console.log('[SimulationEditor] hasService initializeGame:', game.hasService('initializeGame'));
        if (game.hasService('initializeGame')) {
            game.call('initializeGame', null);
        }

        // Spawn AI opponents for both teams
        console.log('[SimulationEditor] Spawning AI opponents...');
        this.spawnAIOpponent(leftTeam, leftBuildOrder);
        this.spawnAIOpponent(rightTeam, rightBuildOrder);

        this.isRunning = true;
        console.log('[SimulationEditor] Simulation setup complete - isRunning:', this.isRunning);
    }

    /**
     * Spawn an AI opponent entity for a team
     * Copied from HeadlessSkirmishRunner
     */
    spawnAIOpponent(team, buildOrderId) {
        console.log('[SimulationEditor] spawnAIOpponent - team:', team, 'buildOrderId:', buildOrderId);
        const game = this.editorContext;
        const enums = game.getEnums();

        const aiEntityId = game.createEntity();
        console.log('[SimulationEditor] Created AI entity:', aiEntityId);

        // Add team component
        game.addComponent(aiEntityId, 'team', {
            team: team
        });

        // Add aiState component pointing to AIOpponentBehaviorTree
        console.log('[SimulationEditor] behaviorTrees enum:', enums.behaviorTrees);
        game.addComponent(aiEntityId, 'aiState', {
            rootBehaviorTree: enums.behaviorTrees?.AIOpponentBehaviorTree ?? 0,
            rootBehaviorTreeCollection: enums.behaviorCollection?.behaviorTrees ?? 0,
            currentAction: 0,
            currentActionCollection: 0
        });

        // Add aiOpponent component with build order config
        game.addComponent(aiEntityId, 'aiOpponent', {
            buildOrderId: buildOrderId,
            currentRound: 0,
            actionsExecuted: false,
            actionIndex: 0
        });
    }

    /**
     * Pause the simulation
     */
    pauseSimulation() {
        this.isPaused = true;
        if (this.editorContext) {
            this.editorContext.state.isPaused = true;
        }

        // Update UI
        const playBtn = document.getElementById('sim-play-btn');
        const pauseBtn = document.getElementById('sim-pause-btn');
        if (playBtn) {
            playBtn.style.display = 'block';
            playBtn.textContent = 'Resume';
        }
        if (pauseBtn) pauseBtn.style.display = 'none';

        this.updateStatus('Paused');
        this.stopUIUpdates();
    }

    /**
     * Restart the simulation from the beginning
     */
    async restartSimulation() {
        this.pauseSimulation();
        this.isRunning = false;

        // Destroy current context
        if (this.editorContext) {
            this.editorContext.destroy();
            this.editorContext = null;
        }

        // Reinitialize
        await this.initEditorContext();

        // Reset UI
        const playBtn = document.getElementById('sim-play-btn');
        if (playBtn) playBtn.textContent = 'Play';

        this.updateStatus('Ready - Click Play to start');
        this.updateUI();
    }

    /**
     * Set playback speed multiplier
     */
    setPlaybackSpeed(speed) {
        this.playbackSpeed = speed;
        if (this.editorContext) {
            // Adjust tick rate based on speed
            this.editorContext.tickRate = (1 / 20) / speed;
        }
    }

    /**
     * Update simulation info display
     */
    updateSimulationInfo() {
        const data = this.simulationData;
        if (!data) return;

        const setTextContent = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value || '-';
        };

        setTextContent('sim-name', data.name);
        setTextContent('sim-level', data.level);
        setTextContent('sim-seed', data.seed);
        setTextContent('sim-build-order-a', data.buildOrders[0]);
        setTextContent('sim-build-order-b', data.buildOrders[1]);
    }

    /**
     * Update status display
     */
    updateStatus(status) {
        const el = document.getElementById('sim-status');
        if (el) el.textContent = status;
    }

    /**
     * Start periodic UI updates
     */
    startUIUpdates() {
        this.stopUIUpdates();
        this.uiUpdateInterval = setInterval(() => this.updateUI(), 100);
    }

    /**
     * Stop periodic UI updates
     */
    stopUIUpdates() {
        if (this.uiUpdateInterval) {
            clearInterval(this.uiUpdateInterval);
            this.uiUpdateInterval = null;
        }
    }

    /**
     * Update all UI elements with current game state
     */
    updateUI() {
        if (!this.editorContext) return;

        const game = this.editorContext;
        const state = game.state;
        const reverseEnums = game.getReverseEnums?.() || {};

        // Phase and round
        const setTextContent = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        const phaseName = reverseEnums.gamePhase?.[state.phase] || state.phase || '-';
        setTextContent('sim-phase', `Phase: ${phaseName}`);
        setTextContent('sim-round', `Round: ${state.round || '-'}`);
        setTextContent('sim-tick', `Tick: ${game.tickCount || 0}`);

        // Game over state
        setTextContent('sim-winner', state.winner || '-');
        setTextContent('sim-game-over', state.gameOver ? 'Yes' : 'No');

        if (state.gameOver) {
            this.updateStatus(`Game Over - Winner: ${state.winner}`);
            this.pauseSimulation();
        }

        // Team stats
        this.updateTeamStats();
    }

    /**
     * Update team statistics
     */
    updateTeamStats() {
        if (!this.editorContext) return;

        const game = this.editorContext;
        const enums = game.getEnums();

        const leftTeam = enums.team?.left;
        const rightTeam = enums.team?.right;

        // Count units and buildings per team
        const stats = { left: { units: 0, buildings: 0, gold: 0 }, right: { units: 0, buildings: 0, gold: 0 } };

        const entities = game.getEntitiesWith('team', 'unitType');
        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const deathState = game.getComponent(entityId, 'deathState');

            // Skip dead units
            if (deathState && deathState.state !== enums.deathState?.alive) continue;

            const unitDef = game.call?.('getUnitTypeDef', unitTypeComp);
            const isBuilding = unitDef?.isBuilding || unitDef?.collection === 'buildings';

            const teamKey = teamComp.team === leftTeam ? 'left' : 'right';
            if (isBuilding) {
                stats[teamKey].buildings++;
            } else {
                stats[teamKey].units++;
            }
        }

        // Get gold from player entities
        const playerEntities = game.getEntitiesWith('player');
        for (const entityId of playerEntities) {
            const player = game.getComponent(entityId, 'player');
            const teamComp = game.getComponent(entityId, 'team');
            if (player && teamComp) {
                const teamKey = teamComp.team === leftTeam ? 'left' : 'right';
                stats[teamKey].gold = player.gold || 0;
            }
        }

        // Update UI
        document.getElementById('sim-left-units').textContent = stats.left.units;
        document.getElementById('sim-left-buildings').textContent = stats.left.buildings;
        document.getElementById('sim-left-gold').textContent = stats.left.gold;

        document.getElementById('sim-right-units').textContent = stats.right.units;
        document.getElementById('sim-right-buildings').textContent = stats.right.buildings;
        document.getElementById('sim-right-gold').textContent = stats.right.gold;
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopUIUpdates();

        if (this.cameraController) {
            this.cameraController.destroy();
            this.cameraController = null;
        }

        if (this.editorContext) {
            this.editorContext.destroy();
            this.editorContext = null;
        }

        this.editorLoader = null;
        this.simulationData = null;
        this.isRunning = false;
        this.isPaused = true;
    }
}

// Register with window.GUTS for editor module system
if (typeof window !== 'undefined') {
    window.GUTS = window.GUTS || {};
    window.GUTS.SimulationEditor = SimulationEditor;
    console.log('[SimulationEditor] Registered on window.GUTS');
}
