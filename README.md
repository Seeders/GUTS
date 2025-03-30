# GUTS - Gamedev Ultimate Toolkit System

GUTS is a comprehensive toolkit for game development, providing a flexible framework to create and edit games with ease. It comes with a pre-packaged tower defense game and sample assets to help you get started.

## Local Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   node server.js
   ```

3. Open in your browser:
   - Editor: `http://localhost:5000/editor.html`
   - Game: `http://localhost:5000/index.html`

## License

GUTS is available under the GNU General Public License v3. See [LICENSE.GPL](LICENSE.GPL) for details.

## Try it yourself:
https://seeders.github.io/GUTS/index.html

https://seeders.github.io/GUTS/editor.html

## Screenshots

![image](https://github.com/user-attachments/assets/136fbb71-47e6-4e08-b663-ecce43fc2219)

Customize your theme, your tools, ALL the guts:
![Editor Screenshot](https://github.com/user-attachments/assets/77f5a78d-bbfe-4d62-b26e-9479ca03dd84)
![Game Screenshot](https://github.com/user-attachments/assets/3f63d70f-cdd1-43f6-97fc-65805144735d)

## Features

GUTS includes a simple tower defense game and various assets to demonstrate its capabilities. The toolkit is built around the following core object types:

### Core Object Types

- **Configs**: Store settings for the editor, game, and plugins.
- **Entities**: Collections of Components and Renderers that define game objects.
- **Components**: Standalone behaviors with an `update()` function.
- **Renderers**: Visual components with a `draw()` function.
- **Functions**: Global utility functions for use in Components and Renderers.
- **Levels (Terrain)**: Tilemaps that render as level terrain.
- **Visual Objects**: Data for game entities (e.g., Players, Allies, Enemies, Projectiles) with stats (health, speed) and render objects (3D models, animations). These can be used to create Entities.
- **Data**: Global collections of non-visual game data (e.g., upgrades, effects).

## Usage Tips

- **Adding Object References**: Use a key on the object with the type's singular or plural name (e.g., `components` or `component`).
- **Data Storage**: All game data is saved in `/config/game_config.json`. Back up this file regularly, as there’s no history system yet (Git is recommended).

## Known Issues & Troubleshooting

- **Data Backup**: Save `/config/game_config.json` manually, as there’s no built-in history system.
- **Script Saving**: Use the "Save" button next to the script editor to save scripts. The "Save Object" button won’t save script changes.
- **Graphics Editor**: Rendering may stop occasionally—refresh the page to fix it.
- **Level Tilemap Editor**: Tile placement can be slow.
- **Sound Editor**: Currently experimental and limited in functionality.

## Getting Started

1. Launch the server and open the editor (`/editor.html`) to explore the toolkit.
2. Experiment with the included tower defense game to understand how Entities, Components, and Renderers work together.
3. Modify configs and assets in `/config/game_config.json` to customize your game.

## Contributing

Feel free to submit issues or pull requests to improve GUTS. Contributions are welcome under the GPL v3 license.
