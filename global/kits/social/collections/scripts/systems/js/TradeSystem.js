/**
 * TradeSystem - two players trade face to face, as Diablo II's trade window (where the game's rules run).
 *
 * tradeAsk(a, b) asks; b's tradeAnswer(b, yes) opens the trade (asking someone who already asked you
 * is a yes). Each side puts in items (tradeOffer(id, item, n), tradePull(id, index)) and gold
 * (tradeGold(id, n)); any change takes back both acceptances. When both have accepted (tradeAccept),
 * everything changes hands at once, or, if either can't carry what they'd get, nothing does.
 * Walking apart (socialCanTrade turns false) or leaving (tradeMemberGone) ends it.
 *
 * The game hears:
 *   onTradeRequest { from, to }       onTradeUpdate { trade } (show it: tradeView(trade, id))
 *   onTradeClosed { trade, a, b, reason, done }   reason: 'done', 'cancelled', 'apart', 'gone',
 *                                                  'noGold', 'noItems', 'noRoom'
 * and provides (items are item ids; a game's inventory, its own business):
 *   socialCanTrade(a, b) -> bool       socialTradable(id, item) -> bool (optional: quest items stay)
 *   socialCountItem(id, item) -> n     socialGold(id) -> n
 *   socialTakeItem(id, item, n)        socialGiveItem(id, item, n) -> how many it took
 *   socialAddGold(id, n)               socialSnapshot(id) -> s, socialRestore(id, s): undo a failed trade
 * Settings: configs/social.json { tradeAskLife (seconds, default 30), tradeMaxItems (20) }.
 * Calls return { ok, reason } (reason: 'self', 'busy', 'apart', 'noAsk', 'notTrading', 'untradable', 'notEnough').
 */
class TradeSystem extends GUTS.BaseSystem {
    static services = ['tradeAsk', 'tradeAnswer', 'tradeOffer', 'tradePull', 'tradeGold', 'tradeAccept', 'tradeCancel', 'tradeMemberGone', 'tradeOf', 'tradeView'];
    static serviceDependencies = ['socialCanTrade', 'socialTradable', 'socialCountItem', 'socialGold', 'socialTakeItem', 'socialGiveItem', 'socialAddGold', 'socialSnapshot', 'socialRestore'];

    constructor(game) {
        super(game);
        this.game.tradeSystem = this;
        this.asks = new Map();           // asked id -> { from, at }
        this.trades = new Map();         // id -> trade { a, b, offer: { [id]: { items: [{ id, n }], gold } }, ok: Set }
        this._acc = 0;
    }

    get cfg() { return this.collections.configs?.social || {}; }
    now() { return this.game.state?.now || 0; }
    canTrade(a, b) { return this.game.hasService('socialCanTrade') ? !!this.call.socialCanTrade(a, b) : true; }

    tradeOf(id) { return this.trades.get(id) || null; }
    other(t, id) { return t.a === id ? t.b : t.a; }

    /** What one side sees: { you: { items, gold, ok }, them: { id, items, gold, ok } }. */
    tradeView(t, id) {
        const side = (x) => ({ items: t.offer[x].items, gold: t.offer[x].gold, ok: t.ok.has(x) });
        const o = this.other(t, id);
        return { you: side(id), them: { id: o, ...side(o) } };
    }

    tradeAsk(a, b) {
        if (a === b) return { ok: false, reason: 'self' };
        if (!this.canTrade(a, b)) return { ok: false, reason: 'apart' };
        if (this.trades.has(a) || this.trades.has(b)) return { ok: false, reason: 'busy' };
        if (this.asks.get(a)?.from === b) return this.tradeAnswer(a, true);           // (they asked you first: that's a yes)
        this.asks.set(b, { from: a, at: this.now() });
        this.game.triggerEvent('onTradeRequest', { from: a, to: b });
        return { ok: true };
    }

    tradeAnswer(b, yes) {
        const q = this.asks.get(b);
        this.asks.delete(b);
        if (!q || this.now() - q.at > (this.cfg.tradeAskLife ?? 30)) return { ok: false, reason: 'noAsk' };
        const a = q.from;
        if (!yes) { this.game.triggerEvent('onTradeDeclined', { from: a, to: b }); return { ok: true, declined: true }; }
        if (!this.canTrade(a, b)) return { ok: false, reason: 'apart' };
        if (this.trades.has(a) || this.trades.has(b)) return { ok: false, reason: 'busy' };
        const t = { a, b, offer: { [a]: { items: [], gold: 0 }, [b]: { items: [], gold: 0 } }, ok: new Set() };
        this.trades.set(a, t); this.trades.set(b, t);
        this.game.triggerEvent('onTradeUpdate', { trade: t });
        return { ok: true, trade: t };
    }

