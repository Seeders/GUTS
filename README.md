
<p align="center">
   <img src="https://raw.githubusercontent.com/Seeders/GUTS/main/logo.png">
</p>

# GUTS - Gamedev Ultimate Toolkit System

A data-driven JavaScript game engine: an entity component system with typed-array storage,
Three.js rendering, server-authoritative and lockstep multiplayer, headless simulation, a
visual editor, and a build CLI. Game content (units, items, levels, scenes, components) is
JSON; behavior is small systems that read and write it.

- **ECS** with schema-defined components stored in typed arrays, and systems that talk
  through named services instead of imports.
- **Core + kits.** The core covers rendering, world and terrain, cameras, audio, particles,
  animation and scenes. Optional kits add behavior-tree AI, grid units with pathfinding,
  combat, an RTS layer, and card games.
- **One codebase, four builds:** browser client, Node server, headless simulation, and editor.
- **Editor** for every collection, with modules for terrain, models, sprites, particles,
  audio, behavior trees and simulations.

## Quick start

Needs Node.js 20 or newer.

```bash
npx github:Seeders/GUTS new my-game     # or: node path/to/GUTS/bin/guts.js new my-game
cd my-game
npm install
npm run dev                              # http://localhost:3000/
```

Then follow **[Getting started](docs/getting-started.md)**: add a component, a system, and a
service to the starter project in about ten minutes.

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Tutorial on the starter project |
| [Concepts](docs/concepts.md) | Entities, components, systems, services, scenes, collections, configs, builds, multiplayer |
| [Engine core and kits](global/README.md) | What the engine ships, and each kit's systems and requirements |
| [Editor](docs/editor.md) | Running the editor, its layout, writing modules |

## The `guts` command

| Command | Description |
|---------|-------------|
| `guts new <folder> [--template game\|app]` | Create a project from a template |
| `guts dev [--port n] [--no-serve]` | Build the project in this folder, rebuild on change, serve with live reload |
| `guts build [--target client\|server\|headless\|editor] [--production]` | Build the project in this folder |
| `guts fork-diff <projects...>` | List engine files a project replaces and how they differ |

## Repository layout

```
GUTS/
├── bin/guts.js          the guts command
├── build/               build system: collection discovery, entry generation, webpack
├── engine/              runtime entry points (client, server, headless engines)
├── global/              engine collections: core (collections/) and kits (kits/)
├── templates/           starter projects for guts new
├── docs/                documentation
└── projects/Editor/     the editor; other projects are cloned into projects/ from their own repos
```

## Example projects

- **[TurnBasedWarfare](https://github.com/Seeders/TurnBasedWarfare)**: RTS/auto-battler with
  placement and battle phases, behavior-tree AI, abilities, server-authoritative
  multiplayer, and headless AI-vs-AI simulations.

## Working on GUTS itself

```bash
git clone https://github.com/Seeders/GUTS.git
cd GUTS
npm install
npm run start:editor     # editor, http://localhost:8080/index.html
npm test                 # engine and editor tests
```

To try engine changes in a project, point the project at your clone
(`npm install ../GUTS` in the project) and run `guts dev` there.

## Screenshots

![Editor Overview](https://github.com/user-attachments/assets/efcaa562-b040-4789-a5a4-14e14ddbe2a0)

*The editor with the terrain module*

![Gameplay](https://github.com/user-attachments/assets/77f5a78d-bbfe-4d62-b26e-9479ca03dd84)

*TurnBasedWarfare*

![Theme Customization](https://github.com/user-attachments/assets/3f63d70f-cdd1-43f6-97fc-65805144735d)

*Editor themes*

## Contributing

Bug reports, feature requests and pull requests are welcome via
[GitHub Issues](https://github.com/Seeders/GUTS/issues). Games made with GUTS are welcome too.

## License

MIT, see [LICENSE](LICENSE).
