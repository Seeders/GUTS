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

        // Entity tracking
        this.monsterEntities = new Map(); // monsterId -> entityId
        this.lootEntities = new Map(); // lootId -> entityId
        this.partyMemberEntities = new Map(); // playerId -> entityId

        // Objectives
        this.objectives = [];
        this.completedObjectives = new Set();

        // Instance timer
        this.instanceStartTime = 0;
        this.instanceTimeLimit = 0; // 0 = no limit

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
        // Instance info
        this.game.register('getInstanceId', () => this.instanceId);
        this.game.register('getAdventureId', () => this.adventureId);
        this.game.register('isInInstance', () => this.isInInstance);
        this.game.register('getInstanceData', () => this.instanceData);

        // Monster management
        this.game.register('spawnMonster', this.spawnMonster.bind(this));
        this.game.register('spawnMonsterAtSpawnPoint', this.spawnMonsterAtSpawnPoint.bind(this));
        this.game.register('getMonsterEntities', () => Array.from(this.monsterEntities.values()));
        this.game.register('handleMonsterDeath', this.handleMonsterDeath.bind(this));
        this.game.register('getActiveMonsterCount', () => this.monsterEntities.size);

        // Loot management
        this.game.register('spawnLoot', this.spawnLoot.bind(this));
        this.game.register('collectLoot', this.collectLoot.bind(this));

        // Objectives
        this.game.register('getObjectives', () => this.objectives);
        this.game.register('isObjectiveComplete', (id) => this.completedObjectives.has(id));
        this.game.register('completeObjective', this.completeObjective.bind(this));

        // Instance control
        this.game.register('initializeInstance', this.initializeInstance.bind(this));
        this.game.register('exitInstance', this.exitInstance.bind(this));
        this.game.register('getInstanceProgress', this.getInstanceProgress.bind(this));

        // Terrain utilities
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

    handleInstanceJoined(data) {
        this.instanceId = data.instanceId;
        this.adventureId = data.adventureId;
        this.instanceData = data.instanceData;
        this.isInInstance = true;
        this.instanceStartTime = this.game.state.now;

        // Load adventure definition
        const adventures = this.game.getCollections().adventures;
        if (adventures && adventures[this.adventureId]) {
            const adventureDef = adventures[this.adventureId];
            this.instanceTimeLimit = adventureDef.timeLimit || 0;
            this.loadObjectives(adventureDef.objectives || []);
            this.monsterWaves = adventureDef.waves || [];
        }

        // Switch to adventure instance scene
        this.game.switchScene('adventure_instance').then(() => {
            // Wait for terrain to be ready
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
        const terrainSize = this.game.call('getTerrainSize') || 2304; // 48 * 48 default
        const margin = this.gridSize * 2;

        this.terrainBounds = {
            minX: margin,
            maxX: terrainSize - margin,
            minZ: margin,
            maxZ: terrainSize - margin
        };

        // Get spawn points from terrain tile map
        this.loadSpawnPointsFromTerrain();

        console.log('[InstanceSystem] Terrain ready, bounds:', this.terrainBounds);
    }

    loadSpawnPointsFromTerrain() {
        // Try to get tile map data
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

        // Default spawn point if none defined
        if (!this.spawnPoints.player) {
            const terrainSize = this.game.call('getTerrainSize') || 2304;
            this.spawnPoints.player = {
                x: terrainSize / 2,
                y: this.getTerrainHeightAt(terrainSize / 2, this.gridSize * 3),
                z: this.gridSize * 3
            };
        }

        // Default monster spawn points if none defined
        if (this.spawnPoints.monsters.length === 0) {
            const terrainSize = this.game.call('getTerrainSize') || 2304;
            const center = terrainSize / 2;

            // Create spawn points in a grid pattern
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

        // Use terrain-aware spawn point
        const spawnPoint = this.spawnPoints.player || data.spawnPoint || { x: 0, y: 0, z: 0 };

        // Spawn party members
        const partyMembers = this.game.call('getPartyMembers') || [];

        if (partyMembers.length === 0) {
            // Solo play - spawn local player
            this.game.call('spawnLocalPlayer', spawnPoint);
        } else {
            for (const member of partyMembers) {
                if (member.isLocal) {
                    this.game.call('spawnLocalPlayer', spawnPoint);
                } else {
                    // Offset spawn position slightly for other members
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

        // Spawn initial monsters based on adventure definition
        if (data.initialMonsters) {
            for (const monsterData of data.initialMonsters) {
                const pos = { ...monsterData.position };
                pos.y = this.getTerrainHeightAt(pos.x, pos.z);
                this.spawnMonster(monsterData.id, monsterData.type, pos);
            }
        } else {
            // Spawn monsters at terrain-defined spawn points
            this.spawnInitialMonsters();
        }

        // Start instance
        this.game.state.phase = 'adventure';
        this.game.triggerEvent('onInstanceStarted', { instanceId: this.instanceId });
    }

    spawnInitialMonsters() {
        // Get adventure definition for monster types
        const adventures = this.game.getCollections().adventures;
        const adventureDef = adventures?.[this.adventureId];

        if (!adventureDef) {
            console.warn('[InstanceSystem] No adventure definition found');
            return;
        }

        const encounters = adventureDef.encounters || [];
        const monsterTypes = encounters.map(e => e.type || e.monsterType || 'goblin');

        // Spawn monsters at each spawn point
        for (let i = 0; i < this.spawnPoints.monsters.length; i++) {
            const spawnPoint = this.spawnPoints.monsters[i];
            const monsterType = monsterTypes[i % monsterTypes.length];

            // Spawn a group of monsters at this point
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

                const monsterId = `${this.instanceId}_monster_${this.nextMonsterId++}`;
                this.spawnMonster(monsterId, monsterType, position);
            }
        }

        // Spawn boss if defined
        if (this.spawnPoints.boss && adventureDef.boss) {
            const bossId = `${this.instanceId}_boss`;
            this.spawnMonster(bossId, adventureDef.boss.type || 'orc', this.spawnPoints.boss, true);
        }
    }

    spawnMonsterAtSpawnPoint(monsterType, spawnPointIndex = 0) {
        const spawnPoint = this.spawnPoints.monsters[spawnPointIndex % this.spawnPoints.monsters.length];
        if (!spawnPoint) return null;

        const monsterId = `${this.instanceId}_monster_${this.nextMonsterId++}`;
        return this.spawnMonster(monsterId, monsterType, spawnPoint);
    }

    spawnPartyMember(memberData, spawnPoint) {
        const entityId = `party_member_${memberData.playerId}`;
        const position = spawnPoint || this.spawnPoints.player || { x: 0, y: 0, z: 0 };

        // Ensure Y is terrain-aware
        position.y = this.getTerrainHeightAt(position.x, position.z);

        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        this.game.addComponent(entityId, 'transform', {
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(entityId, 'velocity', { vx: 0, vy: 0, vz: 0 });

        this.game.addComponent(entityId, 'playerCharacter', {
            playerId: memberData.playerId,
            playerName: memberData.name,
            isLocal: false,
            characterClass: memberData.characterClass || 'warrior',
            level: memberData.level || 1
        });

        this.game.addComponent(entityId, 'health', {
            current: memberData.health?.current || 100,
            max: memberData.health?.max || 100
        });

        this.game.addComponent(entityId, 'team', {
            team: 'player'
        });

        this.game.addComponent(entityId, 'unitType', {
            id: 'player_character',
            collection: 'units'
        });

        this.game.addComponent(entityId, 'networkSynced', { lastUpdate: 0 });

        this.partyMemberEntities.set(memberData.playerId, entityId);

        this.game.call('spawnInstance', entityId, 'units', 'player_character', position);

        return entityId;
    }

    spawnMonster(monsterId, monsterType, position, isBoss = false) {
        const entityId = `monster_${monsterId}`;

        if (this.monsterEntities.has(monsterId)) {
            console.warn('[InstanceSystem] Monster already spawned:', monsterId);
            return this.monsterEntities.get(monsterId);
        }

        // Get monster definition from collections
        const monsters = this.game.getCollections().monsters;
        const monsterDef = monsters?.[monsterType];

        if (!monsterDef) {
            console.error('[InstanceSystem] Monster type not found:', monsterType);
            return null;
        }

        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        // Ensure Y is terrain-aware
        const spawnPos = { ...position };
        spawnPos.y = this.getTerrainHeightAt(spawnPos.x, spawnPos.z);

        // Scale up bosses
        const scale = isBoss ? (monsterDef.scale || 1) * 1.5 : (monsterDef.scale || 1);

        // Transform
        this.game.addComponent(entityId, 'transform', {
            position: spawnPos,
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: scale, y: scale, z: scale }
        });

        this.game.addComponent(entityId, 'velocity', { vx: 0, vy: 0, vz: 0 });

        // Unit type
        this.game.addComponent(entityId, 'unitType', {
            id: monsterType,
            collection: 'monsters'
        });

        // Health (bosses have more HP)
        const healthMult = isBoss ? 3 : 1;
        this.game.addComponent(entityId, 'health', {
            current: (monsterDef.health || 100) * healthMult,
            max: (monsterDef.health || 100) * healthMult
        });

        // Combat stats
        this.game.addComponent(entityId, 'combat', {
            damage: monsterDef.damage || 10,
            attackSpeed: monsterDef.attackSpeed || 1,
            attackRange: monsterDef.attackRange || 50,
            lastAttack: 0
        });

        // Movement
        this.game.addComponent(entityId, 'movement', {
            speed: monsterDef.speed || 80,
            acceleration: 300,
            friction: 0.9
        });

        // AI state - uses existing BehaviorSystem
        this.game.addComponent(entityId, 'aiState', {
            state: 'idle',
            target: null,
            targetPosition: null,
            aggroRange: monsterDef.aggroRange || 200,
            leashRange: monsterDef.leashRange || 400,
            homePosition: { ...spawnPos }
        });

        // Behavior tree for AI
        this.game.addComponent(entityId, 'behavior', {
            treeId: monsterDef.behaviorTree || 'CombatBehaviorTree',
            blackboard: {}
        });

        // Team
        this.game.addComponent(entityId, 'team', {
            team: 'enemy'
        });

        // Monster-specific data
        this.game.addComponent(entityId, 'monster', {
            monsterId,
            monsterType,
            isBoss,
            level: monsterDef.level || 1,
            experienceValue: (monsterDef.experienceValue || 10) * (isBoss ? 10 : 1),
            lootTable: isBoss ? 'uncommon' : (monsterDef.lootTable || 'common')
        });

        this.monsterEntities.set(monsterId, entityId);

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'monsters', monsterType, spawnPos);

        console.log('[InstanceSystem] Spawned', isBoss ? 'boss' : 'monster', monsterType, 'at', spawnPos);

        return entityId;
    }

    handleMonsterDeath(monsterId, killerPlayerId) {
        const entityId = this.monsterEntities.get(monsterId);
        if (!entityId) return;

        const monster = this.game.getComponent(entityId, 'monster');
        const transform = this.game.getComponent(entityId, 'transform');

        if (monster && transform) {
            // Award experience
            if (this.game.call('isExperienceShared') && this.game.call('isInParty')) {
                const partySize = this.game.call('getPartySize') || 1;
                const expPerMember = Math.floor(monster.experienceValue / partySize);
                this.game.call('awardPartyExperience', expPerMember);
            } else if (killerPlayerId === this.game.call('getPlayerId')) {
                this.game.call('awardExperience', monster.experienceValue);
            }

            // Drop loot
            this.generateLootDrop(monster.lootTable, transform.position);

            // Check kill objectives
            this.checkKillObjective(monster.monsterType);

            // Boss death triggers special handling
            if (monster.isBoss) {
                this.handleBossDeath(monster);
            }
        }

        // Remove monster entity
        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        this.monsterEntities.delete(monsterId);

        // Check if all monsters are dead
        if (this.monsterEntities.size === 0) {
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
        // Check if there are more waves
        if (this.currentWave < this.monsterWaves.length) {
            // Spawn next wave
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

                    const monsterId = `${this.instanceId}_wave${waveIndex}_monster_${this.nextMonsterId++}`;
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
            const lootId = `loot_${Date.now()}_${Math.floor(this.game.rng?.random() * 1000 || Math.random() * 1000)}`;
            this.spawnLoot(lootId, position, items);
        }

        const goldAmount = Math.floor((this.game.rng?.random() || Math.random()) * 10) + 5;
        this.game.call('awardGold', goldAmount);
    }

    spawnLoot(lootId, position, items) {
        const entityId = `loot_${lootId}`;

        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        // Ensure loot is on terrain
        const lootPos = { ...position };
        lootPos.y = this.getTerrainHeightAt(lootPos.x, lootPos.z);

        this.game.addComponent(entityId, 'transform', {
            position: lootPos,
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(entityId, 'loot', {
            lootId,
            items,
            spawnTime: this.game.state.now,
            despawnTime: this.game.state.now + 120
        });

        this.game.addComponent(entityId, 'interactable', {
            interactionType: 'loot',
            interactionRadius: 30,
            promptText: 'Pick up loot'
        });

        this.lootEntities.set(lootId, entityId);

        this.game.call('spawnInstance', entityId, 'effects', 'loot_bag', lootPos);

        return entityId;
    }

    collectLoot(lootId, playerId) {
        const entityId = this.lootEntities.get(lootId);
        if (!entityId) return false;

        const loot = this.game.getComponent(entityId, 'loot');
        if (!loot) return false;

        for (const item of loot.items) {
            this.game.call('addToInventory', item.itemId, item.quantity);
        }

        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        this.lootEntities.delete(lootId);

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

        for (const [monsterId, entityId] of this.monsterEntities) {
            this.game.call('removeInstance', entityId);
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }
        this.monsterEntities.clear();

        for (const [lootId, entityId] of this.lootEntities) {
            this.game.call('removeInstance', entityId);
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }
        this.lootEntities.clear();

        for (const [playerId, entityId] of this.partyMemberEntities) {
            this.game.call('removeInstance', entityId);
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }
        this.partyMemberEntities.clear();

        // Reset state
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
            monstersRemaining: this.monsterEntities.size,
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

        // Check time limit
        if (this.instanceTimeLimit > 0) {
            const elapsed = this.game.state.now - this.instanceStartTime;
            if (elapsed >= this.instanceTimeLimit) {
                this.game.call('showNotification', 'Time expired! Adventure failed.', 'error');
                this.exitInstance(true);
                return;
            }
        }

        // Update monster positions to stay on terrain
        for (const [monsterId, entityId] of this.monsterEntities) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform && transform.position) {
                // Keep on terrain
                const terrainY = this.getTerrainHeightAt(transform.position.x, transform.position.z);
                transform.position.y = terrainY;

                // Enforce bounds
                if (this.terrainBounds) {
                    transform.position.x = Math.max(this.terrainBounds.minX,
                        Math.min(this.terrainBounds.maxX, transform.position.x));
                    transform.position.z = Math.max(this.terrainBounds.minZ,
                        Math.min(this.terrainBounds.maxZ, transform.position.z));
                }
            }
        }

        // Update party member positions on terrain
        for (const [playerId, entityId] of this.partyMemberEntities) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform && transform.position) {
                const terrainY = this.getTerrainHeightAt(transform.position.x, transform.position.z);
                transform.position.y = terrainY;
            }
        }

        // Update loot despawn
        for (const [lootId, entityId] of this.lootEntities) {
            const loot = this.game.getComponent(entityId, 'loot');
            if (loot && this.game.state.now >= loot.despawnTime) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
                this.lootEntities.delete(lootId);
            }
        }
    }

    onSceneUnload() {
        // Cleanup handled by exitInstance
    }
}
