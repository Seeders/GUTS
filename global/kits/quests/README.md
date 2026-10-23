# Quests kit

Quests and the people who give them: quest offers, objectives (kill, collect, talk), turning in, experience and levelling (QuestSystem); clickable world objects, item nodes, doors, locks and escorts with ambushes (ObjectiveSystem); NPCs with daily routines, dialog topics, vendors, trainers, inns and pockets to pick (NpcSystem); story quests in stages with branches, shared by the whole world or kept per player, triggers, overheard barks and books (StorySystem), and their journal and compass on the client (StoryClientSystem); the world's saved memory with conditions and actions (QuestWorldStateSystem).

**Requires kits:** [world](../world/README.md) (zones, NPC walking), [social](../social/README.md)
(QuestWorldStateSystem is built on its WorldStateSystem), and a world server such as the
[multiplayer](../multiplayer/README.md) kit's NetWorldSystem with the `mmo*` names.

## Systems

| System | Services it provides |
|---|---|
| `QuestSystem` | `mmoAwardXp`, `mmoQuestsForNpc` |
| `ObjectiveSystem` | none |
| `NpcSystem` | none |
| `StorySystem` | `storyState`, `storyStart`, `storySetStage`, `storyEnd`, `storyDone`, `storyEvent` |
| `StoryClientSystem` | none (client) |
| `QuestWorldStateSystem` | the social kit's WorldStateSystem services, and `kdFlag`, `kdSetFlag`, `kdWorld`, `kdCtx`, `kdTest`, `kdRun`, `kdWorldChanged`, `kdNpcSay`, `kdTouch` |

They run on the server (ObjectiveSystem is also listed on the client, where it does nothing),
StoryClientSystem on the client. They register themselves as `game.mmoQuestSystem`,
`game.mmoObjectiveSystem`, `game.mmoNpcSystem`, `game.mmoStorySystem`,
`game.mmoStoryClientSystem` and `game.mmoWorldStateSystem`, the names other systems look for.

## Setting it up

Extend each and list the kit class before yours (server.json, and game.json for ObjectiveSystem):

```js
class MmoQuestSystem extends GUTS.QuestSystem {}
class MmoObjectiveSystem extends GUTS.ObjectiveSystem {
    interact(actor, id) { /* your own nodes, then */ return super.interact(actor, id); }
}
class MmoNpcSystem extends GUTS.NpcSystem {}
class MmoStorySystem extends GUTS.StorySystem {}
class MmoStoryClientSystem extends GUTS.StoryClientSystem {}   // game.json
class MmoWorldStateSystem extends GUTS.QuestWorldStateSystem {}
```

List the social kit's `WorldStateSystem` before `QuestWorldStateSystem`.

Override what your game does differently: `QuestSystem.onMmoKill` (who gets kill credit),
`mmoAwardXp`; `ObjectiveSystem.interact` (what a node does); `NpcSystem.sendDialog`, `buy`, `sell`,
`hearth`, `trainerList`, `train`; `StorySystem.onKdCampCleared`; `StoryClientSystem.markers`, `update`.

## The protocol

Client to server: `MMO_INTERACT { id }`, `MMO_TALK { id, topic }`, `MMO_QUEST_ACCEPT { quest, npc }`,
`MMO_QUEST_TURNIN { quest, npc, choice }`, `MMO_QUEST_ABANDON { quest }`, `MMO_BUY { npc, item,
count }`, `MMO_SELL { npc, index }`, `MMO_TRAIN { npc, spell }`, `MMO_BIND { npc }`, `MMO_HEARTH`,
`MMO_PICKPOCKET { id, item }`, `MMO_READ { item | node }`. Server to client: `MMO_DIALOG` (title, greeting, roles, quests,
talk topics, vendor, trainer, inn), `MMO_DIALOG_CLOSE`, `MMO_QUEST_UPDATE`, `MMO_LEVEL_UP`,
`MMO_LEARNED`, `MMO_LOOT_MSG`, `MMO_STORY` (a story quest's state), `MMO_WORLD` (the world's flags and
quest stages), `MMO_BOOK`.

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
- Story quests: a quest with `stages` (`objectives`: goto, kill, retrieve, talk, use, choice, cond;
  `next`, `onEnter`, `end`, rewards), `scope: 'player'` for per-character ones. Zones' `triggers`,
  NPCs' `barks`, items' and nodes' `read`. The full forms are at the top of StorySystem.js.
- World actions (`{set}`, `{inc}`, `{start}`, `{stage}`, `{done}`, `{give}`, `{say}`, `{teleport}`,
  `{noise}`...) and conditions: see QuestWorldStateSystem.js.

## What your game supplies

**Services.** These systems call these services; a world server and rules system provide them:

`mmoActor`, `mmoActors`, `mmoSpawnActor`, `mmoDespawnActor`, `mmoTeleport`, `mmoCanStep`,
`mmoSend`, `mmoToast`, `mmoEmit`, `mmoMarkDirty`, `mmoNow`, `mmoConfig`, `mmoQuest`, `mmoNpc`,
`mmoItem`, `mmoSpell`, `mmoGiveItem`, `mmoTakeItem`, `mmoCountItem`, `mmoAddMoney`,
`mmoRecalcStats`, `mmoXpToLevel`, `mmoMobXp`, `mmoCreditedPlayers`, `mmoAddThreat`,
`mmoContentZones`, `mmoStartZone`, `mmoSkill`, `mmoSkillDefs`, `mmoSkillUse`, `mmoTrainable`,
`mmoSpellNeeds`, `mmoSessions`, `mmoSessionByName`, `mmoZones`, `mmoInteriors`, `mmoRadiantJobs`,
`mmoRandomGear`, `mmoMob`, `mmoFormatMoney` (client). QuestWorldStateSystem provides the `kd*`
conditions and actions the others use.

**Optional systems.** It uses these when present: `game.mmoCombatSystem`, `mmoMobSystem`,
`mmoStorySystem`, `mmoWorldStateSystem`, `mmoFlightSystem`, `mmoProfessionSystem`.
