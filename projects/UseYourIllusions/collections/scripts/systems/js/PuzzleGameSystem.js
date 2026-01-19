/**
 * PuzzleGameSystem - Game flow coordination for the puzzle game
 *
 * Handles:
 * - Spawning player at level start
 * - Spawning collectibles from level data
 * - Spawning enemies from level data
 * - Creating exit zone from level data
 * - Game state management
 */
class PuzzleGameSystem extends GUTS.BaseSystem {
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
    }

    init() {
    }

    onSceneLoad(sceneData) {
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
        if (this.game.hasService('setActivePlayer')) {
            this.game.call('setActivePlayer', 0, playerTeam);
            console.log(`[PuzzleGameSystem] Set active player team to ${playerTeam} (left)`);
        }

        // Spawn player
        if (levelData.playerSpawn) {
            this.spawnPlayer(levelData.playerSpawn, playerTeam);
        }

        // Spawn collectibles
        if (levelData.collectibles && Array.isArray(levelData.collectibles)) {
            levelData.collectibles.forEach(collectibleData => {
                this.spawnCollectible(collectibleData);
            });
        }

        // Spawn enemies
        if (levelData.enemies && Array.isArray(levelData.enemies)) {
            levelData.enemies.forEach(enemyData => {
                this.spawnEnemy(enemyData, playerTeam);
            });
        }

        // Create exit zone
        if (levelData.exitPosition) {
            this.createExitZone(levelData.exitPosition);
        }

        console.log(`[PuzzleGameSystem] Initialized level: ${this.currentLevelId}`);
    }

    spawnPlayer(spawnData, playerTeam) {
        const x = spawnData.x || 0;
        const z = spawnData.z || 0;

        // Get terrain height at spawn position
        const terrainHeight = this.game.call('getTerrainHeightAtPosition', x, z) ?? 0;

        const unitData = this.collections.units?.illusionist;
        if (!unitData) {
            console.error(`[PuzzleGameSystem] ERROR: illusionist not found in collections.units!`);
            return null;
        }

        // Use createEntityFromPrefab with the player prefab (no aiState, has playerController + magicBelt)
        const playerId = this.game.call('createEntityFromPrefab', {
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
                magicBelt: {
                    slot0: null,
                    slot1: null,
                    slot2: null,
                    selectedSlot: 0
                }
            }
        });

        this.playerEntityId = playerId;

        console.log(`[PuzzleGameSystem] Spawned player entity ${playerId} at (${x}, ${terrainHeight}, ${z})`);
        this.game.triggerEvent('onPlayerSpawned', { entityId: playerId, position: { x, y: terrainHeight, z } });

        return playerId;
    }

    spawnCollectible(collectibleData) {
        const position = collectibleData.position || { x: 0, y: 0, z: 0 };
        const objectType = collectibleData.objectType;

        if (!objectType) {
            console.warn('[PuzzleGameSystem] Collectible missing objectType');
            return null;
        }

        // Get terrain height at position
        const terrainHeight = this.game.call('getTerrainHeightAtPosition', position.x, position.z) ?? 0;

        // Use createUnit to spawn the collectible from the collectibles collection
        const collectionIndex = this.enums.objectTypeDefinitions?.collectibles;
        const spawnTypeIndex = this.enums.collectibles?.[objectType];

        if (collectionIndex === undefined || spawnTypeIndex === undefined) {
            console.warn(`[PuzzleGameSystem] Collectible ${objectType} not found in enums (collection: ${collectionIndex}, type: ${spawnTypeIndex})`);
            return null;
        }

        const transform = {
            position: { x: position.x, y: terrainHeight, z: position.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        };

        const neutralTeam = this.enums.team?.neutral ?? 0;
        const collectibleId = this.game.call('createUnit', collectionIndex, spawnTypeIndex, transform, neutralTeam);

        // Add collectible-specific component for pickup logic
        // Store the enum index since TypedArray components can't store strings
        this.game.addComponent(collectibleId, 'collectible', {
            objectType: spawnTypeIndex
        });

        console.log(`[PuzzleGameSystem] Spawned collectible ${objectType} (index: ${spawnTypeIndex}) at (${position.x}, ${position.z})`);

        return collectibleId;
    }

    spawnEnemy(enemyData, playerTeam) {
        const position = enemyData.position || { x: 0, y: 0, z: 0 };
        const enemyType = enemyData.type || 'guard';

        // Get terrain height at position
        const terrainHeight = this.game.call('getTerrainHeightAtPosition', position.x, position.z) ?? 0;

        // Use createUnit to spawn the enemy
        const collectionIndex = this.enums.objectTypeDefinitions?.units ?? 0;
        const spawnTypeIndex = this.enums.units?.[enemyType] ?? this.enums.units?.guard;

        if (spawnTypeIndex === undefined) {
            console.warn(`[PuzzleGameSystem] Enemy type ${enemyType} not found in enums`);
            return null;
        }

        const transform = {
            position: { x: position.x, y: terrainHeight, z: position.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        };

        // Enemies are on the hostile team (opposite of player)
        const enemyTeam = this.enums.team?.hostile ?? 1;
        const enemyId = this.game.call('createUnit', collectionIndex, spawnTypeIndex, transform, enemyTeam);

        // Store patrol data in behavior shared state if provided
        if (enemyData.patrol && this.game.hasService('getBehaviorShared')) {
            const shared = this.game.call('getBehaviorShared', enemyId);
            if (shared) {
                shared.patrolWaypoints = enemyData.patrol.waypoints;
                shared.currentWaypointIndex = 0;
            }
        }

        console.log(`[PuzzleGameSystem] Spawned enemy ${enemyType} at (${position.x}, ${position.z})`);

        return enemyId;
    }

    createExitZone(exitPosition) {
        const x = exitPosition.x || 0;
        const z = exitPosition.z || 0;

        // Get terrain height at position
        const terrainHeight = this.game.call('getTerrainHeightAtPosition', x, z) ?? 0;

        const exitId = this.game.createEntity();

        // Add transform
        this.game.addComponent(exitId, 'transform', {
            position: { x, y: terrainHeight, z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        // Add exit zone component
        this.game.addComponent(exitId, 'exitZone', {
            radius: 60,
            isActive: true
        });

        console.log(`[PuzzleGameSystem] Created exit zone at (${x}, ${z})`);

        return exitId;
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
    }
}
