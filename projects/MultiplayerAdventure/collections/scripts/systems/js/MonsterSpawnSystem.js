/**
 * MonsterSpawnSystem - Server-side monster spawning and management
 *
 * Handles:
 * - Monster spawning based on adventure definitions
 * - Monster respawning
 * - Monster AI state management
 */
class MonsterSpawnSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.monsterSpawnSystem = this;

        // Tracked monsters
        this.spawnedMonsters = new Map(); // entityId -> monster data
        this.respawnQueue = []; // { monsterType, position, respawnTime }
    }

    init(params) {
        this.params = params || {};
        console.log('[MonsterSpawnSystem] Initializing...');
        this.registerServices();
    }

    registerServices() {
        this.game.register('spawnMonsterEntity', this.spawnMonsterEntity.bind(this));
        this.game.register('despawnMonster', this.despawnMonster.bind(this));
        this.game.register('getActiveMonsters', () => Array.from(this.spawnedMonsters.values()));
    }

    spawnMonsterEntity(monsterType, position, instanceId = null) {
        const monsters = this.game.getCollections().monsters;
        const monsterDef = monsters?.[monsterType];

        if (!monsterDef) {
            console.error('[MonsterSpawnSystem] Monster type not found:', monsterType);
            return null;
        }

        const entityId = `monster_${monsterType}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        this.game.createEntity(entityId);

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

        // Combat
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

        // AI State
        this.game.addComponent(entityId, 'aiState', {
            state: 'idle',
            target: null,
            targetPosition: null,
            aggroRange: monsterDef.aggroRange || 200,
            leashRange: monsterDef.leashRange || 400,
            homePosition: { ...position }
        });

        // Behavior tree
        this.game.addComponent(entityId, 'behavior', {
            treeId: monsterDef.behaviorTree || 'monster_basic',
            blackboard: {}
        });

        // Team
        this.game.addComponent(entityId, 'team', {
            team: 'enemy'
        });

        // Monster data
        this.game.addComponent(entityId, 'monster', {
            monsterType,
            level: monsterDef.level || 1,
            experienceValue: monsterDef.experienceValue || 10,
            lootTable: monsterDef.lootTable || 'common',
            instanceId
        });

        // Track monster
        this.spawnedMonsters.set(entityId, {
            entityId,
            monsterType,
            position,
            instanceId,
            spawnTime: this.game.state.now
        });

        return entityId;
    }

    despawnMonster(entityId) {
        const monsterData = this.spawnedMonsters.get(entityId);
        if (!monsterData) return;

        // Check if should respawn
        const monsters = this.game.getCollections().monsters;
        const monsterDef = monsters?.[monsterData.monsterType];

        if (monsterDef?.respawnTime) {
            this.respawnQueue.push({
                monsterType: monsterData.monsterType,
                position: monsterData.position,
                instanceId: monsterData.instanceId,
                respawnTime: this.game.state.now + monsterDef.respawnTime
            });
        }

        // Remove entity
        this.game.destroyEntity(entityId);
        this.spawnedMonsters.delete(entityId);
    }

    update() {
        // Process respawn queue
        const now = this.game.state.now;
        for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
            const spawn = this.respawnQueue[i];
            if (now >= spawn.respawnTime) {
                this.spawnMonsterEntity(spawn.monsterType, spawn.position, spawn.instanceId);
                this.respawnQueue.splice(i, 1);
            }
        }
    }
}
