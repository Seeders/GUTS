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
        'getLevelEntityData',
        'getTerrainHeightAtPosition',
        'getTerrainSize',
        'loadPlayerState',
        'playMusic',
        'playSound',
        'setActivePlayer',
        'showDefeatScreen',
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

        // Stop background music when leaving level
        this.call.stopMusic(1);
    }

}
