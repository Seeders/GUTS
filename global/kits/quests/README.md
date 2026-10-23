# Quests kit

Quests and the people who give them: quest offers, objectives (kill, collect, talk), turning in, experience and levelling (QuestSystem); clickable world objects, item nodes, doors, locks and escorts with ambushes (ObjectiveSystem); NPCs with daily routines, dialog topics, vendors, trainers, inns and pockets to pick (NpcSystem).

**Requires kits:** [world](../world/README.md) (zones, NPC walking), and a world server such as the
[multiplayer](../multiplayer/README.md) kit's NetWorldSystem with the `mmo*` names.

## Systems

| System | Services it provides |
|---|---|
| `QuestSystem` | `mmoAwardXp`, `mmoQuestsForNpc` |
| `ObjectiveSystem` | none |
| `NpcSystem` | none |

All three run on the server (ObjectiveSystem is also listed on the client, where it does nothing).
They register themselves as `game.mmoQuestSystem`, `game.mmoObjectiveSystem` and
`game.mmoNpcSystem`, the names other systems look for.

## Setting it up

Extend each and list the kit class before yours (server.json, and game.json for ObjectiveSystem):

```js
class MmoQuestSystem extends GUTS.QuestSystem {}
class MmoObjectiveSystem extends GUTS.ObjectiveSystem {
    interact(actor, id) { /* your own nodes, then */ return super.interact(actor, id); }
}
class MmoNpcSystem extends GUTS.NpcSystem {}
```

Override what your game does differently: `QuestSystem.onMmoKill` (who gets kill credit),
`mmoAwardXp`; `ObjectiveSystem.interact` (what a node does); `NpcSystem.sendDialog`, `buy`, `sell`,
`hearth`, `trainerList`, `train`.

## The protocol

Client to server: `MMO_INTERACT { id }`, `MMO_TALK { id, topic }`, `MMO_QUEST_ACCEPT { quest, npc }`,
`MMO_QUEST_TURNIN { quest, npc, choice }`, `MMO_QUEST_ABANDON { quest }`, `MMO_BUY { npc, item,
count }`, `MMO_SELL { npc, index }`, `MMO_TRAIN { npc, spell }`, `MMO_BIND { npc }`, `MMO_HEARTH`,
`MMO_PICKPOCKET { id, item }`. Server to client: `MMO_DIALOG` (title, greeting, roles, quests,
talk topics, vendor, trainer, inn), `MMO_DIALOG_CLOSE`, `MMO_QUEST_UPDATE`, `MMO_LEVEL_UP`,
`MMO_LEARNED`, `MMO_LOOT_MSG`.

## The data

- `collections.quests[id]`: `giver`, `turnIn`, `minLevel`, `requires`, `classes`, `objectives`
  (`{ type: 'kill', mob, count }`, `{ type: 'collect', item, count }`, `{ type: 'talk', npc }`,
  `{ type: 'escort', npc, zone, path, ambush }`), `rewards` (`xp`, `gold`, `items`).
- `collections.npcs[id]`: `title`, `subtitle`, `greeting`, `unit`, `x`, `z`, `facing`, `roles`
  (`quest`, `vendor`, `trainer`, `inn`, `flight`, `professions`), `vendor` (item ids), `routine`
  (daily blocks), `places`, `when`, `pockets`.
- `collections.dialogues[npcId]`: `{ greeting, topics }`; a story quest's `topics: { <npcId>: [...] }`
  adds its own lines.
- Zones' `nodes` (item nodes, portals, locks) for ObjectiveSystem.

## What your game supplies

**Services.** These systems call these services; a world server and rules system provide them:

`mmoActor`, `mmoActors`, `mmoSpawnActor`, `mmoDespawnActor`, `mmoTeleport`, `mmoCanStep`,
`mmoSend`, `mmoToast`, `mmoEmit`, `mmoMarkDirty`, `mmoNow`, `mmoConfig`, `mmoQuest`, `mmoNpc`,
`mmoItem`, `mmoSpell`, `mmoGiveItem`, `mmoTakeItem`, `mmoCountItem`, `mmoAddMoney`,
`mmoRecalcStats`, `mmoXpToLevel`, `mmoMobXp`, `mmoCreditedPlayers`, `mmoAddThreat`,
`mmoContentZones`, `mmoStartZone`, `mmoSkill`, `mmoSkillDefs`, `mmoSkillUse`, `mmoTrainable`,
`mmoSpellNeeds`; world conditions and lines: `kdTest`, `kdRun`, `kdFlag`, `kdSetFlag`,
`kdNpcSay`.

**Optional systems.** It uses these when present: `game.mmoCombatSystem`, `mmoMobSystem`,
`mmoStorySystem`, `mmoWorldStateSystem`, `mmoFlightSystem`, `mmoProfessionSystem`.
