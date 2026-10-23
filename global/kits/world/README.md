# World kit

A big world of square chunks of tiles, the same on the server and every client: loading the continent, ground and walk height, water and swimming, what blocks a walker or an arrow (buildings, trees, interiors' rock), bridges, zones and subzones, and paths over it all (ContinentSystem); streaming the chunks in and out around the player and drawing their ground, water and props (ChunkStreamSystem).

**Requires kits:** none (core only)

## Systems

| System | Services it provides |
|---|---|
| `ContinentSystem` | `mmoShotBlocked`, `mmoZone`, `mmoZones`, `mmoZoneAt`, `mmoBlocked`, `mmoBuildingAt`, `mmoWalkHeight`, `mmoCanStep`, `mmoFindPath`, `mmoStartZone`, `mmoContinent`, `mmoLoadWorld`, `mmoSubzoneAt`, `mmoWorldStaticsChanged`, `mmoInteriorAt`, `mmoInteriors`, `mmoContentZones` |
| `ChunkStreamSystem` | none |

## Setting it up

**The rules system.** `ContinentSystem` runs on the server and on every client, so both sides
walk, collide and path with the same numbers. A game extends it with its rules system and lists
the kit class before its own in both server.json and game.json (so it is compiled first):

```js
class MmoGameSystem extends GUTS.ContinentSystem {
    static services = [...GUTS.ContinentSystem.services, 'mmoConfig' /* , ... */];
    constructor(game) {
        super(game);
        this.config = { startZone: 'ashford', treeRadius: 14 /* , ... */ };
    }
}
```

It sets `game.continentSystem`. Its static constants (`CLIMB`, `DROP`, `STEEP`, `BODY`,
`SHOT_CELL`, `SWIM_DEPTH`) and helpers (`maskAt`, `bits`, `reliefAt`) are inherited, so
`GUTS.MmoGameSystem.maskAt` keeps working.

**The chunk streamer.** `ChunkStreamSystem` is client only. Extend it and say where the player is;
list it in game.json before your subclass:

```js
class MmoWorldChunkSystem extends GUTS.ChunkStreamSystem {
    playerPos() { return this.game.mmoClientSystem?.pos || null; }
}
```

## The data

- `collections.continent` (`resources/world/continent.json`): `size` (tiles a side), `chunk`
  (tiles a chunk side), `grid` (units a tile), `res` (height samples a tile), `minX`, `minZ`,
  `seaLevel`, `zones` (ids in zoneMap order), `chunks` (`[{ id, cx, cz, x, z }]`), `subzones`,
  `version`.
- Each chunk's level (`resources/world/chunks/<id>.json`, held as `collections.levels.chunk_<id>`):
  a `tileMap` with `terrainTypes`, `terrainMap`, `heightMap`, `heightField { res, data }`,
  `zoneMap`, `subMap`, and `levelEntities` (props, chunk-local). Adding a chunk to the world grid
  strips its tile data (`added`); `terrain()` streams stripped chunks again.
- `collections.zones[id]`: `buildings` (resolved through `collections.buildings[type].collision`),
  `decor`, `bridges`, `palette`, `race`.
- `collections.interiors[id]`: rock grids in the world (`origin`, `cell`, `w`, `h`, `grid`, `y`).
- `collections.worldObjects[type]`: `impassable`, `blockRadius` for props that block.

**Loading.** On a client `mmoLoadWorld(onProgress)` fetches the continent, then chunks stream in
by distance. On the server, put the same in `collections` before the world room starts: with the
multiplayer kit that's `startMultiplayerServer({ beforeWorld })`.

## Overriding

What a game does differently it overrides whole: `kdOn(cond)` (conditions on buildings and decor;
always true by default), `mmoCanStep`, `mmoWalkHeight`, `bridgeAt`, `interiorOpen`,
`interiorFloor`, `blockers`, `mmoBlocked`, `mmoAddChunk`, `mmoStartZone`, `mmoShotBlocked`; on the
client `buildGround`, `buildLiquids`, `waterMaterial`, `spawnProps`, `postSceneLoad`. After the
world changes (a building comes or goes) call `mmoWorldStaticsChanged()`.

## What your game supplies

**Config.** `this.config.startZone` (where a new character without a race zone starts) and
`this.config.treeRadius` (a tree trunk's collision radius).

**Services.** None required. The client streamer uses `createEntityFromPrefab` (core) for props.
