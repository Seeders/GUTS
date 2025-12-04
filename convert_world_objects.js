const fs = require('fs');
const path = require('path');

// Read the level file
const levelPath = 'c:\\projects\\GUTS\\projects\\TurnBasedWarfare\\scripts\\Terrain\\levels\\level1.json';
const data = JSON.parse(fs.readFileSync(levelPath, 'utf8'));

const GRID_SIZE = 48;

// Convert world objects from x,y (world coordinates) to gridX,gridZ (grid coordinates)
if (data.tileMap && data.tileMap.worldObjects) {
    data.tileMap.worldObjects = data.tileMap.worldObjects.map(obj => {
        // Convert world coordinates to grid coordinates
        // Objects are centered in tiles, so we round to nearest grid position
        const gridX = Math.round(obj.x / GRID_SIZE);
        const gridZ = Math.round(obj.y / GRID_SIZE);

        return {
            type: obj.type,
            gridX: gridX,
            gridZ: gridZ
        };
    });

    console.log(`Converted ${data.tileMap.worldObjects.length} world objects to grid coordinates`);
}

// Write back to file
fs.writeFileSync(levelPath, JSON.stringify(data, null, 2), 'utf8');
console.log('Conversion complete!');
