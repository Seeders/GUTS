# Action RPG

A Diablo 2-style action RPG built with the GUTS game engine, featuring procedural level generation and fast-paced combat.

## Features

- **Diablo 2-style Controls**: Click to move, click to attack
- **Procedural Level Generation**: Dungeons are generated using Wave Function Collapse algorithm
- **ARPG Combat System**: Real-time combat with elemental damage, critical hits, and resistances
- **Character Progression**: Level up, gain stats, and acquire new skills
- **Loot System**: Enemies drop gold and items with different rarities
- **Enemy AI**: Intelligent enemies that patrol, chase, and attack

## Architecture

This project follows the same ECS (Entity-Component-System) architecture as TurnBasedWarfare:

### Core Managers
- **GameManager**: Service locator pattern for cross-system communication
- **ComponentManager**: Defines all component types and factories
- **ScreenManager**: Manages UI screens (menu, game, victory, defeat)

### Systems
- **PlayerControllerSystem**: Handles player input (click-to-move, click-to-attack, skills)
- **MovementSystem**: Updates entity positions, applies gravity, handles collisions
- **CombatSystem**: Handles attacks, damage calculation, death, loot drops
- **EnemyAISystem**: AI state machine (idle, patrol, chase, attack)
- **LevelGeneratorSystem**: Generates procedural dungeons using WFC algorithm
- **RenderSystem**: 3D rendering with THREE.js

### Components
The game uses a rich component library including:
- Core: Position, Velocity, Facing, Collision, Health, Mana
- Player: PlayerController, Stats, Inventory, Equipment, Skills
- Combat: Combat, StatusEffect, Projectile
- Enemy: EnemyAI, LootTable, ExperienceReward

## Level Generation

Levels are generated using a Wave Function Collapse algorithm that pieces together pre-made terrain chunks:

1. **Chunk Templates**: Rooms, corridors, junctions, treasure rooms, boss rooms
2. **Constraint Propagation**: Ensures exits line up properly between adjacent chunks
3. **Weighted Selection**: Different room types have different spawn probabilities
4. **Entity Spawning**: Spawners in chunks create enemies, chests, and other entities

The system is designed to be extended with more chunk templates created in the TerrainMapEditor.

## Controls

- **Left Click**: Move to location / Attack enemy
- **Right Click**: Force attack
- **1-8**: Use skill hotkeys
- **Q**: Use health potion
- **W**: Use mana potion
- **ESC**: Pause/Unpause

## Development

The game reuses many patterns and systems from TurnBasedWarfare but adapts them for ARPG gameplay:

- Service locator pattern for decoupled system communication
- Event system for triggering game events
- Data-driven design with JSON configuration
- Authoritative server model (ready for multiplayer)

## Future Enhancements

- More enemy types and bosses
- More skills and abilities
- Equipment system with stats
- Procedural item generation
- Multiple dungeon tilesets
- Minimap
- Sound effects and music
- Particle effects
- Status effects (poison, freeze, stun)
