/**
 * SurvivalMissionSystem - Handles survival missions where players defend against 30 waves of enemies.
 *
 * Survival missions differ from hunt/skirmish:
 * - Player defends their base against waves of enemies
 * - 30 total waves with increasing difficulty
 * - Enemies spawn at the start of each round
 * - Victory when all 30 waves are defeated
 * - Defeat if player's base is destroyed
 */
class SurvivalMissionSystem extends GUTS.BaseSystem {
    static services = [
        'spawnSurvivalWave',
        'getSurvivalWaveInfo'
    ];

    constructor(game) {
        super(game);
        this.game.survivalMissionSystem = this;

        // Survival config
        this.totalWaves = 6;     // 6 waves total
        this.currentWave = 0;
        this.waveEnemiesAlive = 0;
        this.missionComplete = false;
        this.missionFailed = false;
        this.roundsPerWave = 5;  // Waves spawn every 5 rounds (rounds 1, 6, 11, 16, 21, 26)

        // Enemy types available for waves (using existing units from collection)
        // Wave difficulty progresses through tiers of increasingly tough enemies
        this.enemyTypes = {
            basic: ['0_skeleton'],                                    // Wave 1-2: skeletons only
            medium: ['0_skeleton', '1_s_barbarian'],                  // Wave 3-4: add barbarians
            hard: ['1_s_barbarian', '2_s_berserker', '2_s_gladiator'], // Wave 5: tougher melee
            elite: ['2_s_berserker', '2_s_gladiator', '2_s_warlord']   // Wave 6: elite fighters
        };

        // Boss types for final wave
        this.bossTypes = ['0_golemStone', '0_golemFire', '0_golemIce', 'dragon_red'];

        // Difficulty scaling per wave
        this.difficultyScaling = {
            healthMultiplier: 0.05,   // +5% health per wave
            damageMultiplier: 0.03,   // +3% damage per wave
            armorMultiplier: 0.02     // +2% armor per wave
        };
    }

    init() {
    }

    /**
     * Called when the survival scene loads
     */
    onSceneLoad(sceneData, params) {
        console.log('[SurvivalMissionSystem] onSceneLoad called, params:', params);
        if (params && params.isSurvivalMission) {
            this.initializeSurvivalMission(params);
        } else {
            console.warn('[SurvivalMissionSystem] No isSurvivalMission flag in params');
        }
    }

    /**
     * Initialize and start a survival mission
     */
    initializeSurvivalMission(config) {
        if (!config) {
            console.error('[SurvivalMissionSystem] No mission config provided');
            return;
        }

        // Store config in game state
        this.game.state.skirmishConfig = config;
        this.game.state.debugEntityDestruction = true;

        // Enable local game mode
        this.game.call('setLocalGame', true, 0);

        // Generate game seed
        this.game.state.gameSeed = Date.now() % 1000000;

        // Player is always on left team, enemies on right
        const playerTeam = this.enums.team.left;
        const enemyTeam = this.enums.team.right;

        // Set up player ID
        if (this.game.clientNetworkManager) {
            this.game.clientNetworkManager.numericPlayerId = 0;
        }

        // Set level
        const levelName = config.selectedLevel;
        const levelIndex = this.enums.levels?.[levelName];
        const validLevelIndex = levelIndex ?? 0;
        this.game.state.level = validLevelIndex;
        console.log('[SurvivalMissionSystem] Starting mission with level:', levelName, '-> index:', validLevelIndex);

        this.game.call('showLoadingScreen');

        // Update terrain for the scene
        const gameScene = this.collections?.scenes?.survival;
        if (gameScene?.entities) {
            const terrainEntity = gameScene.entities.find(e => e.prefab === 'terrain');
            if (terrainEntity) {
                terrainEntity.components = terrainEntity.components || {};
                terrainEntity.components.terrain = terrainEntity.components.terrain || {};
                terrainEntity.components.terrain.level = validLevelIndex;
            }
        }

        // Create player entity (human player)
        const startingGold = config.startingGold || 150;
        this.game.call('createPlayerEntity', 0, {
            team: playerTeam,
            gold: startingGold,
            upgrades: 0
        });

        // Create enemy AI player entity (for wave spawning)
        // This allows ui_placeUnit to work for enemy team placements
        this.game.call('createPlayerEntity', 1, {
            team: enemyTeam,
            gold: 999999, // Unlimited gold for spawning waves
            upgrades: 0
        });

        // Set active player (human player)
        if (this.game.hasService('setActivePlayer')) {
            this.game.call('setActivePlayer', 0, playerTeam);
        }

        // Store config for postSceneLoad
        this.pendingMissionConfig = config;
        this.pendingEnemyTeam = enemyTeam;

        // Mark this as a survival mission
        this.game.state.isSurvivalMission = true;
        this.currentWave = 0;
        this.missionComplete = false;
        this.missionFailed = false;

        // Store base difficulty from config
        this.baseDifficulty = config.difficulty || 1;
    }

