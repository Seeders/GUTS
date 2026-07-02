# Hero Arena

A **Mechabellum-style tactics autobattler** built with the GUTS engine.
Deployment is permanent, your army accumulates round over round, spending is
deterministic and legible, and the only randomness is one 1-of-3 card pick per
round. Tactics come from decisions you have to live with.

---

## Quick Start

```bash
npm run build -- HeroArena
node projects/HeroArena/server.js
# open http://localhost:3000/index.html → ENTER BATTLE → Skirmish → START BATTLE
```

Headless AI-vs-AI simulation (balance/testing):

```bash
node projects/HeroArena/headless.js --simulation random_match --seed 42
```

Browser E2E (server running, `npm i --no-save puppeteer`):

```bash
node projects/HeroArena/test_mechabellum.mjs
```

---

## The Round Loop

```
MATCH START   pick a Leader (match-long passive)
EACH ROUND    1. REINFORCE  pick 1 of 3 cards (units / gold / tech discount /
                            skill charge / tier unlock / free level)
              2. SPEND      buy squads and place them on your half,
                            buy unit techs, level up squads
              3. BATTLE     fully automatic — every squad attack-moves the
                            enemy base; cast banked commander skills
              4. RESOLVE    surviving enemy units deal their value as
                            commander damage
GAME OVER     a commander reaches 0 HP (1500 to start)
```

## The Rules That Matter

- **Deployment is permanent.** Once a unit has fought a battle it holds that
  position for the rest of the match, and can no longer be moved or sold.
  Your board is the accumulated record of every decision you've made.
- **Your army persists.** Everything you buy respawns every round at its
  position. Battles cost commander HP, not units.
- **Predefined abilities need investment.** Every unit's abilities start
  locked; buy the ability tech to activate them for all units of that type.
- **Techs are always visible.** Click the ⚙ on any fielded unit card to see
  its full technology list with prices — stat boosts, ability unlocks, and
  tier-2/tier-3 roster unlocks.
- **Grow wide or grow tall.** New squads vs. leveling existing squads
  (level also scales the commander damage a surviving squad deals).
- **Commander skills** (Meteor Strike, Frost Nova, Mending Wave) are
  single-use charges from reinforcement cards, cast at a clicked point
  mid-battle. Max 2 banked.

## Project Structure (key files)

| Path | What |
|------|------|
| `collections/scripts/systems/js/AutobattlerRoundSystem.js` | Round loop + commander HP scoring |
| `collections/scripts/systems/js/ArmyShopSystem.js` | Units, techs, level-ups, reinforcement cards |
| `collections/scripts/systems/js/CommanderSkillSystem.js` | Battle actives |
| `collections/scripts/systems/js/HeroRosterSystem.js` | Persistent army + deployment lock |
| `collections/data/unitTechs/` | Per-unit technologies (83 techs) |
| `collections/data/reinforcementCards/` | The 1-of-3 round picks |
| `collections/data/commanderSkills/` | Battle actives |
| `collections/terrain/levels/battleplain.json` | Default symmetric map |
| `MECHABELLUM_REDESIGN.md` | The redesign design doc |

Older systems (buildings, gold mines, fog of war, unit orders, the 5-offer
reroll shop) were removed from the loop in the redesign — see the design doc
for rationale.

## License

MIT License — see the main GUTS repository for details.
