/**
 * InstanceSystem - Manages instanced adventure areas
 *
 * Handles:
 * - Instance creation and joining
 * - Instance state management
 * - Monster spawning with terrain awareness
 * - Objective tracking
 * - Instance completion
 * - Deterministic sync with server
 *
 * Uses numeric entity IDs for performance (deterministic lockstep compatible)
 */
class InstanceSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.instanceSystem = this;

        // Instance state
        this.instanceId = null;
        this.adventureId = null;
        this.instanceData = null;
        this.isInInstance = false;

        // No longer tracking entities with Maps - use ECS queries instead
        // Entities are found via: getEntitiesWith('monster'), getEntitiesWith('loot'), etc.

        // Objectives
        this.objectives = [];
        this.completedObjectives = new Set();

        // Instance timer
        this.instanceStartTime = 0;
        this.instanceTimeLimit = 0;

        // Spawn points from terrain
        this.spawnPoints = {
            player: null,
            monsters: [],
            boss: null
        };

        // Terrain integration
        this.terrainReady = false;
        this.terrainBounds = null;
        this.gridSize = 48;

        // Monster spawn tracking
        this.nextMonsterId = 0;
        this.monsterWaves = [];
        this.currentWave = 0;
    }

    init(params) {
        this.params = params || {};
        console.log('[InstanceSystem] Initializing...');
        this.registerServices();
        this.setupEventListeners();
    }

    registerServices() {
        this.game.register('getInstanceId', () => this.instanceId);
        this.game.register('getAdventureId', () => this.adventureId);
        this.game.register('isInInstance', () => this.isInInstance);
        this.game.register('getInstanceData', () => this.instanceData);

        this.game.register('spawnMonster', this.spawnMonster.bind(this));
        this.game.register('spawnMonsterAtSpawnPoint', this.spawnMonsterAtSpawnPoint.bind(this));
        this.game.register('getMonsterEntities', () => this.getMonsterEntityIds());
        this.game.register('handleMonsterDeath', this.handleMonsterDeath.bind(this));
        this.game.register('getActiveMonsterCount', () => this.getMonsterEntityIds().length);

        this.game.register('spawnLoot', this.spawnLoot.bind(this));
        this.game.register('collectLoot', this.collectLoot.bind(this));

        this.game.register('getObjectives', () => this.objectives);
        this.game.register('isObjectiveComplete', (id) => this.completedObjectives.has(id));
        this.game.register('completeObjective', this.completeObjective.bind(this));

        this.game.register('initializeInstance', this.initializeInstance.bind(this));
        this.game.register('exitInstance', this.exitInstance.bind(this));
        this.game.register('getInstanceProgress', this.getInstanceProgress.bind(this));

        this.game.register('getInstanceSpawnPoint', () => this.spawnPoints.player);
        this.game.register('getMonsterSpawnPoints', () => this.spawnPoints.monsters);
    }

    setupEventListeners() {
        this.game.on('onInstanceJoined', (data) => this.handleInstanceJoined(data));
        this.game.on('onInstanceCreated', (data) => this.handleInstanceCreated(data));
    }

    handleInstanceCreated(data) {
        console.log('[InstanceSystem] Instance created:', data.instanceId);
    }

    // === ECS Query Helpers (replaces tracking Maps) ===

    /**
     * Get all monster entity IDs by querying ECS
     */
    getMonsterEntityIds() {
        const entities = this.game.getEntitiesWith('monster', 'transform');
        return Array.from(entities).sort((a, b) => a - b); // Numeric sort for determinism
    }

    /**
     * Get all monster entities with their data
     */
    getMonsterEntities() {
        const monsters = [];
        const entities = this.game.getEntitiesWith('monster', 'transform');

        for (const entityId of entities) {
            const monster = this.game.getComponent(entityId, 'monster');
            const transform = this.game.getComponent(entityId, 'transform');
            if (monster && transform) {
                monsters.push({
                    entityId,
                    monsterId: monster.monsterId,
                    monsterType: monster.monsterType,
                    isBoss: monster.isBoss,
                    position: transform.position
                });
            }
        }
        return monsters;
    }

    /**
     * Find monster entity by monsterId using ECS query
     */
    findMonsterEntityByMonsterId(monsterId) {
        const entities = this.game.getEntitiesWith('monster');

        for (const entityId of entities) {
            const monster = this.game.getComponent(entityId, 'monster');
            if (monster && monster.monsterId === monsterId) {
                return entityId;
            }
        }
        return null;
    }

    /**
     * Get all loot entity IDs by querying ECS
     */
    getLootEntityIds() {
        const entities = this.game.getEntitiesWith('loot', 'transform');
        return Array.from(entities).sort((a, b) => a - b);
    }

    /**
     * Find loot entity by lootId using ECS query
     */
    findLootEntityByLootId(lootId) {
        const entities = this.game.getEntitiesWith('loot');

        for (const entityId of entities) {
            const loot = this.game.getComponent(entityId, 'loot');
            if (loot && loot.lootId === lootId) {
                return entityId;
            }
        }
        return null;
    }

    /**
     * Get all party member entity IDs (non-local players) by querying ECS
     */
    getPartyMemberEntityIds() {
        const members = [];
        const entities = this.game.getEntitiesWith('playerCharacter', 'transform');

        for (const entityId of entities) {
            const pc = this.game.getComponent(entityId, 'playerCharacter');
            if (pc && !pc.isLocal) {
                members.push(entityId);
            }
        }
        return members.sort((a, b) => a - b);
    }

    /**
     * Find party member entity by playerId using ECS query
     */
    findPartyMemberEntityByPlayerId(playerId) {
        const entities = this.game.getEntitiesWith('playerCharacter');

        for (const entityId of entities) {
            const pc = this.game.getComponent(entityId, 'playerCharacter');
            if (pc && pc.playerId === playerId && !pc.isLocal) {
                return entityId;
            }
        }
        return null;
    }

    handleInstanceJoined(data) {
        this.instanceId = data.instanceId;
        this.adventureId = data.adventureId;
        this.instanceData = data.instanceData;
        this.isInInstance = true;
        this.instanceStartTime = this.game.state.now;

        const adventures = this.game.getCollections().adventures;
        if (adventures && adventures[this.adventureId]) {
            const adventureDef = adventures[this.adventureId];
            this.instanceTimeLimit = adventureDef.timeLimit || 0;
            this.loadObjectives(adventureDef.objectives || []);
            this.monsterWaves = adventureDef.waves || [];
        }

        this.game.switchScene('adventure_instance').then(() => {
            this.waitForTerrain().then(() => {
                this.initializeInstance(data);
            });
        });
    }

    async waitForTerrain() {
        return new Promise((resolve) => {
            const checkTerrain = () => {
                const terrainSize = this.game.call('getTerrainSize');
                if (terrainSize && terrainSize > 0) {
                    this.terrainReady = true;
                    this.setupTerrainData();
                    resolve();
                } else {
                    setTimeout(checkTerrain, 100);
                }
            };
            checkTerrain();
        });
    }

    setupTerrainData() {
        const terrainSize = this.game.call('getTerrainSize') || 2304;
        const margin = this.gridSize * 2;

        this.terrainBounds = {
            minX: margin,
            maxX: terrainSize - margin,
            minZ: margin,
            maxZ: terrainSize - margin
        };

        this.loadSpawnPointsFromTerrain();
        console.log('[InstanceSystem] Terrain ready, bounds:', this.terrainBounds);
    }

    loadSpawnPointsFromTerrain() {
        const tileMap = this.game.call('getTileMap');

        if (tileMap && tileMap.worldObjects) {
            for (const obj of tileMap.worldObjects) {
                const worldX = obj.gridX * this.gridSize + this.gridSize / 2;
                const worldZ = obj.gridZ * this.gridSize + this.gridSize / 2;
                const worldY = this.getTerrainHeightAt(worldX, worldZ);

                const position = { x: worldX, y: worldY, z: worldZ };

                switch (obj.type) {
                    case 'spawn_point':
                        this.spawnPoints.player = position;
                        break;
                    case 'monster_spawn':
                        this.spawnPoints.monsters.push(position);
                        break;
                    case 'boss_spawn':
                        this.spawnPoints.boss = position;
                        break;
                }
            }
        }

        if (!this.spawnPoints.player) {
            const terrainSize = this.game.call('getTerrainSize') || 2304;
            this.spawnPoints.player = {
                x: terrainSize / 2,
                y: this.getTerrainHeightAt(terrainSize / 2, this.gridSize * 3),
                z: this.gridSize * 3
            };
        }

        if (this.spawnPoints.monsters.length === 0) {
            const terrainSize = this.game.call('getTerrainSize') || 2304;
            const center = terrainSize / 2;

            const spawnLocations = [
                { x: center - 200, z: center - 100 },
                { x: center + 200, z: center - 100 },
                { x: center - 200, z: center + 100 },
                { x: center + 200, z: center + 100 },
                { x: center, z: center + 200 },
            ];

            for (const loc of spawnLocations) {
                const y = this.getTerrainHeightAt(loc.x, loc.z);
                this.spawnPoints.monsters.push({ x: loc.x, y, z: loc.z });
            }
        }

        console.log('[InstanceSystem] Loaded spawn points:', {
            player: this.spawnPoints.player,
            monsterCount: this.spawnPoints.monsters.length,
            boss: this.spawnPoints.boss
        });
    }

    getTerrainHeightAt(worldX, worldZ) {
        let height = this.game.call('getTerrainHeightAtPositionSmooth', worldX, worldZ);
        if (height === undefined || height === null) {
            height = this.game.call('getTerrainHeightAtPosition', worldX, worldZ);
        }
        return height || 0;
    }

    initializeInstance(data) {
        console.log('[InstanceSystem] Initializing instance:', this.instanceId);

        const spawnPoint = this.spawnPoints.player || data.spawnPoint || { x: 0, y: 0, z: 0 };
        const partyMembers = this.game.call('getPartyMembers') || [];

        if (partyMembers.length === 0) {
            this.game.call('spawnLocalPlayer', spawnPoint);
        } else {
            for (const member of partyMembers) {
                if (member.isLocal) {
                    this.game.call('spawnLocalPlayer', spawnPoint);
                } else {
                    const offset = { x: (Math.random() - 0.5) * 50, z: (Math.random() - 0.5) * 50 };
                    const memberSpawn = {
                        x: spawnPoint.x + offset.x,
                        y: this.getTerrainHeightAt(spawnPoint.x + offset.x, spawnPoint.z + offset.z),
                        z: spawnPoint.z + offset.z
                    };
                    this.spawnPartyMember(member, memberSpawn);
                }
            }
        }

        if (data.initialMonsters) {
            for (const monsterData of data.initialMonsters) {
                const pos = { ...monsterData.position };
                pos.y = this.getTerrainHeightAt(pos.x, pos.z);
                this.spawnMonster(monsterData.id, monsterData.type, pos);
            }
        } else {
            this.spawnInitialMonsters();
        }

        this.game.state.phase = 'adventure';
        this.game.triggerEvent('onInstanceStarted', { instanceId: this.instanceId });
    }

    spawnInitialMonsters() {
        const adventures = this.game.getCollections().adventures;
        const adventureDef = adventures?.[this.adventureId];

        if (!adventureDef) {
            console.warn('[InstanceSystem] No adventure definition found');
            return;
        }

        const encounters = adventureDef.encounters || [];
        const monsterTypes = encounters.map(e => e.type || e.monsterType || 'goblin');

        for (let i = 0; i < this.spawnPoints.monsters.length; i++) {
            const spawnPoint = this.spawnPoints.monsters[i];
            const monsterType = monsterTypes[i % monsterTypes.length];
            const groupSize = adventureDef.monstersPerSpawn || 3;

            for (let j = 0; j < groupSize; j++) {
                const offset = {
                    x: (Math.random() - 0.5) * 80,
                    z: (Math.random() - 0.5) * 80
                };

                const position = {
                    x: spawnPoint.x + offset.x,
                    y: this.getTerrainHeightAt(spawnPoint.x + offset.x, spawnPoint.z + offset.z),
                    z: spawnPoint.z + offset.z
                };

                const monsterId = this.nextMonsterId++;
                this.spawnMonster(monsterId, monsterType, position);
            }
        }

        if (this.spawnPoints.boss && adventureDef.boss) {
            const bossId = this.nextMonsterId++;
            this.spawnMonster(bossId, adventureDef.boss.type || 'orc', this.spawnPoints.boss, true);
        }
    }

    spawnMonsterAtSpawnPoint(monsterType, spawnPointIndex = 0) {
        const spawnPoint = this.spawnPoints.monsters[spawnPointIndex % this.spawnPoints.monsters.length];
        if (!spawnPoint) return null;

        const monsterId = this.nextMonsterId++;
        return this.spawnMonster(monsterId, monsterType, spawnPoint);
    }

    spawnPartyMember(memberData, spawnPoint) {
        const position = spawnPoint || this.spawnPoints.player || { x: 0, y: 0, z: 0 };
        position.y = this.getTerrainHeightAt(position.x, position.z);

        // Create entity with numeric ID
        const entityId = this.game.createEntity();

        // Use addComponents for batch operation
        this.game.addComponents(entityId, {
            transform: {
                position: { x: position.x, y: position.y, z: position.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            velocity: {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: 150,
                affectedByGravity: true,
                anchored: false
            },
            playerCharacter: {
                playerId: memberData.playerId,
                playerName: memberData.name,
                isLocal: false,
                characterClass: memberData.characterClass || 'warrior',
                level: memberData.level || 1
            },
            health: {
                current: memberData.health?.current || 100,
                max: memberData.health?.max || 100
            },
            team: {
                team: 'player'
            },
            collision: {
                radius: 10,
                height: 50
            },
            renderable: {
                objectType: 'units',
                spawnType: 'peasant',
                capacity: 128
            },
            networkSynced: {
                lastUpdate: 0
            }
        });

        // Entity is now tracked via ECS - no Map needed
        // Can be found with findPartyMemberEntityByPlayerId()

        this.game.call('spawnInstance', entityId, 'units', 'peasant', position);

        console.log('[InstanceSystem] Spawned party member:', memberData.name, 'entityId:', entityId);

        return entityId;
    }

    spawnMonster(monsterId, monsterType, position, isBoss = false) {
        // Check if monster already exists using ECS query
        const existingEntity = this.findMonsterEntityByMonsterId(monsterId);
        if (existingEntity !== null) {
            console.warn('[InstanceSystem] Monster already spawned:', monsterId);
            return existingEntity;
        }

        const monsters = this.game.getCollections().monsters;
        const monsterDef = monsters?.[monsterType];

        if (!monsterDef) {
            console.error('[InstanceSystem] Monster type not found:', monsterType);
            return null;
        }

        const spawnPos = { ...position };
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        const scale = isBoss ? (monsterDef.scale || 1) * 1.5 : (monsterDef.scale || 1);
        const healthMult = isBoss ? 3 : 1;
        const maxHP = (monsterDef.health || 100) * healthMult;

        // Create entity with numeric ID
        const entityId = this.game.createEntity();

        // Use addComponents for batch operation (single cache invalidation)
        this.game.addComponents(entityId, {
            transform: {
                position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: scale, y: scale, z: scale }
            },
            velocity: {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: (monsterDef.speed || 80) * 20,
                affectedByGravity: true,
                anchored: false
            },
            health: {
                current: maxHP,
                max: maxHP
            },
            combat: {
                damage: monsterDef.damage || 10,
                range: monsterDef.attackRange || 50,
                attackSpeed: monsterDef.attackSpeed || 1,
                lastAttack: 0
            },
            collision: {
                radius: (monsterDef.size || 10) * scale,
                height: 50
            },
            aiState: {
                currentAction: null,
                rootBehaviorTree: monsterDef.behaviorTree || 'CombatBehaviorTree',
                meta: {
                    aggroRange: monsterDef.aggroRange || 200,
                    leashRange: monsterDef.leashRange || 400,
                    homePosition: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }
                }
            },
            pathfinding: {
                path: null,
                pathIndex: 0,
                lastPathRequest: 0,
                useDirectMovement: false
            },
            combatState: {
                lastAttacker: null,
                lastAttackTime: 0
            },
            team: {
                team: 'enemy'
            },
            monster: {
                monsterId,
                monsterType,
                isBoss,
                level: monsterDef.level || 1,
                experienceValue: (monsterDef.experienceValue || 10) * (isBoss ? 10 : 1),
                lootTable: isBoss ? 'uncommon' : (monsterDef.lootTable || 'common')
            },
            renderable: {
                objectType: 'units',
                spawnType: 'peasant', // Use peasant as placeholder model
                capacity: 128
            }
        });

        // Entity is now tracked via ECS - no Map needed
        // Can be found with findMonsterEntityByMonsterId()

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'units', 'peasant', spawnPos);

        console.log('[InstanceSystem] Spawned', isBoss ? 'boss' : 'monster', monsterType, 'entityId:', entityId);

        return entityId;
    }

    handleMonsterDeath(monsterId, killerPlayerId) {
        // Find entity via ECS query instead of Map
        const entityId = this.findMonsterEntityByMonsterId(monsterId);
        if (entityId === null) return;

        const monster = this.game.getComponent(entityId, 'monster');
        const transform = this.game.getComponent(entityId, 'transform');

        if (monster && transform) {
            if (this.game.call('isExperienceShared') && this.game.call('isInParty')) {
                const partySize = this.game.call('getPartySize') || 1;
                const expPerMember = Math.floor(monster.experienceValue / partySize);
                this.game.call('awardPartyExperience', expPerMember);
            } else if (killerPlayerId === this.game.call('getPlayerId')) {
                this.game.call('awardExperience', monster.experienceValue);
            }

            this.generateLootDrop(monster.lootTable, transform.position);
            this.checkKillObjective(monster.monsterType);

            if (monster.isBoss) {
                this.handleBossDeath(monster);
            }
        }

        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        // No Map.delete needed - entity is removed from ECS

        // Check if all monsters are defeated using ECS query
        if (this.getMonsterEntityIds().length === 0) {
            this.handleAllMonstersDefeated();
        }
    }

    handleBossDeath(monster) {
        this.game.call('showNotification', 'Boss Defeated!', 'success');
        this.game.triggerEvent('onBossDefeated', {
            instanceId: this.instanceId,
            bossType: monster.monsterType
        });
    }

    handleAllMonstersDefeated() {
        if (this.currentWave < this.monsterWaves.length) {
            setTimeout(() => {
                this.spawnWave(this.currentWave);
                this.currentWave++;
            }, 2000);
        }
    }

    spawnWave(waveIndex) {
        const wave = this.monsterWaves[waveIndex];
        if (!wave) return;

        this.game.call('showNotification', `Wave ${waveIndex + 1}!`, 'info');

        for (const spawn of wave.spawns || []) {
            const spawnPoint = this.spawnPoints.monsters[spawn.spawnPointIndex || 0];
            if (spawnPoint) {
                for (let i = 0; i < (spawn.count || 1); i++) {
                    const offset = {
                        x: (Math.random() - 0.5) * 80,
                        z: (Math.random() - 0.5) * 80
                    };

                    const position = {
                        x: spawnPoint.x + offset.x,
                        y: this.getTerrainHeightAt(spawnPoint.x + offset.x, spawnPoint.z + offset.z),
                        z: spawnPoint.z + offset.z
                    };

                    const monsterId = this.nextMonsterId++;
                    this.spawnMonster(monsterId, spawn.type, position);
                }
            }
        }
    }

    generateLootDrop(lootTable, position) {
        const roll = this.game.rng?.random() || Math.random();

        const lootTables = this.game.getCollections().lootTables;
        const table = lootTables?.[lootTable];

        if (!table) return;

        const items = [];
        for (const entry of table.entries || []) {
            if (roll <= entry.chance) {
                items.push({
                    itemId: entry.itemId,
                    quantity: entry.quantity || 1
                });
            }
        }

        if (items.length > 0) {
            const lootId = this.nextMonsterId++; // Reuse counter for unique IDs
            this.spawnLoot(lootId, position, items);
        }

        const goldAmount = Math.floor((this.game.rng?.random() || Math.random()) * 10) + 5;
        this.game.call('awardGold', goldAmount);
    }

    spawnLoot(lootId, position, items) {
        const lootPos = { ...position };
        lootPos.y = this.getTerrainHeightAt(lootPos.x, lootPos.z);

        // Create entity with numeric ID
        const entityId = this.game.createEntity();

        // Use addComponents for batch operation
        this.game.addComponents(entityId, {
            transform: {
                position: { x: lootPos.x, y: lootPos.y, z: lootPos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            loot: {
                lootId,
                items,
                spawnTime: this.game.state.now,
                despawnTime: this.game.state.now + 120
            },
            interactable: {
                interactionType: 'loot',
                interactionRadius: 30,
                promptText: 'Pick up loot'
            }
        });

        // Entity is now tracked via ECS - no Map needed
        // Can be found with findLootEntityByLootId()

        this.game.call('spawnInstance', entityId, 'effects', 'loot_bag', lootPos);

        return entityId;
    }

    collectLoot(lootId, playerId) {
        // Find entity via ECS query instead of Map
        const entityId = this.findLootEntityByLootId(lootId);
        if (!entityId) return false;

        const loot = this.game.getComponent(entityId, 'loot');
        if (!loot) return false;

        for (const item of loot.items) {
            this.game.call('addToInventory', item.itemId, item.quantity);
        }

        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        // No Map.delete needed - entity is removed from ECS

        this.game.call('showNotification', 'Loot collected!', 'success');
        return true;
    }

    loadObjectives(objectivesDef) {
        this.objectives = objectivesDef.map(obj => ({
            id: obj.id,
            type: obj.type,
            description: obj.description,
            target: obj.target,
            required: obj.required || 1,
            current: 0,
            completed: false
        }));

        this.completedObjectives.clear();
        this.updateObjectivesUI();
    }

    checkKillObjective(monsterType) {
        for (const objective of this.objectives) {
            if (objective.type === 'kill' && objective.target === monsterType && !objective.completed) {
                objective.current++;
                if (objective.current >= objective.required) {
                    this.completeObjective(objective.id);
                }
                this.updateObjectivesUI();
            }
        }
    }

    completeObjective(objectiveId) {
        const objective = this.objectives.find(o => o.id === objectiveId);
        if (!objective || objective.completed) return;

        objective.completed = true;
        this.completedObjectives.add(objectiveId);

        this.game.call('showNotification', `Objective complete: ${objective.description}`, 'success');

        if (this.objectives.every(o => o.completed)) {
            this.handleInstanceComplete();
        }

        this.updateObjectivesUI();
    }

    handleInstanceComplete() {
        this.game.call('showNotification', 'Adventure Complete!', 'success');
        this.game.triggerEvent('onInstanceComplete', {
            instanceId: this.instanceId,
            adventureId: this.adventureId,
            completionTime: this.game.state.now - this.instanceStartTime
        });

        this.game.call('awardExperience', 100);
        this.game.call('awardGold', 50);
    }

    exitInstance(returnToTown = true) {
        console.log('[InstanceSystem] Exiting instance');

        // Cleanup monsters using ECS query
        for (const entityId of this.getMonsterEntityIds()) {
            this.game.call('removeInstance', entityId);
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }

        // Cleanup loot using ECS query
        for (const entityId of this.getLootEntityIds()) {
            this.game.call('removeInstance', entityId);
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }

        // Cleanup party members using ECS query
        for (const entityId of this.getPartyMemberEntityIds()) {
            this.game.call('removeInstance', entityId);
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }

        this.instanceId = null;
        this.adventureId = null;
        this.instanceData = null;
        this.isInInstance = false;
        this.objectives = [];
        this.completedObjectives.clear();
        this.nextMonsterId = 0;
        this.currentWave = 0;
        this.terrainReady = false;
        this.spawnPoints = { player: null, monsters: [], boss: null };

        this.game.state.inInstance = false;
        this.game.state.instanceId = null;

        this.game.call('leaveInstance', (success) => {
            if (returnToTown) {
                this.game.switchScene('town_hub');
            }
        });
    }

    getInstanceProgress() {
        const completed = this.completedObjectives.size;
        const total = this.objectives.length;
        return {
            completed,
            total,
            percentage: total > 0 ? (completed / total * 100) : 0,
            timeElapsed: this.game.state.now - this.instanceStartTime,
            timeRemaining: this.instanceTimeLimit > 0 ?
                Math.max(0, this.instanceTimeLimit - (this.game.state.now - this.instanceStartTime)) : null,
            monstersRemaining: this.getMonsterEntityIds().length, // Use ECS query
            currentWave: this.currentWave,
            totalWaves: this.monsterWaves.length
        };
    }

    updateObjectivesUI() {
        const objectivesPanel = document.getElementById('objectives-panel');
        if (!objectivesPanel) return;

        let html = '<div class="objectives-header">Objectives</div>';
        for (const obj of this.objectives) {
            const statusClass = obj.completed ? 'completed' : 'pending';
            const checkmark = obj.completed ? '&#10003;' : '';
            html += `
                <div class="objective ${statusClass}">
                    <span class="objective-check">${checkmark}</span>
                    <span class="objective-text">${obj.description}</span>
                    <span class="objective-progress">${obj.current}/${obj.required}</span>
                </div>
            `;
        }
        objectivesPanel.innerHTML = html;
    }

    update() {
        if (!this.isInInstance || !this.terrainReady) return;

        if (this.instanceTimeLimit > 0) {
            const elapsed = this.game.state.now - this.instanceStartTime;
            if (elapsed >= this.instanceTimeLimit) {
                this.game.call('showNotification', 'Time expired! Adventure failed.', 'error');
                this.exitInstance(true);
                return;
            }
        }

        // Update monster positions to stay on terrain using ECS query
        const monsterEntities = this.game.getEntitiesWith('monster', 'transform');
        for (const entityId of monsterEntities) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform && transform.position) {
                const terrainY = this.getTerrainHeightAt(transform.position.x, transform.position.z);
                transform.position.y = terrainY;

                if (this.terrainBounds) {
                    transform.position.x = Math.max(this.terrainBounds.minX,
                        Math.min(this.terrainBounds.maxX, transform.position.x));
                    transform.position.z = Math.max(this.terrainBounds.minZ,
                        Math.min(this.terrainBounds.maxZ, transform.position.z));
                }
            }
        }

        // Update party member positions on terrain using ECS query
        const partyMemberEntities = this.getPartyMemberEntityIds();
        for (const entityId of partyMemberEntities) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform && transform.position) {
                const terrainY = this.getTerrainHeightAt(transform.position.x, transform.position.z);
                transform.position.y = terrainY;
            }
        }

        // Update loot despawn using ECS query
        const lootEntities = this.game.getEntitiesWith('loot', 'transform');
        for (const entityId of lootEntities) {
            const loot = this.game.getComponent(entityId, 'loot');
            if (loot && this.game.state.now >= loot.despawnTime) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
                // No Map.delete needed - entity is removed from ECS
            }
        }
    }

    onSceneUnload() {
        // Cleanup handled by exitInstance
    }
}