    /**
     * Called after all systems have finished onSceneLoad
     */
    postSceneLoad() {
        console.log('[SurvivalMissionSystem] postSceneLoad called, pendingMissionConfig:', !!this.pendingMissionConfig);
        if (!this.pendingMissionConfig) return;

        const config = this.pendingMissionConfig;
        const playerTeam = this.enums.team.left;

        // Spawn player's starting state (gold mine and units)
        this.spawnStartingState(playerTeam);

        // Initialize the game
        console.log('[SurvivalMissionSystem] Calling initializeGame');
        this.game.call('initializeGame', null);

        // Store enemy team for wave spawning
        this.enemyTeam = this.pendingEnemyTeam;

        // Auto-ready the enemy AI player so battle can start when human player is ready
        // The enemy AI (player 1) doesn't need to manually click ready
        if (this.game.serverNetworkSystem?.placementReadyStates) {
            this.game.serverNetworkSystem.placementReadyStates.set(1, true);
            console.log('[SurvivalMissionSystem] Auto-readied enemy AI player');
        }

        // Clear pending config
        this.pendingMissionConfig = null;
        this.pendingEnemyTeam = null;

        console.log('[SurvivalMissionSystem] Survival mission initialized, waiting for first round');
    }

    /**
     * Spawn starting units and gold mine for the player team only
     * Survival missions spawn enemies in waves, not at start
     */
    spawnStartingState(playerTeam) {
        // Spawn gold mine for player
        this.game.call('spawnGoldMineForTeam', playerTeam);

        // Spawn starting units for player
        this.game.call('spawnStartingUnitsForTeam', playerTeam);

        console.log('[SurvivalMissionSystem] Spawned starting state for player team');
    }

    /**
     * Called when placement phase starts (after round counter increments)
     * This is triggered by ServerBattlePhaseSystem after each battle ends
     */
    onPlacementPhaseStart() {
        console.log('[SurvivalMissionSystem] onPlacementPhaseStart called, isSurvivalMission:', this.game.state.isSurvivalMission, 'enemyTeam:', this.enemyTeam);
        if (!this.game.state.isSurvivalMission) return;
        if (this.missionComplete || this.missionFailed) return;

        // Auto-ready the enemy AI player each round using the UI interface
        this.game.call('ui_toggleReadyForBattle', this.enemyTeam, () => {
            console.log('[SurvivalMissionSystem] Enemy AI player readied for battle');
        });

        const roundNumber = this.game.state.round || 1;
        console.log('[SurvivalMissionSystem] Round:', roundNumber, 'currentWave:', this.currentWave);

        // Waves spawn on rounds 5, 10, 15, 20, 25, 30
        // First wave on round 5 gives player 4 rounds to set up
        const isWaveRound = roundNumber >= this.roundsPerWave && roundNumber % this.roundsPerWave === 0;
        console.log('[SurvivalMissionSystem] isWaveRound:', isWaveRound, '(roundsPerWave:', this.roundsPerWave, ')');

        if (!isWaveRound) {
            // Not a wave round, just update UI with countdown
            const roundsUntilNextWave = this.roundsPerWave - (roundNumber % this.roundsPerWave);
            this.game.triggerEvent('onSurvivalWaveCountdown', {
                currentWave: this.currentWave,
                totalWaves: this.totalWaves,
                roundsUntilNextWave: roundsUntilNextWave
            });
            return;
        }

        // Increment wave counter
        this.currentWave++;

        if (this.currentWave > this.totalWaves) {
            // All waves complete, check for victory
            return;
        }

        console.log('[SurvivalMissionSystem] Wave', this.currentWave, 'of', this.totalWaves, 'starting (round', roundNumber, ')');

        // Spawn enemies for this wave
        this.spawnSurvivalWave(this.currentWave);

        // Emit wave info for UI
        this.game.triggerEvent('onSurvivalWaveStart', {
            wave: this.currentWave,
            totalWaves: this.totalWaves
        });
    }

