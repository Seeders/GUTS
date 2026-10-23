/**
 * RpgSkillSystem - skills that rise with use, and the levels they bring (server). KINGDOM.md "Skills".
 *
 * Thirteen skills (MmoGameSystem.SKILLS), 0-100, kept on the character: char.skills[id] =
 * { level, xp }. Doing a thing trains its skill (mmoSkillUse): a weapon hit its weapon skill, a
 * spell its school, a blow taken the armor worn, slipping past the unaware Sneak, a lock
 * Lockpicking, a bargain or a persuasion Speech. A class's major skills train half again as fast.
 *
 * Every skill increase adds its new level to the character's experience (Skyrim's rule); a
 * character level brings a choice (MMO_LEVEL_CHOICE): +Health, +Magicka or +Stamina
 * (char.attr; char.picks counts the choices not yet made).
 *
 * The GUTS rpg kit. A game extends it (`class MmoSkillSystem extends GUTS.RpgSkillSystem`) and overrides
 * what it does differently. It registers under the game's old names.
 */
class RpgSkillSystem extends GUTS.BaseSystem {
    static services = [
        'mmoSkillUse'
    ];

    static serviceDependencies = [
        'mmoSkillDefs',
        'mmoSkill',
        'mmoSkillNeed',
        'mmoStartingSkills',
        'mmoClass',
        'mmoSend',
        'mmoAwardXp',
        'mmoMarkDirty',
        'mmoRecalcStats',
        'mmoActor',
        'mmoSpell'
    ];

    constructor(game) {
        super(game);
        this.game.mmoSkillSystem = this;
    }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_LEVEL_CHOICE', (e) => { const a = actorOf(e); if (a) this.choose(a, e.data?.attr); });
    }

    /** New characters, and ones from before skills: their starting skills and an attribute record. */
    onMmoPlayerEnter({ actor }) {
        const c = actor?.char;
        if (!c) return;
        if (!c.skills) {
            c.skills = {};
            for (const [id, level] of Object.entries(this.call.mmoStartingSkills(c.classId, c.appearance?.race))) c.skills[id] = { level, xp: 0 };
        }
        for (const id of Object.keys(this.call.mmoSkillDefs())) if (!c.skills[id]) c.skills[id] = { level: 15, xp: 0 };
        if (!c.attr) {
            c.attr = { health: 0, magicka: 0, stamina: 0 };
            c.picks = Math.max(0, (actor.level || 1) - 1);          // older characters choose for the levels they have
        }
        // hands start empty: the weapon in the right, the guard in the left; spells are readied from
        // Magic (P) or the favorites (no classes: nobody starts as a caster)
        if (!c.hands) c.hands = { right: null, left: null };
        if (!c.paSeeded && Array.isArray(c.actionBar)) {                     // everyone's Power Attack, once, on a free slot
            c.paSeeded = true;
            const free = c.actionBar.findIndex((x, i) => i < 9 && !x);
            if (free >= 0 && !c.actionBar.includes('powerAttack')) c.actionBar[free] = 'powerAttack';
        }
        this.call.mmoRecalcStats(actor, false);
        this.call.mmoMarkDirty(actor);
    }

    /** Train a skill by `amount` uses; raise it (and the character's experience) as it fills. */
    mmoSkillUse(actor, id, amount = 1) {
        const c = actor?.char;
        if (!c?.skills || !id || !c.skills[id] || amount <= 0) return;
        const sk = c.skills[id];
        if (sk.level >= 100) return;
        const major = (this.call.mmoClass(c.classId)?.majorSkills || []).includes(id);
        sk.xp += amount * (major ? 1.5 : 1);
        let ups = 0;
        while (sk.level < 100 && sk.xp >= this.call.mmoSkillNeed(sk.level)) {
            sk.xp -= this.call.mmoSkillNeed(sk.level);
            sk.level++;
            ups++;
            this.call.mmoSend(actor.socketId, 'MMO_SKILL_UP', { skill: id, level: sk.level });
            this.call.mmoAwardXp(actor, sk.level, 'skill');       // a skill increase is experience
        }
        if (ups) this.call.mmoRecalcStats(actor, false);         // armor skills change the armor rating
        this._dirty = this._dirty || new Set();
        this._dirty.add(actor.id);
    }

    /** A level-up's choice: more Health, Magicka or Stamina. */
    choose(actor, attr) {
        const c = actor.char;
        if (!c?.attr || !(c.picks > 0) || !['health', 'magicka', 'stamina'].includes(attr)) return;
        c.attr[attr]++;
        c.picks--;
        const before = { hp: actor.maxHp, res: actor.resMax };
        this.call.mmoRecalcStats(actor, false);
        actor.hp += Math.max(0, actor.maxHp - before.hp);         // the new share comes full
        actor.res = Math.min(actor.resMax, actor.res + Math.max(0, actor.resMax - before.res));
        this.call.mmoMarkDirty(actor);
    }

    /** A level gained (MmoQuestSystem.mmoAwardXp): one more choice to make. */
    onMmoLevelUp({ actor }) {
        if (!actor?.char) return;
        actor.char.picks = (actor.char.picks || 0) + 1;
        this.call.mmoMarkDirty(actor);
    }

    update() {
        if (!this.game.isServer || !this._dirty?.size) return;
        this._acc = (this._acc || 0) + (this.game.state.deltaTime || 0.05);
        if (this._acc < 1) return;                                 // skill bars to the client once a second
        this._acc = 0;
        for (const id of this._dirty) { const a = this.call.mmoActor(id); if (a) this.call.mmoMarkDirty(a); }
        this._dirty.clear();
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.RpgSkillSystem = RpgSkillSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.RpgSkillSystem = RpgSkillSystem; }
export default RpgSkillSystem;
export { RpgSkillSystem };
