# Hero Arena

An army-building autobattler built with the GUTS engine. Forked from TurnBasedWarfare.

Each round, players draft heroes, buy units/upgrades/abilities from a per-player reroll
shop, position their army during a prep phase, then watch a fully automated battle resolve.
Win by wiping the enemy's heroes across a best-of series of rounds.

---

## Quick Start

### Running the Game

1. **Build the project:**
   ```bash
   npm run build -- HeroArena
   ```

2. **Start the game server:**
   ```bash
   node projects/HeroArena/server.js
   ```

3. **Play:**
   Open http://localhost:3000/index.html in your browser.

### Headless Simulation

Run server-side battle simulations without rendering (AI testing, balance work):

```bash
node projects/HeroArena/headless.js --simulation <name> --seed <number>
```

See [HEADLESS_SIMULATION.md](HEADLESS_SIMULATION.md) for build orders, batch mode, and
result output. Simulations are deterministic for a given seed.

---

## Game Flow

```
LOBBY → LEADER SELECT → HERO SELECT → PREP (shop + placement) → BATTLE → RESOLVE
                                         ↑                                  |
                                         └────────── next round ───────────┘
```

- **Leader select** — each player picks 1 of 6 leaders (Commander, Alchemist, Warlord,
  Scholar, Ranger, Trickster) granting a match-long passive.
- **Hero select** — pick a starting hero class (Barbarian, Apprentice, Archer, Acolyte,
  Soldier, Scout); additional heroes join at milestone rounds.
- **Prep phase** — income arrives (20g/round base), the shop offers 5 choices
  (units / upgrades / abilities / buildings / Town Hall tiers); reroll costs escalate
  within the round. Drag heroes and buildings to position them.
- **Battle** — deterministic auto-battle, 30s cap. Heroes respawn next round at their
  last battle positions; survivors grant nothing — victory is about hero kills.

### Shop & Progression

- Buying a unit **unlocks** it for repeat purchase from the unlocked panel.
- Tier-2/3 units gate on Town Hall tier (Keep/Castle) plus a matching archetype
  building (Barracks = STR, Hunting Lodge = DEX, Mage Tower = INT).
- Upgrades/abilities only appear when an owned unit satisfies their requirements.
- See `collections/scripts/systems/js/ArmyShopSystem.js` for pricing/eligibility rules.

---

## Project Structure

```
HeroArena/
├── collections/
│   ├── settings/configs/      # game.json (client), server.json, headless.json, ...
│   ├── data/                  # JSON data: scenes, components, enums, upgrades,
│   │                          #   shopAbilities, buildOrders, simulations, ...
│   ├── spawns/                # Unit & building prefabs (37 units, T1–T3)
│   ├── scripts/
│   │   ├── systems/js/        # Game systems (see below)
│   │   ├── abilities/js/      # Ability implementations
│   │   └── libraries/js/      # Support libraries
│   ├── behaviors/             # Behavior trees, actions, decorators
│   ├── ui/                    # HTML/CSS interfaces and modals
│   └── resources/             # Models, sprites, audio
├── server.js                  # Multiplayer game server entry (Socket.IO)
├── headless.js                # Headless simulation entry
├── index.html                 # Browser client entry
└── dist/                      # Build output (client/ and server/)
```

### Key Systems

| System | Role |
|--------|------|
| `AutobattlerRoundSystem` | Round loop: leader/hero select → prep → battle → resolve |
| `ArmyShopSystem` | Server-authoritative reroll shop (offers, pricing, eligibility) |
| `HeroRosterSystem` | Persistent hero roster; respawns heroes each round |
| `PlacementSystem` | Prep-phase unit/building placement |
| `ServerBattlePhaseSystem` | Battle start/end, seeded battle RNG, result broadcast |
| `ServerNetworkSystem` / `ClientNetworkSystem` | Event handlers / transport (shared handlers for local + online) |
| `BehaviorSystem` | Unit AI behavior trees during battle |
| `AutobattlerEconomySystem` | Round income and bonuses |

---

## Networking Architecture

Hero Arena uses a hybrid of the two GUTS multiplayer models:

- **Prep/shop phase — server-authoritative replication.** Shop offers, purchases,
  selections, and placement all resolve on the server; clients receive `SHOP_OFFERS`,
  `ARMY_SYNC`, and `ENTITY_SYNC` broadcasts. Prep-phase randomness lives only on the
  server (seeded `shop`/`ai` RNG strands), so clients never need to reproduce it.
- **Battle phase — deterministic lockstep.** At ready-up the server broadcasts a full
  entity sync plus the authoritative `gameSeed`; both sides reseed the `battle` RNG
  strand with `combineSeed(gameSeed, round)` and run the identical simulation at a
  fixed 20 TPS. `BATTLE_END` carries a delta sync that clients apply once their tick
  clock catches up to the server's.

**Determinism rules for contributors:** inside anything that runs during battle
(systems, behavior trees, abilities), never use `Math.random()`, `Date.now()`, or
`setTimeout` — use `game.rng.strand('battle')`, `game.state.now`, and the
`SchedulingSystem`. Server-only prep code uses the `shop` and `ai` strands so headless
runs stay reproducible per seed.

Local skirmish and online play share the same server handlers: in local mode
`ClientNetworkSystem.networkRequest` calls them directly in-process; online it routes
through Socket.IO (`ServerEventManager` on the server side).

---

## Development Tips

- `window.game` is exposed in the browser console for entity inspection
  (`game.getEntitiesWith(...)`, `game.getComponent(...)`).
- `game.desyncDebugger` is enabled during battles for client/server state comparison.
- Scene configs (`collections/data/scenes/*.json`) split systems into shared
  `systems`, `clientSystems`, and `serverSystems` — simulation code must live in the
  shared list and be free of DOM/rendering dependencies.
- Run tests with `npx vitest` from the repo root.

---

## Credits

Built with GUTS (Gamedev Ultimate Toolkit System).
3D animations from Mixamo; custom sprite artwork.

## License

MIT License — see the main GUTS repository for details.
