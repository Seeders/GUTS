/**
 * PuzzleGameSystem - Game flow coordination for the puzzle game
 *
 * Handles:
 * - Spawning player at starting location from level data
 * - Configuring guards with behavior trees and patrol waypoints
 * - Setting up exit zones from exit world objects
 * - Game state management
 *
 * Note: World objects and units are spawned by TerrainSystem from levelEntities.
 * This system handles puzzle-specific setup on top of those entities.
 */
class PuzzleGameSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'createEntityFromPrefab',
        'getBehaviorShared',
        'getCamera',
        'getLevelEntityData',
        'getTerrainHeightAtPosition',
        'getTerrainSize',
        'loadPlayerState',
        'playMusic',
        'playSound',
        'setActivePlayer',
        'setFollowTarget',
        'showDefeatScreen',
        'showNotification',
        'stopMusic'
    ];

    static services = [
        'startPuzzleLevel',
        'restartLevel',
        'getCurrentLevelId'
    ];

    constructor(game) {
        super(game);
        this.game.puzzleGameSystem = this;
        this.currentLevelId = null;
        this.playerEntityId = null;
        this.gameOver = false;

        // Cinematic state
        this.cinematicActive = false;
        this.cinematicWizardId = null;
        this.dialogLines = [];
        this.currentDialogIndex = 0;
        this._dialogAdvanceHandler = null;
    }

    init() {
    }

    // Event handler for when a guard catches the player (triggered by ChasePlayerBehaviorAction)
    onPlayerCaught(data) {
        if (this.gameOver) return;
        this.triggerDefeat({
            title: 'Caught!',
            message: 'You were spotted by the guards.',
            icon: '&#128065;', // Eye emoji
            reason: 'caught'
        });
    }

    // Event handler for when any unit is killed (triggered by DeathSystem)
    onUnitKilled(entityId) {
        if (this.gameOver) return;

        // Check if the killed entity is the player
        if (entityId === this.playerEntityId) {
            this.triggerDefeat({
                title: 'Game Over',
                message: 'You have been slain.',
                icon: '&#128128;', // Skull emoji
                reason: 'killed'
            });
        }
    }

    /**
     * Event handler for when player acquires an item
     */
    onItemGranted(data) {
        // Show cinematic for special items
        if (data.itemId === 'magicBelt') {
            this.showItemAcquisitionCinematic({
                itemName: 'Belt of Illusions',
                itemIcon: '🔮',
                description: 'A magical belt capable of copying particular objects and creating illusions of them.'
            });
        }
    }

    /**
     * Show a Zelda-style item acquisition cinematic
     */
    showItemAcquisitionCinematic(itemInfo) {
        // Disable player controls
        if (this.game.playerControlSystem) {
            this.game.playerControlSystem.controlsDisabled = true;
        }

        // Release pointer lock
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }

        // Create the cinematic overlay
        const overlayHTML = `
            <div id="itemAcquisitionOverlay" class="item-acquisition-overlay">
                <div class="item-acquisition-content">
                    <div class="item-acquisition-glow"></div>
                    <div class="item-acquisition-icon">${itemInfo.itemIcon}</div>
                    <div class="item-acquisition-name">${itemInfo.itemName}</div>
                    <div class="item-acquisition-description">${itemInfo.description}</div>
                    <div class="item-acquisition-continue">[Press any key or click to continue]</div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', overlayHTML);

        // Animate in
        requestAnimationFrame(() => {
            const overlay = document.getElementById('itemAcquisitionOverlay');
            if (overlay) overlay.classList.add('active');
        });

        // Play item fanfare sound
        this.call.playSound('sounds', 'item_fanfare');

        // Set up dismissal handler
        const dismissHandler = (e) => {
            // Ignore if it's just a modifier key
            if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
                return;
            }

            document.removeEventListener('keydown', dismissHandler);
            document.removeEventListener('click', dismissHandler);

            // Animate out and remove
            const overlay = document.getElementById('itemAcquisitionOverlay');
            if (overlay) {
                overlay.classList.remove('active');
                overlay.classList.add('dismissing');
                setTimeout(() => {
                    overlay.remove();

                    // Re-enable player controls
                    if (this.game.playerControlSystem) {
                        this.game.playerControlSystem.controlsDisabled = false;
                    }
                }, 300);
            }
        };

        // Small delay before accepting input (prevent accidental dismiss)
        setTimeout(() => {
            document.addEventListener('keydown', dismissHandler);
            document.addEventListener('click', dismissHandler);
        }, 500);
    }

    triggerDefeat(defeatInfo) {
        this.gameOver = true;

        console.log(`[PuzzleGameSystem] triggerDefeat called at ${this.game.state.now}`, defeatInfo);
        console.log(`[PuzzleGameSystem] isPaused before: ${this.game.state.isPaused}`);

        // Play game over sound
        this.call.playSound('sounds', 'game_over');

        // Show defeat screen with appropriate message

        this.call.showDefeatScreen(defeatInfo);

    }

    onSceneLoad(sceneData) {
        this.gameOver = false;



        // Get the current level data from collections
        const levelIndex = this.game.state.level ?? 0;
        const levelKey = this.reverseEnums.levels?.[levelIndex];
        const levelData = this.collections.levels?.[levelKey];

        console.log(`[PuzzleGameSystem] onSceneLoad - levelIndex: ${levelIndex}, levelKey: ${levelKey}, puzzleLevel: ${levelData?.puzzleLevel}`);

        // Check if this is a puzzle level and initialize
        if (levelData && levelData.puzzleLevel) {
            this.initializePuzzleLevel(levelData, levelKey);
        }
    }

    initializePuzzleLevel(levelData, levelKey) {
        if (!levelData) {
            console.log('[PuzzleGameSystem] No level data found');
            return;
        }

        this.currentLevelId = levelKey || levelData.title;

        // Set active player team for fog of war - use 'left' team (index 2)
        const playerTeam = this.enums.team?.left ?? 2;
        this.call.setActivePlayer(0, playerTeam);
    

        // Spawn player at starting location
        const startingLocations = levelData.tileMap?.startingLocations || [];
        const playerSpawn = startingLocations.find(loc => loc.side === 'left') || startingLocations[0];
        if (playerSpawn) {
            this.spawnPlayerAtLocation(playerSpawn, playerTeam);
        } else {
            // Fallback to legacy playerSpawn if no startingLocations
            if (levelData.playerSpawn) {
                this.spawnPlayer(levelData.playerSpawn, playerTeam);
            }
        }

        // Configure guards that were spawned by TerrainSystem
        this.configureGuards();

        // Exit zones are now automatically configured by UnitCreationSystem via prefab
        // when world objects have exit: true in their type data

        // Start background music if level has songSound defined
        if (levelData.songSound) {
            this.call.playMusic(levelData.songSound, {
                volume: 0.4,
                loop: true,
                fadeInTime: 2
            });
        }

        console.log(`[PuzzleGameSystem] Initialized level: ${this.currentLevelId}`);

        // Check if this level has a cinematic ending (intro cinematic for final level)
        if (levelData.hasCinematicEnding) {
            this.findCinematicWizard();
            // Short delay to let scene fully render before starting cinematic
            setTimeout(() => this.startCinematicEnding(), 1000);
        }
    }

    spawnPlayerAtLocation(location, playerTeam) {
        // Convert grid position to world position if needed
        let x, z;
        if (location.gridX !== undefined && location.gridZ !== undefined) {
            // Grid-based position from TerrainMapEditor
            const tileSize = 50; // Standard tile size
            const terrainSize = this.call.getTerrainSize() || 800;
            const halfTerrain = terrainSize / 2;
            x = (location.gridX * tileSize) - halfTerrain + (tileSize / 2);
            z = (location.gridZ * tileSize) - halfTerrain + (tileSize / 2);
        } else {
            // World position
            x = location.x || 0;
            z = location.z || 0;
        }

        this.spawnPlayer({ x, z }, playerTeam);
    }

    spawnPlayer(spawnData, playerTeam) {
        const x = spawnData.x || 0;
        const z = spawnData.z || 0;

        // Get terrain height at spawn position
        const terrainHeight = this.call.getTerrainHeightAtPosition(x, z) ?? 0;

        const unitData = this.collections.units?.illusionist;
        if (!unitData) {
            console.error(`[PuzzleGameSystem] ERROR: illusionist not found in collections.units!`);
            return null;
        }

        // Use createEntityFromPrefab with the player prefab (no aiState, has playerController + inventory)
        const playerId = this.call.createEntityFromPrefab({
            prefab: 'player',
            type: 'illusionist',
            collection: 'units',
            team: playerTeam,
            componentOverrides: {
                transform: {
                    position: { x, y: terrainHeight, z },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                },
                playerController: {
                    isPlayer: 1,
                    movementSpeed: unitData.speed || 60,
                    interactionRadius: 50
                },
                playerInventory: {
                    items: []
                },
                abilitySlots: {
                    slotQ: null,
                    slotE: null,
                    slotR: null
                }
            }
        });

        this.playerEntityId = playerId;

        console.log(`[PuzzleGameSystem] Spawned player entity ${playerId} at (${x}, ${terrainHeight}, ${z})`);

        // Load saved player state (inventory, abilities, belt contents)
        if (this.game.hasService('loadPlayerState')) {
            this.call.loadPlayerState(playerId);
        }

        this.game.triggerEvent('onPlayerSpawned', { entityId: playerId, position: { x, y: terrainHeight, z } });

        return playerId;
    }

    /**
     * Configure guards that were spawned by TerrainSystem.
     * Sets up GuardBehaviorTree and patrol waypoints from level data.
     */
    configureGuards() {
        // Find all guard units by checking unitType
        const guardTypeIndex = this.enums.units?.guard;
        if (guardTypeIndex === undefined) {
            console.log('[PuzzleGameSystem] No guard unit type defined');
            return;
        }

        const entities = this.game.getEntitiesWith('unitType', 'aiState');
        let guardCount = 0;

        for (const entityId of entities) {
            const unitType = this.game.getComponent(entityId, 'unitType');
            if (unitType?.type !== guardTypeIndex) continue;

            // Set GuardBehaviorTree
            const aiState = this.game.getComponent(entityId, 'aiState');
            if (aiState && this.enums.behaviorTrees?.GuardBehaviorTree !== undefined) {
                aiState.rootBehaviorTree = this.enums.behaviorTrees.GuardBehaviorTree;
                console.log(`[PuzzleGameSystem] Set GuardBehaviorTree for guard ${entityId}`);
            }

            // Get patrol waypoints from level entity data (only if explicitly defined)
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform) {
                const shared = this.call.getBehaviorShared(entityId);
                if (shared && !shared.patrolWaypoints) {
                    // Only set patrol waypoints if explicitly defined in level data
                    const levelEntityData = this.call.getLevelEntityData(entityId);
                    if (levelEntityData?.patrolWaypoints) {
                        shared.patrolWaypoints = levelEntityData.patrolWaypoints;
                        shared.currentWaypointIndex = 0;
                        console.log(`[PuzzleGameSystem] Using level-defined patrol waypoints for guard ${entityId}`);
                    } else {
                        // No patrol waypoints - create a single waypoint at spawn position
                        // so guard returns here after picking up objects
                        shared.patrolWaypoints = [{ x: transform.position.x, z: transform.position.z }];
                        shared.currentWaypointIndex = 0;
                        console.log(`[PuzzleGameSystem] Guard ${entityId} has no patrol waypoints - standing guard at spawn position`);
                    }
                    
                }
            }

            guardCount++;
        }

        console.log(`[PuzzleGameSystem] Configured ${guardCount} guards`);
    }

    /**
     * Set up exit zones from world objects marked as exits.
     * Looks for world objects with exit: true in their prefab data.
     */
    configureExitZones() {
        const worldObjectEntities = this.game.getEntitiesWith('unitType', 'transform');
        let exitCount = 0;

        for (const entityId of worldObjectEntities) {
            const unitType = this.game.getComponent(entityId, 'unitType');
            if (!unitType) continue;

            // Get the world object type name
            const typeName = this.reverseEnums.worldObjects?.[unitType.type];
            if (!typeName) continue;

            // Check if this world object is marked as an exit
            const prefabData = this.collections.worldObjects?.[typeName];
            if (!prefabData?.exit) continue;

            // Add exitZone component if not already present
            if (!this.game.hasComponent(entityId, 'exitZone')) {
                this.game.addComponent(entityId, 'exitZone', {
                    radius: prefabData.exitRadius || 60,
                    isActive: true
                });
                console.log(`[PuzzleGameSystem] Configured exit zone on ${typeName} (entity ${entityId})`);
                exitCount++;
            }
        }

        console.log(`[PuzzleGameSystem] Configured ${exitCount} exit zones`);
    }

    startPuzzleLevel(levelId) {
        this.currentLevelId = levelId;
        console.log(`[PuzzleGameSystem] Starting level: ${levelId}`);
    }

    restartLevel() {
        if (this.currentLevelId) {
            console.log(`[PuzzleGameSystem] Restarting level: ${this.currentLevelId}`);
            this.game.switchScene('game');
        }
    }

    getCurrentLevelId() {
        return this.currentLevelId;
    }

    onSceneUnload() {
        this.playerEntityId = null;
        this.gameOver = false;
        this.cinematicActive = false;
        this.cinematicWizardId = null;

        // Clean up dialog event listener if present
        if (this._dialogAdvanceHandler) {
            document.removeEventListener('keydown', this._dialogAdvanceHandler);
            document.removeEventListener('click', this._dialogAdvanceHandler);
            this._dialogAdvanceHandler = null;
        }

        // Stop background music when leaving level
        this.call.stopMusic(1);
    }

    // ========== CINEMATIC SEQUENCE METHODS ==========

    /**
     * Find the wizard entity (2_i_elementalist) in the level for the cinematic
     */
    findCinematicWizard() {
        const elementalistTypeIndex = this.enums.units?.['2_i_elementalist'];
        if (elementalistTypeIndex === undefined) {
            console.log('[PuzzleGameSystem] No elementalist unit type defined');
            return;
        }

        const entities = this.game.getEntitiesWith('unitType', 'transform');
        for (const entityId of entities) {
            const unitType = this.game.getComponent(entityId, 'unitType');
            if (unitType?.type === elementalistTypeIndex) {
                this.cinematicWizardId = entityId;
                console.log('[PuzzleGameSystem] Found cinematic wizard:', entityId);
                return;
            }
        }

        console.log('[PuzzleGameSystem] No wizard entity found for cinematic');
    }

    /**
     * Start the cinematic ending sequence
     */
    startCinematicEnding() {
        if (this.cinematicActive || !this.cinematicWizardId) {
            console.log('[PuzzleGameSystem] Cannot start cinematic - already active or no wizard');
            return;
        }

        this.cinematicActive = true;
        console.log('[PuzzleGameSystem] Starting cinematic ending sequence');

        // Disable player controls
        const playerControlSystem = this.game.playerControlSystem;
        if (playerControlSystem) {
            playerControlSystem.controlsDisabled = true;
            // Reset any movement state
            playerControlSystem.wasdInput = { forward: 0, strafe: 0 };
            playerControlSystem.isWASDMoving = false;
        }

        // Release pointer lock for cinematic viewing
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }

        // Start camera pan to wizard
        this.cinematicPhase1_CameraPan();
    }

    /**
     * Phase 1: Pan camera to look at wizard with smooth transition
     */
    cinematicPhase1_CameraPan() {
        const wizardTransform = this.game.getComponent(this.cinematicWizardId, 'transform');
        if (!wizardTransform) {
            console.log('[PuzzleGameSystem] No wizard transform, ending cinematic');
            this.endCinematic();
            return;
        }

        const cameraSystem = this.game.cameraControlSystem;
        const camera = this.call.getCamera();
        if (!cameraSystem || !camera) {
            console.log('[PuzzleGameSystem] No camera system, skipping to dialog');
            this.cinematicPhase2_WizardTurns();
            return;
        }

        // Store original follow target
        this._originalFollowTarget = cameraSystem.followTargetId;

        // Stop following the player - we'll manually control the camera
        cameraSystem.followTargetId = null;

        // Get current camera position
        const startPos = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z
        };

        // Calculate target position - keep current camera height/distance, just rotate to face wizard
        const wizardPos = wizardTransform.position;
        const playerTransform = this.game.getComponent(this.playerEntityId, 'transform');
        const playerPos = playerTransform?.position || startPos;

        // Position camera behind player, looking toward wizard (like a cinematic over-the-shoulder)
        const dx = wizardPos.x - playerPos.x;
        const dz = wizardPos.z - playerPos.z;
        const distToWizard = Math.sqrt(dx * dx + dz * dz);

        // Keep camera at a reasonable viewing distance - closer to wizard for dramatic effect
        const targetPos = {
            x: playerPos.x + dx * 0.6,
            y: startPos.y, // Keep same height to avoid ceiling clipping
            z: playerPos.z + dz * 0.6
        };

        // Animate camera over 2 seconds (60 steps at ~33ms each)
        const duration = 2000;
        const steps = 60;
        const stepTime = duration / steps;
        let currentStep = 0;

        const animateCamera = () => {
            currentStep++;
            const t = currentStep / steps;
            // Ease in-out curve for smooth motion
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            // Interpolate position
            camera.position.x = startPos.x + (targetPos.x - startPos.x) * eased;
            camera.position.y = startPos.y + (targetPos.y - startPos.y) * eased;
            camera.position.z = startPos.z + (targetPos.z - startPos.z) * eased;

            // Look at wizard (at roughly head height)
            camera.lookAt(wizardPos.x, wizardPos.y + 20, wizardPos.z);

            if (currentStep < steps) {
                setTimeout(animateCamera, stepTime);
            } else {
                // Animation complete, proceed to next phase
                this.cinematicPhase2_WizardTurns();
            }
        };

        animateCamera();
    }

    /**
     * Phase 2: Wizard turns to face the player
     */
    cinematicPhase2_WizardTurns() {
        const wizardTransform = this.game.getComponent(this.cinematicWizardId, 'transform');
        const playerTransform = this.game.getComponent(this.playerEntityId, 'transform');

        if (wizardTransform && playerTransform) {
            // Calculate angle from wizard to player
            const dx = playerTransform.position.x - wizardTransform.position.x;
            const dz = playerTransform.position.z - wizardTransform.position.z;
            wizardTransform.rotation.y = Math.atan2(dz, dx);
            console.log('[PuzzleGameSystem] Wizard turned to face player');
        }

        // Wait a moment for the turn animation, then show dialog
        setTimeout(() => this.cinematicPhase3_Dialog(), 1000);
    }

    /**
     * Phase 3: Show wizard dialog
     */
    cinematicPhase3_Dialog() {
        // Create dialog overlay HTML
        const dialogHTML = `
            <div id="cinematicDialog" class="cinematic-dialog-overlay active">
                <div class="cinematic-dialog">
                    <div class="dialog-portrait">
                        <div class="portrait-frame">🧙</div>
                    </div>
                    <div class="dialog-content">
                        <div class="dialog-speaker">The Wizard</div>
                        <div class="dialog-text" id="dialogText"></div>
                        <div class="dialog-continue">[Press E or Click to continue]</div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', dialogHTML);

        // Set up dialog lines
        this.dialogLines = [
            "At last... a worthy soul has found their way to me.",
            "You have mastered the art of illusion, walking unseen through shadows and deception.",
            "The secret I guard is this: True power lies not in strength, but in wisdom. The greatest battles are won without a single blow.",
            "Go forth now. Use what you have learned to protect the innocent. The world needs those who can see beyond mere appearances.",
            "Farewell, Illusionist. May your path remain hidden from those who wish you harm."
        ];
        this.currentDialogIndex = 0;

        // Type out the first line
        this.typeDialogLine();

        // Set up input handler for advancing dialog
        this.setupDialogInput();
    }

    /**
     * Type out the current dialog line with typewriter effect
     */
    typeDialogLine() {
        const textEl = document.getElementById('dialogText');
        if (!textEl) return;

        // Cancel any existing typing
        if (this._typeTimeoutId) {
            clearTimeout(this._typeTimeoutId);
            this._typeTimeoutId = null;
        }

        const line = this.dialogLines[this.currentDialogIndex];
        textEl.textContent = '';
        this._isTyping = true;
        this._currentLine = line;

        let charIndex = 0;
        const typeNextChar = () => {
            if (charIndex < line.length && this._isTyping) {
                textEl.textContent += line[charIndex];
                charIndex++;
                this._typeTimeoutId = setTimeout(typeNextChar, 30); // 30ms per character
            } else {
                this._isTyping = false;
                this._typeTimeoutId = null;
            }
        };

        typeNextChar();
    }

    /**
     * Complete the current line immediately (skip typewriter)
     */
    completeCurrentLine() {
        if (this._typeTimeoutId) {
            clearTimeout(this._typeTimeoutId);
            this._typeTimeoutId = null;
        }
        this._isTyping = false;

        const textEl = document.getElementById('dialogText');
        if (textEl && this._currentLine) {
            textEl.textContent = this._currentLine;
        }
    }

    /**
     * Set up input handlers for advancing dialog
     */
    setupDialogInput() {
        this._dialogAdvanceHandler = (e) => {
            // Advance on E key, Space, or click
            if (e.key === 'e' || e.key === 'E' || e.key === ' ' || e.type === 'click') {
                this.advanceDialog();
            }
        };

        document.addEventListener('keydown', this._dialogAdvanceHandler);
        document.addEventListener('click', this._dialogAdvanceHandler);
    }

    /**
     * Advance to the next dialog line or end the dialog
     */
    advanceDialog() {
        // If still typing, complete current line first
        if (this._isTyping) {
            this.completeCurrentLine();
            return;
        }

        this.currentDialogIndex++;

        if (this.currentDialogIndex < this.dialogLines.length) {
            // More lines to show
            this.typeDialogLine();
        } else {
            // Dialog complete
            this.endCinematic();
        }
    }

    /**
     * End the cinematic sequence and restore control
     */
    endCinematic() {
        console.log('[PuzzleGameSystem] Ending cinematic sequence');

        // Remove dialog overlay
        const dialog = document.getElementById('cinematicDialog');
        if (dialog) {
            dialog.remove();
        }

        // Clean up event listeners
        if (this._dialogAdvanceHandler) {
            document.removeEventListener('keydown', this._dialogAdvanceHandler);
            document.removeEventListener('click', this._dialogAdvanceHandler);
            this._dialogAdvanceHandler = null;
        }

        // Restore camera to follow player
        const cameraSystem = this.game.cameraControlSystem;
        if (cameraSystem && this.playerEntityId) {
            cameraSystem.setFollowTarget(this.playerEntityId);
        }

        // Re-enable player controls
        const playerControlSystem = this.game.playerControlSystem;
        if (playerControlSystem) {
            playerControlSystem.controlsDisabled = false;
        }

        this.cinematicActive = false;

        // Show a notification that the game is complete
        this.call.showNotification('You have completed the wizard\'s trials!', 'success', 5000);
    }

}
