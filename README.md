=# GUTS
Gamedev Ultimate Toolkit System

    npm install

    node server.js

open 

    http://localhost:5000/editor.html
or 

    http://localhost:5000/index.html

Available under the GNU General Public License v3 for free use. See LICENSE.GPL for details.

![image](https://github.com/user-attachments/assets/77f5a78d-bbfe-4d62-b26e-9479ca03dd84)

![image](https://github.com/user-attachments/assets/3f63d70f-cdd1-43f6-97fc-65805144735d)


It comes pre-packaged with a simple tower defense game and some random assets to help you get a feel for how everything works.

Basic Overview:

The core object types are:

Configs, Entities, Components, Renderers, Functions, Levels (Terrain), Visual Objects, and Data.

Configs - 
    store settings for various systems including the editor, the game, and plugins.

Entities - 
    Collections of Components and Renderers that define the structure of your games objects.   

Components - 
    Standalone simple behaviors that implement an update() function.

Renderers - 
    The same as a component, except it implements a draw() function.

Functions - 
    Global functions for your game you may want to include in components or renderers.

Data - 
    Global collections of data you may need for your game that dont necessarily have visual graphics.  Upgrades, effects, etc.

Levels - 
    Tilemaps that render as terrain for your levels.

Visual Objects - 
    Data for Player, Allies, Enemies, Projectiles, etc.  They have stats like health and speed, and also a render object that stores their 3D model and animations.  This data can be fed in to their respective Entity definitions to create game objects.  



Tips:

To add object references, just make a key on the object with the types plural or single name.


Known issues and troubleshooting: 
all the data is saved in /config/game_config.json, so make backups.  i dont have a history system yet, since i just use git.  

You have to click the save button next to the script editor to save your script, if you click the save object button it wont save your script.

The graphics editor tends to stop rendering sometimes, just refresh and it should work again.

The level tilemap editor is slow when placing tiles.

The sound editor is brand new and sucks, and is basically useless.

