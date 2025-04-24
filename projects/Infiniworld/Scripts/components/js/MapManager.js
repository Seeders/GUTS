class MapManager extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
init({level}) {
  this.nodeClass = class Node {
    constructor(x, y, tileType, parent = null) {
        this.x = x;
        this.y = y;
        this.tileType = tileType;
        this.parent = parent;
        
        this.g = 0; // Cost from start to current node
        this.h = 0; // Heuristic (estimated cost from current to goal)
        this.f = 0; // Total cost (g + h)
    }

    equals(other) {
        return this.x === other.x && this.y === other.y;
    }

    // Unique key for node based on coordinates
    key() {
        return `${this.x},${this.y}`;
    }
};
  this.tileMap = level.tileMap;
   
   const {tileMap, paths} = this.generateMap();
   this.game.state.tileMap = tileMap;
   this.game.state.paths = paths;
}

    generateMap() {
        // Extract values from the data object
        const { size, terrainTypes, terrainMap } = this.tileMap;
        
        let paths = [];
        let starts = [];
        let endPoint = {x: 0, y: 0};

        // Find START and END tile types by their IDs
        const startTypeId = terrainTypes.findIndex(t => t.type === "start");
        const endTypeId = terrainTypes.findIndex(t => t.type === "end");
        // Create the tile map using the provided terrainMap
        const tileMap = terrainMap.map((row, y) => 
            row.map((terrainId, x) => {
                // Find the terrain object to get color information
                const terrain = terrainTypes[terrainId]; 
                // Check for start/end points using IDs
                if(terrainId === startTypeId) {
                    starts.push({x: x, y: y});
                } else if(terrainId === endTypeId) {
                    endPoint = {x: x, y: y};
                }
                
                return { 
                    type: terrain ? terrain.type : 'unknown',
                    typeId: terrainId,
                    color: terrain ? terrain.color : '#8bc34a', // Default to grass color if not found
                    buildable: terrain ? terrain.buildable : false
                };
            })
        );        
        
        starts.forEach((startPoint) => {
            paths.push(this.findPath(startPoint, endPoint, terrainMap));
        });

        return { tileMap, paths };
    }

    findPath(startPoint, endPoint, tileMap) {
        return this.aStar(startPoint, endPoint, tileMap);
    }
    
    /**
     * A* pathfinding algorithm
     * @param {Object} start - Starting position {x, y}
     * @param {Object} end - Ending position {x, y}
     * @param {Array} tileMap - 2D array representing the map
     * @returns {Array} - Array of positions forming the path, or empty array if no path found
     */
    aStar(start, end, tileMap) {
       
        const rows = tileMap.length;
        const cols = tileMap[0].length;
        
        // Validate inputs
        if (start.x < 0 || start.x >= cols || start.y < 0 || start.y >= rows) {
            throw new Error('Start position is outside the map bounds');
        }
        if (end.x < 0 || end.x >= cols || end.y < 0 || end.y >= rows) {
            throw new Error('End position is outside the map bounds');
        }
        
        // Create start and end nodes
        const startNode = new this.nodeClass(start.x, start.y, tileMap[start.y][start.x]);
        const endNode = new this.nodeClass(end.x, end.y, tileMap[end.y][end.x]);
        
        // Initialize open and closed lists
        const openList = [];
        const closedList = new Set();
        const openSet = new Set(); // For faster lookups
        
        // Add start node to open list
        openList.push(startNode);
        openSet.add(startNode.key());
        
        // Define movement directions (4-directional: up, right, down, left)
        const directions = [
            {x: 0, y: -1}, // Up
            {x: 1, y: 0},  // Right
            {x: 0, y: 1},  // Down
            {x: -1, y: 0}  // Left
            
            // {x: 1, y: 1}, // Up
            // {x: 1, y: -1},  // Right
            // {x: -1, y: 1},  // Down
            // {x: -1, y: -1}  // Left
        ];
        
        // Main loop
        while (openList.length > 0) {
            // Sort by f value and take the lowest
            openList.sort((a, b) => a.f - b.f);
            const currentNode = openList.shift();
            openSet.delete(currentNode.key());
            
            // Add current node to closed list
            closedList.add(currentNode.key());
            
            // Check if we've reached the end
            if (currentNode.equals(endNode)) {
                // Reconstruct the path
                return this.reconstructPath(currentNode);
            }
            
            // Generate neighbors
            for (const dir of directions) {
                const neighborX = currentNode.x + dir.x;
                const neighborY = currentNode.y + dir.y;
                
                // Check if neighbor is inside the map
                if (neighborX < 0 || neighborX >= cols || neighborY < 0 || neighborY >= rows) {
                    continue;
                }
                
                const tileType = tileMap[neighborY][neighborX];
                const neighbor = new this.nodeClass(neighborX, neighborY, tileType, currentNode);
                const neighborKey = neighbor.key();
                
                // Skip if neighbor is in closed list
                if (closedList.has(neighborKey)) {
                    continue;
                }
                
                // Calculate g score for this neighbor
                // Path tiles will have a much lower cost than other tile types
                let movementCost = this.calculateMovementCost(tileType);
                const tentativeG = currentNode.g + movementCost;
                
                // Check if this is a better path to neighbor
                if (!openSet.has(neighborKey) || tentativeG < neighbor.g) {
                    // Update neighbor values
                    neighbor.g = tentativeG;
                    neighbor.h = this.calculateHeuristic(neighbor, endNode);
                    neighbor.f = neighbor.g + neighbor.h;
                    
                    // Add neighbor to open list if not there already
                    if (!openSet.has(neighborKey)) {
                        openList.push(neighbor);
                        openSet.add(neighborKey);
                    }
                }
            }
        }
        
        // No path found
        return [];
    }
    
    /**
     * Calculate movement cost based on tile type
     * Path tiles are heavily favored
     * @param {number} tileTypeId - ID of the tile type
     * @returns {number} - Movement cost
     */
    calculateMovementCost(tileTypeId) {
        // Find path and end type IDs
        const { terrainTypes } = this.tileMap;
        const pathTypeId = terrainTypes.findIndex(t => t.type === "path");
        const endTypeId = terrainTypes.findIndex(t => t.type === "end");
        
        // Heavily favor "path" and "end" type tiles
        if (tileTypeId === pathTypeId || tileTypeId === endTypeId) {
            return 1;
        } else {
            // Make non-path tiles much less desirable
            return 100000;
        }
    }
    
    /**
     * Calculate heuristic (Manhattan distance)
     * @param {Node} nodeA 
     * @param {Node} nodeB 
     * @returns {number} - Heuristic value
     */
    calculateHeuristic(nodeA, nodeB) {
        return Math.abs(nodeA.x - nodeB.x) + Math.abs(nodeA.y - nodeB.y);
    }
    
    /**
     * Reconstruct the path from the end node to the start
     * @param {Node} endNode - The end node
     * @returns {Array} - Array of positions {x, y} from start to end
     */
    reconstructPath(endNode) {
        const path = [];
        let currentNode = endNode;
        
        while (currentNode !== null) {
            path.unshift({
                x: currentNode.x,
                y: currentNode.y,
                tileType: currentNode.tileType
            });
            currentNode = currentNode.parent;
        }
        
        return path;
    }
}