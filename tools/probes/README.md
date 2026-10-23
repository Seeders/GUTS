# Probes

Checks that a change to a multiplayer kit game (or to a kit it uses) didn't change what the game
does. Take a result before the change, make the change, take one after and compare. Run them from
the game's folder after `npm run build`:

```
node node_modules/guts/tools/probes/probe.mjs world  --out before/world.json
# ...change, build...
node node_modules/guts/tools/probes/probe.mjs world  --base before/world.json
```

Options: `--out <file>` (default: a temp folder), `--base <file>` (compare; exit code 1 on a
difference), `--port <n>` (3940; give parallel runs their own), `--seed <n>` (WORLD_SEED, 777),
`--build` (`npm run build` first). Each run starts `server.js` on fresh saves in a temp folder.
The server's log is next to the result (`<out>.log`).

| Probe | What it does | Same each run? |
|---|---|---|
| `world` | Asks the rules system (`game.mmoGameSystem`) a grid of questions: walk height, blocked, in the world, water, swim, zone, subzone, interior, steps, line of sight, paths; inside interiors too. Hashes the answers per kind. `PROBE_N` (120) sets the grid, `PROBE_SWIM=0` steps without swimming. | yes |
| `fight` | Seeds `Math.random`, runs the clock off the tick count and steps the server's ticks itself. A character enters, goes to the creature camps in turn and fights the nearest creature with real attack messages. Logs every world event (hits, misses, auras, deaths, xp) with its tick. `FIGHTS` (4) sets how many. | yes |
| `quests` | A character connects over a socket and visits every NPC it can see: dialog (quests, topics, vendor, trainer, inn), accepts what's offered, turns in, buys and sells. The server's random is seeded and its clock starts at a fixed moment but runs at real speed. | mostly: things timed to the millisecond can differ |

## Your game's character

The probes enter as a new barbarian (`{ name, create: true, profile: true, classId: 'barbarian' }`).
If your game enters differently, say so in package.json; `null` drops a default field:

```json
"gutsProbe": {
    "fight": { "create": null, "classId": null, "newRun": true, "hero": "warrior" },
    "quests": { "classId": "warrior" }
}
```

`fight` sends this as `MMO_ENTER` through the server's event bus, `quests` as `ENTER_WORLD` over
the socket.

## What it needs from the game

- The world server from the [multiplayer kit](../../global/kits/multiplayer/README.md), started
  with `startMultiplayerServer` (it calls the probe once the world is up). On GUTS before 1.12,
  the game's `onReady` calls `global.__profileHook?.(ctx.game)` instead.
- `world`: a [world kit](../../global/kits/world/README.md) rules system as `game.mmoGameSystem`.
- `fight`: the [rpg kit](../../global/kits/rpg/README.md)'s `game.mmoMobSystem` and the world
  server's `mmoWorldSystem`.
- `quests`: `socket.io-client` in the game's dependencies, and the dev chat command `.tele x z`
  (REALM_DEV=1 is set).

## Notes

- A seed taken from the clock at a moment that differs between runs (a new run's seed when a
  hero enters, for one) makes `quests` differ; compare `fight` and `world` for those games.
- Generated item ids (`g_...`) are replaced by `g_ID` in `fight` and `quests`.
- A result only compares with one taken from the same content: data or another person's
  uncommitted edits in the working tree change it too.