    changed(t) { t.ok.clear(); this.game.triggerEvent('onTradeUpdate', { trade: t }); }

    tradeOffer(id, item, n = 1) {
        const t = this.trades.get(id);
        if (!t) return { ok: false, reason: 'notTrading' };
        if (this.game.hasService('socialTradable') && this.call.socialTradable(id, item) === false) return { ok: false, reason: 'untradable' };
        const mine = t.offer[id];
        if (mine.items.length >= (this.cfg.tradeMaxItems ?? 20)) return { ok: false, reason: 'full' };
        const already = mine.items.filter(x => x.id === item).reduce((s, x) => s + x.n, 0);
        const have = this.call.socialCountItem(id, item) || 0;
        if (already >= have) return { ok: false, reason: 'notEnough' };
        mine.items.push({ id: item, n: Math.min(n, have - already) });
        this.changed(t);
        return { ok: true };
    }

    tradePull(id, i) {
        const t = this.trades.get(id);
        if (!t || !t.offer[id].items[i]) return { ok: false, reason: 'notTrading' };
        t.offer[id].items.splice(i, 1);
        this.changed(t);
        return { ok: true };
    }

    tradeGold(id, n) {
        const t = this.trades.get(id);
        if (!t) return { ok: false, reason: 'notTrading' };
        t.offer[id].gold = Math.max(0, Math.min(Math.floor(n) || 0, this.call.socialGold(id) || 0));
        this.changed(t);
        return { ok: true };
    }

    tradeAccept(id) {
        const t = this.trades.get(id);
        if (!t) return { ok: false, reason: 'notTrading' };
        t.ok.add(id);
        if (t.ok.size < 2) { this.game.triggerEvent('onTradeUpdate', { trade: t }); return { ok: true }; }
        return this.execute(t);
    }

    /** Both accepted: everything changes hands, or (if either can't carry it) nothing does. */
    execute(t) {
        const { a, b } = t;
        if (!this.canTrade(a, b)) return this.close(t, 'apart');
        for (const id of [a, b]) {
            const o = t.offer[id];
            if ((this.call.socialGold(id) || 0) < o.gold) return this.close(t, 'noGold', id);
            const want = {};
            for (const x of o.items) want[x.id] = (want[x.id] || 0) + x.n;
            for (const [item, n] of Object.entries(want)) if ((this.call.socialCountItem(id, item) || 0) < n) return this.close(t, 'noItems', id);
        }
        const before = [this.call.socialSnapshot(a), this.call.socialSnapshot(b)];
        const take = (id, o) => { for (const x of o.items) this.call.socialTakeItem(id, x.id, x.n); if (o.gold) this.call.socialAddGold(id, -o.gold); };
        const give = (id, o) => { for (const x of o.items) if ((this.call.socialGiveItem(id, x.id, x.n) || 0) < x.n) return false; if (o.gold) this.call.socialAddGold(id, o.gold); return true; };
        take(a, t.offer[a]); take(b, t.offer[b]);
        if (!give(b, t.offer[a]) || !give(a, t.offer[b])) {
            this.call.socialRestore(a, before[0]); this.call.socialRestore(b, before[1]);
            return this.close(t, 'noRoom');
        }
        return this.close(t, 'done');
    }

    tradeCancel(id) {
        const t = this.trades.get(id);
        return t ? this.close(t, 'cancelled', id) : { ok: false, reason: 'notTrading' };
    }

    close(t, reason, by = null) {
        this.trades.delete(t.a); this.trades.delete(t.b);
        this.game.triggerEvent('onTradeClosed', { trade: t, a: t.a, b: t.b, reason, by, done: reason === 'done' });
        return { ok: reason === 'done', reason };
    }

    tradeMemberGone(id) {
        const t = this.trades.get(id);
        if (t) this.close(t, 'gone', id);
        this.asks.delete(id);
        for (const [k, v] of this.asks) if (v.from === id) this.asks.delete(k);
    }

    /** Walked apart: the trade's off. */
    update() {
        if (!this.trades.size) return;
        this._acc += this.game.state.deltaTime || 0.05;
        if (this._acc < 0.25) return;
        this._acc = 0;
        for (const t of new Set(this.trades.values())) if (!this.canTrade(t.a, t.b)) this.close(t, 'apart');
    }

    onSceneUnload() { this.asks.clear(); this.trades.clear(); }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.TradeSystem = TradeSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.TradeSystem = TradeSystem; }
export default TradeSystem;
export { TradeSystem };
