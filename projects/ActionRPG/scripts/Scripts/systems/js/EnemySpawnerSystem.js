class EnemySpawnerSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.enemySpawnerSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Spawn configuration
        this.spawnPoints = [];
        this.activeEnemies = new Map();
        this.maxEnemies = 20;
        this.spawnRate = 3; // seconds between spawns
        this.lastSpawnTime = 0;

        // Wave configuration
        this.waveNumber = 1;
        this.enemiesPerWave = 5;
        this.enemiesSpawnedThisWave = 0;
        this.waveInProgress = false;

        // Enemy types by difficulty
        this.enemyTiers = {
            easy: ['peasant', 'scout'],
            medium: ['soldier', 'archer', 'apprentice'],
            hard: ['barbarian', 'berserker', 'ranger', 'elementalist'],
            elite: ['paladin', 'assassin', 'archmage']
        };

        // Spawn radius from player
        this.MIN_SPAWN_DISTANCE = 300;
        this.MAX_SPAWN_DISTANCE = 600;

        // Aggro settings
        this.AGGRO_RANGE = 400;
        this.LEASH_RANGE = 800;
    }

    init() {
        this.game.gameManager.register('spawnEnemy', this.spawnEnemy.bind(this));
        this.game.gameManager.register('spawnWave', this.spawnWave.bind(this));
        this.game.gameManager.register('addSpawnPoint', this.addSpawnPoint.bind(this));
        this.game.gameManager.register('clearSpawnPoints', this.clearSpawnPoints.bind(this));
        this.game.gameManager.register('getActiveEnemyCount', () => this.activeEnemies.size);
        this.game.gameManager.register('setMaxEnemies', (max) => { this.maxEnemies = max; });
        this.game.gameManager.register('setSpawnRate', (rate) => { this.spawnRate = rate; });
    }

    addSpawnPoint(x, z, types = null) {
        this.spawnPoints.push({
            x, z,
            types: types || this.getDefaultEnemyTypes()
        });
    }

    clearSpawnPoints() {
        this.spawnPoints = [];
    }

    getDefaultEnemyTypes() {
        const level = this.game.gameManager.call('getCurrentLevel') || 1;

        if (level <= 3) {
            return this.enemyTiers.easy;
        } else if (level <= 6) {
            return [...this.enemyTiers.easy, ...this.enemyTiers.medium];
        } else if (level <= 9) {
            return [...this.enemyTiers.medium, ...this.enemyTiers.hard];
        } else {
            return [...this.enemyTiers.hard, ...this.enemyTiers.elite];
        }
    }

    spawnWave(waveConfig = null) {
        const config = waveConfig || {
            count: this.enemiesPerWave + Math.floor(this.waveNumber / 2),
            types: this.getDefaultEnemyTypes(),
            elite: this.waveNumber % 5 === 0 // Elite every 5 waves
        };

        this.waveInProgress = true;
        this.enemiesSpawnedThisWave = 0;

        // Spawn enemies over time
        for (let i = 0; i < config.count; i++) {
            const delay = i * 0.5; // Stagger spawns
            this.game.gameManager.call('scheduleAction', () => {
                const type = config.elite && i === config.count - 1
                    ? this.enemyTiers.elite[Math.floor(Math.random() * this.enemyTiers.elite.length)]
                    : config.types[Math.floor(Math.random() * config.types.length)];

                this.spawnEnemy(type);
                this.enemiesSpawnedThisWave++;
            }, delay);
        }

        this.waveNumber++;
        this.game.triggerEvent('onWaveStart', {
            wave: this.waveNumber,
            enemyCount: config.count
        });
    }

    spawnEnemy(unitType, x = null, z = null) {
        if (this.activeEnemies.size >= this.maxEnemies) {
            return null;
        }

        const CT = this.componentTypes;
        const Components = this.game.componentManager.getComponents();
        const collections = this.game.getCollections();

        // Get unit data
        const unitData = collections.units[unitType];
        if (!unitData) {
            console.warn('Enemy unit type not found:', unitType);
            return null;
        }

        // Determine spawn position
        let spawnX = x;
        let spawnZ = z;

        if (spawnX === null || spawnZ === null) {
            const spawnPos = this.getSpawnPosition();
            spawnX = spawnPos.x;
            spawnZ = spawnPos.z;
        }

        // Create enemy entity
        const entityId = this.game.createEntity();

        // Apply difficulty scaling
        const difficultyMult = this.game.gameManager.call('getDifficultyMultiplier') || 1.0;

        // Add components
        this.game.addComponent(entityId, CT.POSITION, Components.Position(spawnX, 0, spawnZ));
        this.game.addComponent(entityId, CT.VELOCITY, Components.Velocity(0, 0, 0, unitData.speed || 50, false, false));
        this.game.addComponent(entityId, CT.FACING, Components.Facing(Math.random() * Math.PI * 2));
        this.game.addComponent(entityId, CT.COLLISION, Components.Collision(unitData.size || 25, 50));

        // Scaled health and damage
        const scaledHP = Math.floor((unitData.hp || 100) * difficultyMult);
        const scaledDamage = Math.floor((unitData.damage || 10) * difficultyMult);

        this.game.addComponent(entityId, CT.HEALTH, Components.Health(scaledHP));
        this.game.addComponent(entityId, CT.COMBAT, Components.Combat(
            scaledDamage,
            unitData.range || 30,
            unitData.attackSpeed || 1.0,
            unitData.projectile || null,
            0,
            unitData.element || 'physical',
            unitData.armor || 0,
            unitData.fireResistance || 0,
            unitData.coldResistance || 0,
            unitData.lightningResistance || 0,
            unitData.poisonResistance || 0,
            unitData.visionRange || this.AGGRO_RANGE
        ));

        // Enemy team
        this.game.addComponent(entityId, CT.TEAM, Components.Team('enemy'));

        // Unit type with XP/gold values
        const xpValue = (unitData.xpValue || 10) * difficultyMult;
        const goldValue = (unitData.goldValue || 5) * difficultyMult;

        this.game.addComponent(entityId, CT.UNIT_TYPE, Components.UnitType({
            id: unitType,
            ...unitData,
            xpValue,
            goldValue,
            lootTable: unitData.lootTable || 'common'
        }));

        // AI state - start idle, will aggro when player is near
        this.game.addComponent(entityId, CT.AI_STATE, Components.AIState('idle', null, null, null, {
            initialized: true,
            spawnPosition: { x: spawnX, z: spawnZ },
            leashRange: this.LEASH_RANGE
        }));

        // Ability cooldowns
        this.game.addComponent(entityId, CT.ABILITY_COOLDOWNS, Components.AbilityCooldowns({}));

        // Renderable
        if (unitData.render) {
            this.game.addComponent(entityId, CT.RENDERABLE, Components.Renderable(
                'units',
                unitType,
                128
            ));
        }

        // Track active enemies
        this.activeEnemies.set(entityId, {
            type: unitType,
            spawnTime: this.game.state.now,
            spawnPosition: { x: spawnX, z: spawnZ }
        });

        // Add abilities
        if (unitData.abilities && this.game.abilitySystem) {
            for (const abilityId of unitData.abilities) {
                this.game.gameManager.call('addAbilityToEntity', entityId, abilityId);
            }
        }

        this.game.triggerEvent('onEnemySpawned', entityId);

        return entityId;
    }

    getSpawnPosition() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');

        if (playerEntityId) {
            const playerPos = this.game.getComponent(playerEntityId, this.componentTypes.POSITION);
            if (playerPos) {
                // Spawn at random position around player
                const angle = Math.random() * Math.PI * 2;
                const distance = this.MIN_SPAWN_DISTANCE + Math.random() * (this.MAX_SPAWN_DISTANCE - this.MIN_SPAWN_DISTANCE);

                return {
                    x: playerPos.x + Math.cos(angle) * distance,
                    z: playerPos.z + Math.sin(angle) * distance
                };
            }
        }

        // Fallback to spawn points
        if (this.spawnPoints.length > 0) {
            const point = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
            return { x: point.x, z: point.z };
        }

        // Random position in map
        return {
            x: (Math.random() - 0.5) * 1000,
            z: (Math.random() - 0.5) * 1000
        };
    }

    update() {
        if (this.game.state.phase !== 'battle') return;

        // Clean up dead enemies
        this.cleanupDeadEnemies();

        // Update enemy AI (aggro check)
        this.updateEnemyAggro();

        // Auto-spawn enemies
        this.autoSpawn();
    }

    cleanupDeadEnemies() {
        for (const [entityId, data] of this.activeEnemies) {
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            const deathState = this.game.getComponent(entityId, this.componentTypes.DEATH_STATE);

            if (!health || health.current <= 0 || (deathState && deathState.isDying)) {
                this.activeEnemies.delete(entityId);
            }
        }
    }

    updateEnemyAggro() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const playerPos = this.game.getComponent(playerEntityId, this.componentTypes.POSITION);
        const playerHealth = this.game.getComponent(playerEntityId, this.componentTypes.HEALTH);

        if (!playerPos || !playerHealth || playerHealth.current <= 0) return;

        for (const [entityId, data] of this.activeEnemies) {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
            const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);

            if (!pos || !aiState || !combat) continue;

            // Calculate distance to player
            const dx = playerPos.x - pos.x;
            const dz = playerPos.z - pos.z;
            const distToPlayer = Math.sqrt(dx * dx + dz * dz);

            // Check aggro range
            const aggroRange = combat.visionRange || this.AGGRO_RANGE;

            if (distToPlayer <= aggroRange) {
                // Aggro on player
                if (!aiState.target || aiState.target !== playerEntityId) {
                    aiState.target = playerEntityId;
                    aiState.state = 'chasing';
                }
            } else if (aiState.target === playerEntityId) {
                // Check leash range
                const spawnPos = aiState.meta?.spawnPosition || data.spawnPosition;
                const dxSpawn = pos.x - spawnPos.x;
                const dzSpawn = pos.z - spawnPos.z;
                const distFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dzSpawn * dzSpawn);

                const leashRange = aiState.meta?.leashRange || this.LEASH_RANGE;

                if (distFromSpawn > leashRange) {
                    // Return to spawn
                    aiState.target = null;
                    aiState.targetPosition = spawnPos;
                    aiState.state = 'chasing';
                }
            }
        }
    }

    autoSpawn() {
        const now = this.game.state.now;

        // Check if it's time to spawn
        if (now - this.lastSpawnTime < this.spawnRate) return;
        if (this.activeEnemies.size >= this.maxEnemies) return;

        // Spawn random enemy
        const types = this.getDefaultEnemyTypes();
        const type = types[Math.floor(Math.random() * types.length)];

        this.spawnEnemy(type);
        this.lastSpawnTime = now;
    }
}
