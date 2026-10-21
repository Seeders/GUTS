# The GUTS editor

The editor is a browser app for a project's collections. At heart it edits the JSON files
under `collections/`, so units, items, scenes, components and configs can all be changed
without opening a text editor. On top of that it has visual modules: terrain and level
editing, sprite animations, 3D models, particle effects, audio and music, behavior trees,
textures, a systems overview and headless simulations.

## Running it

The editor runs from a clone of the GUTS repository and works on the projects cloned into
its `projects/` folder:

```bash
git clone https://github.com/Seeders/GUTS.git
cd GUTS
npm install
cd projects && git clone <your-project-repo> && cd ..
npm run build:editor -- <ProjectName>     # editor bundle for that project
npm run start:editor                      # http://localhost:8080/index.html
```

Edits are written to the project's files on disk when you save. Rebuild or reload the game
to see them (`guts dev` in the project rebuilds on change).

**Security.** The editor server can read, write and delete files. In development it is
open, with a warning at startup. Set `GUTS_EDITOR_PASSWORD` (and optionally
`GUTS_EDITOR_USER`, default `admin`) to require a login; in production mode (`--prod`) the
editor endpoints are refused unless a password is set. Never expose an editor server
without one.

## Layout

- **Sidebar**: the project's collections, grouped by category, and the items in each.
- **Main area**: the selected item. Plain JSON items get a property form; types with a
  module get that module's view (the terrain editor for levels, the graphics editor for
  models, and so on).
- **Save** writes the item to its file under `collections/`.

## Modules

A module is described by a JSON file in `global/collections/editor/editorModules/`. A project
turns modules on by listing them in `collections/settings/configs/editor.json`
(`"editorModules": ["terrainModule", "behaviorTreeModule", ...]`), and can add or replace one
with a file of that name in `collections/settings/editorModules/`:

```json
{
    "title": "Behavior Tree Editor",
    "container": "behavior-tree-editor-container",
    "interface": "behaviorTreeEditor",
    "propertyName": "mockEntities",
    "inputElement": "textarea",
    "inputDataType": "json",
    "loadHook": "editBehaviorTree",
    "saveHook": "saveBehaviorTree",
    "unloadHook": "unloadBehaviorTree",
    "libraries": ["BaseECSGame", "BehaviorTreeProcessor", "BehaviorTreeEditor"],
    "systems": ["BehaviorSystem"],
    "classes": [{ "collection": "behaviorTrees", "baseClass": "BaseBehaviorTree" }]
}
```

| Key | Meaning |
|---|---|
| `container`, `interface` | the element the module renders into, and the `ui/interfaces` page it uses |
| `propertyName` | the item property that opens this module |
| `loadHook`, `saveHook`, `unloadHook` | editor events the module's code listens for when an item opens, saves and closes |
| `libraries`, `systems`, `classes` | what the editor build compiles in for the module, named like game.json |

The module's code is an ordinary library (for example `BehaviorTreeEditor` in the ai kit)
that listens for its hooks. Themes live in `global/collections/editor/themes/`.

## Editor builds

`guts build --target editor` (or `npm run build:editor -- <ProjectName>` from the GUTS repo)
compiles the editor with the project's collections and the libraries, systems and classes of
the modules its `editor.json` lists.
