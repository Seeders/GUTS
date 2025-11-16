# Terrain Level Chunks

This directory contains terrain chunks used by the Wave Function Collapse algorithm to generate procedural dungeons.

## Chunk Format

Each chunk is a 16x16 grid defined in JSON format:

```json
{
  "name": "chunk_name",
  "type": "room|corridor|junction|combat|treasure|boss",
  "weight": 1-3,
  "size": 16,
  "exits": {
    "north": true/false,
    "south": true/false,
    "east": true/false,
    "west": true/false
  },
  "terrainMap": [ /* 16x16 array */ ],
  "spawners": [
    {
      "x": 8,
      "z": 8,
      "type": "skeleton|zombie|boss|chest",
      "count": 2
    }
  ],
  "description": "Human-readable description"
}
```

## Terrain Types

- `0`: Void/Empty
- `1`: Wall (impassable)
- `2`: Floor (walkable)

## Chunk Types

### Start Room (`start_room.json`)
- Large open room with 4 exits
- Player spawns here
- No enemies

### Corridors
- `corridor_ns.json` - North-South corridor
- `corridor_ew.json` - East-West corridor
- `l_bend_*.json` - L-shaped bends (NE, SE, SW, NW)

### Junctions
- `junction_nse.json` - T-junction (North, South, East)
- `junction_nsw.json` - T-junction (North, South, West)
- `junction_new.json` - T-junction (North, East, West)
- `junction_sew.json` - T-junction (South, East, West)

### Combat Rooms
- `combat_room_small.json` - Small octagonal room with 2-3 enemies
- `combat_room_large.json` - Large room with central pillar and 4-6 enemies

### Treasure Room (`treasure_room.json`)
- Dead-end room with chest and guardian enemies
- Only accessible from one direction

### Boss Room (`boss_room.json`)
- Large arena with boss and minions
- Dead-end room

## Wave Function Collapse

The LevelGeneratorSystem uses these chunks to build complete dungeons:

1. **Constraint Matching**: Chunks can only connect if their exits align
2. **Weighted Selection**: Higher weight = more likely to spawn
3. **Entropy Reduction**: Algorithm picks cells with fewest valid options first
4. **Propagation**: Placing a chunk constrains neighboring cells

## Creating New Chunks

You can create new chunks using the TerrainMapEditor:

1. Open TerrainMapEditor in GUTS
2. Create a 16x16 grid
3. Paint terrain (walls = 1, floor = 2)
4. Define exits at edges (rows 0, 7-8, 15 and columns 0, 7-8, 15)
5. Add spawners for enemies/items
6. Export as JSON
7. Place in this directory
8. Add filename to LevelGeneratorSystem.chunkFiles array

## Tips for Good Chunks

- **Exits must align**: If north exit is true, ensure tiles at [0][7] and [0][8] are floor (2)
- **Connectivity**: Ensure all floor tiles are connected
- **Balance**: Don't make rooms too large or too small
- **Variety**: Create multiple versions of each type
- **Weights**: Common chunks (corridors) should have higher weights (2-3)
- **Rare chunks** (treasures, bosses) should have lower weights (1)

## Spawner Types

- `skeleton` - Basic melee enemy
- `zombie` - Slower, tankier enemy
- `boss` - Powerful unique enemy
- `chest` - Loot container

Spawner positions are in local chunk coordinates (0-15).
