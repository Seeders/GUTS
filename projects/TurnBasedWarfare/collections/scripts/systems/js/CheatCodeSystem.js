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
        } else {
            // Server-side: execute cheats directly (no network round-trip needed)
            this.game.register('cheat', (cheatName, params) => this.executeCheat(cheatName, params));
            this.game.register('cheats', this.listCheats.bind(this));
        }

        // Register cheat handlers
        this.registerCheats();
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
            this.listCheats();
            return false;
        }

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

        return cheat.execute(params);
    }

    /**
     * List all available cheats
     */
    listCheats() {
        return Array.from(this.cheats.keys());
    }

    /**
     * Print help information about available cheats
     */
    help() {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      CHEAT CODE HELP                             ║
╚══════════════════════════════════════════════════════════════════╝

USAGE
─────
  game.call('cheat', 'cheatName', { params })
  game.call('cheats')                          List available cheats

AVAILABLE CHEATS
────────────────
`);
        for (const [name, cheat] of this.cheats) {
            console.log(`  ${name}`);
            console.log(`    ${cheat.description}`);
            console.log(`    Usage: ${cheat.usage}`);
            console.log(`    Example: ${cheat.example}`);
            console.log('');
        }

        console.log(`
EXAMPLES
────────
  // Spawn 5 footmen at position (100, 100) for team 2
  game.call('cheat', 'spawnUnits', {
    collection: 'units',
    type: 'footman',
    amount: 5,
    x: 100,
    z: 100,
    team: 2
  })

  // Give team 2 1000 gold
  game.call('cheat', 'addGold', { amount: 1000, team: 2 })

  // Kill all units on team 3
  game.call('cheat', 'killEnemies', { team: 3 })

NOTES
─────
  - Cheats are sent to server for validation and execution
  - Server broadcasts result to all clients for synchronization
  - Team 2 is typically player 1, Team 3 is typically player 2/enemy
`);
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
        if (amount == null || amount < 1 || amount > 1000) {
            return { valid: false, error: 'Amount must be between 1 and 1000' };
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
     * Uses the standard UnitCreationSystem pipeline for proper unit setup
     * @param {object} params - { collection, type, amount, x, z, team, entityIds? }
     */
    executeSpawnUnits(params) {
        const { collection, type, amount, x, z, team, entityIds } = params;

        const unitType = this.collections[collection][type];
        const positions = this.calculateGroupPositions(x, z, amount, unitType);
        const spawnedUnits = [];

        // Get enum indices for createUnit
        const collectionIndex = this.enums.objectTypeDefinitions?.[collection] ?? -1;
        const typeIndex = this.enums[collection]?.[type] ?? -1;

        if (collectionIndex < 0 || typeIndex < 0) {
            console.error(`[CheatCodeSystem] Invalid collection/type: ${collection}.${type}`);
            return { error: `Invalid collection/type: ${collection}.${type}` };
        }

        for (let i = 0; i < amount; i++) {
            const pos = positions[i];
            if (!pos) continue;

            // Get terrain height at spawn position
            const terrainHeight = this.game.call('getTerrainHeightAtPosition', pos.x, pos.z) ?? 0;

            // Build transform for this unit
            const transform = {
                position: { x: pos.x, y: terrainHeight, z: pos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            };

            // Build placement data for createPlacement
            const placementData = {
                collection: collectionIndex,
                unitTypeId: typeIndex,
                placementId: this.game.placementSystem._getNextPlacementId(),
                gridPosition: { x: Math.floor(pos.x / 32), z: Math.floor(pos.z / 32) },
                playerId: null,
                roundPlaced: this.game.state?.round ?? 1
            };

            // Use server-provided entity ID if available
            const providedEntityId = entityIds?.[i] ?? null;

            // Use the standard unit creation pipeline with placement
            const entityId = this.game.call('createPlacement', placementData, transform, team, providedEntityId);

            spawnedUnits.push(entityId);
        }

        return { entityIds: spawnedUnits };
    }

    /**
     * Calculate grid positions for a group of units centered at a point
     * Uses spiral search to find free cells when positions are occupied
     */
    calculateGroupPositions(centerX, centerZ, amount, unitType) {
        const positions = [];
        const cellSize = this.game.gridSystem?.dimensions?.cellSize || 32;

        const unitWidth = unitType.placementGridWidth || 1;
        const unitHeight = unitType.placementGridHeight || 1;
        const spacing = Math.max(unitWidth, unitHeight) * cellSize;

        // Track which grid cells are occupied (by existing entities or new spawns)
        const occupiedCells = new Set();

        // Mark existing entity positions as occupied
        const entities = this.game.getEntitiesWith('transform');
        for (const entityId of entities) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform?.position) {
                const cellX = Math.floor(transform.position.x / spacing);
                const cellZ = Math.floor(transform.position.z / spacing);
                occupiedCells.add(`${cellX},${cellZ}`);
            }
        }

        // Spiral search starting from center
        const centerCellX = Math.floor(centerX / spacing);
        const centerCellZ = Math.floor(centerZ / spacing);

        let count = 0;
        let radius = 0;
        const maxRadius = Math.ceil(Math.sqrt(amount)) + 50; // Search up to this far out

        while (count < amount && radius <= maxRadius) {
            if (radius === 0) {
                // Check center cell
                const key = `${centerCellX},${centerCellZ}`;
                if (!occupiedCells.has(key)) {
                    positions.push({
                        x: centerCellX * spacing + spacing / 2,
                        z: centerCellZ * spacing + spacing / 2
                    });
                    occupiedCells.add(key);
                    count++;
                }
            } else {
                // Check cells in a square ring at this radius
                for (let dx = -radius; dx <= radius && count < amount; dx++) {
                    for (let dz = -radius; dz <= radius && count < amount; dz++) {
                        // Only check cells on the edge of the ring
                        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                        const cellX = centerCellX + dx;
                        const cellZ = centerCellZ + dz;
                        const key = `${cellX},${cellZ}`;

                        if (!occupiedCells.has(key)) {
                            positions.push({
                                x: cellX * spacing + spacing / 2,
                                z: cellZ * spacing + spacing / 2
                            });
                            occupiedCells.add(key);
                            count++;
                        }
                    }
                }
            }
            radius++;
        }

        return positions;
    }

    /**
     * Add gold to a team
     */
    executeAddGold(params) {
        const { amount, team } = params;

        this.game.call('addPlayerGold', team, amount);
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

        return { killed: killCount };
    }
}
