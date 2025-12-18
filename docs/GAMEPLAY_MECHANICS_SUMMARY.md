# TurnBasedWarfare - Gameplay Mechanics Summary

## Overview
**TurnBasedWarfare** is a hybrid RTS/auto-battler game built on the GUTS engine. Players build armies, position units strategically during a placement phase, then watch them battle in real-time 30-second combat rounds. The game features multiplayer (Arena) and single-player vs AI (Skirmish) modes.

---

## Core Game Loop

### Match Flow
1. **Lobby** → Players join/create rooms (max 2 players)
2. **Placement Phase** → Purchase and position units on your half of the map, set movement orders
3. **Battle Phase** → 30 seconds of automated real-time combat
4. **Repeat** → Surviving units carry over, gold awarded, place more units
5. **Victory** → Destroy all enemy buildings

### Phase System
- **Placement Phase**: Unlimited time to buy/place units and set targets
- **Battle Phase**: 30-second real-time combat where units act autonomously
- **Ended Phase**: Game over, display results

---

## Unit System

### Unit Archetypes (Tier System)
Units are classified by primary stat and tier:

| Code | Type | Description |
|------|------|-------------|
| **S** | Strength | Melee warriors (Barbarians, Berserkers, Gladiators) |
| **D** | Dexterity | Ranged units (Archers, Rangers, Trappers) |
| **I** | Intelligence | Mages (Necromancers, Elementalists, Enchanters) |
| **SD** | Str/Dex | Hybrid melee-ranged (Knights, Crossbowmen, Hoplites) |
| **DI** | Dex/Int | Rogue-casters (Shadow Assassins, Tricksters, Scouts) |
| **IS** | Int/Str | Paladins/Holy warriors (Crusaders, Paladins, Acolytes) |

### Tier Pricing
- **Tier 0**: Summoned units (Skeletons, Golems) - 0 gold
- **Tier 1**: Basic units - 35-50 gold
- **Tier 2**: Advanced units - 100-250 gold
- **Tier 4**: Elite units - 500+ gold (Dragons, Archmages, Ancient Treants)

### Unit Stats
- **HP**: Health points
- **Speed**: Movement speed
- **Damage**: Base attack damage
- **Attack Speed**: Attacks per second
- **Range**: Attack range (melee ~50, ranged ~300-400)
- **Armor**: Flat physical damage reduction
- **Element Resistances**: Fire, Cold, Lightning, Poison (percentage reduction, capped at 90%)
- **Size/Height**: Collision and visual dimensions
- **Value**: Gold cost to purchase

### Special Units
- **Peasant**: Worker unit that builds Gold Mines
- **Sentry**: Defensive structure
- **Dragons**: Massive flying units with breath attacks

---

## Combat System

### Damage Types & Mitigation
| Element | Mitigation | Notes |
|---------|------------|-------|
| **Physical** | Armor (flat reduction) | `damage - armor` |
| **Fire** | Fire Resistance % | Reduced by percentage |
| **Cold** | Cold Resistance % | Reduced by percentage |
| **Lightning** | Lightning Resistance % | Reduced by percentage |
| **Poison** | None (DoT only) | Stacking damage over time |
| **Holy** | Cannot be reduced | Healing and divine smite |
| **Shadow** | Cannot be reduced | Necromancy and curses |

### Combat Features
- **Critical Hits**: 2x damage multiplier
- **Splash Damage**: AoE with distance falloff
- **Poison Stacks**: DoT that stacks and ticks over time
- **Scheduled Damage**: Delayed damage for melee attack timing
- **Buffs/Debuffs**: Modify damage dealt and taken

---

## Ability System (40+ Abilities)

### Ability Properties
- **Cooldown**: Time between uses (1-30 seconds)
- **Range**: How far ability can reach
- **Cast Time**: Delay before ability executes
- **Target Type**: enemy, ally, self, or auto
- **Priority**: AI preference (higher = used first)
- **Auto Trigger**: Conditions for AI to use (e.g., "injured_ally")

### Ability Categories

**Offensive (Direct Damage)**
- FireBall, IceShard, LightningBolt, Smite
- MeteorStrike, ChainLightning

**AoE Damage**
- Blizzard, FireStorm, Inferno
- ExplosiveTrap, DisruptionBomb

**Buffs (Self/Ally)**
- Rage, BattleCry, Bloodlust
- EnchantWeapon, WindShield

**Debuffs (Enemy)**
- Curse, DrainLife, ShadowStrike
- MindControl, TrackingMark

**Summons**
- RaiseDead (Skeletons)
- SummonWolf
- MirrorImages (illusions)

**Support/Healing**
- Heal, MassHeal, Consecration

