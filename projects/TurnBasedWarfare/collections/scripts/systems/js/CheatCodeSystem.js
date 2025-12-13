/**
 * CheatCodeSystem - Cheat code execution logic
 *
 * This system runs identically on client and server. It contains the actual
 * cheat logic (spawning units, adding gold, etc.) but knows nothing about
 * networking.
 *
 * Network flow:
 * 1. Client calls game.call('cheat', ...) which sends to server
 * 2. Server validates and executes cheat (using this system)
 * 3. Server broadcasts result to all clients
 * 4. Clients execute same cheat with server-provided entity IDs
 *
 * Usage from console:
 *   game.call('cheat', 'spawnUnits', { collection: 'units', type: 'footman', amount: 5, x: 100, z: 100, team: 2 })
 */
class CheatCodeSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.cheatCodeSystem = this;

        // Available cheat commands
        this.cheats = new Map();
    }

    init() {
        // Register cheat execution (called by network layer after validation)
        this.game.register('executeCheat', this.executeCheat.bind(this));
        this.game.register('validateCheat', this.validateCheat.bind(this));
        this.game.register('listCheats', this.listCheats.bind(this));

        // Client-side convenience method that routes through network
        if (!this.game.isServer) {
            this.game.register('cheat', this.requestCheat.bind(this));
            this.game.register('cheats', this.listCheats.bind(this));
        }

        // Register cheat handlers
        this.registerCheats();

        console.log('[CheatCodeSystem] Initialized. Use game.call("cheats") to list available cheats.');
    }

    registerCheats() {
        // Spawn units cheat
        this.cheats.set('spawnUnits', {
            description: 'Spawn units at a position',
            usage: 'spawnUnits { collection, type, amount, x, z, team }',
            example: 'game.call("cheat", "spawnUnits", { collection: "units", type: "footman", amount: 5, x: 100, z: 100, team: 2 })',
            validate: this.validateSpawnUnits.bind(this),
            execute: this.executeSpawnUnits.bind(this)
        });

        // Add gold cheat
        this.cheats.set('addGold', {
            description: 'Add gold to a team',
            usage: 'addGold { amount, team }',
            example: 'game.call("cheat", "addGold", { amount: 1000, team: 2 })',
            validate: this.validateAddGold.bind(this),
            execute: this.executeAddGold.bind(this)
        });

        // Kill all enemies cheat
        this.cheats.set('killEnemies', {
            description: 'Kill all enemy units',
            usage: 'killEnemies { team }',
            example: 'game.call("cheat", "killEnemies", { team: 3 })',
            validate: this.validateKillEnemies.bind(this),
            execute: this.executeKillEnemies.bind(this)
        });
    }

    /**
     * Client-side: Request a cheat (sends to server)
     */
    requestCheat(cheatName, params = {}, callback = null) {
        const cheat = this.cheats.get(cheatName);
        if (!cheat) {
            console.error(`[CheatCodeSystem] Unknown cheat: ${cheatName}`);
            this.listCheats();
            return false;
        }

        console.log(`[CheatCodeSystem] Requesting cheat: ${cheatName}`, params);

        // Send through network system
        this.game.call('sendCheatRequest', cheatName, params, callback);
        return true;
    }

    /**
     * Validate cheat parameters (called by server before execution)
     */
    validateCheat(cheatName, params) {
        const cheat = this.cheats.get(cheatName);
        if (!cheat) {
            return { valid: false, error: `Unknown cheat: ${cheatName}` };
        }
        return cheat.validate(params);
    }

    /**
     * Execute a cheat (runs identically on client and server)
     * @param {string} cheatName - Name of the cheat
     * @param {object} params - Parameters (may include server-provided entityIds)
     * @returns {object} Result of cheat execution
     */
    executeCheat(cheatName, params = {}) {
        const cheat = this.cheats.get(cheatName);
        if (!cheat) {
            return { error: `Unknown cheat: ${cheatName}` };
        }

        console.log(`[CheatCodeSystem] Executing cheat: ${cheatName}`, params);
        return cheat.execute(params);
    }

    /**
     * List all available cheats
     */
    listCheats() {
        console.log('\n=== Available Cheats ===\n');
        for (const [name, cheat] of this.cheats) {
            console.log(`${name}:`);
            console.log(`  Description: ${cheat.description}`);
            console.log(`  Usage: ${cheat.usage}`);
            console.log(`  Example: ${cheat.example}`);
            console.log('');
        }
        return Array.from(this.cheats.keys());
    }

    // ==================== VALIDATORS ====================

    validateSpawnUnits(params) {
        const { collection, type, amount, x, z, team } = params;

        if (!collection) {
            return { valid: false, error: 'Missing collection parameter' };
        }
        if (!type) {
            return { valid: false, error: 'Missing type parameter' };
        }
        if (amount == null || amount < 1 || amount > 100) {
            return { valid: false, error: 'Amount must be between 1 and 100' };
        }
        if (x == null || z == null) {
            return { valid: false, error: 'Missing x or z coordinates' };
        }
        if (team == null) {
            return { valid: false, error: 'Missing team parameter' };
        }

        const unitType = this.collections?.[collection]?.[type];
        if (!unitType) {
            return { valid: false, error: `Unit type not found: ${collection}.${type}` };
        }

        return { valid: true };
    }

    validateAddGold(params) {
        const { amount, team } = params;

        if (amount == null) {
            return { valid: false, error: 'Missing amount parameter' };
        }
        if (team == null) {
            return { valid: false, error: 'Missing team parameter' };
        }

        return { valid: true };
    }

    validateKillEnemies(params) {
        const { team } = params;

        if (team == null) {
            return { valid: false, error: 'Missing team parameter' };
        }

        return { valid: true };
    }

    // ==================== CHEAT EXECUTORS ====================

    /**
     * Spawn units at a position in a grid formation
     * @param {object} params - { collection, type, amount, x, z, team, entityIds? }
     */
    executeSpawnUnits(params) {
        const { collection, type, amount, x, z, team, entityIds } = params;

        const unitType = this.collections[collection][type];
        const positions = this.calculateGroupPositions(x, z, amount, unitType);
        const spawnedUnits = [];

        // Get enum indices for numeric storage
        const collectionIndex = this.enums.objectTypeDefinitions?.[collection] ?? null;
        const typeIndex = this.enums[collection]?.[type] ?? null;

        for (let i = 0; i < amount; i++) {
            const pos = positions[i];
            if (!pos) continue;

            // Use server-provided entity ID if available, otherwise create new
            const entityId = entityIds?.[i] ?? this.game.createEntity();

            // Get terrain height at spawn position
            const terrainHeight = this.game.call('getTerrainHeightAtPosition', pos.x, pos.z) ?? 0;

            // Add core components
            this.game.addComponent(entityId, 'transform', {
                position: { x: pos.x, y: terrainHeight, z: pos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            });

            this.game.addComponent(entityId, 'unitType', {
                collection: collectionIndex,
                type: typeIndex
            });

            this.game.addComponent(entityId, 'team', {
                team: team
            });

            this.game.addComponent(entityId, 'renderable', {
                objectType: collectionIndex,
                spawnType: typeIndex
            });

            // Add health component
            const maxHealth = unitType.health || 100;
            this.game.addComponent(entityId, 'health', {
                current: maxHealth,
                max: maxHealth
            });

            // Add death state component
            this.game.addComponent(entityId, 'deathState', {
                state: this.enums.deathState.alive,
                deathTime: 0
            });

            // Add velocity component for movement
            this.game.addComponent(entityId, 'velocity', {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: unitType.moveSpeed || 30,
                affectedByGravity: 1,
                anchored: 0
            });

            // Add combat component if unit has attack
            if (unitType.damage || unitType.attackSpeed) {
                this.game.addComponent(entityId, 'combat', {
                    damage: unitType.damage || 10,
                    attackSpeed: unitType.attackSpeed || 1,
                    range: unitType.range || 30,
                    lastAttack: 0,
                    target: null
                });
            }

            // Add AI state for behavior
            if (this.enums.behaviorTrees?.[unitType.behaviorTree]) {
                this.game.addComponent(entityId, 'aiState', {
                    rootBehaviorTree: this.enums.behaviorTrees[unitType.behaviorTree] ?? 0,
                    rootBehaviorTreeCollection: this.enums.behaviorCollection?.behaviorTrees ?? 0,
                    currentAction: null,
                    currentActionCollection: null
                });
            }

            // Add abilities if unit has them
            if (unitType.abilities) {
                this.game.call('addAbilitiesToUnit', entityId, unitType.abilities);
            }

            spawnedUnits.push(entityId);
        }

        console.log(`[CheatCodeSystem] Spawned ${spawnedUnits.length} ${type} units at (${x}, ${z}) for team ${team}`);
        return { entityIds: spawnedUnits };
    }

    /**
     * Calculate grid positions for a group of units centered at a point
     */
    calculateGroupPositions(centerX, centerZ, amount, unitType) {
        const positions = [];
        const cellSize = this.game.gridSystem?.dimensions?.cellSize || 32;

        const unitWidth = unitType.placementGridWidth || 1;
        const unitHeight = unitType.placementGridHeight || 1;
        const spacing = Math.max(unitWidth, unitHeight) * cellSize;

        const gridSize = Math.ceil(Math.sqrt(amount));

        const startX = centerX - ((gridSize - 1) * spacing) / 2;
        const startZ = centerZ - ((gridSize - 1) * spacing) / 2;

        let count = 0;
        for (let row = 0; row < gridSize && count < amount; row++) {
            for (let col = 0; col < gridSize && count < amount; col++) {
                positions.push({
                    x: startX + col * spacing,
                    z: startZ + row * spacing
                });
                count++;
            }
        }

        return positions;
    }

    /**
     * Add gold to a team
     */
    executeAddGold(params) {
        const { amount, team } = params;

        this.game.call('addPlayerGold', team, amount);
        console.log(`[CheatCodeSystem] Added ${amount} gold to team ${team}`);
        return { success: true, amount, team };
    }

    /**
     * Kill all units on a team
     */
    executeKillEnemies(params) {
        const { team } = params;

        const entities = this.game.getEntitiesWith('team', 'health');
        let killCount = 0;

        for (const entityId of entities) {
            const entityTeam = this.game.getComponent(entityId, 'team');
            if (entityTeam && entityTeam.team === team) {
                const health = this.game.getComponent(entityId, 'health');
                if (health && health.current > 0) {
                    health.current = 0;
                    killCount++;
                }
            }
        }

        console.log(`[CheatCodeSystem] Killed ${killCount} units on team ${team}`);
        return { killed: killCount };
    }
}
