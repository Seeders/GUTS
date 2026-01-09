# GUTS ECS Boid Simulation

A high-performance boid flocking simulation demonstrating the GUTS game engine's ECS (Entity Component System) architecture with 100,000 boids.

This project is designed for performance comparison testing between GUTS (JavaScript ECS) and other game engines written in C.

---

## Quick Start

### Building and Running

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Start the server:**
   ```bash
   npm run game:server
   ```

3. **View the simulation:**
   Open http://localhost:3000/index.html in your browser

### Development Mode

For active development with auto-rebuild:
```bash
npm run game:dev
```

---

## Simulation Features

### Boid Behavior
- **Separation**: Steer away from nearby boids to avoid crowding
- **Alignment**: Steer towards the average heading of nearby boids
- **Cohesion**: Steer towards the average position of nearby boids
- **Target Seeking**: Move towards animated target points
- **Obstacle Avoidance**: Avoid predator entities

### Performance Optimizations
- **Spatial Hashing**: O(1) neighbor lookups using 8192-bucket grid
- **Per-Cell Aggregates**: Alignment/separation calculated once per cell
- **TypedArray Access**: Direct array access bypasses ECS proxy overhead
- **Instanced Rendering**: Single draw call for all 100k boids

### Configuration Constants
```javascript
NUM_BOIDS = 100000          // Total boid count
GRID_SIZE = 8192            // Spatial hash buckets
CELL_SIZE = 8.0             // World units per cell
MAX_PER_BUCKET = 256        // Max boids per bucket

BOID_SEPARATION_WEIGHT = 1.0
BOID_ALIGNMENT_WEIGHT = 1.0
BOID_TARGET_WEIGHT = 2.0
BOID_OBSTACLE_AVERSION_DISTANCE = 30.0
BOID_MOVE_SPEED = 25.0
```

---

## Project Structure

```
BoidSimulation/
├── collections/
│   ├── data/
│   │   └── components/           # ECS component schemas
│   │       ├── position.json     # 3D position (x, y, z)
│   │       ├── heading.json      # Direction vector (x, y, z)
│   │       ├── boidTag.json      # Tag for boid entities
│   │       ├── boidIndex.json    # Instance index for rendering
│   │       ├── target.json       # Tag for target entities
│   │       └── obstacle.json     # Tag for obstacle entities
│   ├── scripts/
│   │   └── systems/
│   │       └── js/
│   │           ├── BoidFlockingSystem.js   # Core flocking logic
│   │           └── BoidRenderSystem.js     # Three.js rendering
│   └── settings/
│       └── configs/
│           └── game.json         # Game configuration
├── dist/
│   └── client/
│       └── index.html           # Client entry point
├── server.js                     # Server entry point
└── README.md                     # This file
```

---

## Systems Overview

### BoidFlockingSystem
The core flocking simulation system implementing:

1. **Spatial Hash Insertion**: Places boids into grid buckets
2. **Cell Merging**: Calculates per-cell aggregates for alignment/separation
3. **Boid Steering**: Applies flocking rules to each boid
4. **Matrix Building**: Generates transform matrices for instanced rendering

### BoidRenderSystem
Three.js-based rendering system:

- Creates instanced mesh for 100k boids
- Updates instance matrices each frame
- Renders animated target/obstacle entities
- Displays FPS and boid count overlay

---

## ECS Architecture

### Components

| Component | Fields | Description |
|-----------|--------|-------------|
| `position` | x, y, z | World position |
| `heading` | x, y, z | Normalized direction vector |
| `boidIndex` | index | Instance buffer index |
| `boidTag` | dummy | Tags entity as a boid |
| `target` | dummy | Tags entity as a target |
| `obstacle` | dummy | Tags entity as an obstacle |

### Entity Types

- **Boids** (100,000): position, heading, boidIndex, boidTag
- **Targets** (2): position, target (animated waypoints)
- **Obstacles** (1): position, obstacle (predator to avoid)

---

## Performance Comparison

This simulation mirrors the C implementation in `boid_code.c` for fair comparison:

| Feature | GUTS (JavaScript) | C Implementation |
|---------|-------------------|------------------|
| Boid Count | 100,000 | 100,000 |
| Spatial Hash | 8192 buckets | 8192 buckets |
| Cell Size | 8.0 units | 8.0 units |
| Behavior Weights | Identical | Identical |
| Rendering | Three.js instanced | Custom GPU |

### Measuring Performance

1. Open browser developer tools (F12)
2. Check the FPS counter in the top-left overlay
3. Monitor frame times in the Performance tab

---

## Modifying the Simulation

### Adjusting Boid Count

Edit `BoidFlockingSystem.js`:
```javascript
this.NUM_BOIDS = 50000;  // Reduce for slower machines
```

### Tuning Behavior

Edit the weight constants:
```javascript
this.BOID_SEPARATION_WEIGHT = 1.5;  // More spacing
this.BOID_ALIGNMENT_WEIGHT = 0.5;   // Less alignment
this.BOID_TARGET_WEIGHT = 3.0;      // Stronger attraction
```

### Adding More Targets

Edit the spawn function:
```javascript
this.NUM_TARGETS = 4;  // More waypoints
```

---

## Technical Notes

### Spatial Hashing Algorithm

The simulation uses a simple spatial hash:
```javascript
hash(x, y, z) = ((x/CELL_SIZE * 73856093) ^
                 (y/CELL_SIZE * 19349663) ^
                 (z/CELL_SIZE * 83492791)) % GRID_SIZE
```

### Per-Cell Optimization

Instead of each boid checking all neighbors, we:
1. Insert all boids into buckets (O(n))
2. Calculate alignment/separation sums per bucket (O(GRID_SIZE))
3. Each boid reads pre-computed bucket values (O(n))

This reduces complexity from O(n²) to O(n).

---

## Credits

Built with GUTS (Gamedev Ultimate Toolkit System)

Based on the boid algorithm by Craig Reynolds (1986)

---

## License

MIT License - See main GUTS repository for details
