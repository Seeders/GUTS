# __TITLE__

A [GUTS](https://github.com/Seeders/GUTS) project.

```bash
npm install
npm run dev          # build, watch and serve with live reload at http://localhost:3000/
```

`npm run build` then `npm start` builds once and serves without reloading.

## Engine systems and kits

`collections/settings/configs/game.json` lists the systems this game runs. Engine systems come
from the GUTS core plus optional kits (`ai`, `units`, `combat`, `rts`, `cards`). This starter
uses only the core (`"kits": []`); to use, say, grid movement and pathfinding, add `"units"` to
`kits` and its systems (e.g. `"GridSystem"`, `"PathfindingSystem"`) to `systems`. Listing a kit also
brings in its component schemas (`collections/data/components` files of your own with the same
names win). Each kit's
README in `node_modules/guts/global/kits/<kit>/` lists its systems and what your game supplies.