    /**
     * Spawn enemies for the given wave using the standard placement pipeline
     */
    spawnSurvivalWave(waveNumber) {
        console.log('[SurvivalMissionSystem] spawnSurvivalWave called for wave', waveNumber, 'enemyTeam:', this.enemyTeam);
        const gridSystem = this.game.gridSystem;
        if (!gridSystem) {
            console.error('[SurvivalMissionSystem] No grid system available');
            return;
        }

        const gridWidth = gridSystem.width || 20;
        const gridHeight = gridSystem.height || 20;
        console.log('[SurvivalMissionSystem] Grid dimensions:', gridWidth, 'x', gridHeight);

        // Calculate wave composition
        const waveConfig = this.getWaveConfig(waveNumber);

        // Track spawned placements for issuing move orders
        const spawnedPlacements = [];

        // Get starting locations from the level data
        const startingLocations = this.game.call('getStartingLocationsFromLevel');
        if (!startingLocations) {
            console.error('[SurvivalMissionSystem] No starting locations found in level');
            return;
        }

        // Player is team.left, enemies are team.right
        const playerStartLoc = startingLocations[this.enums.team.left];
        const enemyStartLoc = startingLocations[this.enums.team.right];

        if (!playerStartLoc || !enemyStartLoc) {
            console.error('[SurvivalMissionSystem] Missing starting location for player or enemy');
            return;
        }

        // Target is the player's starting location (where enemies should attack)
        const targetWorldPos = gridSystem.gridToWorld(playerStartLoc.x, playerStartLoc.z);
        console.log('[SurvivalMissionSystem] Enemy spawn location:', enemyStartLoc, 'Target (player base):', playerStartLoc, targetWorldPos);

        // Spawn regular enemies using ui_placeUnit
        for (const enemyGroup of waveConfig.enemies) {
            for (let i = 0; i < enemyGroup.count; i++) {
                // Spawn around the enemy starting location with some spread
                const gridX = enemyStartLoc.x + Math.floor(Math.random() * 8) - 4;
                const gridZ = enemyStartLoc.z + Math.floor(Math.random() * 8) - 4;

                const unitType = {
                    id: enemyGroup.type,
                    collection: 'units',
                    ...this.collections.units[enemyGroup.type]
                };

                // Use the standard placement pipeline (same as simulations)
                const playerId = 1; // Enemy player
                this.game.call('ui_placeUnit',
                    { x: gridX, z: gridZ },
                    unitType,
                    this.enemyTeam,
                    playerId,
                    null,
                    (success, response) => {
                        if (success && response?.placementId) {
                            console.log('[SurvivalMissionSystem] Spawned enemy at grid', gridX, gridZ, 'placementId:', response.placementId);
                            spawnedPlacements.push(response.placementId);

                            // Apply difficulty scaling to the spawned units
                            const placement = this.game.call('getPlacementById', response.placementId);
                            if (placement?.squadUnits) {
                                for (const entityId of placement.squadUnits) {
                                    this.applyWaveScaling(entityId, waveNumber);

                                    // Add neutral monster for loot drops
                                    this.game.addComponent(entityId, 'neutralMonster', {
                                        lootTable: 'common',
                                        lootChance: 0.2
                                    });
                                }
                            }

                            // Issue move order toward player's base
                            if (targetWorldPos) {
                                this.game.call('ui_issueMoveOrder',
                                    [response.placementId],
                                    { x: targetWorldPos.x, z: targetWorldPos.z },
                                    {},
                                    () => {}
                                );
                            }
                        } else {
                            console.warn('[SurvivalMissionSystem] Failed to spawn enemy:', response);
                        }
                    }
                );
            }
        }

        // Spawn boss on final wave
        if (waveConfig.boss) {
            // Boss spawns at enemy starting location
            const bossGridX = enemyStartLoc.x;
            const bossGridZ = enemyStartLoc.z;

            const bossUnitType = {
                id: waveConfig.boss,
                collection: 'units',
                ...this.collections.units[waveConfig.boss]
            };

            const playerId = 1;
            this.game.call('ui_placeUnit',
                { x: bossGridX, z: bossGridZ },
                bossUnitType,
                this.enemyTeam,
                playerId,
                null,
                (success, response) => {
                    if (success && response?.placementId) {
                        console.log('[SurvivalMissionSystem] Boss spawned, placementId:', response.placementId);

                        const placement = this.game.call('getPlacementById', response.placementId);
                        if (placement?.squadUnits) {
                            for (const entityId of placement.squadUnits) {
                                this.applyWaveScaling(entityId, waveNumber + 5);

                                this.game.addComponent(entityId, 'neutralMonster', {
                                    lootTable: 'rare',
                                    lootChance: 1.0,
                                    guaranteedLoot: true
                                });

                                this.game.addComponent(entityId, 'boss', { isBoss: true });
                            }
                        }

                        // Issue move order toward player's base
                        if (targetWorldPos) {
                            this.game.call('ui_issueMoveOrder',
                                [response.placementId],
                                { x: targetWorldPos.x, z: targetWorldPos.z },
                                {},
                                () => {}
                            );
                        }
                    }
                }
            );
        }

        console.log('[SurvivalMissionSystem] Spawning wave', waveNumber, 'with config:', waveConfig);
    }

