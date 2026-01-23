/**
 * HuntMissionSystem - Handles hunt missions where players fight neutral monsters and a boss.
 *
 * Hunt missions differ from skirmish:
 * - No AI opponent with buildings
 * - Player spawns skeleton packs and a boss (dragon or golem)
 * - Victory when the boss is killed
 * - Enemies drop loot when killed
 * - No placement phase for enemies - they spawn pre-placed
 */
class HuntMissionSystem extends GUTS.BaseSystem {
    static services = [
        'dropLoot',
        'pickupLoot'
    ];

    static serviceDependencies = [
        'setLocalGame',
        'showLoadingScreen',
        'createPlayerEntity',
        'setActivePlayer',
        'initializeGame',
        'spawnGoldMineForTeam',
        'spawnStartingUnitsForTeam',
        'createEntityFromPrefab',
        'broadcastGameEnd',
        'getPlayerEntities',
        'addCurrency'
    ];

    constructor(game) {
        super(game);
        this.game.huntMissionSystem = this;
        this.bossEntityId = null;
        this.bossDefeated = false;
        this.lootEntities = [];

        // Boss types available
        this.bossTypes = ['dragon_red', '0_golemStone', '0_golemFire', '0_golemIce'];

        // Monster pack config
        this.monsterConfig = {
            packCount: 3,          // Number of skeleton packs
            skeletonsPerPack: 4,   // Skeletons in each pack
            monsterUnit: '0_skeleton'
        };

        // Difficulty scaling for stats (per difficulty level)
        // Difficulty 1 = base stats, each level adds these percentages
        this.difficultyScaling = {
            healthMultiplier: 0.15,   // +15% health per difficulty
            damageMultiplier: 0.10,   // +10% damage per difficulty
            armorMultiplier: 0.05     // +5% armor per difficulty
        };
    }

    init() {
    }

    /**
     * Called when the hunt scene loads
     * Initializes the mission using config passed via scene params
     * @param {Object} sceneData - The scene configuration
     * @param {Object} params - Hunt config passed to switchScene
     */
    onSceneLoad(sceneData, params) {
        if (params && params.isHuntMission) {
            this.initializeHuntMission(params);
        }
    }

    /**
     * Initialize and start a hunt mission
     * @param {Object} config - Mission configuration passed from scene switch
     */
    initializeHuntMission(config) {
        if (!config) {
            console.error('[HuntMissionSystem] No mission config provided');
            return;
        }

        // Store config in game state for other systems to access (e.g., GameUISystem for return handling)
        this.game.state.skirmishConfig = config;

        // Enable entity destruction debugging to track mysterious unit deletions
        this.game.state.debugEntityDestruction = true;

        // Enable local game mode
        this.call.setLocalGame( true, 0);

        // Generate game seed
        this.game.state.gameSeed = Date.now() % 1000000;

        // Player is always on left team, monsters on right (neutral)
        const playerTeam = this.enums.team.left;
        const monsterTeam = this.enums.team.right;

        // Set up player ID
        if (this.game.clientNetworkManager) {
            this.game.clientNetworkManager.numericPlayerId = 0;
        }

        // Set level
        const levelName = config.selectedLevel;
        const levelIndex = this.enums.levels?.[levelName];

        // Validate level exists in enums
        if (levelIndex === undefined) {
            console.warn('[HuntMissionSystem] Level not found in enums:', levelName, 'Available:', Object.keys(this.enums.levels || {}));
        }

        const validLevelIndex = levelIndex ?? 0;
        this.game.state.level = validLevelIndex;
        console.log('[HuntMissionSystem] Starting mission with level:', levelName, '-> index:', validLevelIndex);

        this.call.showLoadingScreen();

        // Update terrain for the scene
        const gameScene = this.collections?.scenes?.hunt;
        if (gameScene?.entities) {
            const terrainEntity = gameScene.entities.find(e => e.prefab === 'terrain');
            if (terrainEntity) {
                terrainEntity.components = terrainEntity.components || {};
                terrainEntity.components.terrain = terrainEntity.components.terrain || {};
                terrainEntity.components.terrain.level = validLevelIndex;
                console.log('[HuntMissionSystem] Set terrain level to:', validLevelIndex);
            }
        }

        // Create player entity only (no AI player entity)
        const startingGold = config.startingGold || 100;
        this.call.createPlayerEntity( 0, {
            team: playerTeam,
            gold: startingGold,
            upgrades: 0
        });

        // Set active player
        if (this.game.hasService('setActivePlayer')) {
            this.call.setActivePlayer( 0, playerTeam);
        }

        // Store config for postSceneLoad to spawn monsters and initialize game
        this.pendingMissionConfig = config;
        this.pendingMonsterTeam = monsterTeam;

        // Mark this as a hunt mission for victory checking
        this.game.state.isHuntMission = true;
        this.bossDefeated = false;
    }

