# The GUTS editor

The editor is a browser app for a project's collections. It reads the JSON files under
`collections/`, gives you forms, graphs and 3D tools for them, and writes them back to disk.
Anything it does you could also do by editing the files by hand; the editor just makes units,
items, levels, scenes, effects and configs quicker to change and easier to see.

On top of the plain data editing, **editor modules** add purpose-built tools for particular
kinds of data: a terrain editor for levels, a graphics editor for models, a behavior tree
editor, a particle editor, and so on. A project picks the modules it wants and can write its
own.

## Running it

**From a clone of the GUTS repository**, the editor works on any project cloned into its
`projects/` folder:

```bash
git clone https://github.com/Seeders/GUTS.git
cd GUTS
npm install
cd projects && git clone <your-project-repo> && cd ..
npm run build:editor -- <ProjectName>     # editor bundle for that project
npm run start:editor                      # http://localhost:8080/index.html
```

**From a standalone project**, mount the editor in the project's own `server.js`:

```js
const { mountEditor } = require('guts/editor-api');
mountEditor(app, { base: '', projectRoot: __dirname });
```

```bash
npx guts build --target editor            # builds dist/editor
GUTS_EDITOR_PASSWORD=secret node server.js
# http://localhost:3000/editor/   (user admin, or set GUTS_EDITOR_USER)
```

`MultiplayerHost` mounts it for you; pass `editor: false` to leave it out.

**Security.** The editor server can read, write and delete files in the project. Set
`GUTS_EDITOR_PASSWORD` to require a login (HTTP Basic, then a 12-hour session cookie).
`mountEditor` won't mount without one, and in production mode (`--prod`) the editor endpoints
are refused unless it is set. The development server in the GUTS repo stays open without a
password and warns at startup. Never expose an editor server without one.

## Editing collections