    /**
     * Get the wave configuration based on wave number (1-6)
     */
    getWaveConfig(waveNumber) {
        const config = {
            enemies: [],
            boss: null
        };

        // Base enemy count scales with wave (more enemies each wave)
        const baseCount = 4 + (waveNumber * 2);

        // Determine enemy tier based on wave (6 waves total)
        let enemyPool;
        if (waveNumber <= 2) {
            enemyPool = this.enemyTypes.basic;
        } else if (waveNumber <= 4) {
            enemyPool = this.enemyTypes.medium;
        } else if (waveNumber <= 5) {
            enemyPool = this.enemyTypes.hard;
        } else {
            enemyPool = this.enemyTypes.elite;
        }

        // Pick random enemy types from the pool (more variety in later waves)
        const enemyTypeCount = Math.min(3, Math.ceil(waveNumber / 2));
        const selectedTypes = [];
        for (let i = 0; i < enemyTypeCount; i++) {
            const type = enemyPool[Math.floor(Math.random() * enemyPool.length)];
            if (!selectedTypes.includes(type)) {
                selectedTypes.push(type);
            }
        }

        // Distribute enemies among selected types
        for (const type of selectedTypes) {
            config.enemies.push({
                type: type,
                count: Math.floor(baseCount / selectedTypes.length) + Math.floor(Math.random() * 2)
            });
        }

        // Boss spawns on the final wave (wave 6)
        if (waveNumber === this.totalWaves) {
            const bossIndex = Math.floor(Math.random() * this.bossTypes.length);
            config.boss = this.bossTypes[bossIndex];
        }

        return config;
    }

    /**
     * Apply wave-based difficulty scaling to an entity
     * Also ensures enemies have proper visionRange to find targets
     */
    applyWaveScaling(entityId, waveNumber) {
        // Scale health
        const health = this.game.getComponent(entityId, 'health');
        if (health) {
            const scalingLevel = (waveNumber - 1) + (this.baseDifficulty - 1);
            if (scalingLevel > 0) {
                const healthMult = 1 + (scalingLevel * this.difficultyScaling.healthMultiplier);
                health.max = Math.floor(health.max * healthMult);
                health.current = health.max;
            }
        }

        // Scale combat stats and ensure visionRange is set
        const combat = this.game.getComponent(entityId, 'combat');
        if (combat) {
            const scalingLevel = (waveNumber - 1) + (this.baseDifficulty - 1);
            if (scalingLevel > 0) {
                const damageMult = 1 + (scalingLevel * this.difficultyScaling.damageMultiplier);
                const armorMult = 1 + (scalingLevel * this.difficultyScaling.armorMultiplier);

                if (combat.damage) {
                    combat.damage = Math.floor(combat.damage * damageMult);
                }
                if (combat.armor) {
                    combat.armor = Math.floor(combat.armor * armorMult);
                }
            }

            // Ensure enemies have visionRange to find targets (default 500 if not set)
            if (!combat.visionRange || combat.visionRange === 0) {
                combat.visionRange = 500;
            }
        }
    }

