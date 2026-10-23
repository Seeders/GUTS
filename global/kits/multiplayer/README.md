# Multiplayer kit

A persistent multiplayer world: sessions, character saving, actors, server-checked movement, interest-managed snapshots and events (NetWorldSystem); the client mirror of it with clock sync, interpolation and corrected local movement (NetClientSystem); and MultiplayerHost, the Node server that runs it.

**Requires kits:** none (core only)

## Systems

| System | Services it provides |
|---|---|
| `NetClientSystem` | `netMyId`, `netActorView`, `netSend`, `netServerNow`, `netLocalPos` |
| `NetWorldSystem` | `netActor`, `netActors`, `netSpawnActor`, `netDespawnActor`, `netNearbyActors`, `netGroundY`, `netEmit`, `netSend`, `netToast`, `netMarkDirty`, `netSessionOf`, `netSessionByName`, `netSessions`, `netTeleport`, `netNow` |

## Setting it up

**The server.** `guts/engine/MultiplayerHost.js` runs the world; a game's `server.js` is one call:

```js
import { startMultiplayerServer } from 'guts/engine/MultiplayerHost.js';
startMultiplayerServer({
    root: __dirname, name: 'mygame', title: 'My Game', port: 3000, prefix: 'NET_',
    beforeWorld: (collections, ctx) => { /* put generated world data in place */ },
    routes: (app, ctx) => { /* the game's own HTTP endpoints */ }
});
```

It loads the compiled server bundle, boots one persistent room on a fixed-step loop (20 Hz),
routes every connected client into it (`ENTER_WORLD` arrives as `${prefix}ENTER`), serves the
project's files and the editor, stores JSON under `saves/` (`global.netStorage.load(kind, key)` /
`save(kind, key, data)`), and saves everyone at shutdown (`onServerShutdown`).

**The systems.** List `NetWorldSystem` in server.json's systems and `NetClientSystem` in
game.json's, or your subclasses of them (with the kit class still listed, before yours, so it is
compiled first). The scene runs your subclasses: the server one in `serverSystems`, the client
one in `clientSystems`. Settings go in `collections/settings/configs/multiplayer.json`:
`{ "snapshotRate": 10, "viewRadius": 1900, "saveEvery": 60, "runSpeed": 190 }`.

## The protocol

| From | Message | Payload |
|---|---|---|
| client | `ENTER_WORLD` | `{ name, create }` and anything your `prepareCharacter` reads |
| client | `MOVE` | `{ x, z, f, seq }`, ~20 Hz while moving |
| client | `RESYNC`, `LOGOUT` | |
| server | `WELCOME` | `{ actorId, name, now, x, z, facing, resync? }` + `welcomeInfo` |
| server | `ENTER_FAILED` | `{ error }` |
| server | `SNAPSHOT` | `{ now, add: [staticInfo], dyn: [dynRow], gone: [id] }` |
| server | `EVENTS` | `{ now, e: [event] }` (`{ t: 'gone', id }` for a despawn) |
| server | `CORRECT` | `{ x, z, facing, seq, teleport? }` |
| server | `TOAST` | `{ text, kind }` |

Every name but `ENTER_WORLD` carries the system's `static PREFIX` (default `NET_`).

## Making it yours

Extend both systems. On the server, `prepareCharacter` decides who may enter (and makes or
migrates the character), `spawnPlayer` places them, `actorFields` adds your fields to every
actor, `staticInfo` and `dynRow` say what each viewer is told, `afterSnapshot` sends your private
state, and `moveRefusal` / `moveSpeed` / `canStep` / `groundY` shape movement. On the client,
`createLocal` makes the entity that draws an actor, `applyRow` reads your dyn rows,
`needsRebuild` says when an actor must be drawn anew, `onEvent` plays your events, and
`walk(dt, fwd, strafe, speed)` + `sendMoves(dt)` move your own actor. Message, service and event
names can keep a game's own spelling: set `static PREFIX`, `static EVENTS`, and add aliases.

## What your game supplies

**Components.** This kit ships reference schemas for none. A project that lists its kits in game.json gets the schemas of the core and of those kits, except where it has its own file of the same name (yours wins). Its systems use these, which the core or this kit's required kits provide: `transform`.

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

none

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["multiplayer"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/NetClientSystem.js` (a project file with the same name as an engine file replaces it):

```js
import Base from '@global/scripts/systems/js/NetClientSystem.js';

class NetClientSystem extends Base {
    // override what you need
}
```
