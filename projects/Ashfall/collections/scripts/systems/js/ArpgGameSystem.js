/**
 * ArpgGameSystem - Bootstraps the ARPG adventure mode.
 *
 * Responsibilities:
 * - Initialize local single-player game state for the adventure scene
 * - Spawn the player's chosen class as a directly-controlled character
 * - Spawn enemy packs for the current zone (placeholder packs until EnemyPackSystem)
 * - Keep game.state.phase = battle so combat systems run continuously
 * - Player death / respawn handling
 */
class ArpgGameSystem extends GUTS.BaseSystem {
    static services = [
        'getPlayerCharacter',
        'respawnPlayerCharacter'
    ];

    static serviceDependencies = [
        'setLocalGame',
        'showLoadingScreen',
        'createPlayerEntity',
        'setActivePlayer',
        'initializeGame',
        'createEntityFromPrefab',
        'getPlayerEntities',
        'addAbilitiesToUnit',
        'toggleCameraFollow',
        'cameraLookAt'
    ];

    constructor(game) {
        super(game);
        this.game.arpgGameSystem = this;
        this.playerEntityId = null;
        this.playerClassId = null;
        this.pendingConfig = null;
    }

    init() {}

    onSceneLoad(sceneData, params) {
        if (!params || !params.isAdventure) return;

        this.pendingConfig = params;

        // Local single-player mode
        this.call.setLocalGame(true, 0);
        this.game.state.gameSeed = Date.now() % 1000000;
        this.game.state.isAdventure = true;

        if (this.game.clientNetworkManager) {
            this.game.clientNetworkManager.numericPlayerId = 0;
        }

        // Resolve level. When traveling via ZoneSystem, game.state.level was
        // already set before the scene switch (TerrainSystem reads it during load).
        if (!params.zoneId) {
            const levelName = params.selectedLevel || 'forest';
            const levelIndex = this.enums.levels?.[levelName] ?? 0;
            this.game.state.level = levelIndex;
        }

        // Point the scene's terrain entity at the level
        const gameScene = this.collections?.scenes?.adventure;
        if (gameScene?.entities) {
            const terrainEntity = gameScene.entities.find(e => e.spawnType === 'terrain');
            if (terrainEntity) {
                terrainEntity.components = terrainEntity.components || {};
                terrainEntity.components.terrain = terrainEntity.components.terrain || {};
                terrainEntity.components.terrain.level = levelIndex;
            }
        }

        this.call.showLoadingScreen();

        // Player entity (stats container, not the character)
        this.call.createPlayerEntity(0, {
            team: this.enums.team.left,
            gold: params.startingGold ?? 0,
            upgrades: 0
        });
        this.call.setActivePlayer(0, this.enums.team.left);
    }

    postSceneLoad() {
        if (!this.pendingConfig) return;
        const config = this.pendingConfig;
        this.pendingConfig = null;

        // Spawn the player character at the requested marker
        this.spawnPlayerCharacter(config.classId || '1_s_barbarian', config.spawnAt || 'entrance');

        // Populate the zone (packs, boss, portals, waypoints) or fall back to
        // the simple placeholder population for direct level loads
        if (config.zoneId && this.game.zoneSystem) {
            this.game.zoneSystem.setupZone(config.zoneId, config);
        } else {
            this.spawnPlaceholderEnemies();
        }

        this.call.initializeGame(null);

        // Real-time combat is always on in adventure mode
        this.game.state.phase = this.enums.gamePhase.battle;
    }

    // ─── Player character ─────────────────────────────────────────────────────

    spawnPlayerCharacter(classId, spawnAt = 'entrance') {
        this.playerClassId = classId;

        const spawn = this.getPlayerSpawnPosition(spawnAt);
        const entityId = this.call.createEntityFromPrefab({
            prefab: 'unit',
            type: classId,
            collection: 'units',
            team: this.enums.team.left,
            componentOverrides: {
                transform: {
                    position: { x: spawn.x, y: spawn.y, z: spawn.z }
                }
            }
        });

        if (entityId == null) {
            console.error('[ArpgGameSystem] Failed to spawn player character:', classId);
            return null;
        }

        // Direct control: remove the AI brain, add player control marker
        this.game.removeComponent(entityId, 'aiState');
        this.game.addComponent(entityId, 'playerControlled', {
            playerId: 0,
            moveX: 0, moveZ: 0,
            aimX: spawn.x, aimY: spawn.y, aimZ: spawn.z + 100,
            attacking: 0
        });

        // Mana / resource pool for skills
        this.game.addComponent(entityId, 'resourcePool', {
            mana: 40, maxMana: 40, manaRegen: 2,
            stamina: 100, maxStamina: 100, staminaRegen: 10,
            focus: 100, maxFocus: 100,
            lastRegenTick: 0
        });

        this.playerEntityId = entityId;
        this.game.state.playerCharacterId = entityId;

        // Camera follows the character (orthographic Diablo-style follow)
        if (this.game.hasService('toggleCameraFollow')) {
            this.call.toggleCameraFollow(entityId);
        }

        this.game.triggerEvent('onPlayerCharacterSpawned', { entityId, classId });
        return entityId;
    }