    /**
     * Called after all systems have finished onSceneLoad
     * This ensures WorldSystem has created uiScene before we call initializeGame
     */
    postSceneLoad() {
        if (!this.pendingMissionConfig) return;

        const config = this.pendingMissionConfig;
        const monsterTeam = this.pendingMonsterTeam;
        const playerTeam = this.enums.team.left;

        // Spawn player's starting state (gold mine and units)
        this.spawnStartingState(playerTeam);

        // Spawn monster packs and boss
        this.spawnMonsterPacks(config, monsterTeam);
        this.spawnBoss(config, monsterTeam);

        // Now initialize the game - WorldSystem has created uiScene by now
        this.call.initializeGame( null);

        // Clear pending config
        this.pendingMissionConfig = null;
        this.pendingMonsterTeam = null;
    }

    /**
     * Spawn starting units and gold mine for the player team only
     * Hunt missions don't have an AI opponent with buildings
     */
    spawnStartingState(playerTeam) {
        // Spawn gold mine for player
        this.call.spawnGoldMineForTeam( playerTeam);

        // Spawn starting units for player
        this.call.spawnStartingUnitsForTeam( playerTeam);

        console.log('[HuntMissionSystem] Spawned starting state for player team');
    }

    /**
     * Spawn neutral monster packs (skeletons)
     */
    spawnMonsterPacks(config, monsterTeam) {
        const gridSystem = this.game.gridSystem;
        if (!gridSystem) {
            console.error('[HuntMissionSystem] No grid system available');
            return;
        }

        const packCount = config.packCount || this.monsterConfig.packCount;
        const skeletonsPerPack = config.skeletonsPerPack || this.monsterConfig.skeletonsPerPack;
        const monsterUnit = this.monsterConfig.monsterUnit;
        const difficulty = config.difficulty || 1;

        // Get grid dimensions for placement
        const gridWidth = gridSystem.width || 20;
        const gridHeight = gridSystem.height || 20;

        // Spawn packs on the right side of the map (enemy territory)
        for (let pack = 0; pack < packCount; pack++) {
            // Calculate pack center position (right half of map)
            const packX = Math.floor(gridWidth * 0.6 + Math.random() * (gridWidth * 0.3));
            const packY = Math.floor(gridHeight * 0.2 + Math.random() * (gridHeight * 0.6));

            for (let i = 0; i < skeletonsPerPack; i++) {
                // Spread skeletons around pack center
                const offsetX = Math.floor(Math.random() * 3) - 1;
                const offsetY = Math.floor(Math.random() * 3) - 1;
                const x = packX + offsetX;
                const y = packY + offsetY;

                // Convert grid to world position
                const worldPos = gridSystem.gridToWorld(x, y);
                if (!worldPos) continue;

                // Create skeleton entity using prefab system
                const entityId = this.call.createEntityFromPrefab( {
                    prefab: 'unit',
                    type: monsterUnit,
                    collection: 'units',
                    team: monsterTeam,
                    componentOverrides: {
                        transform: {
                            x: worldPos.x,
                            y: worldPos.y || 0,
                            z: worldPos.z
                        }
                    }
                });

                if (entityId) {
                    // Apply difficulty scaling to stats
                    this.applyDifficultyScaling(entityId, difficulty);

                    // Mark as neutral monster for loot dropping
                    this.game.addComponent(entityId, 'neutralMonster', {
                        lootTable: 'common',
                        lootChance: 0.3
                    });
                }
            }
        }

        console.log('[HuntMissionSystem] Spawned', packCount * skeletonsPerPack, 'monsters at difficulty', difficulty);
    }