**Movement/CC**
- Charge (dash + stun)
- LeapSlam (jump + AoE)
- Tornado

**Formation**
- ShieldWall, PhalanxFormation

**Ranged Specials**
- MultiShot, PiercingShot

**Auras (Passive AoE)**
- BurningAura, FreezingAura, CorruptingAura, ArenaPresence

---

## Grid & Map System

### Dual Grid System
- **Terrain Grid**: 48-unit cells for tile rendering
- **Placement Grid**: 24-unit cells (half terrain) for unit positioning

### Map Division
- Map split in half vertically
- Left side: Team 1 placement zone
- Right side: Team 2 placement zone
- Units can only be placed on your side during placement phase

### Movement & Pathfinding
- **A* Pathfinding** with caching
- **Spatial Grid** for O(1) nearby unit queries
- **Separation Forces** prevent unit overlap
- **Obstacle Avoidance** around units and terrain
- **Gravity System** units follow terrain elevation

---

## Economy System

### Gold
- **Starting Gold**: 100 per player
- **Round Progression**: Base 50 + 50 per round
- **Gold Mines**: Peasants build on gold veins for passive income

### Unit Purchasing
- Buy units during placement phase
- Spend gold based on unit tier/type
- Surviving units carry over (no refund for dead units)

---

## Game Modes

### Implemented
| Mode | Players | Description |
|------|---------|-------------|
| **Skirmish** | 1 | Battle AI opponent, single round |
| **Arena** | 2 | PvP multiplayer |

### Planned (Commented Out)
- **Campaign**: 10 rounds, progressive unlocks
- **Survival**: Infinite rounds, decreasing gold
- **Challenge**: Preset enemies, special constraints
- **Endless**: Infinite scaling enemies
- **Tournament**: Bracket-style progression

---

## AI System

### Behavior Trees
- Hierarchical decision-making system
- **Sequence Nodes**: Execute children until failure
- **Selector Nodes**: Try children until success
- **Parallel Nodes**: Multiple simultaneous actions
- **Action Nodes**: Combat, movement, abilities
- **Decorator Nodes**: Modify behavior (cooldowns, conditions)

### AI Ability Usage
- Abilities sorted by priority
- Highest priority off-cooldown ability used first
- Auto-triggers for situational abilities (heal when ally injured)

### AI Placement (Skirmish)
- Automatically generates balanced army composition
- Uses gold budget efficiently
- Strategic positioning near buildings/gold veins

---

## Networking/Multiplayer

### Architecture
- **Authoritative Server**: Server validates all actions
- **Client Prediction**: Smooth local experience
- **Deterministic RNG**: Seeded random for reproducible battles

### Key Events
- Lobby: CREATE_ROOM, JOIN_ROOM, TOGGLE_READY, START_GAME
- Placement: SUBMIT_PLACEMENT, SET_SQUAD_TARGET, PURCHASE_UPGRADE
- Battle: BATTLE_END, GAME_END (with entity sync)

### Synchronization
- Complete ECS state sync after each battle
- Typed arrays for efficient network transfer
- Entity IDs assigned deterministically

---

## Win/Loss Conditions

### Victory
- **Destroy all enemy buildings** → Immediate win
- **Opponent disconnects** → Win by forfeit

### No Draw
- If battle timer expires with buildings on both sides → Continue to next round
- Game continues until one side loses all buildings

---

## Technical Architecture

### Engine: GUTS
- Entity-Component-System (ECS) architecture
- TypedArrays for memory-efficient components
- Three.js for 3D rendering
- Socket.io for multiplayer
- Rapier for physics

### Performance Optimizations
- Spatial grid with cell hashing
- Object pooling to reduce garbage collection
- Incremental grid updates
- Seeded deterministic RNG for sync

### Systems (50+ Systems)
Key systems include: GameModeSystem, BehaviorSystem, MovementSystem, DamageSystem, AbilitySystem, GridSystem, PlacementSystem, ClientNetworkSystem, DeathSystem, ProjectileSystem, AnimationSystem, ParticleSystem, FogOfWarSystem, VisionSystem, and many more.

---

## Summary for AI Context

**Genre**: Turn-based strategy / Auto-battler hybrid with real-time combat phases

**Core Mechanics**:
1. Buy units with gold during placement phase
2. Position units strategically on your half of the map
3. Set movement orders/targets for units
4. Watch 30-second automated battles
5. Surviving units persist, earn gold, repeat
6. Win by destroying all enemy buildings

**Key Systems**: ECS architecture, behavior trees for AI, deterministic multiplayer, elemental damage/resistance system, 40+ unique abilities, tiered unit progression, gold economy with gold mines.
