# Headless Puzzle Simulation

Run puzzle game simulations without rendering for automated testing.

## Overview

Headless mode runs puzzle simulations to test guard behaviors, player mechanics, and level completion. Each test runs in an isolated game state.

## Usage

```bash
# Run all puzzle simulations
node headless.js

# Run a specific simulation
node headless.js --simulation guard_chase_player

# Show help
node headless.js --help
```

## Simulations

Simulations are JSON files in `collections/data/simulations/` with `testType: "puzzle"`.

### Available Simulations

| Simulation | Description |
|------------|-------------|
| `guard_chase_player` | Guard detects, chases, and attacks player |
| `player_escape_guard` | Player escapes guard's vision, guard gives up |
| `guard_pickup_illusion` | Guard picks up illusion and waits 3 seconds |
| `player_reach_exit` | Player reaches exit zone to complete level |

### Simulation Format

```json
{
  "name": "Guard Chase Player",
  "description": "Tests guard detecting and attacking player",
  "testType": "puzzle",
  "level": "puzzle_tutorial",
  "maxTicks": 600,
  "setup": {
    "guardNearPlayer": true
  },
  "expectedOutcome": {
    "playerDied": true
  }
}
```

### Setup Options

| Option | Description |
|--------|-------------|
| `guardNearPlayer` | Position player within guard's vision range |
| `movePlayerToExit` | Move player to exit zone |
| `createIllusion` | Create an illusion object at specified position |
| `escapePlayerAfterTicks` | Ticks before player teleports away |
| `escapePosition` | Position to teleport player to |

### Expected Outcomes

| Outcome | Description |
|---------|-------------|
| `playerDied` | Player health reaches 0 |
| `levelComplete` | Player reaches exit zone |
| `guardGaveUp` | Guard stops chasing player |
| `illusionPickedUp` | Guard picks up illusion |
| `guardWaited` | Guard waits after pickup |

## Creating New Simulations

1. Create a JSON file in `collections/data/simulations/`
2. Set `testType: "puzzle"`
3. Define `setup` conditions
4. Define `expectedOutcome` assertions
5. Run with `node headless.js --simulation your_simulation_name`

## Example Output

```
[Headless] ══════════════════════════════════════════
[Headless] Guard Chase Player
[Headless] ──────────────────────────────────────────
[Headless] Player positioned near guard
[Headless] Player died at tick 294
[Headless] ✓ PASSED

[Headless] ══════════════════════════════════════════
[Headless] SUMMARY
[Headless] ──────────────────────────────────────────
[Headless] ✓ Guard Chase Player
[Headless] ✓ Guard Pickup Illusion
[Headless] ✓ Player Escape Guard
[Headless] ✓ Player Reach Exit
[Headless] ──────────────────────────────────────────
[Headless] 4/4 passed
[Headless] ══════════════════════════════════════════
```
