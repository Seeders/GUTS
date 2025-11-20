class ServerEnemySpawnerSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.serverEnemySpawnerSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;

        // Track spawned enemies per room
        this.roomEnemies = new Map(); // roomId -> Set of entityIds
        this.enemyData = new Map(); // entityId -> enemy data

        // Spawn configuration
        this.spawnInterval = 5000; // ms between spawn checks
        this.maxEnemiesPerRoom = 20;
        this.spawnRadius = 600;
        this.minSpawnDistance = 300;

        // Wave management per room
        this.roomWaves = new Map(); // roomId -> wave data

        // Enemy tiers will be loaded from enemySets collection
        this.enemyTiers = null;
    }

    init(params) {
        this.params = params || {};

        // Load enemy tiers from enemySets collection
        this.loadEnemyTiers();

        // Register game manager methods
        this.game.gameManager.register('spawnEnemyForRoom', this.spawnEnemyForRoom.bind(this));
        this.game.gameManager.register('removeEnemyFromRoom', this.removeEnemyFromRoom.bind(this));
        this.game.gameManager.register('getRoomEnemies', this.getRoomEnemies.bind(this));
        this.game.gameManager.register('startWaveForRoom', this.startWaveForRoom.bind(this));

        this.subscribeToEvents();

        // Start spawn timer
        this.lastSpawnCheck = 0;
    }

    loadEnemyTiers() {
        const collections = this.game.getCollections();
        const enemySets = collections.enemySets;

        if (!enemySets) {
            console.warn('ServerEnemySpawnerSystem: No enemySets collection found, using defaults');
            this.enemyTiers = {
                easy: ['0_skeleton', 'peasant'],
                medium: ['1_sd_soldier', '1_d_archer'],
                hard: ['1_s_barbarian', '0_golemStone'],
                elite: ['2_s_berserker', '2_d_ranger']
            };
            return;
        }

        // Build enemy tiers from enemySets collection
        this.enemyTiers = {};
        for (const [setId, setData] of Object.entries(enemySets)) {
            if (setData.units && setData.units.length > 0) {
                this.enemyTiers[setId] = setData.units;
            }
        }

        console.log('ServerEnemySpawnerSystem: Loaded enemy tiers:', Object.keys(this.enemyTiers));
    }

    subscribeToEvents() {
        if (!this.game.serverEventManager) {
            console.error('ServerEnemySpawnerSystem: No event manager found');
            return;
        }

        this.game.serverEventManager.subscribe('REQUEST_ENEMY_SPAWN', this.handleRequestEnemySpawn.bind(this));
        this.game.serverEventManager.subscribe('ENEMY_KILLED', this.handleEnemyKilled.bind(this));
        this.game.serverEventManager.subscribe('REQUEST_ROOM_ENEMIES', this.handleRequestRoomEnemies.bind(this));
        this.game.serverEventManager.subscribe('START_WAVE', this.handleStartWave.bind(this));
    }

    handleRequestEnemySpawn(eventData) {
        try {
            const { playerId, data } = eventData;
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            // Check if room can have more enemies
            const roomEnemies = this.roomEnemies.get(roomId) || new Set();
            if (roomEnemies.size >= this.maxEnemiesPerRoom) {
                return;
            }

            // Spawn enemy at requested or random position
            const spawnPosition = data.position || this.getRandomSpawnPosition(roomId);
            const enemyType = data.enemyType || this.getRandomEnemyType(roomId);
            const tier = data.tier || 1;

            this.spawnEnemyForRoom(roomId, enemyType, spawnPosition, tier);

        } catch (error) {
            console.error('ServerEnemySpawnerSystem: Error handling spawn request:', error);
        }
    }

    handleEnemyKilled(eventData) {
        try {
            const { playerId, data } = eventData;
            const { entityId, killerEntityId } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            // Remove from tracking
            this.removeEnemyFromRoom(roomId, entityId);

            // Get enemy data for rewards
            const enemyInfo = this.enemyData.get(entityId);

            // Broadcast death to all players
            this.serverNetworkManager.broadcastToRoom(roomId, 'ENEMY_DIED', {
                entityId: entityId,
                killerEntityId: killerEntityId,
                enemyType: enemyInfo ? enemyInfo.type : 'unknown',
                tier: enemyInfo ? enemyInfo.tier : 1,
                position: enemyInfo ? enemyInfo.position : null
            });

            // Clean up enemy data
            this.enemyData.delete(entityId);

            // Check wave completion
            this.checkWaveCompletion(roomId);

        } catch (error) {
            console.error('ServerEnemySpawnerSystem: Error handling enemy killed:', error);
        }
    }

    handleRequestRoomEnemies(eventData) {
        try {
            const { playerId } = eventData;
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const enemies = this.getRoomEnemiesData(roomId);

            this.serverNetworkManager.sendToPlayer(playerId, 'ROOM_ENEMIES', {
                enemies: enemies
            });

        } catch (error) {
            console.error('ServerEnemySpawnerSystem: Error handling room enemies request:', error);
        }
    }

    handleStartWave(eventData) {
        try {
            const { playerId, data } = eventData;
            const { waveNumber } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            this.startWaveForRoom(roomId, waveNumber);

        } catch (error) {
            console.error('ServerEnemySpawnerSystem: Error handling start wave:', error);
        }
    }

    spawnEnemyForRoom(roomId, enemyType, position, tier = 1) {
        // Initialize room enemy set if needed
        if (!this.roomEnemies.has(roomId)) {
            this.roomEnemies.set(roomId, new Set());
        }

        const roomEnemies = this.roomEnemies.get(roomId);

        // Check max enemies
        if (roomEnemies.size >= this.maxEnemiesPerRoom) {
            return null;
        }

        // Create enemy entity on server
        const entityId = this.createEnemyEntity(enemyType, position, tier);
        if (!entityId) return null;

        // Track enemy
        roomEnemies.add(entityId);
        this.enemyData.set(entityId, {
            type: enemyType,
            tier: tier,
            position: { x: position.x, y: position.y },
            spawnTime: Date.now()
        });

        // Broadcast spawn to all players in room
        this.serverNetworkManager.broadcastToRoom(roomId, 'ENEMY_SPAWNED', {
            entityId: entityId,
            enemyType: enemyType,
            position: position,
            tier: tier,
            components: this.serializeEnemyComponents(entityId)
        });

        return entityId;
    }

    createEnemyEntity(enemyType, position, tier) {
        // Get enemy definition
        const enemyDef = this.getEnemyDefinition(enemyType);
        if (!enemyDef) {
            console.error('ServerEnemySpawnerSystem: Unknown enemy type:', enemyType);
            return null;
        }

        // Create entity with descriptive string ID
        const roundedX = Math.round(position.x);
        const roundedY = Math.round(position.y);
        const timestamp = this.game.state.now || Date.now();
        const entityId = this.game.createEntity(`server_enemy_${enemyType}_${roundedX}_${roundedY}_${timestamp}`);

        // Add components
        this.game.addComponent(entityId, 'Position', {
            x: position.x,
            y: position.y
        });

        this.game.addComponent(entityId, 'Velocity', {
            x: 0,
            y: 0
        });

        // Scale stats by tier
        const tierMultiplier = 1 + (tier - 1) * 0.5;

        this.game.addComponent(entityId, 'Health', {
            current: Math.floor(enemyDef.health * tierMultiplier),
            max: Math.floor(enemyDef.health * tierMultiplier)
        });

        this.game.addComponent(entityId, 'Combat', {
            damage: Math.floor(enemyDef.damage * tierMultiplier),
            attackSpeed: enemyDef.attackSpeed || 1.0,
            attackRange: enemyDef.attackRange || 50,
            targetId: null
        });

        this.game.addComponent(entityId, 'Team', {
            team: 'enemy'
        });

        this.game.addComponent(entityId, 'AIState', {
            state: 'idle',
            aggroRange: enemyDef.aggroRange || 300,
            leashRange: enemyDef.leashRange || 600,
            spawnPoint: { x: position.x, y: position.y }
        });

        this.game.addComponent(entityId, 'Render', {
            sprite: enemyDef.sprite || 'enemy',
            width: enemyDef.width || 32,
            height: enemyDef.height || 32
        });

        this.game.addComponent(entityId, 'Movement', {
            speed: enemyDef.moveSpeed || 100
        });

        // Add experience value for killing
        this.game.addComponent(entityId, 'ExperienceValue', {
            amount: Math.floor(enemyDef.xpValue * tierMultiplier)
        });

        return entityId;
    }

    getEnemyDefinition(enemyType) {
        const definitions = {
            'skeleton': {
                health: 80,
                damage: 10,
                attackSpeed: 1.0,
                attackRange: 40,
                moveSpeed: 80,
                aggroRange: 300,
                leashRange: 600,
                sprite: 'skeleton',
                xpValue: 25,
                width: 32,
                height: 32
            },
            'zombie': {
                health: 120,
                damage: 15,
                attackSpeed: 0.7,
                attackRange: 35,
                moveSpeed: 50,
                aggroRange: 250,
                leashRange: 500,
                sprite: 'zombie',
                xpValue: 30,
                width: 32,
                height: 32
            },
            'goblin': {
                health: 50,
                damage: 8,
                attackSpeed: 1.5,
                attackRange: 35,
                moveSpeed: 120,
                aggroRange: 350,
                leashRange: 700,
                sprite: 'goblin',
                xpValue: 20,
                width: 28,
                height: 28
            },
            'orc': {
                health: 200,
                damage: 25,
                attackSpeed: 0.8,
                attackRange: 50,
                moveSpeed: 70,
                aggroRange: 300,
                leashRange: 600,
                sprite: 'orc',
                xpValue: 50,
                width: 40,
                height: 40
            },
            'demon': {
                health: 300,
                damage: 35,
                attackSpeed: 1.0,
                attackRange: 60,
                moveSpeed: 90,
                aggroRange: 400,
                leashRange: 800,
                sprite: 'demon',
                xpValue: 100,
                width: 48,
                height: 48
            }
        };

        return definitions[enemyType];
    }

    serializeEnemyComponents(entityId) {
        const components = {};
        const componentTypes = ['Position', 'Velocity', 'Health', 'Combat', 'Team', 'AIState', 'Render', 'Movement', 'ExperienceValue'];

        for (const type of componentTypes) {
            const component = this.game.getComponent(entityId, type);
            if (component) {
                components[type] = JSON.parse(JSON.stringify(component));
            }
        }

        return components;
    }

    removeEnemyFromRoom(roomId, entityId) {
        const roomEnemies = this.roomEnemies.get(roomId);
        if (roomEnemies) {
            roomEnemies.delete(entityId);
        }
    }

    getRoomEnemies(roomId) {
        return this.roomEnemies.get(roomId) || new Set();
    }

    getRoomEnemiesData(roomId) {
        const roomEnemies = this.roomEnemies.get(roomId);
        if (!roomEnemies) return [];

        const enemies = [];
        for (const entityId of roomEnemies) {
            const data = this.enemyData.get(entityId);
            if (data) {
                enemies.push({
                    entityId: entityId,
                    ...data,
                    components: this.serializeEnemyComponents(entityId)
                });
            }
        }

        return enemies;
    }

    startWaveForRoom(roomId, waveNumber = 1) {
        // Initialize wave data
        const waveData = {
            number: waveNumber,
            enemiesSpawned: 0,
            enemiesKilled: 0,
            totalEnemies: 5 + waveNumber * 2,
            startTime: Date.now()
        };

        this.roomWaves.set(roomId, waveData);

        // Get enemy types from loaded tiers
        const enemyTypes = this.enemyTiers?.easy || ['0_skeleton', 'peasant'];
        const tier = Math.floor(waveNumber / 3) + 1;

        for (let i = 0; i < Math.min(waveData.totalEnemies, 5); i++) {
            const enemyType = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
            const position = this.getRandomSpawnPosition(roomId);
            this.spawnEnemyForRoom(roomId, enemyType, position, tier);
            waveData.enemiesSpawned++;
        }

        // Broadcast wave start
        this.serverNetworkManager.broadcastToRoom(roomId, 'WAVE_STARTED', {
            waveNumber: waveNumber,
            totalEnemies: waveData.totalEnemies
        });
    }

    checkWaveCompletion(roomId) {
        const waveData = this.roomWaves.get(roomId);
        if (!waveData) return;

        const roomEnemies = this.roomEnemies.get(roomId);
        const aliveCount = roomEnemies ? roomEnemies.size : 0;

        // Spawn more enemies if needed
        if (waveData.enemiesSpawned < waveData.totalEnemies && aliveCount < 5) {
            // Select enemy tier based on wave number
            const tier = Math.floor(waveData.number / 3) + 1;
            let tierName = 'easy';
            if (tier >= 3) tierName = 'hard';
            else if (tier >= 2) tierName = 'medium';

            const enemyTypes = this.enemyTiers?.[tierName] || this.enemyTiers?.easy || ['0_skeleton', 'peasant'];
            const toSpawn = Math.min(3, waveData.totalEnemies - waveData.enemiesSpawned);

            for (let i = 0; i < toSpawn; i++) {
                const enemyType = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
                const position = this.getRandomSpawnPosition(roomId);
                this.spawnEnemyForRoom(roomId, enemyType, position, tier);
                waveData.enemiesSpawned++;
            }
        }

        // Check wave completion
        if (aliveCount === 0 && waveData.enemiesSpawned >= waveData.totalEnemies) {
            this.serverNetworkManager.broadcastToRoom(roomId, 'WAVE_COMPLETED', {
                waveNumber: waveData.number,
                duration: Date.now() - waveData.startTime
            });

            // Auto-start next wave after delay
            setTimeout(() => {
                this.startWaveForRoom(roomId, waveData.number + 1);
            }, 5000);
        }
    }

    getRandomSpawnPosition(roomId) {
        // Get center position (could be based on player positions)
        const centerX = 400;
        const centerY = 300;

        // Random angle and distance
        const angle = Math.random() * Math.PI * 2;
        const distance = this.minSpawnDistance + Math.random() * (this.spawnRadius - this.minSpawnDistance);

        return {
            x: centerX + Math.cos(angle) * distance,
            y: centerY + Math.sin(angle) * distance
        };
    }

    getRandomEnemyType(roomId) {
        const types = ['skeleton', 'zombie', 'goblin'];
        const waveData = this.roomWaves.get(roomId);

        // Add tougher enemies in later waves
        if (waveData && waveData.number >= 3) {
            types.push('orc');
        }
        if (waveData && waveData.number >= 5) {
            types.push('demon');
        }

        return types[Math.floor(Math.random() * types.length)];
    }

    update(deltaTime) {
        // Could add periodic spawn checks here if needed
    }

    cleanup() {
        this.roomEnemies.clear();
        this.enemyData.clear();
        this.roomWaves.clear();
    }
}
