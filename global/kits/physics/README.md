# Physics kit

Rigid-body physics on Rapier: bodies, colliders, joints and character controllers as components, collision and trigger events, raycasts and shape queries, terrain collision, explosions, and client-only ragdolls, debris and thrown objects.

**Requires kits:** none (core only)

## Systems

| System | Services it provides |
|---|---|
| `DebrisSystem` | `spawnDebris`, `simulateObject`, `registerDebrisType`, `clearDebris` |
| `PhysicsSystem` | `getPhysicsWorld`, `getPhysicsBody`, `rebuildPhysicsBody`, `applyImpulse`, `applyForce`, `applyTorqueImpulse`, `setLinearVelocity`, `getLinearVelocity`, `teleportBody`, `radialImpulse`, `raycast`, `shapeCast`, `overlapSphere`, `isGrounded`, `addStaticCollider`, `removeStaticColliders`, `setGravity`, `togglePhysicsDebug` |
| `RagdollSystem` | `spawnRagdoll`, `clearRagdolls` |

## Setting it up

1. Add Rapier to the project: `npm install @dimforge/rapier3d-compat`.
2. List `"Rapier"` in the `libraries` of each config that runs physics (game.json, and server.json
   or headless.json if the simulation runs there).
3. List the systems: `PhysicsSystem` wherever bodies should move (for gameplay physics on a
   server-authoritative game, the server; for lockstep, every peer), and `RagdollSystem` and
   `DebrisSystem` on clients for effects.
4. Optional settings in `collections/settings/configs/physics.json`:
   `{ "gravity": -314, "terrain": true, "terrainStep": 0, "maxStep": 0.0167, "maxRagdolls": 14, "maxDebris": 200 }`.

## Bodies

An entity with `transform` and `collider` gets a body; `rigidBody.type` makes it `dynamic`
(simulated: it owns its `transform` and `velocity`), `fixed` (the default without a rigidBody),
`kinematicPosition` (follows its `transform`) or `kinematicVelocity` (moves by its `velocity`).
`transform.rotation` is Euler angles applied yaw, then pitch, then roll (`'YXZ'`); the renderer
draws all three.

```js
const crate = game.createEntity();
game.addComponents(crate, {
    transform: { position: { x: 0, y: 200, z: 0 } },
    velocity: {},
    rigidBody: { type: this.enums.bodyType.dynamic },
    collider: { shape: this.enums.colliderShape.box, halfExtents: { x: 16, y: 16, z: 16 }, events: true }
});
```

A `characterController` on a `kinematicPosition` body walks by its `velocity` (vx, vz), falls under
gravity (vy; set it positive to jump), climbs steps and slopes, and reports `grounded`. A `joint`
component links `bodyA` and `bodyB` (entity ids): `fixed`, `spherical`, `revolute` (a hinge on
`axis`, optional `limits`/`min`/`max` and motor) or `prismatic` (a slider).

Events, as `game.triggerEvent` calls any system can have: `onCollisionStart` / `onCollisionEnd`
`({ a, b })` for colliders with `"events": true`, and `onTriggerEnter` / `onTriggerExit`
`({ sensor, other })` for `"sensor": true` colliders. Ids are `null` for colliders that aren't
entities (terrain, static geometry).

## Effects

`spawnRagdoll(model, { velocity, spin, rig, life })` turns a posed, skinned model into a ragdoll
(Mixamo bone names by default; other rigs go in `collections.ragdollRigs`). `spawnDebris(position,
type)` bursts pieces (types from `registerDebrisType` or `collections.debrisTypes`), and
`simulateObject(object, { velocity, ... })` hands any Object3D to the physics for a while. They use
`Math.random` and never touch components: never use them for anything the game's rules depend on.

The world steps once per game tick (fixed step), so the same inputs give the same result.

## What your game supplies

**Components.** This kit ships reference schemas for `characterController`, `collider`, `joint`, `rigidBody`. A project that lists its kits in game.json gets the schemas of the core and of those kits, except where it has its own file of the same name (yours wins). Its systems use these, which the core or this kit's required kits provide: `transform`, `velocity`.

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

none

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["physics"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/DebrisSystem.js` (a project file with the same name as an engine file replaces it):

```js
import Base from '@global/scripts/systems/js/DebrisSystem.js';

class DebrisSystem extends Base {
    // override what you need
}
```