    /**
     * Apply difficulty scaling to an entity's stats
     * @param {number} entityId - The entity to scale
     * @param {number} difficulty - The difficulty level (1-5+)
     */
    applyDifficultyScaling(entityId, difficulty) {
        if (difficulty <= 1) return; // No scaling at difficulty 1

        const scalingLevel = difficulty - 1; // How many levels above base

        // Scale health (component uses 'max' and 'current' properties)
        const health = this.game.getComponent(entityId, 'health');
        if (health) {
            const healthMult = 1 + (scalingLevel * this.difficultyScaling.healthMultiplier);
            health.max = Math.floor(health.max * healthMult);
            health.current = health.max;
        }

        // Scale damage via combatStats
        const combatStats = this.game.getComponent(entityId, 'combatStats');
        if (combatStats) {
            const damageMult = 1 + (scalingLevel * this.difficultyScaling.damageMultiplier);
            const armorMult = 1 + (scalingLevel * this.difficultyScaling.armorMultiplier);

            if (combatStats.damage) {
                combatStats.damage = Math.floor(combatStats.damage * damageMult);
            }
            if (combatStats.armor) {
                combatStats.armor = Math.floor(combatStats.armor * armorMult);
            }
        }
    }

    /**
     * Spawn the boss monster
     */
    spawnBoss(config, monsterTeam) {
        const gridSystem = this.game.gridSystem;
        if (!gridSystem) {
            console.error('[HuntMissionSystem] No grid system available');
            return;
        }

        const difficulty = config.difficulty || 1;

        // Select boss type - use config or random
        let bossType = config.bossType;
        if (!bossType) {
            const randomIndex = Math.floor(Math.random() * this.bossTypes.length);
            bossType = this.bossTypes[randomIndex];
        }

        // Spawn boss at the back-right of the map
        const gridWidth = gridSystem.width || 20;
        const gridHeight = gridSystem.height || 20;
        const bossX = Math.floor(gridWidth * 0.85);
        const bossY = Math.floor(gridHeight * 0.5);

        const worldPos = gridSystem.gridToWorld(bossX, bossY);
        if (!worldPos) {
            console.error('[HuntMissionSystem] Could not get boss world position');
            return;
        }

        // Create boss entity using prefab system
        const entityId = this.call.createEntityFromPrefab( {
            prefab: 'unit',
            type: bossType,
            collection: 'units',
            team: monsterTeam,
            componentOverrides: {
                transform: {
                    x: worldPos.x,
                    y: worldPos.y || 0,
                    z: worldPos.z
                }
            }
        });

        if (entityId) {
            this.bossEntityId = entityId;

            // Apply difficulty scaling to boss (bosses get extra scaling)
            this.applyDifficultyScaling(entityId, difficulty + 1);

            // Mark as boss for victory condition and loot
            this.game.addComponent(entityId, 'boss', {
                isBoss: true
            });
            this.game.addComponent(entityId, 'neutralMonster', {
                lootTable: 'rare',
                lootChance: 1.0,
                guaranteedLoot: true
            });

            console.log('[HuntMissionSystem] Spawned boss', bossType, 'at difficulty', difficulty + 1);
        }
    }

    /**
     * Called when battle ends - check if the hunt mission is won (boss defeated)
     */
    onBattleEnd() {
        if (!this.game.state.isHuntMission) {
            return;
        }

        // Already defeated, game should have ended
        if (this.bossDefeated) {
            return;
        }

        if (!this.bossEntityId) {
            return;
        }

        // Check if boss is dead
        const health = this.game.getComponent(this.bossEntityId, 'health');
        const deathState = this.game.getComponent(this.bossEntityId, 'deathState');

        const bossDead = (health && health.current <= 0) ||
                        (deathState && deathState.state >= this.enums.deathState.dying);

        if (bossDead) {
            this.bossDefeated = true;
            console.log('[HuntMissionSystem] Boss defeated - victory!');
            const result = {
                winner: 0,
                reason: 'boss_defeated',
                finalStats: this.getPlayerStatsForBroadcast(),
                totalRounds: this.game.state.round
            };
            this.call.broadcastGameEnd( result);
            this.game.endGame(result);
            return;
        }

        // Boss still alive - continue to next round
    }

