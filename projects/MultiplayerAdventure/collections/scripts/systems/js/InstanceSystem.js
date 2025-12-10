/**
 * InstanceSystem - Manages instanced adventure areas
 *
 * Handles:
 * - Instance creation and joining
 * - Instance state management
 * - Monster spawning and tracking
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

        // Spawn tracking for deterministic sync
        this.spawnQueue = [];
        this.lastSpawnTime = 0;
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
        this.game.register('getMonsterEntities', () => Array.from(this.monsterEntities.values()));
        this.game.register('handleMonsterDeath', this.handleMonsterDeath.bind(this));

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
        }

        // Switch to adventure instance scene
        this.game.switchScene('adventure_instance').then(() => {
            this.initializeInstance(data);
        });
    }

    initializeInstance(data) {
        console.log('[InstanceSystem] Initializing instance:', this.instanceId);

        // Spawn party members
        const partyMembers = this.game.call('getPartyMembers') || [];
        for (const member of partyMembers) {
            if (member.isLocal) {
                // Spawn local player
                this.game.call('spawnLocalPlayer', data.spawnPoint);
            } else {
                // Spawn other party member
                this.spawnPartyMember(member, data.spawnPoint);
            }
        }

        // Load initial monsters from adventure definition
        if (data.initialMonsters) {
            for (const monsterData of data.initialMonsters) {
                this.spawnMonster(monsterData.id, monsterData.type, monsterData.position);
            }
        }

        // Start instance
        this.game.state.phase = 'adventure';
        this.game.triggerEvent('onInstanceStarted', { instanceId: this.instanceId });
    }

    spawnPartyMember(memberData, spawnPoint) {
        const entityId = `party_member_${memberData.playerId}`;
        const position = spawnPoint || { x: 0, y: 0, z: 0 };

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

        this.game.addComponent(entityId, 'unitType', {
            id: 'player_character',
            collection: 'units'
        });

        this.game.addComponent(entityId, 'networkSynced', { lastUpdate: 0 });

        this.partyMemberEntities.set(memberData.playerId, entityId);

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'units', 'player_character', position);

        return entityId;
    }

    spawnMonster(monsterId, monsterType, position) {
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

        // Transform
        this.game.addComponent(entityId, 'transform', {
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: monsterDef.scale || 1, y: monsterDef.scale || 1, z: monsterDef.scale || 1 }
        });

        this.game.addComponent(entityId, 'velocity', { vx: 0, vy: 0, vz: 0 });

        // Unit type
        this.game.addComponent(entityId, 'unitType', {
            id: monsterType,
            collection: 'monsters'
        });

        // Health
        this.game.addComponent(entityId, 'health', {
            current: monsterDef.health || 100,
            max: monsterDef.health || 100
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
            homePosition: { ...position }
        });

        // Behavior tree for AI
        this.game.addComponent(entityId, 'behavior', {
            treeId: monsterDef.behaviorTree || 'monster_basic',
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
            level: monsterDef.level || 1,
            experienceValue: monsterDef.experienceValue || 10,
            lootTable: monsterDef.lootTable || 'common'
        });

        this.monsterEntities.set(monsterId, entityId);

        // Spawn render instance
        this.game.call('spawnInstance', entityId, 'monsters', monsterType, position);

        console.log('[InstanceSystem] Spawned monster:', monsterType, 'at', position);

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
                // Split experience among party members
                const partySize = this.game.call('getPartySize') || 1;
                const expPerMember = Math.floor(monster.experienceValue / partySize);
                this.game.call('awardPartyExperience', expPerMember);
            } else if (killerPlayerId === this.game.call('getPlayerId')) {
                // Award full experience to killer
                this.game.call('awardExperience', monster.experienceValue);
            }

            // Drop loot
            this.generateLootDrop(monster.lootTable, transform.position);

            // Check kill objectives
            this.checkKillObjective(monster.monsterType);
        }

        // Remove monster entity
        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        this.monsterEntities.delete(monsterId);
    }

    generateLootDrop(lootTable, position) {
        // Use deterministic RNG for loot generation
        const roll = this.game.rng?.random() || Math.random();

        // Get loot table from collections
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

        // Always drop gold
        const goldAmount = Math.floor((this.game.rng?.random() || Math.random()) * 10) + 5;
        this.game.call('awardGold', goldAmount);
    }

    spawnLoot(lootId, position, items) {
        const entityId = `loot_${lootId}`;

        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        this.game.addComponent(entityId, 'transform', {
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(entityId, 'loot', {
            lootId,
            items,
            spawnTime: this.game.state.now,
            despawnTime: this.game.state.now + 120 // 2 minute despawn
        });

        this.game.addComponent(entityId, 'interactable', {
            interactionType: 'loot',
            interactionRadius: 30,
            promptText: 'Pick up loot'
        });

        this.lootEntities.set(lootId, entityId);

        // Spawn visual (could be a bag/chest model)
        this.game.call('spawnInstance', entityId, 'effects', 'loot_bag', position);

        return entityId;
    }

    collectLoot(lootId, playerId) {
        const entityId = this.lootEntities.get(lootId);
        if (!entityId) return false;

        const loot = this.game.getComponent(entityId, 'loot');
        if (!loot) return false;

        // Add items to inventory
        for (const item of loot.items) {
            this.game.call('addToInventory', item.itemId, item.quantity);
        }

        // Remove loot entity
        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        this.lootEntities.delete(lootId);

        this.game.call('showNotification', 'Loot collected!', 'success');
        return true;
    }

    loadObjectives(objectivesDef) {
        this.objectives = objectivesDef.map(obj => ({
            id: obj.id,
            type: obj.type, // 'kill', 'collect', 'reach', 'boss'
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

        // Check if all objectives are complete
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

        // Award completion bonus
        this.game.call('awardExperience', 100);
        this.game.call('awardGold', 50);
    }

    exitInstance(returnToTown = true) {
        console.log('[InstanceSystem] Exiting instance');

        // Clean up all instance entities
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

        this.game.state.inInstance = false;
        this.game.state.instanceId = null;

        // Notify network
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
                Math.max(0, this.instanceTimeLimit - (this.game.state.now - this.instanceStartTime)) : null
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
        if (!this.isInInstance) return;

        // Check time limit
        if (this.instanceTimeLimit > 0) {
            const elapsed = this.game.state.now - this.instanceStartTime;
            if (elapsed >= this.instanceTimeLimit) {
                this.game.call('showNotification', 'Time expired! Adventure failed.', 'error');
                this.exitInstance(true);
                return;
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
        // Scene unload cleanup handled by exitInstance
    }
}
