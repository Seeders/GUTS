class LevelGeneratorSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.chunkSize = 16; // Each chunk is 16x16 tiles
        this.chunks = new Map(); // Store generated chunks
        this.levelWidth = 5; // Number of chunks wide
        this.levelHeight = 5; // Number of chunks tall

        // Terrain chunk templates (these would come from TerrainMapEditor)
        this.chunkTemplates = this.loadChunkTemplates();

        // WFC constraint rules
        this.constraints = this.setupConstraints();
    }

    loadChunkTemplates() {
        // In a real implementation, these would be loaded from TerrainMapEditor JSON files
        // For now, we define some basic templates
        return {
            // Start room - always has 4 exits
            start: {
                type: 'start',
                terrainMap: this.createRoomTemplate(4, 4, true),
                exits: { north: true, south: true, east: true, west: true },
                weight: 1
            },

            // Corridor - connects two sides
            corridorNS: {
                type: 'corridor',
                terrainMap: this.createCorridorTemplate('ns'),
                exits: { north: true, south: true, east: false, west: false },
                weight: 3
            },

            corridorEW: {
                type: 'corridor',
                terrainMap: this.createCorridorTemplate('ew'),
                exits: { north: false, south: false, east: true, west: true },
                weight: 3
            },

            // T-junction rooms
            junctionNSE: {
                type: 'junction',
                terrainMap: this.createJunctionTemplate('nse'),
                exits: { north: true, south: true, east: true, west: false },
                weight: 2
            },

            junctionNSW: {
                type: 'junction',
                terrainMap: this.createJunctionTemplate('nsw'),
                exits: { north: true, south: true, east: false, west: true },
                weight: 2
            },

            // Large rooms
            room4Way: {
                type: 'room',
                terrainMap: this.createRoomTemplate(8, 8, true),
                exits: { north: true, south: true, east: true, west: true },
                weight: 2,
                spawners: [
                    { x: 4, z: 4, type: 'enemy', count: 3 },
                    { x: 8, z: 8, type: 'enemy', count: 2 }
                ]
            },

            // Dead end with treasure
            treasureRoom: {
                type: 'treasure',
                terrainMap: this.createRoomTemplate(6, 6, false),
                exits: { north: true, south: false, east: false, west: false },
                weight: 1,
                spawners: [
                    { x: 3, z: 3, type: 'chest', count: 1 },
                    { x: 2, z: 2, type: 'enemy', count: 2 }
                ]
            },

            // Boss room
            bossRoom: {
                type: 'boss',
                terrainMap: this.createRoomTemplate(12, 12, false),
                exits: { north: true, south: false, east: false, west: false },
                weight: 1,
                spawners: [
                    { x: 6, z: 6, type: 'boss', count: 1 },
                    { x: 8, z: 8, type: 'enemy', count: 4 }
                ]
            }
        };
    }

    createRoomTemplate(width, height, hasAllExits) {
        const template = [];
        for (let z = 0; z < this.chunkSize; z++) {
            template[z] = [];
            for (let x = 0; x < this.chunkSize; x++) {
                // Floor in the room area
                if (x >= 2 && x < width + 2 && z >= 2 && z < height + 2) {
                    template[z][x] = 2; // floor
                } else {
                    template[z][x] = 1; // wall
                }
            }
        }

        // Add exits
        if (hasAllExits) {
            template[0][8] = 2; // north
            template[15][8] = 2; // south
            template[8][0] = 2; // west
            template[8][15] = 2; // east
        }

        return template;
    }

    createCorridorTemplate(direction) {
        const template = [];
        for (let z = 0; z < this.chunkSize; z++) {
            template[z] = [];
            for (let x = 0; x < this.chunkSize; x++) {
                template[z][x] = 1; // wall by default
            }
        }

        if (direction === 'ns') {
            // North-south corridor
            for (let z = 0; z < this.chunkSize; z++) {
                template[z][7] = 2; // floor
                template[z][8] = 2; // floor
            }
        } else {
            // East-west corridor
            for (let x = 0; x < this.chunkSize; x++) {
                template[7][x] = 2; // floor
                template[8][x] = 2; // floor
            }
        }

        return template;
    }

    createJunctionTemplate(directions) {
        const template = [];
        for (let z = 0; z < this.chunkSize; z++) {
            template[z] = [];
            for (let x = 0; x < this.chunkSize; x++) {
                // Create a central room
                if (x >= 5 && x <= 10 && z >= 5 && z <= 10) {
                    template[z][x] = 2; // floor
                } else {
                    template[z][x] = 1; // wall
                }
            }
        }

        // Add corridors based on directions
        if (directions.includes('n')) {
            for (let z = 0; z <= 5; z++) {
                template[z][7] = 2;
                template[z][8] = 2;
            }
        }
        if (directions.includes('s')) {
            for (let z = 10; z < this.chunkSize; z++) {
                template[z][7] = 2;
                template[z][8] = 2;
            }
        }
        if (directions.includes('e')) {
            for (let x = 10; x < this.chunkSize; x++) {
                template[7][x] = 2;
                template[8][x] = 2;
            }
        }
        if (directions.includes('w')) {
            for (let x = 0; x <= 5; x++) {
                template[7][x] = 2;
                template[8][x] = 2;
            }
        }

        return template;
    }

    setupConstraints() {
        // Define which chunks can be adjacent to each other
        // This ensures exits line up properly
        const constraints = new Map();

        Object.keys(this.chunkTemplates).forEach(chunkType => {
            const chunk = this.chunkTemplates[chunkType];
            constraints.set(chunkType, {
                north: [],
                south: [],
                east: [],
                west: []
            });

            // For each direction, find compatible chunks
            Object.keys(this.chunkTemplates).forEach(otherType => {
                const otherChunk = this.chunkTemplates[otherType];

                // Can place if exits match
                if (chunk.exits.north === otherChunk.exits.south) {
                    constraints.get(chunkType).north.push(otherType);
                }
                if (chunk.exits.south === otherChunk.exits.north) {
                    constraints.get(chunkType).south.push(otherType);
                }
                if (chunk.exits.east === otherChunk.exits.west) {
                    constraints.get(chunkType).east.push(otherType);
                }
                if (chunk.exits.west === otherChunk.exits.east) {
                    constraints.get(chunkType).west.push(otherType);
                }
            });
        });

        return constraints;
    }

    generateLevel() {
        console.log('Generating level using Wave Function Collapse...');

        // Initialize grid with all possibilities
        const grid = [];
        for (let y = 0; y < this.levelHeight; y++) {
            grid[y] = [];
            for (let x = 0; x < this.levelWidth; x++) {
                grid[y][x] = {
                    collapsed: false,
                    options: Object.keys(this.chunkTemplates)
                };
            }
        }

        // Place start room in center
        const centerX = Math.floor(this.levelWidth / 2);
        const centerY = Math.floor(this.levelHeight / 2);
        grid[centerY][centerX] = {
            collapsed: true,
            options: ['start']
        };

        // Wave Function Collapse algorithm
        let iterations = 0;
        const maxIterations = this.levelWidth * this.levelHeight * 10;

        while (iterations < maxIterations) {
            iterations++;

            // Find cell with minimum entropy (fewest options)
            let minEntropy = Infinity;
            let minCell = null;

            for (let y = 0; y < this.levelHeight; y++) {
                for (let x = 0; x < this.levelWidth; x++) {
                    const cell = grid[y][x];
                    if (!cell.collapsed && cell.options.length > 0 && cell.options.length < minEntropy) {
                        minEntropy = cell.options.length;
                        minCell = { x, y };
                    }
                }
            }

            // If no uncollapsed cells, we're done
            if (!minCell) break;

            // Collapse the cell
            const cell = grid[minCell.y][minCell.x];
            const weights = cell.options.map(opt => this.chunkTemplates[opt].weight);
            const totalWeight = weights.reduce((a, b) => a + b, 0);
            let random = Math.random() * totalWeight;

            let chosen = cell.options[0];
            for (let i = 0; i < cell.options.length; i++) {
                random -= weights[i];
                if (random <= 0) {
                    chosen = cell.options[i];
                    break;
                }
            }

            cell.collapsed = true;
            cell.options = [chosen];

            // Propagate constraints
            this.propagateConstraints(grid, minCell.x, minCell.y);
        }

        // Generate actual terrain from collapsed grid
        this.generateTerrainFromGrid(grid);

        // Spawn entities from chunk spawners
        this.spawnEntitiesFromChunks(grid);

        console.log('Level generation complete!');
    }

    propagateConstraints(grid, x, y) {
        const stack = [{ x, y }];

        while (stack.length > 0) {
            const { x, y } = stack.pop();
            const cell = grid[y][x];

            if (!cell.collapsed || cell.options.length === 0) continue;

            const chunkType = cell.options[0];
            const constraint = this.constraints.get(chunkType);

            // Check neighbors
            const neighbors = [
                { dx: 0, dy: -1, dir: 'north', opposite: 'south' },
                { dx: 0, dy: 1, dir: 'south', opposite: 'north' },
                { dx: 1, dy: 0, dir: 'east', opposite: 'west' },
                { dx: -1, dy: 0, dir: 'west', opposite: 'east' }
            ];

            for (const { dx, dy, dir, opposite } of neighbors) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx < 0 || nx >= this.levelWidth || ny < 0 || ny >= this.levelHeight) continue;

                const neighbor = grid[ny][nx];
                if (neighbor.collapsed) continue;

                // Filter neighbor options based on constraint
                const allowedOptions = constraint[dir];
                const newOptions = neighbor.options.filter(opt => allowedOptions.includes(opt));

                if (newOptions.length < neighbor.options.length) {
                    neighbor.options = newOptions;
                    stack.push({ x: nx, y: ny });
                }
            }
        }
    }

    generateTerrainFromGrid(grid) {
        // Convert grid to actual terrain
        const fullTerrainMap = [];
        const totalWidth = this.levelWidth * this.chunkSize;
        const totalHeight = this.levelHeight * this.chunkSize;

        for (let z = 0; z < totalHeight; z++) {
            fullTerrainMap[z] = [];
            for (let x = 0; x < totalWidth; x++) {
                const chunkX = Math.floor(x / this.chunkSize);
                const chunkY = Math.floor(z / this.chunkSize);
                const localX = x % this.chunkSize;
                const localZ = z % this.chunkSize;

                const cell = grid[chunkY]?.[chunkX];
                if (cell && cell.options.length > 0) {
                    const chunkTemplate = this.chunkTemplates[cell.options[0]];
                    fullTerrainMap[z][x] = chunkTemplate.terrainMap[localZ][localX];
                } else {
                    fullTerrainMap[z][x] = 1; // wall
                }
            }
        }

        // Store terrain in game state
        this.game.state.terrainMap = fullTerrainMap;
        this.game.state.terrainWidth = totalWidth;
        this.game.state.terrainHeight = totalHeight;
    }

    spawnEntitiesFromChunks(grid) {
        // Spawn enemies, chests, etc. based on chunk spawners
        for (let y = 0; y < this.levelHeight; y++) {
            for (let x = 0; x < this.levelWidth; x++) {
                const cell = grid[y][x];
                if (!cell.collapsed || cell.options.length === 0) continue;

                const chunkTemplate = this.chunkTemplates[cell.options[0]];
                if (!chunkTemplate.spawners) continue;

                const offsetX = x * this.chunkSize;
                const offsetZ = y * this.chunkSize;

                for (const spawner of chunkTemplate.spawners) {
                    const worldX = offsetX + spawner.x;
                    const worldZ = offsetZ + spawner.z;

                    for (let i = 0; i < spawner.count; i++) {
                        // Add some randomization to spawn position
                        const spawnX = worldX + (Math.random() - 0.5) * 2;
                        const spawnZ = worldZ + (Math.random() - 0.5) * 2;

                        // Trigger event for entity spawning
                        this.game.triggerEvent('spawnEntity', {
                            type: spawner.type,
                            x: spawnX,
                            z: spawnZ
                        });
                    }
                }
            }
        }
    }

    onGameStarted() {
        this.generateLevel();
    }
}