    getPlayerSpawnPosition(spawnAt = 'entrance') {
        const levelKey = this.reverseEnums.levels?.[this.game.state.level];
        const level = this.collections.levels?.[levelKey];
        const tileMap = level?.tileMap;

        // Generated zones carry precise markers in the arpg block
        let marker = null;
        if (level?.arpg) {
            if (spawnAt === 'exit') marker = level.arpg.exit;
            else if (spawnAt === 'waypoint') marker = level.arpg.waypoint || level.arpg.entrance;
            else marker = level.arpg.entrance;
        }
        if (!marker) {
            const idx = spawnAt === 'exit' ? 1 : 0;
            marker = tileMap?.startingLocations?.[idx] || tileMap?.startingLocations?.[0];
        }
        if (marker) {
            const gridSize = this.collections.configs?.game?.gridSize || 48;
            const size = tileMap?.size || 64;
            const terrainSize = size * gridSize;
            return {
                x: marker.gridX * gridSize - terrainSize / 2 + gridSize / 2,
                y: 0,
                z: marker.gridZ * gridSize - terrainSize / 2 + gridSize / 2
            };
        }
        return { x: 0, y: 0, z: 0 };
    }

    getPlayerCharacter() {
        return this.playerEntityId;
    }

    respawnPlayerCharacter() {
        if (!this.playerClassId) return null;
        return this.spawnPlayerCharacter(this.playerClassId);
    }

    // ─── Placeholder enemies (Phase A) ────────────────────────────────────────

    spawnPlaceholderEnemies() {
        const gridSystem = this.game.gridSystem;
        if (!gridSystem) return;

        const gridWidth = gridSystem.width || 64;
        const gridHeight = gridSystem.height || 64;
        const monsterTeam = this.enums.team.right;

        const packCount = 6;
        const perPack = 4;

        for (let pack = 0; pack < packCount; pack++) {
            const packX = Math.floor(gridWidth * 0.3 + Math.random() * (gridWidth * 0.6));
            const packZ = Math.floor(gridHeight * 0.3 + Math.random() * (gridHeight * 0.6));

            for (let i = 0; i < perPack; i++) {
                const x = packX + Math.floor(Math.random() * 4) - 2;
                const z = packZ + Math.floor(Math.random() * 4) - 2;
                const worldPos = gridSystem.gridToWorld(x, z);
                if (!worldPos) continue;

                const entityId = this.call.createEntityFromPrefab({
                    prefab: 'unit',
                    type: '0_skeleton',
                    collection: 'units',
                    team: monsterTeam,
                    componentOverrides: {
                        transform: { position: { x: worldPos.x, y: worldPos.y || 0, z: worldPos.z } }
                    }
                });

                if (entityId != null) {
                    this.game.addComponent(entityId, 'neutralMonster', {
                        lootTable: 'common',
                        lootChance: 0.3
                    });
                }
            }
        }
    }

    // ─── Player death ─────────────────────────────────────────────────────────

    onUnitKilled(deadEntityId) {
        if (deadEntityId !== this.playerEntityId) return;

        // Simple Phase A respawn: back at spawn point after a moment
        const respawnDelay = 3;
        if (this.game.schedulingSystem) {
            this.game.schedulingSystem.scheduleAction(() => {
                this.respawnPlayerCharacter();
            }, respawnDelay, null);
        }
        this.game.triggerEvent('onPlayerCharacterDied', { entityId: deadEntityId });
    }

    update() {
        // Keep battle phase on while adventuring (some systems gate on it)
        if (this.game.state.isAdventure &&
            this.game.state.phase !== this.enums.gamePhase.battle &&
            this.game.state.phase !== this.enums.gamePhase.ended) {
            this.game.state.phase = this.enums.gamePhase.battle;
        }
    }

    onSceneUnload() {
        this.playerEntityId = null;
        this.playerClassId = null;
        this.pendingConfig = null;
        this.game.state.isAdventure = false;
        this.game.state.playerCharacterId = null;
    }
}