    /**
     * Get player stats for game end broadcast
     */
    getPlayerStatsForBroadcast() {
        const stats = {};
        const playerEntities = this.call.getPlayerEntities();
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
     * Drop loot when a neutral monster dies
     * Called by DeathSystem when an entity with neutralMonster component dies
     */
    dropLoot(entityId) {
        const neutralMonster = this.game.getComponent(entityId, 'neutralMonster');
        if (!neutralMonster) return;

        // Check loot chance
        if (!neutralMonster.guaranteedLoot && Math.random() > neutralMonster.lootChance) {
            return;
        }

        // Get entity position
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform) return;

        // Determine loot type based on loot table
        const lootType = this.rollLoot(neutralMonster.lootTable);
        if (!lootType) return;

        // Create loot entity at death position
        const lootEntityId = this.game.createEntity();

        this.game.addComponent(lootEntityId, 'transform', {
            x: transform.x,
            y: transform.y + 5, // Slightly above ground
            z: transform.z
        });

        this.game.addComponent(lootEntityId, 'loot', {
            type: lootType.type,
            amount: lootType.amount,
            currency: lootType.currency || null,
            itemId: lootType.itemId || null
        });

        // Add visual component for rendering
        this.game.addComponent(lootEntityId, 'lootVisual', {
            icon: lootType.icon || 'coin',
            color: lootType.color || '#ffd700',
            scale: 1.0
        });

        this.lootEntities.push(lootEntityId);
    }

    /**
     * Roll for loot based on loot table
     * Loot types: currency, scroll, equipment, consumable, material
     */
    rollLoot(lootTable) {
        const roll = Math.random();
        const isBoss = lootTable === 'rare' || lootTable === 'boss';

        // Determine loot category first
        let category;
        if (isBoss) {
            // Boss loot table - higher chance for rare items
            // 30% scroll, 20% equipment, 15% consumable, 10% material, 25% currency
            if (roll < 0.30) category = 'scroll';
            else if (roll < 0.50) category = 'equipment';
            else if (roll < 0.65) category = 'consumable';
            else if (roll < 0.75) category = 'material';
            else category = 'currency';
        } else {
            // Common loot table
            // 5% scroll, 5% equipment, 10% consumable, 15% material, 65% currency
            if (roll < 0.05) category = 'scroll';
            else if (roll < 0.10) category = 'equipment';
            else if (roll < 0.20) category = 'consumable';
            else if (roll < 0.35) category = 'material';
            else category = 'currency';
        }

        // Generate specific loot based on category
        switch (category) {
            case 'scroll':
                return this.generateScrollLoot(isBoss);
            case 'equipment':
                return this.generateEquipmentLoot(isBoss);
            case 'consumable':
                return this.generateConsumableLoot(isBoss);
            case 'material':
                return this.generateMaterialLoot(isBoss);
            case 'currency':
            default:
                return this.generateCurrencyLoot(isBoss);
        }
    }

