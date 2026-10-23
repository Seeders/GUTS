# RPG kit

Action-RPG combat and creatures for a persistent world: targets and swings, hands (weapons, shields, spells in either hand), spells with costs, cooldowns, cast times and data-driven effects, auras (buffs, debuffs, damage and healing over time, absorbs), stamina and magicka, arrows and other shots, threat, tapping, death and release (RpgCombatSystem); creature camps that spawn near players at a locked level, wild and road encounters, creature brains (idle, combat, evading, dead), loot and respawns (RpgMobSystem); skills that rise with use and the level-up choice (RpgSkillSystem); ascensions and talent trees (RpgTalentSystem); parties and chat channels over the network (RpgPartySystem).

**Requires kits:** [world](../world/README.md) (walking, line of sight, paths),
[social](../social/README.md) (RpgPartySystem is built on its PartySystem and ChatSystem), and a world server
such as the [multiplayer](../multiplayer/README.md) kit's NetWorldSystem with the `mmo*` names.

## Systems

| System | Services it provides |
|---|---|
| `RpgCombatSystem` | `mmoCastSpell`, `mmoDealDamage`, `mmoHeal`, `mmoApplyAura`, `mmoAddThreat`, `mmoIsEnemy`, `mmoDistance`, `mmoKill`, `mmoResurrect` |
| `RpgMobSystem` | `mmoCreditedPlayers`, `mmoAwareOf`, `mmoNoise` |
| `RpgSkillSystem` | `mmoSkillUse` |
| `RpgTalentSystem` | `mmoApplyTalents` |
| `RpgPartySystem` | the social kit's PartySystem services, and `socialName`, `socialPlayers`, `socialNearby`, `socialFindPlayer` |

All run on the server. They register as `game.mmoCombatSystem`, `game.mmoMobSystem`,
`game.mmoSkillSystem`, `game.mmoTalentSystem` and `game.mmoPartySystem`.

## Setting it up

Extend each and list the kit class before yours in server.json:

```js
class MmoCombatSystem extends GUTS.RpgCombatSystem {}
class MmoMobSystem extends GUTS.RpgMobSystem {}
class MmoSkillSystem extends GUTS.RpgSkillSystem {}
class MmoTalentSystem extends GUTS.RpgTalentSystem {}
class MmoPartySystem extends GUTS.RpgPartySystem {}
```

List the social kit's `PartySystem` and `ChatSystem` before `RpgPartySystem`.

Every actor, player or creature, fights through the same rules; creatures act through the same
entry points players use (`mmoCastSpell`, auto-attack, hands). Override what your game does
differently. The ones games override most: `onHand`, `melee`, `bash`, `loose` (how a hand
swings, blocks and shoots), `mmoDealDamage`, `applyEffects`, `mmoApplyAura`, `updateAuras`,
`resolveSpell`, `pay`, `playerCast`, `useItem`, `mmoIsEnemy`; on creatures `updateIdle`,
`updateCombat`, `pickTarget`, `updateEncounters`, `ezLevel`, `onMmoKill`, `openLoot`, `takeLoot`;
`mmoSkillUse`, `onMmoLevelUp`, `mmoApplyTalents`, `partyView`, `invite`.

## The protocol

Client to server: `MMO_TARGET { id }`, `MMO_ATTACK { on }`, `MMO_HAND { hand, down, f, target }`,
`MMO_EQUIP_HAND { hand, spell }`, `MMO_CAST { spell, target, f }`, `MMO_STOP_CAST`,
`MMO_CANCEL_AURA { aura }`, `MMO_USE_ITEM { item }`, `MMO_RELEASE`, `MMO_LOOT_OPEN { id }`,
`MMO_LOOT_TAKE { id, index }`, `MMO_LEVEL_CHOICE`, `MMO_ASCEND { ascension }`,
`MMO_TALENT_LEARN { talent }`, `MMO_TALENT_RESET`, `MMO_PARTY_INVITE`, `MMO_PARTY_RESPOND`,
`MMO_PARTY_LEAVE`, `MMO_PARTY_KICK`, `MMO_CHAT { channel, text }`. Server to client also
`MMO_SKILL_UP`, `MMO_ASCENDED`, `MMO_LEARNED`. Combat is seen as world events (`swing`, `dmg`, `arrow`,
`shotEnd`, `cast`, `castEnd`, `spell`, `auras`, `die`, `evade`, `xp`, `lvl`...) through the world
server's `mmoEmit`.

## The data

- `collections.spells[id]`: `costType`, `cooldown`, `gcd`, `castTime`, `channel`, `range`,
  `target`, `aoe`, `hand`, `requires`, `combo`/`finisher`, `effects` (damage, heal, aura, threat,
  taunt, interrupt, resource, blink, cleanse), `anim`, `fx`.
- `collections.mobs[id]`: level, stats, spells, hostility, loot (read through `mmoMob` and
  `mmoMobStats`).
- Zones' `mobCamps`: `packs` of members (spots, `pose`, `facing`, `post`, `patrol`), `ez`
  (encounter level range), `fixed`, `kind` (`lair`, `wild`, `road`), `table`, `roster`,
  `chance`, `roam`, `route`, `wake`, `reset`, `quiet`, `site`, `when`, `friendlyWhen`, `sight`.
- Ascensions and talent trees (through `mmoAscension` and `mmoTalentTree`): talents' `effects`
  (`stats`, `gear`, `spell`, `grant`); `collections.races[id].racial`.

## What your game supplies

**Services.** A world server and rules system provide these:

`mmoActor`, `mmoActors`, `mmoNearbyActors`, `mmoSpawnActor`, `mmoDespawnActor`, `mmoTeleport`,
`mmoGroundY`, `mmoCanStep`, `mmoFindPath`, `mmoShotBlocked`, `mmoZones`, `mmoContentZones`,
`mmoStartZone`, `mmoSend`, `mmoToast`, `mmoEmit`, `mmoMarkDirty`, `mmoNow`, `mmoConfig`,
`mmoClass`, `mmoSpell`, `mmoMob`, `mmoMobStats`, `mmoItem`, `mmoGiveItem`, `mmoTakeItem`,
`mmoCountItem`, `mmoAddMoney`, `mmoRandomGear`, `mmoSpellCost`, `mmoSpellRange`,
`mmoEffectValue`, `mmoSkill`, `mmoSkillMult`, `mmoSkillUse`, `mmoWeaponSkill`, `mmoSpellSkill`,
`mmoArmorSkill`, `mmoWeaponType`, `mmoTrait`, `mmoSkillDefs`, `mmoSkillNeed`, `mmoStartingSkills`,
`mmoAwardXp`, `mmoRecalcStats`, `mmoTalentTree`, `mmoTalentPoints`, `mmoAscension`, `mmoNpc`,
`mmoSessions`, `mmoSessionByName`; world conditions: `kdTest`, `kdTouch`, `kdWorld`.

**Optional systems.** It uses these when present: `game.mmoPartySystem`, `mmoQuestSystem`,
`mmoProfessionSystem`.
