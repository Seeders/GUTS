/**
 * ItemGrid - a Diablo-style grid inventory: items of w x h cells at (x, y) in a W x H grid.
 *
 * A grid is a plain array of { id, n, x, y }; sizeOf(entry) gives an entry's [w, h] (default: [1, 1],
 * or pass e.g. `e => game.call('getItemDef', e.id)?.size || [1, 1]`). Nothing here owns state.
 */
class ItemGrid {
    static size(sizeOf, o) { const s = sizeOf ? sizeOf(o) : o?.size; return Array.isArray(s) ? s : [1, 1]; }

    /** Does a w x h item fit at (x, y) (skipping list[skip], the item being moved)? */
    static fits(list, W, H, x, y, w, h, skip = -1, sizeOf = null) {
        if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
        for (let i = 0; i < list.length; i++) {
            const o = list[i];
            if (i === skip || !o || o.x == null) continue;
            const [ow, oh] = ItemGrid.size(sizeOf, o);
            if (x < o.x + ow && x + w > o.x && y < o.y + oh && y + h > o.y) return false;
        }
        return true;
    }

    /** The first place a w x h item fits (column by column, as Diablo fills a pack), or null. */
    static free(list, W, H, w, h, skip = -1, sizeOf = null) {
        for (let x = 0; x <= W - w; x++) for (let y = 0; y <= H - h; y++) if (ItemGrid.fits(list, W, H, x, y, w, h, skip, sizeOf)) return { x, y };
        return null;
    }

    /** The index of the item covering cell (cx, cy), or -1. */
    static at(list, cx, cy, sizeOf = null) {
        for (let i = 0; i < list.length; i++) {
            const o = list[i];
            if (!o || o.x == null) continue;
            const [w, h] = ItemGrid.size(sizeOf, o);
            if (cx >= o.x && cx < o.x + w && cy >= o.y && cy < o.y + h) return i;
        }
        return -1;
    }

    /** Add an item where it first fits: the entry added, or null if it doesn't fit. */
    static add(list, W, H, entry, sizeOf = null) {
        const [w, h] = ItemGrid.size(sizeOf, entry), at = ItemGrid.free(list, W, H, w, h, -1, sizeOf);
        if (!at) return null;
        const e = { ...entry, x: at.x, y: at.y };
        list.push(e);
        return e;
    }

    /** Give every item without a valid place one; returns those that don't fit (left with x null). */
    static settle(list, W, H, sizeOf = null) {
        const out = [];
        for (let i = 0; i < list.length; i++) {
            const o = list[i], [w, h] = ItemGrid.size(sizeOf, o);
            if (o.x != null && ItemGrid.fits(list, W, H, o.x, o.y, w, h, i, sizeOf)) continue;
            o.x = null;
            const at = ItemGrid.free(list, W, H, w, h, i, sizeOf);
            if (at) { o.x = at.x; o.y = at.y; } else out.push(o);
        }
        return out;
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.ItemGrid = ItemGrid; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.ItemGrid = ItemGrid; }
export default ItemGrid;
export { ItemGrid };
