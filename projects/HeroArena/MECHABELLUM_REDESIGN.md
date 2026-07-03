# Hero Arena — Mechabellum-Style Redesign

The autobattler loop is being redesigned around **Mechabellum's** decision model:
permanent deployment, an accumulating army, legible per-unit technology, one
bounded random choice per round, and commander-HP scoring. Tactics come from
decisions you have to live with, not from re-solving the board every round.

## Design pillars

1. **Placement is permanent.** Once a unit has fought a battle, it holds that
   position for the rest of the match. Prep is about placing *new* purchases.
2. **The army accumulates.** Everything you buy respawns every round at its
   position (already true via the roster system). Battles never permanently
   kill your units — losses cost you commander HP, not your army.
3. **All spending is deterministic and legible.** Unit techs, squad level-ups,
   and unit unlocks have fixed, always-visible prices and full effect text.
   The only randomness is one 1-of-3 card pick per round.
4. **No unit orders.** Every squad auto-advances on the enemy at battle start
   (both sides). Your agency is *where you deployed*, *what you teched*, and
   a couple of single-use commander skills cast mid-battle.
5. **Scoring is attrition.** Each player has Commander HP. After each battle,
   every surviving enemy unit deals damage equal to its value. First commander
   to 0 loses.

## The round loop

```
MATCH START:  pick a Specialist (existing leader select, renamed)
EACH ROUND:
  1. REINFORCE   pick 1 of 3 cards (units / gold / tech discount / skill charge / unlock)
  2. SPEND       buy squads (place on your half — permanent once battle starts),
                 level up placed squads, buy unit techs, unlock higher-tier units
  3. BATTLE      fully automatic; commander skills castable (limited charges)
  4. RESOLVE     survivors deal their value as damage to the enemy commander
GAME OVER:    a commander reaches 0 HP (both → higher remaining HP wins; tie → sudden death)
```

## What's removed (v1)

| Removed | Why |
|---------|-----|
| Town Halls + destruction win | Replaced by commander HP |
| Attribute buildings + building select + milestone pick | Buildings were opaque upgrade vendors; techs live on units now |
| Building tech-tree overlay | Tech panel opens from the unit card instead |
| 5-offer reroll shop | Replaced by 1-of-3 reinforcement pick + deterministic spending |
| Unit orders / standing orders | All squads auto-attack-move; no micromanagement |
| Gold mines, dragons, starting sentries | Map objectives cut for a clean symmetric battlefield |
| Fog of war (in this mode) | Mechabellum shows you the enemy board — deployment is *reactive* |
| Level-3 specialization prompt | Tier-2 promotion becomes a purchasable unit tech |

Heroes remain as the unit catalog (T1 units and their T2 specs); the "hero"
framing goes away — they're squads you buy.

## Scoring (Mechabellum-style)

- Commander HP: **1000** each.
- At battle end, for each side: `damage taken = Σ value of surviving enemy units`
  (unit `value` from its def, scaled by squad level).
- A timeout (30s cap) means both sides likely have survivors — both take damage.
- Round income: base 20g + 1g/round escalation + win/loss streak bonuses
  (existing economy system) — no interest/banking in v1.

## Unit techs (phase 3)

Per unit **type**, purchased once, applies to all your squads of that type.
Data-driven in a new `unitTechs` collection. Each unit shows its full tech list
(with prices) any time you select it. Two kinds:

- **Stat techs** — flat visible effects reusing the existing upgrade
  `statModifiers` pipeline ("Heavy Plating: +20% HP", "Long Draw: +25% range").
- **Ability unlocks** — each unit's def keeps its predefined abilities, but they
  start **locked**; a tech unlocks them ("Whirlwind — 120g: Berserker gains
  Whirlwind"). This is the "invest into predefined abilities" rule.
- **Promotions** — tier-2 upgrade as a tech on the T1 unit ("Promote to
  Berserker — 200g: all Barbarians become Berserkers").

## Squad level-ups (phase 4)

Click one of your placed squads during prep → "Level Up" (cost escalates with
level). Reuses the existing per-level stat scaling. The counterpart to
buying new units: grow taller vs. grow wider.

## Reinforcement cards (phase 5)

Round start: pick **1 of 3** (server-rolled, seeded):
free unit squad / gold pile / tech discount / commander-skill charge /
unit unlock / squad level. Weighted by round number.

## Commander skills (phase 6)

Single-use targeted actives cast during battle at a clicked point (meteor,
frost nova, mass heal, shield) — charges come from reinforcement cards.
Reuses existing ability implementations; 2 charges max banked.

## New map (phase 2)

`level_battleplain`: flat, open, symmetric 48×48 field — two deployment halves,
sparse rock cover, no water/forest chokes, no objectives. The board reads like a
chessboard; deployment is the message.

## Build order

- **Phase 2 (core):** commander HP scoring + battleplain map + permanent
  placement + auto-advance both armies + strip buildings/mines/fog/orders/spec
  prompts + full enemy visibility in prep
- **Phase 3:** unit techs + tech panel (replaces shop offers)
- **Phase 4:** squad level-ups
- **Phase 5:** reinforcement 1-of-3 (replaces reroll shop UI)
- **Phase 6:** commander skills
- **Phase 7:** AI + balance + E2E/headless verification