    /**
     * Generate a blank prophecy scroll as loot
     * Higher tier scrolls can hold more modifiers
     */
    generateScrollLoot(isBoss) {
        const tier = isBoss ? Math.floor(1 + Math.random() * 2) : 1;

        // Determine rarity based on boss status
        let rarity, rarityName, rarityColor;
        const rarityRoll = Math.random();

        if (isBoss) {
            // Boss: 50% uncommon, 40% rare, 10% epic
            if (rarityRoll < 0.50) {
                rarity = 'uncommon';
                rarityName = 'Uncommon';
                rarityColor = '#2ecc71';
            } else if (rarityRoll < 0.90) {
                rarity = 'rare';
                rarityName = 'Rare';
                rarityColor = '#3498db';
            } else {
                rarity = 'epic';
                rarityName = 'Epic';
                rarityColor = '#9b59b6';
            }
        } else {
            // Regular: 70% common, 25% uncommon, 5% rare
            if (rarityRoll < 0.70) {
                rarity = 'common';
                rarityName = 'Common';
                rarityColor = '#95a5a6';
            } else if (rarityRoll < 0.95) {
                rarity = 'uncommon';
                rarityName = 'Uncommon';
                rarityColor = '#2ecc71';
            } else {
                rarity = 'rare';
                rarityName = 'Rare';
                rarityColor = '#3498db';
            }
        }

        return {
            type: 'scroll',
            itemType: 'missionScroll',
            rarity: rarity,
            tier: tier,
            itemData: {
                tier: tier,
                modifiers: [],
                rewardMultiplier: 1.0,
                maxModifiers: Math.min(3, Math.floor(tier / 2) + 1),
                timesRolled: 0
            },
            icon: 'scroll',
            color: rarityColor,
            name: `${rarityName} Prophecy Scroll`
        };
    }

    /**
     * Generate equipment/artifact loot
     */
    generateEquipmentLoot(isBoss) {
        const equipmentTypes = [
            { id: 'warBanner', name: 'War Banner', effect: 'unitDamage', value: 5, icon: 'banner', color: '#e74c3c' },
            { id: 'ironShield', name: 'Iron Shield', effect: 'unitHealth', value: 10, icon: 'shield', color: '#7f8c8d' },
            { id: 'goldPouch', name: 'Gold Pouch', effect: 'startingGold', value: 15, icon: 'pouch', color: '#f39c12' },
            { id: 'tacticalMap', name: 'Tactical Map', effect: 'missionRewards', value: 5, icon: 'map', color: '#9b59b6' },
            { id: 'veteranMedal', name: 'Veteran Medal', effect: 'unitDamage', value: 3, icon: 'medal', color: '#ffd700' }
        ];

        // Boss drops better equipment
        const equipment = equipmentTypes[Math.floor(Math.random() * equipmentTypes.length)];
        const bonusMultiplier = isBoss ? 1.5 : 1.0;

        return {
            type: 'equipment',
            itemType: 'equipment',
            itemData: {
                equipmentId: equipment.id,
                effect: equipment.effect,
                value: Math.floor(equipment.value * bonusMultiplier)
            },
            icon: equipment.icon,
            color: equipment.color,
            name: equipment.name
        };
    }

    /**
     * Generate consumable loot
     */
    generateConsumableLoot(isBoss) {
        const consumables = [
            { id: 'goldCoin', name: 'Gold Coin', effect: 'bonusGold', value: 25, icon: 'coin', color: '#ffd700' },
            { id: 'reinforcements', name: 'Reinforcements', effect: 'bonusUnit', unitType: '1_sd_soldier', icon: 'troops', color: '#3498db' },
            { id: 'healingPotion', name: 'Healing Salve', effect: 'healUnits', value: 20, icon: 'potion', color: '#2ecc71' },
            { id: 'warHorn', name: 'War Horn', effect: 'damageBoost', value: 15, duration: 30, icon: 'horn', color: '#e67e22' },
            { id: 'scoutReport', name: 'Scout Report', effect: 'revealMap', icon: 'eye', color: '#1abc9c' }
        ];

        const consumable = consumables[Math.floor(Math.random() * consumables.length)];
        const bonusMultiplier = isBoss ? 1.5 : 1.0;

        return {
            type: 'consumable',
            itemType: 'consumable',
            itemData: {
                consumableId: consumable.id,
                effect: consumable.effect,
                value: consumable.value ? Math.floor(consumable.value * bonusMultiplier) : undefined,
                unitType: consumable.unitType,
                duration: consumable.duration
            },
            icon: consumable.icon,
            color: consumable.color,
            name: consumable.name
        };
    }

