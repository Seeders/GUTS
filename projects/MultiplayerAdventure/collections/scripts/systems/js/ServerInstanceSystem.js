/**
 * ServerInstanceSystem - Server-side management of adventure instances
 *
 * Handles:
 * - Instance creation and lifecycle
 * - Monster spawning and AI
 * - Loot generation
 * - State synchronization
 */
class ServerInstanceSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.serverInstanceSystem = this;
        this.engine = this.game.app;

        // Active instances
        this.instances = new Map(); // instanceId -> instance data

        // Instance counter
        this.instanceCounter = 0;
    }

    init(params) {
        this.params = params || {};
        console.log('[ServerInstanceSystem] Initializing...');

        this.serverNetworkManager = this.engine.serverNetworkManager;
        this.registerHandlers();
    }

    registerHandlers() {
        const snm = this.serverNetworkManager;
        if (!snm) return;

        snm.registerHandler('START_ADVENTURE', this.handleStartAdventure.bind(this));
        snm.registerHandler('LEAVE_INSTANCE', this.handleLeaveInstance.bind(this));
        snm.registerHandler('PLAYER_ACTION', this.handlePlayerAction.bind(this));
    }

    handleStartAdventure(socket, data, callback) {
        const playerId = socket.playerId;
        const adventureId = data.adventureId;

        // Get adventure definition
        const adventures = this.game.getCollections().adventures;
        const adventureDef = adventures?.[adventureId];

        if (!adventureDef) {
            callback({ success: false, error: 'Adventure not found' });
            return;
        }

        // Get party info from party system
        const partySystem = this.game.serverPartySystem;
        const partyId = partySystem?.getPlayerParty(playerId);
        let partyMembers = [];

        if (partyId) {
            const party = partySystem.getParty(partyId);
            if (party && party.leaderId !== playerId) {
                callback({ success: false, error: 'Only party leader can start adventures' });
                return;
            }
            partyMembers = party ? Array.from(party.members.values()) : [];
        } else {
            // Solo player
            partyMembers = [{
                playerId,
                name: socket.playerName || 'Adventurer',
                socketId: socket.id
            }];
        }

        // Create instance
        const instanceId = this.createInstance(adventureId, adventureDef, partyMembers);

        // Join all party members to instance
        for (const member of partyMembers) {
            this.joinPlayerToInstance(member.playerId, instanceId);
        }

        // Notify all party members
        const instanceData = this.instances.get(instanceId);

        for (const member of partyMembers) {
            const memberSocket = this.serverNetworkManager.getSocketByPlayerId(member.playerId);
            if (memberSocket) {
                memberSocket.join(`instance_${instanceId}`);
                memberSocket.emit('INSTANCE_JOINED', {
                    instanceId,
                    adventureId,
                    instanceData: {
                        spawnPoint: adventureDef.spawnPoint || { x: 0, y: 0, z: 0 },
                        initialMonsters: instanceData.monsters.map(m => ({
                            id: m.id,
                            type: m.type,
                            position: m.position
                        }))
                    }
                });
            }
        }

        callback({
            success: true,
            instanceId,
            adventureId
        });

        console.log(`[ServerInstanceSystem] Created instance ${instanceId} for adventure ${adventureId}`);
    }

    createInstance(adventureId, adventureDef, partyMembers) {
        const instanceId = `instance_${adventureId}_${++this.instanceCounter}_${Date.now()}`;

        // Initialize deterministic RNG
        const seed = GUTS.SeededRandom.hashString(instanceId);
        const rng = new GUTS.SeededRandom(seed);

        // Generate initial monsters
        const monsters = [];
        if (adventureDef.monsterSpawns) {
            for (const spawn of adventureDef.monsterSpawns) {
                for (let i = 0; i < spawn.count; i++) {
                    const monster = {
                        id: `${instanceId}_monster_${monsters.length}`,
                        type: spawn.type,
                        position: this.randomizePosition(spawn.position, spawn.radius || 50, rng),
                        health: spawn.health || 100,
                        alive: true
                    };
                    monsters.push(monster);
                }
            }
        }

        // Create instance data
        const instanceData = {
            instanceId,
            adventureId,
            createdAt: Date.now(),
            players: new Map(partyMembers.map(m => [m.playerId, { ...m, position: adventureDef.spawnPoint || { x: 0, y: 0, z: 0 } }])),
            monsters,
            loot: [],
            objectives: adventureDef.objectives?.map(obj => ({ ...obj, current: 0, completed: false })) || [],
            rng,
            timeLimit: adventureDef.timeLimit || 0,
            completed: false
        };

        this.instances.set(instanceId, instanceData);

        return instanceId;
    }

    randomizePosition(center, radius, rng) {
        const angle = rng.random() * Math.PI * 2;
        const dist = rng.random() * radius;
        return {
            x: center.x + Math.cos(angle) * dist,
            y: center.y || 0,
            z: center.z + Math.sin(angle) * dist
        };
    }

    joinPlayerToInstance(playerId, instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) return false;

        // Track player's current instance
        // This could be stored on the player object in a real implementation

        return true;
    }

    handleLeaveInstance(socket, data, callback) {
        const playerId = socket.playerId;

        // Find player's instance
        for (const [instanceId, instance] of this.instances) {
            if (instance.players.has(playerId)) {
                instance.players.delete(playerId);
                socket.leave(`instance_${instanceId}`);

                // Notify other players in instance
                socket.to(`instance_${instanceId}`).emit('PLAYER_LEFT_INSTANCE', { playerId });

                // Clean up empty instances
                if (instance.players.size === 0) {
                    this.destroyInstance(instanceId);
                }

                callback?.({ success: true });
                return;
            }
        }

        callback?.({ success: false, error: 'Not in an instance' });
    }

    handlePlayerAction(socket, data) {
        const playerId = socket.playerId;

        // Find player's instance
        for (const [instanceId, instance] of this.instances) {
            if (instance.players.has(playerId)) {
                // Validate and process action
                const result = this.processPlayerAction(instance, playerId, data.action);

                // Broadcast to other players in instance
                socket.to(`instance_${instanceId}`).emit('PLAYER_ACTION', {
                    playerId,
                    action: data.action,
                    result,
                    timestamp: data.timestamp
                });

                return;
            }
        }
    }

    processPlayerAction(instance, playerId, action) {
        switch (action.type) {
            case 'ability':
                return this.processAbilityAction(instance, playerId, action);
            case 'move':
                return this.processMoveAction(instance, playerId, action);
            case 'interact':
                return this.processInteractAction(instance, playerId, action);
            default:
                return { success: false, error: 'Unknown action type' };
        }
    }

    processAbilityAction(instance, playerId, action) {
        // Get ability definition
        const abilities = this.game.getCollections().abilities;
        const ability = abilities?.[action.abilityId];

        if (!ability) return { success: false, error: 'Ability not found' };

        // If targeting a monster
        if (action.target && action.target.startsWith(`${instance.instanceId}_monster_`)) {
            const monster = instance.monsters.find(m => m.id === action.target);
            if (monster && monster.alive) {
                // Calculate damage
                const damage = ability.damage || 10;
                monster.health -= damage;

                if (monster.health <= 0) {
                    monster.alive = false;
                    this.handleMonsterDeath(instance, monster, playerId);
                }

                return {
                    success: true,
                    damage,
                    targetHealth: monster.health,
                    targetDead: !monster.alive
                };
            }
        }

        return { success: true };
    }

    processMoveAction(instance, playerId, action) {
        const player = instance.players.get(playerId);
        if (player) {
            player.position = action.position;
        }
        return { success: true };
    }

    processInteractAction(instance, playerId, action) {
        // Handle loot pickup, NPC interaction, etc.
        if (action.interactType === 'loot') {
            const lootIndex = instance.loot.findIndex(l => l.id === action.targetId);
            if (lootIndex !== -1) {
                const loot = instance.loot[lootIndex];
                instance.loot.splice(lootIndex, 1);

                return {
                    success: true,
                    loot: loot.items,
                    gold: loot.gold
                };
            }
        }

        return { success: true };
    }

    handleMonsterDeath(instance, monster, killerPlayerId) {
        // Broadcast death
        this.serverNetworkManager.broadcastToRoom(`instance_${instance.instanceId}`, 'MONSTER_DIED', {
            monsterId: monster.id,
            killerPlayerId
        });

        // Generate loot
        const monsters = this.game.getCollections().monsters;
        const monsterDef = monsters?.[monster.type];
        const lootTableId = monsterDef?.lootTable || 'common';

        const loot = this.generateLoot(instance, lootTableId, monster.position);

        if (loot) {
            this.serverNetworkManager.broadcastToRoom(`instance_${instance.instanceId}`, 'LOOT_DROPPED', {
                lootId: loot.id,
                position: loot.position,
                items: loot.items
            });
        }

        // Update objectives
        this.updateKillObjective(instance, monster.type);

        // Check for instance completion
        this.checkInstanceCompletion(instance);
    }

    generateLoot(instance, lootTableId, position) {
        const lootTables = this.game.getCollections().lootTables;
        const table = lootTables?.[lootTableId];

        if (!table) return null;

        const items = [];
        const rng = instance.rng;

        for (const entry of table.entries || []) {
            if (rng.random() <= entry.chance) {
                items.push({
                    itemId: entry.itemId,
                    quantity: entry.quantity || 1
                });
            }
        }

        const baseGold = table.goldMin || 5;
        const goldRange = (table.goldMax || 15) - baseGold;
        const gold = Math.floor(baseGold + rng.random() * goldRange);

        if (items.length === 0 && gold === 0) return null;

        const loot = {
            id: `loot_${instance.instanceId}_${instance.loot.length}`,
            position,
            items,
            gold,
            dropTime: Date.now()
        };

        instance.loot.push(loot);

        return loot;
    }

    updateKillObjective(instance, monsterType) {
        for (const objective of instance.objectives) {
            if (objective.type === 'kill' && objective.target === monsterType && !objective.completed) {
                objective.current++;
                if (objective.current >= objective.required) {
                    objective.completed = true;
                }
            }
        }
    }

    checkInstanceCompletion(instance) {
        if (instance.completed) return;

        // Check if all objectives are complete
        const allComplete = instance.objectives.every(obj => obj.completed);

        // Or all monsters dead
        const allMonstersDead = instance.monsters.every(m => !m.alive);

        if (allComplete || allMonstersDead) {
            instance.completed = true;

            this.serverNetworkManager.broadcastToRoom(`instance_${instance.instanceId}`, 'INSTANCE_COMPLETE', {
                instanceId: instance.instanceId,
                completionTime: Date.now() - instance.createdAt
            });
        }
    }

    destroyInstance(instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) return;

        console.log(`[ServerInstanceSystem] Destroying instance ${instanceId}`);
        this.instances.delete(instanceId);
    }

    update() {
        // Check for timed-out instances
        const now = Date.now();
        for (const [instanceId, instance] of this.instances) {
            if (instance.timeLimit > 0) {
                const elapsed = (now - instance.createdAt) / 1000;
                if (elapsed >= instance.timeLimit && !instance.completed) {
                    // Time expired
                    this.serverNetworkManager.broadcastToRoom(`instance_${instanceId}`, 'INSTANCE_TIMEOUT', {
                        instanceId
                    });
                    this.destroyInstance(instanceId);
                }
            }

            // Clean up old instances (30 min max)
            if (now - instance.createdAt > 30 * 60 * 1000) {
                this.destroyInstance(instanceId);
            }
        }
    }
}
