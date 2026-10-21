# Getting started

This walks through a new GUTS project: what `guts new` makes, then adding a component, a
system, and a service. It takes about ten minutes. Concepts are explained properly in
[concepts.md](concepts.md); this page only shows the moves.

## 1. Make a project

```bash
npx github:Seeders/GUTS new my-game
cd my-game
npm install
npm run dev
```

Open http://localhost:3000/. You should see a spinning cube. `npm run dev` rebuilds when a
file changes and reloads the page.

## 2. What's in it

```
my-game/
├── collections/
│   ├── settings/configs/game.json      the game: libraries, systems, kits, initial scene
│   ├── data/
│   │   ├── components/                 component schemas: cube.json, spin.json, transform.json
│   │   └── scenes/main.json            the scene: which systems run, which interface shows
│   ├── scripts/systems/js/             SpinSystem.js (rotates things), ViewSystem.js (draws them)
│   └── ui/interfaces/                  main.html + main.css: the page around the canvas
├── index.html
└── server.js                           serves dist/ (and later, your multiplayer server)
```

Everything under `collections/` is a *collection*: a folder of JSON data, scripts, or both.
The build reads them all and bundles them into `dist/`.

`SpinSystem` creates the cube when the scene loads and turns it every tick:

```js
class SpinSystem extends GUTS.BaseSystem {
    onSceneLoad() {
        const cube = this.game.createEntity();
        this.game.addComponents(cube, {
            transform: {},
            spin: { speed: 1.5 },
            cube: { size: 2 }
        });
    }

    update() {
        const dt = this.game.state.deltaTime;
        for (const id of this.game.getEntitiesWith('transform', 'spin')) {
            const rotation = this.game.getComponent(id, 'transform').rotation;
            rotation.y += this.game.getComponent(id, 'spin').speed * dt;
        }
    }
}
```

`ViewSystem` owns Three.js: it makes a mesh for every entity with `transform` + `cube` and
copies the transform onto it each frame. Gameplay systems never touch Three.js.

## 3. Add a component

Make the cube bob up and down. Create `collections/data/components/bob.json`:

```json
{
    "title": "Bob",
    "schema": {
        "height": 0.5,
        "speed": 2,
        "phase": 0
    }
}
```

The `schema` holds the fields and their defaults. Because every field is a number, GUTS stores
`bob` in typed arrays, one array per field, which is fast to iterate.

## 4. Add a system

Create `collections/scripts/systems/js/BobSystem.js`:

```js
class BobSystem extends GUTS.BaseSystem {
    update() {
        const dt = this.game.state.deltaTime;
        for (const id of this.game.getEntitiesWith('transform', 'bob')) {
            const bob = this.game.getComponent(id, 'bob');
            bob.phase += bob.speed * dt;
            this.game.getComponent(id, 'transform').position.y = Math.sin(bob.phase) * bob.height;
        }
    }
}
```

No import or export is needed: the build exposes every system as `GUTS.<Name>`.

Register it in two places:

- `collections/settings/configs/game.json`, `systems`: the systems compiled into the game.
  Add `"BobSystem"`.
- `collections/data/scenes/main.json`, `systems`: the systems that run in this scene, in
  this order. Add `"BobSystem"` before `"ViewSystem"` so the view draws the moved cube.

Finally, give the cube the component. In `SpinSystem.onSceneLoad`, add `bob: {}` to the
components (empty means "use the schema defaults"). Save, and the cube bobs.

## 5. Add a service

Systems talk to each other through *services*: named functions one system provides and
others call. Let something else change the bob height. In `BobSystem`:

```js
class BobSystem extends GUTS.BaseSystem {
    static services = ['setBobHeight'];

    setBobHeight(entityId, height) {
        const bob = this.game.getComponent(entityId, 'bob');
        if (bob) bob.height = height;
    }
    // ...update() as before
}
```

Any other system declares the services it uses and calls them through `this.call`:

```js
class SpinSystem extends GUTS.BaseSystem {
    static serviceDependencies = ['setBobHeight'];

    onSceneLoad() {
        const cube = this.game.createEntity();
        this.game.addComponents(cube, { transform: {}, spin: { speed: 1.5 }, cube: { size: 2 }, bob: {} });
        this.call.setBobHeight(cube, 1.2);
    }
    // ...
}
```

If nothing provides a service, the call does nothing and logs one warning naming the
caller, so systems can be added and removed independently.

## 6. Use engine systems and kits

The engine ships systems you can list next to your own. The core (rendering, world and
terrain, cameras, audio, particles, animation, scheduling) is always available; the rest
comes in kits:

| Kit | For |
|---|---|
| `ai` | behavior trees |
| `units` | units on a grid: spatial queries, pathfinding, steering, vision |
| `combat` | damage, projectiles, death, health bars |
| `rts` | orders, building placement, fog of war, minimap, lockstep networking |
| `cards` | card games |

To use one, add it to `kits` in game.json and list the systems you want:

```json
{
    "kits": ["units"],
    "systems": ["BaseSystem", "GridSystem", "PathfindingSystem", "SpinSystem", "BobSystem", "ViewSystem"]
}
```

Listing a kit also brings its component schemas (`collision`, `pathfinding`, ...) into your
game; a file of your own with the same name wins. Each kit's README (in
`node_modules/guts/global/kits/<kit>/`) lists its systems, the services they offer, and
what your game has to provide.

To change an engine system, subclass it in your project:

```js
import Base from '@global/scripts/systems/js/BaseMovementSystem.js';

class MovementSystem extends Base {
    // override what you need
}
```

A project file with the same name as an engine file replaces the engine's.

## Next

- [concepts.md](concepts.md): entities, component storage, systems and their hooks,
  services, scenes, collections, game.json, build targets, multiplayer and determinism.
- [editor.md](editor.md): the visual editor.
- [../global/README.md](../global/README.md): the engine's core and kits.