    /**
     * Generate crafting material loot
     */
    generateMaterialLoot(isBoss) {
        const materials = [
            { id: 'ironOre', name: 'Iron Ore', rarity: 'common', icon: 'ore', color: '#7f8c8d' },
            { id: 'boneFragment', name: 'Bone Fragment', rarity: 'common', icon: 'bone', color: '#ecf0f1' },
            { id: 'dragonScale', name: 'Dragon Scale', rarity: 'rare', icon: 'scale', color: '#c0392b' },
            { id: 'essenceShard', name: 'Essence Shard', rarity: 'rare', icon: 'shard', color: '#9b59b6' },
            { id: 'ancientRune', name: 'Ancient Rune', rarity: 'epic', icon: 'rune', color: '#f39c12' }
        ];

        // Filter by rarity based on boss
        let availableMaterials;
        if (isBoss) {
            availableMaterials = materials; // Boss can drop anything
        } else {
            availableMaterials = materials.filter(m => m.rarity === 'common');
        }

        const material = availableMaterials[Math.floor(Math.random() * availableMaterials.length)];
        const amount = isBoss ? Math.floor(2 + Math.random() * 3) : Math.floor(1 + Math.random() * 2);

        return {
            type: 'material',
            itemType: 'material',
            itemData: {
                materialId: material.id,
                rarity: material.rarity
            },
            amount: amount,
            icon: material.icon,
            color: material.color,
            name: material.name
        };
    }

    /**
     * Generate currency loot
     */
    generateCurrencyLoot(isBoss) {
        const roll = Math.random();

        if (isBoss) {
            // Boss drops better currency
            if (roll < 0.4) {
                return { type: 'currency', currency: 'glory', amount: Math.floor(5 + Math.random() * 10), icon: 'trophy', color: '#ffd700' };
            } else if (roll < 0.7) {
                return { type: 'currency', currency: 'valor', amount: Math.floor(20 + Math.random() * 30), icon: 'sword', color: '#cd7f32' };
            } else {
                return { type: 'currency', currency: 'essence', amount: Math.floor(1 + Math.random() * 3), icon: 'star', color: '#9b59b6' };
            }
        } else {
            // Common currency drops
            if (roll < 0.8) {
                return { type: 'currency', currency: 'valor', amount: Math.floor(3 + Math.random() * 8), icon: 'sword', color: '#cd7f32' };
            } else {
                return { type: 'currency', currency: 'glory', amount: Math.floor(1 + Math.random() * 2), icon: 'trophy', color: '#ffd700' };
            }
        }
    }

    /**
     * Pick up loot when player clicks on it
     */
    pickupLoot(lootEntityId) {
        const loot = this.game.getComponent(lootEntityId, 'loot');
        if (!loot) {
            console.warn('[HuntMissionSystem] No loot component on entity:', lootEntityId);
            return false;
        }

        // Handle different loot types
        switch (loot.type) {
            case 'currency':
                this.pickupCurrency(loot);
                break;
            case 'scroll':
            case 'equipment':
            case 'consumable':
            case 'material':
                this.pickupItem(loot);
                break;
            default:
                console.warn('[HuntMissionSystem] Unknown loot type:', loot.type);
        }

        // Remove loot entity
        this.game.destroyEntity(lootEntityId);
        this.lootEntities = this.lootEntities.filter(id => id !== lootEntityId);

        return true;
    }

    /**
     * Add currency to campaign
     */
    pickupCurrency(loot) {
        if (this.game.hasService('addCurrency')) {
            this.call.addCurrency( loot.currency, loot.amount);
        } else {
            // Store for later if campaign system not available
            this.game.state.pendingLoot = this.game.state.pendingLoot || [];
            this.game.state.pendingLoot.push({ type: 'currency', currency: loot.currency, amount: loot.amount });
        }
    }

    /**
     * Add item to campaign inventory
     */
    pickupItem(loot) {
        // Store item in pending loot to add to inventory after mission
        this.game.state.pendingLoot = this.game.state.pendingLoot || [];
        this.game.state.pendingLoot.push({
            type: loot.type,
            itemType: loot.itemType,
            itemData: loot.itemData,
            rarity: loot.rarity,
            tier: loot.tier,
            amount: loot.amount || 1,
            name: loot.name,
            icon: loot.icon,
            color: loot.color
        });
    }

    onSceneUnload() {
        this.bossEntityId = null;
        this.bossDefeated = false;
        this.lootEntities = [];
        this.game.state.isHuntMission = false;
    }
}