    /**
     * Called when battle ends - check survival mission victory/defeat conditions
     */
    onBattleEnd() {
        if (!this.game.state.isSurvivalMission) {
            return;
        }

        // Already determined outcome
        if (this.missionComplete || this.missionFailed) {
            return;
        }

        // Check if player's base is destroyed (loss condition)
        const playerBuildings = this.getPlayerBuildings();
        if (playerBuildings.length === 0) {
            this.missionFailed = true;
            console.log('[SurvivalMissionSystem] Base destroyed - mission failed');
            const result = {
                winner: -1,
                reason: 'base_destroyed',
                finalStats: this.getPlayerStatsForBroadcast(),
                totalRounds: this.game.state.round,
                wavesCompleted: this.currentWave,
                totalWaves: this.totalWaves
            };
            this.game.call('broadcastGameEnd', result);
            this.game.endGame(result);
            return;
        }

        // Check if all waves complete and all enemies dead (victory condition)
        if (this.currentWave >= this.totalWaves) {
            const enemiesAlive = this.countAliveEnemies();
            if (enemiesAlive === 0) {
                this.missionComplete = true;
                console.log('[SurvivalMissionSystem] All', this.totalWaves, 'waves complete - victory!');
                const result = {
                    winner: 0,
                    reason: 'survival_complete',
                    finalStats: this.getPlayerStatsForBroadcast(),
                    totalRounds: this.game.state.round,
                    wavesCompleted: this.currentWave,
                    totalWaves: this.totalWaves
                };
                this.game.call('broadcastGameEnd', result);
                this.game.endGame(result);
                return;
            }
        }

        // No victory/defeat - continue to next round
    }

    /**
     * Get player stats for game end broadcast
     */
    getPlayerStatsForBroadcast() {
        const stats = {};
        const playerEntities = this.game.call('getPlayerEntities');
        for (const entityId of playerEntities) {
            const playerStats = this.game.getComponent(entityId, 'playerStats');
            if (playerStats) {
                stats[playerStats.playerId] = {
                    name: playerStats.playerId === 0 ? 'Player' : 'Opponent',
                    stats: {
                        team: playerStats.team,
                        gold: playerStats.gold,
                        upgrades: playerStats.upgrades
                    }
                };
            }
        }
        return stats;
    }

    /**
     * Get all alive player buildings
     */
    getPlayerBuildings() {
        const buildings = [];
        const playerTeam = this.enums.team.left;

        const buildingEntities = this.game.getEntitiesWith('unitType', 'team', 'health');
        for (const entityId of buildingEntities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (!unitType || unitType.collection !== 'buildings') continue;

            const health = this.game.getComponent(entityId, 'health');
            if (!health || health.current <= 0) continue;

            const deathState = this.game.getComponent(entityId, 'deathState');
            if (deathState && deathState.state >= this.enums.deathState.dying) continue;

            const team = this.game.getComponent(entityId, 'team');
            if (team && team.team === playerTeam) {
                buildings.push(entityId);
            }
        }

        return buildings;
    }

    /**
     * Count alive survival enemies
     */
    countAliveEnemies() {
        let count = 0;
        const enemyEntities = this.game.getEntitiesWith('survivalEnemy', 'health');

        for (const entityId of enemyEntities) {
            const health = this.game.getComponent(entityId, 'health');
            if (!health || health.current <= 0) continue;

            const deathState = this.game.getComponent(entityId, 'deathState');
            if (deathState && deathState.state >= this.enums.deathState.dying) continue;

            count++;
        }

        return count;
    }

    /**
     * Get current survival wave info (for UI display)
     */
    getSurvivalWaveInfo() {
        const currentRound = this.game.state.round || 1;
        // Waves spawn on rounds 5, 10, 15, 20, 25, 30
        const roundsUntilNextWave = this.roundsPerWave - (currentRound % this.roundsPerWave);

        return {
            currentWave: this.currentWave,
            totalWaves: this.totalWaves,
            enemiesAlive: this.countAliveEnemies(),
            isComplete: this.missionComplete,
            isFailed: this.missionFailed,
            roundsPerWave: this.roundsPerWave,
            roundsUntilNextWave: roundsUntilNextWave
        };
    }

    onSceneUnload() {
        this.currentWave = 0;
        this.waveEnemiesAlive = 0;
        this.missionComplete = false;
        this.missionFailed = false;
        this.enemyTeam = null;
        this.game.state.isSurvivalMission = false;
    }
}
