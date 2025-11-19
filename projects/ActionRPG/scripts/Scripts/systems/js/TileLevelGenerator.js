class TileLevelGenerator extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.tileLevelGenerator = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Grid configuration
        this.TILE_SIZE = 256; // World units per grid cell
        this.GRID_WIDTH = 16; // Max grid size
        this.GRID_HEIGHT = 16;

        // Connection types - must match for tiles to connect
        this.CONNECTION_TYPES = {
            WALL: 'wall',
            OPEN: 'open',
            DOOR: 'door',
            SECRET: 'secret',
            WIDE: 'wide' // Double-wide passage
        };

        // Direction constants
        this.DIRECTIONS = {
            NORTH: 0,
            EAST: 1,
            SOUTH: 2,
            WEST: 3
        };

        // Opposite direction mapping
        this.OPPOSITE = {
            0: 2, // NORTH -> SOUTH
            1: 3, // EAST -> WEST
            2: 0, // SOUTH -> NORTH
            3: 1  // WEST -> EAST
        };

        // Direction vectors
        this.DIR_VECTORS = [
            { x: 0, y: -1 }, // NORTH
            { x: 1, y: 0 },  // EAST
            { x: 0, y: 1 },  // SOUTH
            { x: -1, y: 0 }  // WEST
        ];

        // Tile sets for different dungeon types
        this.tileSets = new Map();

        // Current level state
        this.grid = null;
        this.placedTiles = [];
        this.levelData = null;

        // Generation settings
        this.minRooms = 8;
        this.maxRooms = 15;
        this.branchingFactor = 0.3; // Chance to branch vs continue
    }

    init() {
        this.game.gameManager.register('generateLevel', this.generateLevel.bind(this));
        this.game.gameManager.register('getTileAt', this.getTileAt.bind(this));
        this.game.gameManager.register('worldToGrid', this.worldToGrid.bind(this));
        this.game.gameManager.register('gridToWorld', this.gridToWorld.bind(this));
        this.game.gameManager.register('registerTileSet', this.registerTileSet.bind(this));
        this.game.gameManager.register('getLevelData', () => this.levelData);
        this.game.gameManager.register('generateTerrainMap', this.generateTerrainMap.bind(this));

        // Register default tile sets
        this.registerDefaultTileSets();
    }

    postAllInit() {
        // Check if current level should use procedural generation
        const collections = this.game.getCollections();
        const currentLevel = this.game.state?.level || 'level1';
        const levelData = collections.levels?.[currentLevel];

        console.log('TileLevelGenerator.postAllInit:', { currentLevel, procedural: levelData?.procedural, isServer: !!this.engine.serverNetworkManager });

        if (levelData?.procedural) {
            console.log('TileLevelGenerator: Generating procedural level for', currentLevel);

            // Generate the level
            const config = {
                tileSet: levelData.tileSet || 'dungeon',
                floor: levelData.floor || 1,
                seed: levelData.seed || Date.now(),
                minRooms: levelData.minRooms || 8,
                maxRooms: levelData.maxRooms || 15
            };

            this.generateLevel(config);

            // Generate and apply terrain map
            if (this.levelData) {
                const terrainMap = this.generateTerrainMap();

                // Update level's tileMap with generated terrain
                if (levelData.tileMap && terrainMap) {
                    levelData.tileMap.terrainMap = terrainMap.terrainMap;
                    levelData.tileMap.heightMap = terrainMap.heightMap;
                    levelData.tileMap.size = terrainMap.size;

                    // Store spawn point for player
                    this.game.state.spawnPoint = this.levelData.spawnPoint;
                }
            }
        }
    }

    registerTileSet(name, tiles) {
        this.tileSets.set(name, tiles);
    }

    registerDefaultTileSets() {
        // Dungeon tile set - like Diablo 2 catacombs
        this.registerTileSet('dungeon', [
            // Entrance room - always has south exit
            {
                id: 'entrance',
                name: 'Entrance Hall',
                width: 2, height: 2,
                special: 'entrance',
                connections: {
                    north: ['wall', 'wall'],
                    east: ['wall', 'wall'],
                    south: ['door', 'door'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [],
                    props: ['torch', 'torch', 'banner'],
                    spawnPoint: { x: 0.5, y: 0.5 }
                },
                weight: 0 // Only placed explicitly
            },
            // Exit room
            {
                id: 'exit',
                name: 'Exit Chamber',
                width: 2, height: 2,
                special: 'exit',
                connections: {
                    north: ['door', 'door'],
                    east: ['wall', 'wall'],
                    south: ['wall', 'wall'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [],
                    props: ['stairs_down', 'torch', 'torch'],
                    exitPoint: { x: 0.5, y: 0.5 }
                },
                weight: 0
            },
            // Boss room
            {
                id: 'boss_room',
                name: 'Boss Chamber',
                width: 3, height: 3,
                special: 'boss',
                connections: {
                    north: ['wall', 'door', 'wall'],
                    east: ['wall', 'wall', 'wall'],
                    south: ['wall', 'wall', 'wall'],
                    west: ['wall', 'wall', 'wall']
                },
                content: {
                    enemies: [{ type: 'boss', count: 1 }],
                    props: ['pillar', 'pillar', 'pillar', 'pillar', 'throne'],
                    loot: 'elite'
                },
                weight: 0
            },
            // Corridor - horizontal
            {
                id: 'corridor_h',
                name: 'Horizontal Corridor',
                width: 3, height: 1,
                connections: {
                    north: ['wall', 'wall', 'wall'],
                    east: ['door'],
                    south: ['wall', 'wall', 'wall'],
                    west: ['door']
                },
                content: {
                    enemies: [{ type: 'easy', count: 1, chance: 0.3 }],
                    props: ['torch']
                },
                weight: 15
            },
            // Corridor - vertical
            {
                id: 'corridor_v',
                name: 'Vertical Corridor',
                width: 1, height: 3,
                connections: {
                    north: ['door'],
                    east: ['wall', 'wall', 'wall'],
                    south: ['door'],
                    west: ['wall', 'wall', 'wall']
                },
                content: {
                    enemies: [{ type: 'easy', count: 1, chance: 0.3 }],
                    props: ['torch']
                },
                weight: 15
            },
            // Corner rooms
            {
                id: 'corner_ne',
                name: 'NE Corner',
                width: 2, height: 2,
                connections: {
                    north: ['wall', 'wall'],
                    east: ['wall', 'wall'],
                    south: ['door', 'wall'],
                    west: ['wall', 'door']
                },
                content: {
                    enemies: [{ type: 'medium', count: 2, chance: 0.5 }],
                    props: ['barrel', 'crate']
                },
                weight: 10
            },
            {
                id: 'corner_nw',
                name: 'NW Corner',
                width: 2, height: 2,
                connections: {
                    north: ['wall', 'wall'],
                    east: ['door', 'wall'],
                    south: ['wall', 'door'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [{ type: 'medium', count: 2, chance: 0.5 }],
                    props: ['barrel', 'crate']
                },
                weight: 10
            },
            {
                id: 'corner_se',
                name: 'SE Corner',
                width: 2, height: 2,
                connections: {
                    north: ['door', 'wall'],
                    east: ['wall', 'wall'],
                    south: ['wall', 'wall'],
                    west: ['wall', 'door']
                },
                content: {
                    enemies: [{ type: 'medium', count: 2, chance: 0.5 }],
                    props: ['barrel', 'crate']
                },
                weight: 10
            },
            {
                id: 'corner_sw',
                name: 'SW Corner',
                width: 2, height: 2,
                connections: {
                    north: ['wall', 'door'],
                    east: ['door', 'wall'],
                    south: ['wall', 'wall'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [{ type: 'medium', count: 2, chance: 0.5 }],
                    props: ['barrel', 'crate']
                },
                weight: 10
            },
            // T-junction
            {
                id: 't_junction',
                name: 'T-Junction',
                width: 2, height: 2,
                connections: {
                    north: ['door', 'door'],
                    east: ['door', 'wall'],
                    south: ['wall', 'wall'],
                    west: ['wall', 'door']
                },
                content: {
                    enemies: [{ type: 'medium', count: 3, chance: 0.6 }],
                    props: ['torch', 'torch']
                },
                weight: 8
            },
            // Crossroads
            {
                id: 'crossroads',
                name: 'Crossroads',
                width: 2, height: 2,
                connections: {
                    north: ['door', 'door'],
                    east: ['door', 'door'],
                    south: ['door', 'door'],
                    west: ['door', 'door']
                },
                content: {
                    enemies: [{ type: 'hard', count: 4, chance: 0.7 }],
                    props: ['pillar']
                },
                weight: 5
            },
            // Standard rooms
            {
                id: 'room_small',
                name: 'Small Room',
                width: 2, height: 2,
                connections: {
                    north: ['door', 'wall'],
                    east: ['wall', 'wall'],
                    south: ['wall', 'door'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [{ type: 'medium', count: 2 }],
                    props: ['barrel', 'crate', 'torch'],
                    loot: 'common'
                },
                weight: 20
            },
            {
                id: 'room_medium',
                name: 'Medium Room',
                width: 3, height: 2,
                connections: {
                    north: ['wall', 'door', 'wall'],
                    east: ['door', 'wall'],
                    south: ['wall', 'door', 'wall'],
                    west: ['wall', 'door']
                },
                content: {
                    enemies: [{ type: 'medium', count: 3 }],
                    props: ['table', 'chair', 'torch', 'torch'],
                    loot: 'uncommon'
                },
                weight: 15
            },
            {
                id: 'room_large',
                name: 'Large Hall',
                width: 3, height: 3,
                connections: {
                    north: ['wall', 'door', 'wall'],
                    east: ['wall', 'door', 'wall'],
                    south: ['wall', 'door', 'wall'],
                    west: ['wall', 'door', 'wall']
                },
                content: {
                    enemies: [{ type: 'hard', count: 5 }],
                    props: ['pillar', 'pillar', 'pillar', 'pillar', 'torch', 'torch'],
                    loot: 'rare'
                },
                weight: 8
            },
            // Treasure room
            {
                id: 'treasure',
                name: 'Treasure Room',
                width: 2, height: 2,
                special: 'treasure',
                connections: {
                    north: ['door', 'wall'],
                    east: ['wall', 'wall'],
                    south: ['wall', 'wall'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [{ type: 'hard', count: 2 }],
                    props: ['chest', 'chest', 'gold_pile'],
                    loot: 'elite'
                },
                weight: 3
            },
            // Dead end with loot
            {
                id: 'dead_end',
                name: 'Dead End',
                width: 1, height: 2,
                connections: {
                    north: ['door'],
                    east: ['wall', 'wall'],
                    south: ['wall'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [{ type: 'easy', count: 1, chance: 0.5 }],
                    props: ['barrel', 'crate'],
                    loot: 'common'
                },
                weight: 12
            }
        ]);

        // Cave tile set
        this.registerTileSet('cave', [
            {
                id: 'cave_entrance',
                name: 'Cave Entrance',
                width: 2, height: 2,
                special: 'entrance',
                connections: {
                    north: ['wall', 'wall'],
                    east: ['wall', 'wall'],
                    south: ['open', 'open'],
                    west: ['wall', 'wall']
                },
                content: {
                    enemies: [],
                    props: ['rocks', 'stalagmite'],
                    spawnPoint: { x: 0.5, y: 0.5 }
                },
                weight: 0
            },
            {
                id: 'cave_tunnel',
                name: 'Cave Tunnel',
                width: 2, height: 1,
                connections: {
                    north: ['wall', 'wall'],
                    east: ['open'],
                    south: ['wall', 'wall'],
                    west: ['open']
                },
                content: {
                    enemies: [{ type: 'easy', count: 1, chance: 0.4 }],
                    props: []
                },
                weight: 20
            },
            {
                id: 'cave_chamber',
                name: 'Cave Chamber',
                width: 3, height: 3,
                connections: {
                    north: ['wall', 'open', 'wall'],
                    east: ['wall', 'open', 'wall'],
                    south: ['wall', 'open', 'wall'],
                    west: ['wall', 'open', 'wall']
                },
                content: {
                    enemies: [{ type: 'medium', count: 4 }],
                    props: ['stalagmite', 'stalagmite', 'rocks'],
                    loot: 'uncommon'
                },
                weight: 10
            }
        ]);
    }

    generateLevel(config = {}) {
        const {
            tileSet = 'dungeon',
            floor = 1,
            seed = Date.now(),
            minRooms = this.minRooms,
            maxRooms = this.maxRooms
        } = config;

        // Initialize random with seed for reproducibility
        this.seed = seed;
        this.random = this.createSeededRandom(seed);

        // Get tile set
        const tiles = this.tileSets.get(tileSet);
        if (!tiles) {
            console.error('TileLevelGenerator: Tile set not found:', tileSet);
            return null;
        }

        // Initialize grid
        this.grid = new Array(this.GRID_WIDTH * this.GRID_HEIGHT).fill(null);
        this.placedTiles = [];

        // Calculate target room count
        const targetRooms = minRooms + Math.floor(this.random() * (maxRooms - minRooms + 1));

        // Place entrance tile at center
        const entranceTile = tiles.find(t => t.special === 'entrance');
        const startX = Math.floor(this.GRID_WIDTH / 2) - Math.floor(entranceTile.width / 2);
        const startY = Math.floor(this.GRID_HEIGHT / 2) - Math.floor(entranceTile.height / 2);

        this.placeTile(entranceTile, startX, startY);

        // Collect open connections as frontier
        const frontier = this.getOpenConnections();

        // Grow level using modified growing tree algorithm
        while (this.placedTiles.length < targetRooms && frontier.length > 0) {
            // Pick from frontier - mix of newest (depth-first) and random (breadth)
            let index;
            if (this.random() < this.branchingFactor) {
                index = Math.floor(this.random() * frontier.length);
            } else {
                index = frontier.length - 1; // Newest
            }

            const connection = frontier[index];

            // Find compatible tile
            const compatibleTile = this.findCompatibleTile(tiles, connection);

            if (compatibleTile) {
                const { tile, x, y, rotation } = compatibleTile;
                this.placeTile(tile, x, y, rotation);

                // Add new open connections
                const newConnections = this.getOpenConnectionsForTile(
                    this.placedTiles[this.placedTiles.length - 1]
                );
                frontier.push(...newConnections);
            }

            // Remove this connection from frontier
            frontier.splice(index, 1);
        }

        // Place exit tile
        this.placeSpecialTile(tiles, 'exit', frontier);

        // Place boss room if floor is multiple of 5
        if (floor % 5 === 0) {
            this.placeSpecialTile(tiles, 'boss', frontier);
        }

        // Place treasure room occasionally
        if (this.random() < 0.3) {
            this.placeSpecialTile(tiles, 'treasure', frontier);
        }

        // Build level data
        this.levelData = {
            tileSet,
            floor,
            seed,
            grid: this.grid,
            tiles: this.placedTiles,
            bounds: this.calculateBounds(),
            spawnPoint: this.findSpawnPoint(),
            exitPoint: this.findExitPoint()
        };

        // Spawn level content
        this.spawnLevelContent();

        console.log(`TileLevelGenerator: Generated level with ${this.placedTiles.length} rooms`);

        return this.levelData;
    }

    placeTile(tile, gridX, gridY, rotation = 0) {
        // Check if space is available
        for (let dy = 0; dy < tile.height; dy++) {
            for (let dx = 0; dx < tile.width; dx++) {
                const idx = (gridY + dy) * this.GRID_WIDTH + (gridX + dx);
                if (this.grid[idx] !== null) {
                    return false; // Space occupied
                }
            }
        }

        // Create placed tile record
        const placedTile = {
            tile,
            gridX,
            gridY,
            rotation,
            worldX: gridX * this.TILE_SIZE,
            worldZ: gridY * this.TILE_SIZE,
            width: tile.width * this.TILE_SIZE,
            height: tile.height * this.TILE_SIZE
        };

        // Mark grid cells as occupied
        for (let dy = 0; dy < tile.height; dy++) {
            for (let dx = 0; dx < tile.width; dx++) {
                const idx = (gridY + dy) * this.GRID_WIDTH + (gridX + dx);
                this.grid[idx] = placedTile;
            }
        }

        this.placedTiles.push(placedTile);
        return true;
    }

    findCompatibleTile(tiles, connection) {
        const { x, y, direction, connectionType } = connection;

        // Get direction vector
        const dir = this.DIR_VECTORS[direction];
        const targetX = x + dir.x;
        const targetY = y + dir.y;

        // Check bounds
        if (targetX < 0 || targetX >= this.GRID_WIDTH ||
            targetY < 0 || targetY >= this.GRID_HEIGHT) {
            return null;
        }

        // Filter to weighted tiles only (special tiles have weight 0)
        const weightedTiles = tiles.filter(t => t.weight > 0);

        // Shuffle tiles by weight
        const shuffled = this.weightedShuffle(weightedTiles);

        // Try each tile
        for (const tile of shuffled) {
            // Try different placements of this tile
            const placements = this.getPossiblePlacements(tile, targetX, targetY, direction, connectionType);

            for (const placement of placements) {
                if (this.canPlaceTile(tile, placement.x, placement.y)) {
                    // Check if connections match
                    if (this.connectionsMatch(tile, placement.x, placement.y, direction, connectionType)) {
                        return {
                            tile,
                            x: placement.x,
                            y: placement.y,
                            rotation: 0
                        };
                    }
                }
            }
        }

        return null;
    }

    getPossiblePlacements(tile, targetX, targetY, fromDirection, connectionType) {
        const placements = [];
        const oppositeDir = this.OPPOSITE[fromDirection];

        // The tile needs to have a matching connection on the opposite side
        const edgeName = this.getEdgeName(oppositeDir);
        const tileConnections = tile.connections[edgeName];

        if (!tileConnections) return placements;

        // Find which cell of the tile edge would connect
        for (let i = 0; i < tileConnections.length; i++) {
            if (this.connectionTypesMatch(tileConnections[i], connectionType)) {
                // Calculate tile position so this edge cell aligns with target
                let tileX, tileY;

                switch (oppositeDir) {
                    case this.DIRECTIONS.NORTH:
                        tileX = targetX - i;
                        tileY = targetY;
                        break;
                    case this.DIRECTIONS.SOUTH:
                        tileX = targetX - i;
                        tileY = targetY - tile.height + 1;
                        break;
                    case this.DIRECTIONS.EAST:
                        tileX = targetX - tile.width + 1;
                        tileY = targetY - i;
                        break;
                    case this.DIRECTIONS.WEST:
                        tileX = targetX;
                        tileY = targetY - i;
                        break;
                }

                placements.push({ x: tileX, y: tileY });
            }
        }

        return placements;
    }

    canPlaceTile(tile, gridX, gridY) {
        // Check bounds
        if (gridX < 0 || gridX + tile.width > this.GRID_WIDTH ||
            gridY < 0 || gridY + tile.height > this.GRID_HEIGHT) {
            return false;
        }

        // Check if all cells are free
        for (let dy = 0; dy < tile.height; dy++) {
            for (let dx = 0; dx < tile.width; dx++) {
                const idx = (gridY + dy) * this.GRID_WIDTH + (gridX + dx);
                if (this.grid[idx] !== null) {
                    return false;
                }
            }
        }

        return true;
    }

    connectionsMatch(tile, gridX, gridY, fromDirection, expectedType) {
        const oppositeDir = this.OPPOSITE[fromDirection];
        const edgeName = this.getEdgeName(oppositeDir);
        const tileConnections = tile.connections[edgeName];

        if (!tileConnections) return false;

        // At least one connection on this edge should match
        return tileConnections.some(type => this.connectionTypesMatch(type, expectedType));
    }

    connectionTypesMatch(type1, type2) {
        // Walls don't connect
        if (type1 === 'wall' || type2 === 'wall') {
            return type1 === type2;
        }

        // Open passages connect to open, door, wide
        if (type1 === 'open' || type2 === 'open') {
            return type1 !== 'wall' && type2 !== 'wall';
        }

        // Doors connect to doors and open
        if (type1 === 'door' || type2 === 'door') {
            return type1 !== 'wall' && type2 !== 'wall';
        }

        return type1 === type2;
    }

    getOpenConnections() {
        const connections = [];

        for (const placedTile of this.placedTiles) {
            connections.push(...this.getOpenConnectionsForTile(placedTile));
        }

        return connections;
    }

    getOpenConnectionsForTile(placedTile) {
        const connections = [];
        const { tile, gridX, gridY } = placedTile;

        // Check each edge
        const edges = ['north', 'east', 'south', 'west'];
        const directions = [
            this.DIRECTIONS.NORTH,
            this.DIRECTIONS.EAST,
            this.DIRECTIONS.SOUTH,
            this.DIRECTIONS.WEST
        ];

        for (let e = 0; e < 4; e++) {
            const edgeConnections = tile.connections[edges[e]];
            if (!edgeConnections) continue;

            for (let i = 0; i < edgeConnections.length; i++) {
                const connType = edgeConnections[i];
                if (connType === 'wall') continue;

                // Calculate grid position of this connection
                let cx, cy;
                switch (directions[e]) {
                    case this.DIRECTIONS.NORTH:
                        cx = gridX + i;
                        cy = gridY - 1;
                        break;
                    case this.DIRECTIONS.SOUTH:
                        cx = gridX + i;
                        cy = gridY + tile.height;
                        break;
                    case this.DIRECTIONS.EAST:
                        cx = gridX + tile.width;
                        cy = gridY + i;
                        break;
                    case this.DIRECTIONS.WEST:
                        cx = gridX - 1;
                        cy = gridY + i;
                        break;
                }

                // Check if this connection is open (no tile there yet)
                if (cx >= 0 && cx < this.GRID_WIDTH &&
                    cy >= 0 && cy < this.GRID_HEIGHT) {
                    const idx = cy * this.GRID_WIDTH + cx;
                    if (this.grid[idx] === null) {
                        connections.push({
                            x: cx,
                            y: cy,
                            direction: directions[e],
                            connectionType: connType,
                            sourceTile: placedTile
                        });
                    }
                }
            }
        }

        return connections;
    }

    placeSpecialTile(tiles, specialType, frontier) {
        const specialTile = tiles.find(t => t.special === specialType);
        if (!specialTile) return false;

        // Try to place at an open connection furthest from entrance
        const sortedFrontier = [...frontier].sort((a, b) => {
            const distA = Math.abs(a.x - this.GRID_WIDTH / 2) + Math.abs(a.y - this.GRID_HEIGHT / 2);
            const distB = Math.abs(b.x - this.GRID_WIDTH / 2) + Math.abs(b.y - this.GRID_HEIGHT / 2);
            return distB - distA;
        });

        for (const connection of sortedFrontier) {
            const result = this.findCompatibleTile([specialTile], connection);
            if (result) {
                this.placeTile(result.tile, result.x, result.y);
                return true;
            }
        }

        return false;
    }

    getEdgeName(direction) {
        const names = ['north', 'east', 'south', 'west'];
        return names[direction];
    }

    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const placed of this.placedTiles) {
            minX = Math.min(minX, placed.worldX);
            minY = Math.min(minY, placed.worldZ);
            maxX = Math.max(maxX, placed.worldX + placed.width);
            maxY = Math.max(maxY, placed.worldZ + placed.height);
        }

        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }

    findSpawnPoint() {
        for (const placed of this.placedTiles) {
            if (placed.tile.content?.spawnPoint) {
                const sp = placed.tile.content.spawnPoint;
                return {
                    x: placed.worldX + sp.x * placed.width,
                    z: placed.worldZ + sp.y * placed.height
                };
            }
        }
        // Fallback to first tile center
        const first = this.placedTiles[0];
        return {
            x: first.worldX + first.width / 2,
            z: first.worldZ + first.height / 2
        };
    }

    findExitPoint() {
        for (const placed of this.placedTiles) {
            if (placed.tile.content?.exitPoint) {
                const ep = placed.tile.content.exitPoint;
                return {
                    x: placed.worldX + ep.x * placed.width,
                    z: placed.worldZ + ep.y * placed.height
                };
            }
        }
        return null;
    }

    spawnLevelContent() {
        console.log('TileLevelGenerator.spawnLevelContent: Processing', this.placedTiles.length, 'tiles');

        for (const placed of this.placedTiles) {
            const content = placed.tile.content;
            if (!content) continue;

            const centerX = placed.worldX + placed.width / 2;
            const centerZ = placed.worldZ + placed.height / 2;

            // Spawn enemies
            if (content.enemies) {
                for (const enemyGroup of content.enemies) {
                    const chance = enemyGroup.chance !== undefined ? enemyGroup.chance : 1;
                    if (this.random() > chance) continue;

                    const count = enemyGroup.count || 1;
                    for (let i = 0; i < count; i++) {
                        const offsetX = (this.random() - 0.5) * placed.width * 0.6;
                        const offsetZ = (this.random() - 0.5) * placed.height * 0.6;

                        this.spawnEnemy(enemyGroup.type, centerX + offsetX, centerZ + offsetZ);
                    }
                }
            }

            // Spawn loot
            if (content.loot) {
                const lootX = centerX + (this.random() - 0.5) * 50;
                const lootZ = centerZ + (this.random() - 0.5) * 50;
                this.game.gameManager.call('spawnLoot', lootX, lootZ, content.loot);
            }
        }
    }

    spawnEnemy(difficulty, x, z) {
        // Check if we're on server side or in offline mode
        const isServer = !!this.engine.serverNetworkManager;
        const hasAnyNetwork = this.engine.serverNetworkManager || this.game.clientNetworkManager;

        console.log('TileLevelGenerator.spawnEnemy:', { difficulty, x, z, isServer, hasAnyNetwork });

        // Only spawn if we're the server OR there's no network at all (offline single-player)
        if (!isServer && hasAnyNetwork) {
            console.log('TileLevelGenerator: Skipping spawn - client side');
            return; // Client waits for server to spawn
        }

        // Get enemy types from enemySets collection
        const collections = this.game.getCollections();
        const enemySet = collections.enemySets?.[difficulty] || collections.enemySets?.easy;

        if (!enemySet || !enemySet.units || enemySet.units.length === 0) {
            console.warn('TileLevelGenerator: No enemy set found for difficulty:', difficulty);
            return;
        }

        const types = enemySet.units;
        const type = types[Math.floor(this.random() * types.length)];

        console.log('TileLevelGenerator: Spawning enemy type:', type, 'at', x, z);

        // Use enemy spawner if available
        if (this.game.enemySpawnerSystem) {
            this.game.gameManager.call('spawnEnemy', type, x, z);
        } else {
            console.warn('TileLevelGenerator: EnemySpawnerSystem not available');
        }
    }

    getTileAt(worldX, worldZ) {
        const gridPos = this.worldToGrid(worldX, worldZ);
        if (!gridPos) return null;

        const idx = gridPos.y * this.GRID_WIDTH + gridPos.x;
        return this.grid[idx];
    }

    worldToGrid(worldX, worldZ) {
        const x = Math.floor(worldX / this.TILE_SIZE);
        const y = Math.floor(worldZ / this.TILE_SIZE);

        if (x < 0 || x >= this.GRID_WIDTH || y < 0 || y >= this.GRID_HEIGHT) {
            return null;
        }

        return { x, y };
    }

    gridToWorld(gridX, gridY) {
        return {
            x: gridX * this.TILE_SIZE + this.TILE_SIZE / 2,
            z: gridY * this.TILE_SIZE + this.TILE_SIZE / 2
        };
    }

    weightedShuffle(tiles) {
        // Create weighted array
        const weighted = [];
        for (const tile of tiles) {
            for (let i = 0; i < tile.weight; i++) {
                weighted.push(tile);
            }
        }

        // Fisher-Yates shuffle
        for (let i = weighted.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
        }

        // Remove duplicates while preserving order
        const seen = new Set();
        return weighted.filter(tile => {
            if (seen.has(tile.id)) return false;
            seen.add(tile.id);
            return true;
        });
    }

    createSeededRandom(seed) {
        // Simple seeded PRNG (mulberry32)
        let state = seed;
        return function() {
            state |= 0;
            state = state + 0x6D2B79F5 | 0;
            let t = Math.imul(state ^ state >>> 15, 1 | state);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    generateTerrainMap() {
        if (!this.levelData || !this.placedTiles.length) {
            return null;
        }

        const collections = this.game.getCollections();
        const gridSize = collections.configs?.game?.gridSize || 48;

        // Convert tile bounds to terrain map size
        // Each tile unit = TILE_SIZE world units = TILE_SIZE/gridSize terrain cells
        const cellsPerTileUnit = Math.ceil(this.TILE_SIZE / gridSize);

        // Calculate min grid coordinates (not world coordinates)
        const minGridX = Math.min(...this.placedTiles.map(p => p.gridX));
        const minGridZ = Math.min(...this.placedTiles.map(p => p.gridY));
        const maxGridX = Math.max(...this.placedTiles.map(p => p.gridX + p.tile.width));
        const maxGridZ = Math.max(...this.placedTiles.map(p => p.gridY + p.tile.height));

        // Use fixed size for simplicity (64x64)
        const mapSize = 64;

        // Initialize terrain map with rock (impassable)
        const terrainMap = [];
        const heightMap = [];
        for (let z = 0; z < mapSize; z++) {
            terrainMap[z] = new Array(mapSize).fill(2); // 2 = rock
            heightMap[z] = new Array(mapSize).fill(0);
        }

        // Terrain type indices (matching level1 terrainTypes)
        const FLOOR = 4;  // dirt
        const WALL = 2;   // rock

        // Fill in placed tiles
        for (const placed of this.placedTiles) {
            // Convert tile grid position to terrain map position
            const baseX = (placed.gridX - minGridX) * cellsPerTileUnit;
            const baseZ = (placed.gridY - minGridZ) * cellsPerTileUnit;

            // Fill tile area with floor
            const tileWidthCells = placed.tile.width * cellsPerTileUnit;
            const tileHeightCells = placed.tile.height * cellsPerTileUnit;

            for (let dz = 0; dz < tileHeightCells; dz++) {
                for (let dx = 0; dx < tileWidthCells; dx++) {
                    const x = baseX + dx;
                    const z = baseZ + dz;

                    if (x >= 0 && x < mapSize && z >= 0 && z < mapSize) {
                        // Check if this is an edge cell
                        const isEdge = dx === 0 || dx === tileWidthCells - 1 ||
                                      dz === 0 || dz === tileHeightCells - 1;

                        if (isEdge) {
                            // Check connections for openings
                            let isOpen = false;

                            // North edge
                            if (dz === 0 && placed.tile.connections.north) {
                                const connIdx = Math.floor(dx / cellsPerTileUnit);
                                const conn = placed.tile.connections.north[connIdx];
                                if (conn === 'open' || conn === 'door' || conn === 'wide') {
                                    isOpen = true;
                                }
                            }
                            // South edge
                            if (dz === tileHeightCells - 1 && placed.tile.connections.south) {
                                const connIdx = Math.floor(dx / cellsPerTileUnit);
                                const conn = placed.tile.connections.south[connIdx];
                                if (conn === 'open' || conn === 'door' || conn === 'wide') {
                                    isOpen = true;
                                }
                            }
                            // West edge
                            if (dx === 0 && placed.tile.connections.west) {
                                const connIdx = Math.floor(dz / cellsPerTileUnit);
                                const conn = placed.tile.connections.west[connIdx];
                                if (conn === 'open' || conn === 'door' || conn === 'wide') {
                                    isOpen = true;
                                }
                            }
                            // East edge
                            if (dx === tileWidthCells - 1 && placed.tile.connections.east) {
                                const connIdx = Math.floor(dz / cellsPerTileUnit);
                                const conn = placed.tile.connections.east[connIdx];
                                if (conn === 'open' || conn === 'door' || conn === 'wide') {
                                    isOpen = true;
                                }
                            }

                            terrainMap[z][x] = isOpen ? FLOOR : WALL;
                        } else {
                            // Interior is always floor
                            terrainMap[z][x] = FLOOR;
                        }
                    }
                }
            }
        }

        return {
            terrainMap,
            heightMap,
            size: mapSize
        };
    }

    update() {
        // Could update dynamic level elements here
    }
}
