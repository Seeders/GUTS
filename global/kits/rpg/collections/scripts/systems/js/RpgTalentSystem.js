/**
 * RpgTalentSystem - ascensions and talent trees (server).
 *
 * At level 10 a character chooses an ascension: one of the three tier-2
 * units that follow their class (data/ascensions/<id>.json). They take on
 * its unit, gain its passive and get its talent tree. Changing later is done
 * at a class trainer for a fee and resets talents.
 *
 * Players earn one talent point per level from 10 (MmoGameSystem
 * mmoTalentPoints). A tree has three tiers: tier 1 is open, tier 2 needs 2
 * points spent, the capstone needs 4. char.talents maps talent id → rank.
 *
 * A talent's effects apply once per rank (see tools/content/spells_talents.mjs):
 *   stats  → actor.talentStats, summed with aura stats (MmoCombatSystem.statSum)
 *   gear   → added to the equipment totals before stats are derived
 *   spell  → actor.spellMods[spellId] = { cooldown, cost, damage }
 *   grant  → the talent spell is added to char.spells (removed on reset)
 *
 * A race's `racial` (data/races/<id>.json) folds in the same way: its stats and gear always
 * on, and its `spell` known from creation.
 *
 * Client → server:  MMO_ASCEND { ascension }   MMO_TALENT_LEARN { talent }   MMO_TALENT_RESET
 *
 * The GUTS rpg kit. A game extends it (`class MmoTalentSystem extends GUTS.RpgTalentSystem`) and overrides
 * what it does differently. It registers under the game's old names.
 */
class RpgTalentSystem extends GUTS.BaseSystem {
    static services = ['mmoApplyTalents'];

    static serviceDependencies = [
        'mmoConfig',
        'mmoTalentTree',
        'mmoTalentPoints',
        'mmoAscension',
        'mmoEmit',
        'mmoNpc',
        'mmoSend',
        'mmoToast',
        'mmoMarkDirty'
    ];

    static TIER_REQUIREMENT = { 1: 0, 2: 2, 3: 4 };
    static REASCEND_FEE = 5000;           // copper (50 silver), paid at a class trainer

