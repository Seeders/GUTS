/**
 * Engine collection roots: the core (global/collections) and each kit (global/kits/<kit>/collections).
 *
 * A kit is an optional group of engine systems/libraries/data for one kind of game (units on a
 * grid, combat, RTS orders, cards...). Its collections have the same layout as the core's, and
 * the build treats them as part of the engine: a game names systems in game.json as before and
 * they are found in whichever root holds them. `@global/...` imports search the core, then the
 * kits, so an import keeps working when a file moves between them.
 */

const fs = require('fs');
const path = require('path');

const GUTS_ROOT = path.resolve(__dirname, '..');

/** Kits under <gutsRoot>/global/kits, sorted by name: [{ name, root, collectionsRoot, meta }]. */
function listKits(gutsRoot = GUTS_ROOT) {
    const kitsDir = path.join(gutsRoot, 'global', 'kits');
    if (!fs.existsSync(kitsDir)) return [];
    return fs.readdirSync(kitsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .map(name => {
            const root = path.join(kitsDir, name);
            const metaPath = path.join(root, 'kit.json');
            const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
            return { name, root, collectionsRoot: path.join(root, 'collections'), meta };
        })
        .filter(kit => fs.existsSync(kit.collectionsRoot));
}

/**
 * The kits a project uses: those named in its game.json `kits` (plus the kits they require, from
 * each kit.json `requires`), or every kit when the project doesn't say. Unknown names throw.
 */
function selectKits(names, gutsRoot = GUTS_ROOT) {
    const all = listKits(gutsRoot);
    if (!Array.isArray(names)) return all;
    const byName = new Map(all.map(k => [k.name, k]));
    const chosen = new Set();
    const add = (name, from) => {
        if (chosen.has(name)) return;
        const kit = byName.get(name);
        if (!kit) {
            throw new Error(`Unknown kit "${name}"${from ? ` (required by ${from})` : ''}. Available: ${[...byName.keys()].join(', ')}`);
        }
        chosen.add(name);
        for (const dep of kit.meta.requires || []) add(dep, name);
    };
    for (const name of names) add(name);
    return all.filter(k => chosen.has(k.name));
}

/** Every engine collections root, core first: what `@global` resolves against. */
function engineCollectionRoots(gutsRoot = GUTS_ROOT) {
    return [path.join(gutsRoot, 'global', 'collections'), ...listKits(gutsRoot).map(k => k.collectionsRoot)];
}

module.exports = { listKits, selectKits, engineCollectionRoots };
