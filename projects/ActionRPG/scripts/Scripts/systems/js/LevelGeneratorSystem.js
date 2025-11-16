class LevelGeneratorSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.chunkSize = 16; // Each chunk is 16x16 tiles
        this.chunks = new Map(); // Store generated chunks
        this.levelWidth = 5; // Number of chunks wide
        this.levelHeight = 5; // Number of chunks tall

        // Terrain chunk templates loaded from JSON files
        this.chunkTemplates = {};
        this.chunkFiles = [
            'start_room',
            'corridor_ns',
            'corridor_ew',
            'l_bend_ne',
            'l_bend_se',
            'l_bend_sw',
            'l_bend_nw',
            'junction_nse',
            'junction_nsw',
            'junction_new',
            'junction_sew',
            'combat_room_small',
            'combat_room_large',
            'treasure_room',
            'boss_room'
        ];

        // WFC constraint rules (will be setup after loading chunks)
        this.constraints = null;
    }

    async loadChunkTemplates() {
        console.log('Loading terrain chunk templates...');
        const basePath = './scripts/Terrain/levels/';

        for (const chunkFile of this.chunkFiles) {
            try {
                const response = await fetch(`${basePath}${chunkFile}.json`);
                if (!response.ok) {
                    console.warn(`Failed to load chunk: ${chunkFile}`);
                    continue;
                }
                const chunkData = await response.json();
                this.chunkTemplates[chunkData.name] = chunkData;
                console.log(`Loaded chunk: ${chunkData.name}`);
            } catch (error) {
                console.error(`Error loading chunk ${chunkFile}:`, error);
            }
        }

        console.log(`Loaded ${Object.keys(this.chunkTemplates).length} chunk templates`);

        // Setup constraints after loading
        this.constraints = this.setupConstraints();
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

    async generateLevel() {
        console.log('Generating level using Wave Function Collapse...');

        // Load chunks if not already loaded
        if (Object.keys(this.chunkTemplates).length === 0) {
            await this.loadChunkTemplates();
        }

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
            options: ['start_room']
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

    async onGameStarted() {
        await this.generateLevel();
    }
}