    constructor(game) {
        super(game);
        this.game.mmoTalentSystem = this;
    }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_ASCEND', (e) => { const a = actorOf(e); if (a) this.ascend(a, e.data?.ascension); });
        bus.subscribe('MMO_TALENT_LEARN', (e) => { const a = actorOf(e); if (a) this.learn(a, e.data?.talent); });
        bus.subscribe('MMO_TALENT_RESET', (e) => { const a = actorOf(e); if (a) this.reset(a); });
    }

    /** Choose (or change) an ascension. */
    ascend(a, ascensionId) {
        if (!a || a.kind !== 'player' || a.dead) return;
        const char = a.char;
        const asc = this.call.mmoAscension(ascensionId);
        if (!asc || asc.class !== char.classId || char.ascension === ascensionId) return;
        if (a.level < 10) return this.call.mmoToast(a, 'You can ascend at level 10.', 'error');
        if (a.inCombat) return this.call.mmoToast(a, "You can't do that in combat.", 'error');
        if (char.ascension) {
            const range = this.call.mmoConfig().talkRange + 60;
            const nearTrainer = [...(this.game.mmoNpcSystem?.npcs?.entries() || [])].some(([id, npc]) =>
                this.call.mmoNpc(id)?.roles?.includes('trainer') && Math.hypot(npc.x - a.x, npc.z - a.z) <= range);
            if (!nearTrainer) return this.call.mmoToast(a, 'Visit a class trainer to change your ascension.', 'error');
            if ((char.money || 0) < RpgTalentSystem.REASCEND_FEE) return this.call.mmoToast(a, 'Changing your ascension costs 50 silver.', 'error');
            char.money -= RpgTalentSystem.REASCEND_FEE;
            this.clearTalents(char);
        }
        char.ascension = ascensionId;
        a.unit = asc.unit;
        this.game.mmoWorldSystem.mmoRecalcStats(a);          // bumps a.ver: viewers rebuild the unit
        this.call.mmoMarkDirty(a);
        this.call.mmoEmit({ t: 'fx', fx: 'rage_buff', x: a.x, z: a.z, id: a.id }, a.x, a.z);
        this.call.mmoSend(a.socketId, 'MMO_ASCENDED', { ascension: ascensionId });
    }

    /** Remove all talents and the spells they granted. */
    clearTalents(char) {
        const spells = this.game.getCollections().spells || {};
        char.talents = {};
        char.spells = char.spells.filter(s => !spells[s]?.talent);
        if (Array.isArray(char.actionBar)) char.actionBar = char.actionBar.map(x => (spells[x]?.talent ? null : x));
    }

    spent(char) {
        return Object.values(char.talents || {}).reduce((n, r) => n + r, 0);
    }

    learn(a, talentId) {
        if (!a || a.kind !== 'player' || a.dead) return;
        const char = a.char;
        char.talents = char.talents || {};
        const tree = this.call.mmoTalentTree(char.ascension);
        if (!tree) return this.call.mmoToast(a, 'Choose an ascension first (level 10).', 'error');
        const t = tree.talents.find(x => x.id === talentId);
        if (!t) return;
        const rank = char.talents[t.id] || 0;
        const spent = this.spent(char);
        if (rank >= t.maxRank) return;
        if (spent >= this.call.mmoTalentPoints(a.level)) return this.call.mmoToast(a, 'You have no talent points to spend.', 'error');
        if (spent < (RpgTalentSystem.TIER_REQUIREMENT[t.tier] ?? 0)) return this.call.mmoToast(a, `Spend ${RpgTalentSystem.TIER_REQUIREMENT[t.tier]} points to unlock this tier.`, 'error');
        char.talents[t.id] = rank + 1;
        for (const e of t.effects) {
            if (e.grant && !char.spells.includes(e.grant)) {
                char.spells.push(e.grant);
                this.call.mmoSend(a.socketId, 'MMO_LEARNED', { spell: e.grant });
            }
        }
        this.game.mmoWorldSystem.mmoRecalcStats(a);
        this.call.mmoMarkDirty(a);
    }

    reset(a) {
        if (!a || a.kind !== 'player') return;
        if (a.inCombat) return this.call.mmoToast(a, "You can't do that in combat.", 'error');
        this.clearTalents(a.char);
        this.game.mmoWorldSystem.mmoRecalcStats(a);
        this.call.mmoMarkDirty(a);
        this.call.mmoToast(a, 'Your talents have been reset.', 'info');
    }

    /** Fold a player's ascension and talents into their actor (called from stat recalculation). */
    mmoApplyTalents(actor, gear) {
        const char = actor.char;
        char.talents = char.talents || {};
        const stats = {}, mods = {};
        const tree = this.call.mmoTalentTree(char.ascension);
        // Drop talents and talent spells that don't belong to the current tree (older saves).
        const ids = new Set((tree?.talents || []).map(t => t.id));
        for (const id of Object.keys(char.talents)) if (!ids.has(id)) delete char.talents[id];
        const spells = this.game.getCollections().spells || {};
        const allowed = new Set((tree?.talents || []).filter(t => char.talents[t.id]).flatMap(t => t.effects.map(e => e.grant).filter(Boolean)));
        char.spells = char.spells.filter(s => !spells[s]?.talent || allowed.has(s));
        // The ascension's passive, always on.
        for (const [k, v] of Object.entries(tree?.passive?.stats || {})) stats[k] = (stats[k] || 0) + v;
        for (const [k, v] of Object.entries(tree?.passive?.gear || {})) gear[k] = (gear[k] || 0) + v;
        // The race's racial: a passive, always on, and an ability known from creation (older
        // saves get it here, in a free action bar slot); other races' abilities are dropped.
        const racial = this.game.getCollections().races?.[char.appearance?.race]?.racial;
        for (const [k, v] of Object.entries(racial?.stats || {})) stats[k] = (stats[k] || 0) + v;
        for (const [k, v] of Object.entries(racial?.gear || {})) gear[k] = (gear[k] || 0) + v;
        char.spells = char.spells.filter(s => !spells[s]?.racial || s === racial?.spell);
        if (racial?.spell && !char.spells.includes(racial.spell)) {
            char.spells.push(racial.spell);
            const bar = char.actionBar || [];
            const free = bar.indexOf(null);
            if (free >= 0 && !bar.includes(racial.spell)) bar[free] = racial.spell;
        }
        for (const t of tree?.talents || []) {
            const rank = char.talents?.[t.id] || 0;
            if (!rank) continue;
            for (const e of t.effects) {
                for (const [k, v] of Object.entries(e.stats || {})) stats[k] = (stats[k] || 0) + v * rank;
                for (const [k, v] of Object.entries(e.gear || {})) gear[k] = (gear[k] || 0) + v * rank;
                if (e.spell) {
                    const m = mods[e.spell] || (mods[e.spell] = { cooldown: 0, cost: 0, damage: 0 });
                    m.cooldown += (e.cooldown || 0) * rank;
                    m.cost += (e.cost || 0) * rank;
                    m.damage += (e.damage || 0) * rank;
                }
                if (e.grant && !char.spells.includes(e.grant)) char.spells.push(e.grant);
            }
        }
        actor.talentStats = stats;
        actor.spellMods = mods;
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.RpgTalentSystem = RpgTalentSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.RpgTalentSystem = RpgTalentSystem; }
export default RpgTalentSystem;
export { RpgTalentSystem };