Everything in a project is a collection (see [Concepts](concepts.md#projects-and-collections)),
and the editor is organised around them.

### Assets

The **Assets** panel at the bottom browses the project in three columns: **category**, then
**collection**, then **items**. Items show as a grid of icons or a list, and can be searched.

| Action | What it does |
|---|---|
| **+ New** | Create an item in the open collection (asks for an id and a name) |
| **Duplicate** | Copy the selected item under a new id |
| **Delete** | Remove the selected item's file |
| **+ Collection** | Add a new collection to a category |

Each item is one file, `collections/<category>/<collection>/<id>.json` (or under the
collection's `data/` folder). Drag an item into the Scene view to place it in the open level.

Categories and collections are described by the project's own settings:
`collections/settings/objectTypeCategories/` names the categories, and
`collections/settings/objectTypeDefinitions/` describes each collection:

```json
{
  "id": "units",
  "name": "Units",
  "singular": "unit",
  "objectTypeCategory": "spawns"
}
```

### Inspector

Selecting an item opens it in the **Inspector** on the right. Every field gets a widget that
fits its value:

| Value | Widget |
|---|---|
| boolean | checkbox |
| number | number field |
| a key ending in `color`, or a `#rrggbb` string | color picker |
| a key that names another collection (`unit`, `requiresBuildings`, ...) | dropdown of that collection's ids, or a list of them |
| object or array | JSON editor |
| `script`, `html`, `css` | code (opens in the Script Editor) |
| long or multi-line string | text area |
| anything else | text field |

A field that names a collection is matched the way the runtime matches it: the exact
collection name, then its singular, then the longest collection name the key ends with (so
`requiresBuildings` holds ids from `buildings`). **+ Field** adds a field, the **×** beside a
field removes it, and **Save** (or Ctrl+S) writes the file.

Below the fields, the inspector offers the tools that fit the item, each opening in its own
tab in the center:

| Button | Shown for |
|---|---|
| **Script Editor** | items with `script`, `html`, `css` or `testScript` (Monaco, with a live preview for HTML and CSS) |
| **Graphics Editor** | items with a `render` block |
| **Texture Editor** | items with an `imagePath` |
| **Behavior Graph** | behavior trees and their actions and decorators: the tree as a wired node graph, with validation and auto-layout |
| **Systems Graph** | scenes: each system as a node listing the services it provides, with an edge to every system that calls them. Good for finding a missing service. |
| a module's title | items in a collection that module lists in `inspectorTypes` (see below) |

The **Preview** panel under the inspector shows the selected item's sprite animation or 3D
model.

### Scene view and hierarchy

The **Scene** tab shows a level in a live 3D view. Choose the level from the toolbar. Placed
entities are listed in the **Hierarchy** on the left; select one to move, rotate or scale it
with the gizmos (or edit its transform in the inspector), and drag items in from Assets to add
more. **Terrain** opens the terrain tools: paint tiles with a brush or fill, raise and lower
height, place ramps and team areas. Saving writes the level's `tileMap`, including its placed
entities (`tileMap.levelEntities`).

The Scene view runs the editor's own ECS world, which the terrain module brings into the
editor build, so a project that wants it lists `terrainModule` in its editor config.

## Editor modules

A module is described by a JSON file in `global/collections/editor/editorModules/`. A project
turns modules on by listing them in `collections/settings/configs/editor.json`, and the editor
build compiles in what those modules need:

```json
{
  "editorModules": ["terrainModule", "graphicsModule", "behaviorTreeModule", "particleEffectModule"],
  "theme": "instrument"
}
```

`theme` picks one of the themes in `global/collections/editor/themes/`.

### Built-in modules

| Module | Edits |
|---|---|
| `terrainModule` | A level's `tileMap`: tiles, heights, ramps, placed entities. Also brings the Scene view. |
| `graphicsModule` | The `render` block: shapes, GLB models, animations, equipment |
| `textureEditor` | Pixel textures (`imagePath`) |
| `spriteAnimationModule` | Sprite animation sets |
| `particleEffectModule`, `particleEffectSystemModule` | Particle effects, and effect systems layered from them |
| `audioModule`, `musicModule` | Synthesized sounds; instruments, patterns and tracks |
| `behaviorTreeModule` | Behavior trees, run against mock entities |
| `systemsEditor` | A scene's systems list |
| `scriptModule` | Scripts in Monaco |
| `simulationModule` | Headless simulations |
| `exportScriptModule` | Exports the project as a zip |
| `aiPromptModule` | An AI prompt panel |

### Writing a module

A module is three pieces: a JSON description, an interface (the HTML it renders into), and a
library class that does the work. A project adds one with a file in
`collections/settings/editorModules/`, or replaces a built-in one with a file of the same name.
Here is a "Loot Table" tool for a `chests` collection:

```json
{
    "title": "Loot Table",
    "container": "loot-editor",
    "interface": "lootEditor",
    "propertyName": "loot",
    "inspectorTypes": ["chests"],
    "allowEmpty": true,
    "loadHook": "loadLootTable",
    "saveHook": "saveLootTable",
    "unloadHook": "unloadLootTable",
    "libraries": ["LootTableEditor"]
}
```

| Key | Meaning |
|---|---|
| `title` | the button and tab label |
| `container`, `interface` | the element the module renders into, and the `ui/interfaces` entry whose HTML holds it |
| `propertyName` | the item field the module edits |
| `inspectorTypes` | collections whose items get a button for this module in the inspector |
| `allowEmpty` | open even when the item has no `propertyName` field yet |
| `loadHook`, `saveHook`, `unloadHook` | the events for opening an item, saving it, and closing the tab |
| `libraries`, `systems`, `classes` | what the editor build compiles in for the module, named like game.json |

The library listens for its hooks. A library whose name ends in `Editor` or `Module` is
created by the editor as `new GUTS.<Name>(controller, moduleConfig, GUTS)`:

```js
class LootTableEditor {
    constructor(controller, moduleConfig, GUTS) {
        this.config = moduleConfig;
        document.body.addEventListener(moduleConfig.loadHook, (e) => this.load(e.detail));
    }

    // detail: { data, propertyName, objectData, config }
    load({ data, propertyName }) {
        this.propertyName = propertyName;
        this.rows = data || [];
        document.getElementById('loot-editor').innerHTML = '...';   // build the UI
    }

    save() {
        document.body.dispatchEvent(new CustomEvent(this.config.saveHook, {
            detail: { propertyName: this.propertyName, data: this.rows }
        }));
    }
}
```

When the module dispatches its save hook, the editor sets `item[propertyName] = data`, writes
the file and refreshes the inspector. To finish:

1. Add the interface: `collections/ui/interfaces/data/lootEditor.json` and
   `collections/ui/interfaces/html/lootEditor.html`, with an element `id="loot-editor"`.
2. Add `"lootModule"` to `editorModules` in `editor.json` and rebuild the editor.
3. Select a chest: the inspector shows **⧉ Loot Table**, which opens the tool in a tab.

A module can be as big as it needs: the terrain module runs a whole ECS world
(`EditorECSGame` and `EditorLoader`) inside the editor.

## Editor builds

`guts build --target editor` (or `npm run build:editor -- <ProjectName>` from the GUTS repo)
compiles the editor with the project's collections and the libraries, systems and classes of
the modules its `editor.json` lists. Rebuild it after changing that list or a module's code.
Edits to data need no rebuild; to see them in the game, reload it (`guts dev` rebuilds the
game on change).

The older form-based editor is still there: add `?ui=legacy` to the editor's URL.
