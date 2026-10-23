/**
 * RpgCombatSystem - action-RPG combat for a persistent world (server only; the GUTS rpg kit).
 *
 * Every actor (player or mob) fights through the same rules:
 *   - a current target and auto-attack swings on a weapon timer
 *   - spells from data/spells: costs, global cooldown, cooldowns, cast times,
 *     channels, ranges and data-driven effects (damage, heal, aura, threat,
 *     taunt, interrupt, resource, blink, cleanse), single-target or AoE
 *   - auras: buffs/debuffs with stat modifiers, DoTs, HoTs, absorbs, pulses
 *   - resources (Skyrim's two): stamina for fighters (regenerates, faster out of combat),
 *     magicka for casters (regenerates, slower just after casting)
 *   - threat tables on mobs, tapping, combat state, death and release
 *
 * Mob decision-making lives in RpgMobSystem; it drives mobs through the same
 * castSpell/autoAttack entry points players use.
 *
 * A game extends it (`class MmoCombatSystem extends GUTS.RpgCombatSystem`) and overrides what it
 * does differently: its hands and swings (onHand, melee, bash), its heroes or traits, its blows.
 * It registers as game.mmoCombatSystem and works through the game's world services (see the
 * kit's README).
 */
class RpgCombatSystem extends GUTS.BaseSystem {
    // The client stretches the attack animation over the swing interval (`iv` on the swing
    // event); the shot leaves / the blow lands at these fractions of it.
    static RANGED_RELEASE = 0.5;
    static SNEAK_ATTACK = 2.5;          // damage of a sneak attack (KINGDOM.md: sneaking)
    static MELEE_IMPACT = 0.4;

    static services = [
        'mmoCastSpell',
        'mmoDealDamage',
        'mmoHeal',
        'mmoApplyAura',
        'mmoAddThreat',
        'mmoIsEnemy',
        'mmoDistance',
        'mmoKill',
        'mmoResurrect'
    ];

    static serviceDependencies = [
        'mmoTrait',
        'mmoWeaponType',
        'mmoSkillUse',
        'mmoSkill',
        'mmoSkillMult',
        'mmoWeaponSkill',
        'mmoSpellSkill',
        'mmoArmorSkill',
        'mmoStartZone',
        'mmoConfig',
        'mmoSpell',
        'mmoClass',
        'mmoActor',
        'mmoActors',
        'mmoNearbyActors',
        'mmoEmit',
        'mmoSend',
        'mmoToast',
        'mmoMarkDirty',
        'mmoCanStep',
        'mmoGroundY',
        'mmoShotBlocked',
        'mmoTeleport',
        'mmoSpellCost',
        'mmoSpellRange',
        'mmoEffectValue',
        'mmoZone',
        'mmoZones',
        'mmoNow',
        'mmoItem',
        'mmoTakeItem',
        'mmoCountItem'
    ];

    constructor(game) {
        super(game);
        this.game.mmoCombatSystem = this;
        this._pending = [];         // delayed effects: [{at, fn}]
        this._regenAccum = 0;
    }

    get cfg() { return this.call.mmoConfig(); }
    now() { return this.call.mmoNow(); }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_TARGET', (e) => { const a = actorOf(e); if (a) this.setTarget(a, e.data?.id ?? null); });
        bus.subscribe('MMO_ATTACK', (e) => { const a = actorOf(e); if (a) this.toggleAutoAttack(a, !!e.data?.on); });
        bus.subscribe('MMO_CAST', (e) => { const a = actorOf(e); if (a) this.playerCast(a, e.data || {}); });
        bus.subscribe('MMO_HAND', (e) => { const a = actorOf(e); if (a) this.onHand(a, e.data || {}); });
        bus.subscribe('MMO_EQUIP_HAND', (e) => { const a = actorOf(e); if (a) this.equipHand(a, e.data || {}); });
        bus.subscribe('MMO_STOP_CAST', (e) => { const a = actorOf(e); if (a?.cast) this.cancelCast(a, 'Interrupted'); });
        bus.subscribe('MMO_RELEASE', (e) => { const a = actorOf(e); if (a) this.releaseSpirit(a); });
        bus.subscribe('MMO_USE_ITEM', (e) => { const a = actorOf(e); if (a) this.useItem(a, e.data?.item); });
        bus.subscribe('MMO_CANCEL_AURA', (e) => { const a = actorOf(e); if (a) this.cancelAura(a, e.data?.id); });
    }

    // ==================== GEOMETRY & RELATIONS ====================

    radiusOf(a) {
        if (a._radius == null) {
            const u = this.collections.units?.[a.unit];
            a._radius = Math.min(60, Math.max(14, (u?.size || 25) * 0.8));
        }
        return a._radius;
    }

    /** Edge-to-edge distance between two actors on the ground plane. */
    mmoDistance(a, b) {
        return Math.max(0, Math.hypot(a.x - b.x, a.z - b.z) - this.radiusOf(a) - this.radiusOf(b));
    }

    mmoIsEnemy(a, b) {
        if (!a || !b || a === b) return false;
        if (a.kind === 'npc' || b.kind === 'npc' || a.kind === 'node' || b.kind === 'node') return false;
        if ((a.kind === 'mob' && a.hostility === 'friendly') || (b.kind === 'mob' && b.hostility === 'friendly')) return false;      // a creature under truce
        return (a.kind === 'mob') !== (b.kind === 'mob');
    }

    isAttackable(attacker, target) {
        return this.mmoIsEnemy(attacker, target) && !target.dead && !target.evading;
    }

    isFriendlyTarget(a, b) {
        return !!b && !b.dead && b.kind === 'player' && a.kind === 'player';
    }

    /** Is `target` behind `a`? (a is behind target if it stands in target's rear arc) */
    isBehind(a, target) {
        const ang = Math.atan2(a.z - target.z, a.x - target.x);
        let d = ang - target.facing;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) > Math.PI * 0.6;
    }

    // ==================== STATS FROM AURAS ====================

    statSum(a, key) {
        let v = (a.talentStats?.[key] || 0) + (a.itemStats?.[key] || 0);       // talents and gear: permanent, invisible auras
        for (const aura of a.auras) {
            const s = aura.stats?.[key];
            if (s) v += s * (aura.stacks || 1);
        }
        return v;
    }

    hasStat(a, key) {
        return a.auras.some(x => x.stats?.[key]);
    }

    moveSpeedOf(a) {
        if (this.hasStat(a, 'stun') || (this.hasStat(a, 'root') && !a.traits?.has('fenwarden'))) return 0;
        // a bow drawn: you stand to shoot (the client holds you still; not 0 here, which reads as
        // stunned and would stop you turning to aim)
        if (a.drawing) return (a.speed || this.cfg.runSpeed) * 0.05;
        let ms = this.statSum(a, 'moveSpeed');
        if (a.traits?.has('fenwarden')) ms = Math.max(ms, a.itemStats?.moveSpeed || 0);       // nothing slows a Fenwarden
        const mult = Math.max(0.3, 1 + ms);
        const sprint = a.sprinting && this.stamOf(a) > 0 ? 1.5 : (a.blocking ? 0.55 : 1);
        const sneak = a.sneaking ? 0.55 * (1 + this.statSum(a, 'sneakMove')) : 1;
        return (a.speed || this.cfg.runSpeed) * mult * sneak * (a.swimming && !a.traits?.has('drowned') ? 0.6 : 1) * sprint;
    }

    attackSpeedMult(a) {
        return Math.max(0.3, 1 + this.statSum(a, 'attackSpeed'));
    }

    // ==================== COMBAT STATE ====================

    enterCombat(a, other) {
        const now = this.now();
        if (a.kind === 'player') a.combatUntil = now + this.cfg.combatDropTime;
        if (!a.inCombat) {
            a.inCombat = true;
            if (a.sitting) this.game.mmoWorldSystem?.setSitting(a, false);
        }
        if (other && a.kind === 'mob' && this.mmoIsEnemy(a, other)) {
            if (!a.threat) a.threat = new Map();
            if (!a.threat.has(other.id)) a.threat.set(other.id, 1);
            this.game.mmoMobSystem?.onMobEngaged(a, other);
        }
    }

    mmoAddThreat(mob, source, amount) {
        if (!mob || mob.kind !== 'mob' || mob.dead || mob.evading || !source || source.dead) return;
        if (!mob.threat) mob.threat = new Map();
        mob.threat.set(source.id, (mob.threat.get(source.id) || 0) + Math.max(0, amount));
        this.enterCombat(mob, source);
        this.enterCombat(source, mob);
    }

    /** First player (or their party) to damage a mob owns its loot and credit. */
    tap(mob, player) {
        if (mob.kind !== 'mob' || player.kind !== 'player' || mob.tapper != null) return;
        mob.tapper = player.id;
        mob.tapParty = this.game.mmoPartySystem?.partyIdOf(player) ?? null;
    }

    isTapAllowed(mob, viewer) {
        if (mob.tapper == null) return true;
        if (mob.tapper === viewer.id) return true;
        const pid = this.game.mmoPartySystem?.partyIdOf(viewer);
        return pid != null && pid === mob.tapParty;
    }

    // ==================== TARGETING & AUTO-ATTACK ====================

    setTarget(a, id) {
        const t = this.call.mmoActor(id);
        a.target = t ? t.id : null;
        if (!t || !this.mmoIsEnemy(a, t)) a.autoAttack = false;
    }

    toggleAutoAttack(a, on) {
        if (a.kind === 'player') return;                       // Kingdom: players swing with their hands (MMO_HAND)
        if (!on) { a.autoAttack = false; return; }
        const t = this.call.mmoActor(a.target);
        if (a.dead) return;
        if (!t || !this.isAttackable(a, t)) return this.error(a, 'Invalid target.');
        a.autoAttack = true;
        if (a.sitting) this.game.mmoWorldSystem?.setSitting(a, false);
        const now = this.now();
        if (a.swingAt < now) a.swingAt = now + 0.15;
    }

    updateSwing(a, now) {
        if (!a.autoAttack || a.dead) return;
        const t = this.call.mmoActor(a.target);
        if (!t || !this.isAttackable(a, t)) { a.autoAttack = false; return; }
        if (now < a.swingAt) return;
        if (this.hasStat(a, 'stun')) return;
        if (a.cast) return;                                   // casting pauses the swing timer
        if (a.gcdUntil > now) return;                         // so does the global cooldown
        const range = a.weapon.ranged ? Math.max(a.weapon.range, this.cfg.rangedRange) : this.cfg.meleeRange;
        if (this.mmoDistance(a, t) > range) return;           // waits in range; client shows the error

        const interval = a.weapon.speed / this.attackSpeedMult(a);
        a.swingAt = now + interval;
        a.facing = Math.atan2(t.z - a.z, t.x - a.x);
        const roll = a.weapon.min + Math.random() * (a.weapon.max - a.weapon.min);
        // How long the attack animation runs: a class's own attack length (a sword slash at its
        // natural pace; stretching it over a slow weapon's whole swing looks like slow motion),
        // else most of the swing.
        const own = a.char ? this.call.mmoClass(a.classId)?.doll?.attackTime : 0;
        const anim = own ? Math.min(interval * 0.9, own) : Math.min(interval, 2.4) * 0.9;
        this.call.mmoEmit({ t: 'swing', s: a.id, d: t.id, iv: +anim.toFixed(2) }, a.x, a.z);

        // The shot leaves (and a blow lands) partway into the attack animation, not as it starts.
        if (a.weapon.ranged) {
            this.later(anim * RpgCombatSystem.RANGED_RELEASE, () => {
                if (a.dead || !this.isAttackable(a, t)) return;
                const delay = this.travelTime(a, t);
                if (a.kind === 'mob') {                        // aimed at you as it's loosed: move, and it misses
                    const o = this.launchPoint(a, t), P = this.aimPointAt(a, t, o);
                    const v = RpgCombatSystem.MOB_ARROW_SPEED, g = RpgCombatSystem.ARROW_GRAVITY;
                    const { f, p } = this.solveArc(o, P, v, g);
                    this.launchShot(a, o, f, p, v, g, { fx: a.weapon.projectile || 'arrow', onHit: (hit) => this.weaponHit(a, hit, roll) });
                    return;
                }
                this.call.mmoEmit({ t: 'proj', s: a.id, d: t.id, fx: a.weapon.projectile || 'arrow', tt: delay }, a.x, a.z);
                this.later(delay, () => this.weaponHit(a, t, roll));
            });
        } else {
            this.later(anim * RpgCombatSystem.MELEE_IMPACT, () => this.weaponHit(a, t, roll));
        }
    }

    weaponHit(a, t, amount) {
        if (!this.isAttackable(a, t)) return;
        if (a.dead && !a.weapon.ranged) return;              // (an arrow already flying still lands)
        // a creature's blow lands only if you're still in reach and in front of it as it falls (step
        // back, or round it, and it whiffs)
        if (a.kind === 'mob' && !a.weapon.ranged && (this.mmoDistance(a, t) > this.cfg.meleeRange + 18 || !this.inFront(a, t, 1.0))) {
            this.call.mmoEmit({ t: 'dmg', s: a.id, d: t.id, v: 0, miss: 1 }, t.x, t.z);
            return;
        }
        this.mmoDealDamage(a, t, amount, 'physical', { swing: true, canMiss: a.kind !== 'mob' });
    }

    // ==================== HANDS (KINGDOM.md "Combat") ====================
    //
    // MMO_HAND { hand: 'right'|'left', down, f (aim yaw) }: the mouse buttons. Right hand: a melee
    // weapon swings on release (held POWER_HOLD, a power attack: x2, staggers, Stamina); a bow draws
    // while held and looses on release along the aim. Left hand: hold to block (bash with the right
    // while blocking).

    static POWER_HOLD = 0.55;
    static BOW_MIN_DRAW = 0.3;
    static BOW_FULL = 1.0;
    static BOW_RANGE = 1800;

    // ==================== SPELLS IN HANDS ====================
    //
    // A known spell with a `hand` kind can be readied in either hand (MMO_EQUIP_HAND; char.hands):
    //   bolt    charge, release: flies along the aim; the first thing in its path takes it
    //   stream  hold: every half second, a fraction of it (a cone of fire, a healing flow)
    //   ward    hold: its shield stands while Magicka lasts
    //   self    charge, release: on the ally under your crosshair, or yourself
    //   area    charge, release: around you (or round your target, for a targeted burst)
    //   target  charge, release: on the creature under your crosshair (if within reach)

    static STREAM_TICK = 0.5;

    equipHand(a, d) {
        const c = a.char, hand = d.hand === 'left' ? 'left' : 'right';
        if (!c) return;
        c.hands = c.hands || { right: null, left: null };
        if (d.spell) {
            const sp = this.call.mmoSpell(d.spell);
            if (!sp?.hand || !c.spells.includes(d.spell)) return this.error(a, 'You can\'t ready that.');
            c.hands[hand] = d.spell;
        } else c.hands[hand] = null;                                  // the weapon (right) or your guard (left)
        if (a.casting?.[hand]) this.stopHand(a, hand);
        a.ver++;
        this.call.mmoMarkDirty(a);
    }

    chargeTime(spell) { return Math.max(0.35, Math.min(1.0, (spell.castTime || 0) * 0.3)); }

    handCost(a, spell, frac = 1) {
        let cost = Math.round(this.call.mmoSpellCost(spell, a.level) * frac);
        if (a.resType === 'magicka') cost = Math.round(cost * Math.max(0.6, 1 - (this.call.mmoSkill(a.char, this.call.mmoSpellSkill(spell, a.char.equipment?.weapon, a.char.classId)) - 15) / 300) * Math.max(0.3, 1 - this.statSum(a, 'costReduce')));
        return cost;
    }

    /** Enough Magicka for a spell (or, under a Grave-Pact, enough Health to pay in blood)? */
    canAfford(a, cost) {
        if (a.res >= cost) return true;
        const gp = a.traits?.has('gravePact') && this.call.mmoTrait('gravePact');
        return !!gp && a.hp > cost * (gp.p?.rate || 1.5) + 1;
    }

    /** The first attackable thing along `a`'s aim within `range` (and how far along). */
    firstAlong(a, range, pad = 16) {
        const fx = Math.cos(a.facing), fz = Math.sin(a.facing);
        let hit = null, best = range;
        for (const o of this.call.mmoNearbyActors(a.x, a.z, range + 60, x => x !== a && !x.dead && this.isAttackable(a, x))) {
            const vx = o.x - a.x, vz = o.z - a.z, along = vx * fx + vz * fz;
            if (along <= 0 || along > best) continue;
            if (Math.abs(vx * fz - vz * fx) <= this.radiusOf(o) + pad) { hit = o; best = along; }
        }
        return { hit, along: best, end: { x: a.x + fx * best, z: a.z + fz * best } };
    }

    /** The ally a healing spell lands on: the player under your crosshair (near), else you. */
    friendlyAim(a, range = 900) {
        const t = this.call.mmoActor(a.target);
        return t && t.kind === 'player' && !t.dead && Math.hypot(t.x - a.x, t.z - a.z) <= range ? t : a;
    }

    spellRange(spell) { return typeof spell.range === 'number' && spell.range > 0 ? spell.range : this.cfg.rangedRange * 2.6; }

    handSpell(a, hand, spell, down) {
        const now = this.now();
        a.casting = a.casting || {};
        if (down) {
            if (this.hasStat(a, 'stun') || a.silencedUntil > now) return;
            if ((a.cooldowns[spell.id] || 0) > now) return this.error(a, `${spell.title} is not ready yet.`);
            if (spell.hand === 'ward') {
                const cost = this.handCost(a, spell, 0.5);
                if (!this.canAfford(a, cost)) return this.error(a, 'Not enough magicka.');
                this.pay(a, spell, cost);
                this.applyEffects(a, spell, a);
                a.casting[hand] = { spell, ward: true, next: now + 1 };
                this.call.mmoEmit({ t: 'spell', s: a.id, sp: spell.id, d: a.id, an: 'cast', fx: spell.fx?.cast || spell.fx?.impact || null }, a.x, a.z);
                return;
            }
            a.casting[hand] = { spell, start: now, next: now, stream: spell.hand === 'stream' };
            this.call.mmoEmit({ t: 'cast', s: a.id, sp: spell.id, dur: spell.hand === 'stream' ? 0.6 : this.chargeTime(spell), an: 'cast' }, a.x, a.z);
            return;
        }
        const c = a.casting[hand];
        if (!c) return;
        if (c.ward || c.stream) return this.stopHand(a, hand);
        delete a.casting[hand];
        this.call.mmoEmit({ t: 'castEnd', s: a.id, ok: true }, a.x, a.z);
        if (now - c.start < this.chargeTime(spell)) return;           // let go before it was ready
        this.releaseSpell(a, spell);
    }

    stopHand(a, hand) {
        const c = a.casting?.[hand];
        if (!c) return;
        delete a.casting[hand];
        if (c.ward) for (const e of c.spell.effects || []) if (e.aura?.id) this.cancelAura(a, e.aura.id);
        this.call.mmoEmit({ t: 'castEnd', s: a.id, ok: true }, a.x, a.z);
    }

    releaseSpell(a, spell) {
        const now = this.now(), cost = this.handCost(a, spell);
        if (!this.canAfford(a, cost)) return this.error(a, 'Not enough magicka.');
        let primary = null;
        if (spell.hand === 'target' || spell.hand === 'area' && spell.aoe?.center === 'target') {
            const t = this.call.mmoActor(a.target);
            if (!t || !this.isAttackable(a, t) || this.mmoDistance(a, t) > this.spellRange(spell)) return this.error(a, 'Aim at an enemy within reach.');
            primary = t;
        } else if (spell.hand === 'self') primary = spell.target === 'ally' ? this.friendlyAim(a) : a;
        else if (spell.hand === 'area') primary = spell.aoe?.allies ? a : a;
        this.pay(a, spell, cost);
        if (spell.cooldown) a.cooldowns[spell.id] = now + spell.cooldown;
        if (spell.hand === 'bolt') {                                    // flies along the aim; the first thing in its way takes it
            const S = RpgCombatSystem.BOLT_SPEED, o = this.launchPoint(a);
            this.call.mmoEmit({ t: 'spell', s: a.id, sp: spell.id, d: null, an: 'cast', fx: spell.fx?.cast || null }, a.x, a.z);
            this.launchShot(a, o, a.facing || 0, a.aimPitch || 0, S, 0, { fx: spell.fx?.projectile || 'arcaneBolt', sp: spell.id, maxT: this.spellRange(spell) / S,
                onHit: (hit) => this.resolveSpell(a, spell, hit, { landed: true, channelTick: true }) });
            return;
        }
        this.resolveSpell(a, spell, primary);
    }

    /** Held streams and wards: a tick of each, while the Magicka lasts. */
    updateHands(a, now) {
        for (const [hand, c] of Object.entries(a.casting || {})) {
            if (now < c.next) continue;
            if (c.ward) {
                c.next = now + 1;
                if (a.res < 6) { this.stopHand(a, hand); continue; }
                a.res -= 6;
                a.lastManaSpend = now;
                continue;
            }
            if (!c.stream) continue;
            c.next = now + RpgCombatSystem.STREAM_TICK;
            const cost = Math.max(1, this.handCost(a, c.spell, 0.15));
            if (!this.canAfford(a, cost)) { this.stopHand(a, hand); this.error(a, 'Not enough magicka.'); continue; }
            let t;
            if (c.spell.target === 'ally') t = this.friendlyAim(a);
            else t = this.firstAlong(a, 340, 40).hit;                   // a short cone: the nearest in front
            if (!t) continue;
            this.pay(a, c.spell, cost);
            this._scale = 0.4;
            try { this.resolveSpell(a, c.spell, t, { channelTick: true }); } finally { this._scale = 1; }
        }
    }

    /** Is `o` within `arc` radians either side of where `a` faces? */
    inFront(a, o, arc) {
        let d = Math.atan2(o.z - a.z, o.x - a.x) - (a.facing || 0);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) <= arc;
    }

    onHand(a, d) {
        if (a.kind !== 'player' || a.dead || a.flight) return;
        if (Number.isFinite(d.f)) a.facing = d.f;
        if (Number.isFinite(d.p)) a.aimPitch = Math.max(-1.2, Math.min(1.2, d.p));       // up/down along the crosshair
        if (d.target !== undefined && d.target !== a.target) this.setTarget(a, d.target);
        const now = this.now();
        const held = a.char?.hands?.[d.hand === 'left' ? 'left' : 'right'], hs = held && this.call.mmoSpell(held);
        if (hs?.hand) return this.handSpell(a, d.hand === 'left' ? 'left' : 'right', hs, !!d.down);
        if (d.hand === 'left') {
            if (a.offWeapon) {                                        // two weapons: the left swings too (and there's no guard)
                if (d.down) { if (this.hasStat(a, 'stun') || a.cast) return; a.chargingL = true; a.chargeStartL = now; }
                else if (a.chargingL) { a.chargingL = false; this.melee(a, false, 'left'); }
                return;
            }
            a.blocking = !!d.down && !a.weapon.ranged && !this.hasStat(a, 'stun') && !a.traits?.has('glassEdge');
            a.ver++;
            return;
        }
        if (d.down) {
            if (a.blocking) return this.bash(a);
            if (this.hasStat(a, 'stun') || a.cast) return;
            if (a.weapon.ranged) {
                if (now < (a.nextAttackAt || 0)) return;
                a.drawing = true; a.drawStart = now;
                this.call.mmoEmit({ t: 'draw', s: a.id, dur: RpgCombatSystem.BOW_FULL }, a.x, a.z);   // the string pulled back
                return;
            }
            a.charging = true; a.chargeStart = now;
        } else {
            if (a.drawing) { a.drawing = false; return this.loose(a, now - a.drawStart); }
            if (a.charging) { a.charging = false; this.melee(a, false); }
        }
    }

    /**
     * A melee swing (or a power attack): whatever is in the arc in front when the blow falls.
     * hand: 'right' (the weapon), 'left' (a second weapon) or 'both' (two weapons' power attack:
     * both strike, for more Stamina).
     */
    melee(a, power, hand = 'right') {
        const now = this.now();
        const L = hand === 'left', both = hand === 'both', timer = L ? 'nextAttackAtL' : 'nextAttackAt';
        const W = L ? a.offWeapon : a.weapon;
        if (a.dead || !W || now < (a[timer] || 0) || (both && now < (a.nextAttackAtL || 0))) return;
        if (power && this.stamOf(a) < 15) power = false;
        const own = this.call.mmoClass(a.classId)?.doll?.attackTime || 0.7;
        const speed = (W.speed || 2) / this.attackSpeedMult(a);
        const anim = Math.min(speed * 0.8, own) * (power ? 1.25 : 1);
        a[timer] = now + Math.max(anim * 0.75, speed * 0.35);              // swings chain (Skyrim: tap, tap, tap)
        if (both) a.nextAttackAtL = a.nextAttackAt;
        if (power) this.spendStam(a, (both ? 35 : 25) * this.stamCostMult(a, true));
        const lunge = power && a.traits?.has('windDancer') && now - (a.lastSprintAt || -9) < 1;          // (Wind Dancer)
        // a combo: swings close together run on through the attack set (a power attack: the last, heaviest)
        const ck = L ? 'combo3L' : 'combo3', lk = L ? 'lastSwingAtL' : 'lastSwingAt';
        // axes and maces chop: their combo skips the set's thrust (the first swing) and runs on the
        // two cuts; blades thrust, slash, slash
        const wt = a.char ? (this.call.mmoWeaponType(L ? a.char.equipment?.offhand : a.char.equipment?.weapon) || 'none') : null;
        const chain = now - (a[lk] || 0) < anim * 1.9;
        a[ck] = power ? 2 : (chain ? ((a[ck] || 0) + 1) % 3 : 0);
        a[lk] = now;
        // what the clip is chosen by (MmoClientSystem.swingClip): the weapon's type, a power attack, a run-up
        this.call.mmoEmit({ t: 'swing', s: a.id, d: a.target ?? null, iv: +anim.toFixed(2), cb: a[ck], ...(L ? { h: 'l' } : both ? { h: 'b' } : {}),
            ...(wt ? { wt } : {}), ...(power ? { pw: 1 } : {}), ...(power && now - (a.lastSprintAt || -9) < 0.6 ? { sp: 1 } : {}) }, a.x, a.z);
        const sweep = power && !L && this.call.mmoWeaponSkill(a.char?.equipment?.weapon, a.char?.classId) === 'twoHanded';
        const strikes = both ? [a.weapon, a.offWeapon].filter(Boolean) : [W];
        this.later(anim * RpgCombatSystem.MELEE_IMPACT, () => {
            if (a.dead || this.hasStat(a, 'stun')) return;
            const reach = this.cfg.meleeRange + (power ? 20 : 8) + (W.reach || 0), arc = power ? 1.1 : 0.85;
            const hits = [];
            for (const o of this.call.mmoNearbyActors(a.x, a.z, reach + 140, x => x !== a && !x.dead && this.isAttackable(a, x))) {
                const dist = this.mmoDistance(a, o);
                if (dist <= reach && this.inFront(a, o, arc)) hits.push({ o, dist });
            }
            hits.sort((p, q) => p.dist - q.dist);
            for (const { o } of sweep ? hits : hits.slice(0, 1)) {
                const lungeMult = lunge ? 1 + (this.call.mmoTrait('windDancer')?.p?.lunge || 0) : 1;
                for (const sw of strikes) {
                    if (o.dead) break;
                    const roll = sw.min + Math.random() * (sw.max - sw.min);
                    this.mmoDealDamage(a, o, roll * (power ? 2 : 1) * lungeMult, 'physical', { swing: true, ...(sw === a.offWeapon ? { skill: 'oneHanded', hand: 'left' } : {}) });
                }
                if (power && !o.dead) this.mmoApplyAura(o, { id: 'staggered', title: 'Staggered', icon: 'stun', debuff: true, duration: 0.6 * (a.traits?.has('oathbreaker') ? (this.call.mmoTrait('oathbreaker')?.p?.stagger || 2) : 1), stats: { stun: 1 } }, a, a.level);
            }
            if (power && a.traits?.has('earthshaker')) {                     // the ground itself staggers them
                const p = this.call.mmoTrait('earthshaker')?.p || {};
                for (const o of this.call.mmoNearbyActors(a.x, a.z, p.radius || 170, x => x !== a && !x.dead && this.isAttackable(a, x)))
                    this.mmoApplyAura(o, { id: 'staggered', title: 'Staggered', icon: 'stun', debuff: true, duration: p.stagger || 1.5, stats: { stun: 1 } }, a, a.level);
                this.call.mmoEmit({ t: 'fx', fx: 'ground_slam', x: a.x, z: a.z }, a.x, a.z);
            }
        });
    }

    // An arrow is a real flight: launched along the crosshair (yaw and pitch) at a speed set by the
    // draw, falling under gravity. A half-drawn shot drops short; a full draw flies flat and far.
    // The first creature its path passes through (or the ground) stops it.
    static ARROW_SPEED = [450, 2300];      // at no draw, at full draw (units/s)
    static ARROW_GRAVITY = 750;
    static ARROW_LAUNCH_Y = 40;            // the bow, above the archer's feet

    heightOf(o) { return Math.max(40, (this.collections.units?.[o.unit]?.height || 52) * (o.scale || 1)); }

    // ==================== LIVE SHOTS ====================
    //
    // Arrows and spell projectiles (everyone's) are flown tick by tick (updateShots) against where
    // things are *now*: step out of an arrow's path and it misses you. Each is sent once ('arrow':
    // origin, velocity, gravity) for clients to fly the same arc, and 'shotEnd' says where it
    // stopped (and on whom).

    static MOB_ARROW_SPEED = 1500;
    static BOLT_SPEED = 1250;              // spell projectiles: straight, no fall

    /** Where a shot leaves `a` (a little ahead of it, about chest-high). */
    launchPoint(a, toward = null) {
        const f = toward ? Math.atan2(toward.z - a.z, toward.x - a.x) : (a.facing || 0);
        return { x: a.x + Math.cos(f) * 12, y: this.call.mmoGroundY(a.x, a.z) + Math.min(70, this.heightOf(a) * 0.65), z: a.z + Math.sin(f) * 12 };
    }

    /** A creature's aim at `t`: its chest, off by a spread that grows with range (they aren't perfect). */
    aimPointAt(a, t, o) {
        const d = Math.hypot(t.x - o.x, t.z - o.z), spread = Math.min(40, d * 0.03);
        const ang = Math.random() * Math.PI * 2, r = Math.random() * spread;
        return { x: t.x + Math.cos(ang) * r, y: this.call.mmoGroundY(t.x, t.z) + this.heightOf(t) * 0.6, z: t.z + Math.sin(ang) * r };
    }

    /** Launch yaw and pitch putting a shot of speed v (gravity g) through P: the low arc, else straight at it. */
    solveArc(o, P, v, g) {
        const h = Math.max(1, Math.hypot(P.x - o.x, P.z - o.z)), dy = P.y - o.y, f = Math.atan2(P.z - o.z, P.x - o.x);
        if (!g) return { f, p: Math.atan2(dy, h) };
        const v2 = v * v, disc = v2 * v2 - g * (g * h * h + 2 * dy * v2);
        return { f, p: disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * h)) : Math.atan2(dy, h) };
    }

    /** Loose a live shot from `o` along yaw f / pitch p. opts: { fx, sp, onHit(hit, pos), maxT } */
    launchShot(a, o, f, p, speed, g, opts = {}) {
        const v = { x: Math.cos(f) * Math.cos(p) * speed, y: Math.sin(p) * speed, z: Math.sin(f) * Math.cos(p) * speed };
        const shot = { id: (this._shotSeq = (this._shotSeq || 0) + 1), a, o, v, g, t: 0, x: o.x, y: o.y, z: o.z, maxT: opts.maxT || 3, ...opts };
        (this._shots ||= []).push(shot);
        const r = (n) => Math.round(n * 10) / 10;
        this.call.mmoEmit({ t: 'arrow', id: shot.id, s: a.id, o: [r(o.x), r(o.y), r(o.z)], v: [r(v.x), r(v.y), r(v.z)], g, fx: opts.fx || 'arrow', sp: opts.sp, mt: +shot.maxT.toFixed(2) }, a.x, a.z);
        return shot;
    }

    updateShots(dt) {
        if (!this._shots?.length) return;
        this._shots = this._shots.filter(sh => {
            const t1 = Math.min(sh.maxT, sh.t + dt);
            const nx = sh.o.x + sh.v.x * t1, ny = sh.o.y + sh.v.y * t1 - 0.5 * sh.g * t1 * t1, nz = sh.o.z + sh.v.z * t1;
            const { x, y, z } = sh;
            let blockK = null;
            const n = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y, nz - z) / 10));
            for (let i = 1; i <= n; i++) {
                const k = i / n, px = x + (nx - x) * k, py = y + (ny - y) * k, pz = z + (nz - z) * k;
                const gy = this.call.mmoGroundY(px, pz);
                if ((Number.isFinite(gy) && py <= gy) || this.call.mmoShotBlocked(px, py, pz)) { blockK = k; break; }
            }
            const segLen = Math.hypot(nx - x, nz - z);
            let best = null;
            for (const c of this.call.mmoNearbyActors((x + nx) / 2, (z + nz) / 2, segLen / 2 + 80, o => o !== sh.a && !o.dead && this.isAttackable(sh.a, o))) {
                const sx = nx - x, sz = nz - z, L2 = sx * sx + sz * sz || 1;
                const k = Math.max(0, Math.min(1, ((c.x - x) * sx + (c.z - z) * sz) / L2));
                if ((blockK != null && k > blockK) || (best && k >= best.k)) continue;
                const px = x + sx * k, pz = z + sz * k, py = y + (ny - y) * k, cy = this.call.mmoGroundY(c.x, c.z);
                if (Math.hypot(c.x - px, c.z - pz) <= this.radiusOf(c) + 4 && py >= cy - 4 && py <= cy + this.heightOf(c) + 6) best = { c, k, px, py, pz };
            }
            const end = (pos, hit) => {
                this.call.mmoEmit({ t: 'shotEnd', id: sh.id, x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z), d: hit?.id }, pos.x, pos.z);
                if (hit) { try { sh.onHit?.(hit, pos); } catch (e) { console.error('[combat] shot hit failed', e); } }
                return false;
            };
            if (best) return end({ x: best.px, y: best.py, z: best.pz }, best.c);
            if (blockK != null) return end({ x: x + (nx - x) * blockK, y: y + (ny - y) * blockK, z: z + (nz - z) * blockK }, null);
            sh.t = t1; sh.x = nx; sh.y = ny; sh.z = nz;
            if (t1 >= sh.maxT) return end(sh, null);
            return true;
        });
    }

    /** How far a straight, chest-high shot from `a` toward (x, z) gets before a wall, tree or rock (null: clear). */
    shotWall(a, x, z, h = 40) {
        const dist = Math.hypot(x - a.x, z - a.z), y0 = this.call.mmoGroundY(a.x, a.z) + h, y1 = this.call.mmoGroundY(x, z) + h;
        for (let d = 14; d < dist; d += 12) {
            const k = d / dist;
            if (this.call.mmoShotBlocked(a.x + (x - a.x) * k, y0 + (y1 - y0) * k, a.z + (z - a.z) * k)) return d;
        }
        return null;
    }

    /** Let an arrow fly where you aim, at the strength of the draw. */
    loose(a, held) {
        const now = this.now();
        if (a.dead || held < RpgCombatSystem.BOW_MIN_DRAW || now < (a.nextAttackAt || 0)) {
            this.call.mmoEmit({ t: 'castEnd', s: a.id, ok: false }, a.x, a.z);                     // let down unshot
            return;
        }
        const pull = Math.min(1, held / RpgCombatSystem.BOW_FULL);
        a.nextAttackAt = now + 0.2;
        const [s0, s1] = RpgCombatSystem.ARROW_SPEED, g = RpgCombatSystem.ARROW_GRAVITY;
        const speed = (s0 + (s1 - s0) * pull) * (a.traits?.has('windwhisper') ? 1 + (this.call.mmoTrait('windwhisper')?.p?.speed || 0) : 1);
        const p = a.aimPitch || 0, f = a.facing || 0;
        const o = { x: a.x + Math.cos(f) * 12, y: this.call.mmoGroundY(a.x, a.z) + RpgCombatSystem.ARROW_LAUNCH_Y, z: a.z + Math.sin(f) * 12 };
        this.call.mmoEmit({ t: 'loose', s: a.id }, a.x, a.z);
        const roll = a.weapon.min + Math.random() * (a.weapon.max - a.weapon.min);
        this.launchShot(a, o, f, p, speed, g, { fx: a.weapon.projectile || 'arrow', onHit: (hit) => {
            if (!hit.dead && this.isAttackable(a, hit)) this.mmoDealDamage(a, hit, roll * (0.35 + 0.65 * pull) * (pull >= 1 ? 1.15 : 1), 'physical', { swing: true, arrow: true, draw: pull });
        } });
    }

    /** Shove with the guard up: a short stagger for the one in front (Stamina). */
    bash(a) {
        const now = this.now();
        if (now < (a.nextAttackAt || 0) || this.stamOf(a) < 15) return;
        a.nextAttackAt = now + 0.8;
        this.spendStam(a, 15 * this.stamCostMult(a, true));
        this.call.mmoEmit({ t: 'swing', s: a.id, d: null, iv: 0.45, bash: 1 }, a.x, a.z);
        const t = this.call.mmoNearbyActors(a.x, a.z, this.cfg.meleeRange + 140, x => x !== a && !x.dead && this.isAttackable(a, x))
            .filter(o => this.mmoDistance(a, o) <= this.cfg.meleeRange + 10 && this.inFront(a, o, 0.9))
            .sort((p, q) => this.mmoDistance(a, p) - this.mmoDistance(a, q))[0];
        if (!t) return;
        this.mmoDealDamage(a, t, Math.max(a.weapon.min * 0.5, (a.shield?.armor || 0) * 0.3), 'physical', { swing: true, skill: 'block' });     // a shield hits harder
        if (!t.dead) this.mmoApplyAura(t, { id: 'staggered', title: 'Staggered', icon: 'stun', debuff: true, duration: a.traits?.has('oathkeeper') ? (this.call.mmoTrait('oathkeeper')?.p?.bash || 2) : 0.9, stats: { stun: 1 } }, a, a.level);
    }

    travelTime(a, t) {
        return Math.min(0.9, Math.hypot(t.x - a.x, t.z - a.z) / 1100);
    }

    later(delay, fn) {
        this._pending.push({ at: this.now() + delay, fn });
    }

    // ==================== DAMAGE & HEALING ====================

    /**
     * opts: { spellId, crit (bool|undefined to roll), isDot, swing, canMiss,
     *         threatMult, school }
     * Returns the damage dealt (after mitigation and absorbs).
     */
    mmoDealDamage(src, tgt, amount, school = 'physical', opts = {}) {
        if (!tgt || tgt.dead || tgt.evading) return 0;
        const now = this.now();

        if (opts.canMiss && Math.random() < this.cfg.missChance + Math.max(0, (tgt.level - src.level)) * 0.01) {
            this.call.mmoEmit({ t: 'dmg', s: src.id, d: tgt.id, v: 0, miss: 1, sp: opts.spellId || null }, tgt.x, tgt.z);
            this.enterCombat(src, tgt); this.enterCombat(tgt, src);
            if (tgt.kind === 'mob') this.mmoAddThreat(tgt, src, 1);
            return 0;
        }

        // Lucky: some blows aimed at you simply miss
        if (tgt.traits?.has('lucky') && !opts.isDot && !opts.proc && src !== tgt && Math.random() < (this.call.mmoTrait('lucky')?.p?.miss || 0)) {
            this.call.mmoEmit({ t: 'dmg', s: src.id, d: tgt.id, v: 0, miss: 1, sp: opts.spellId || null }, tgt.x, tgt.z);
            this.enterCombat(src, tgt); this.enterCombat(tgt, src);
            return 0;
        }

        let dmg = amount;
        let skill = null;
        if (src.kind === 'player' && src.char && !opts.proc) {
            const weap = src.char.equipment?.weapon;
            skill = opts.skill || (opts.spellId ? this.call.mmoSpellSkill(this.call.mmoSpell(opts.spellId), weap, src.char.classId) : this.call.mmoWeaponSkill(weap, src.char.classId));
            dmg *= this.call.mmoSkillMult(src.char, skill) * (1 + this.statSum(src, 'skill_' + skill));    // the skill, and gear that fortifies it
        }
        // a sneak attack: a sneaking player's first blow on a creature that hasn't noticed them
        const unaware = tgt.kind === 'mob' && !tgt.threat?.size;
        const sneakAttack = src.kind === 'player' && src.sneaking && unaware && !opts.isDot && !opts.proc;
        let blocked = false;
        if (tgt.blocking && tgt.char && school === 'physical' && !opts.isDot && this.inFront(tgt, src, 1.3) && this.stamOf(tgt) > 0) {
            // a raised guard: frontal blows lose (40% + Block skill) of their force, and cost Stamina to take;
            // a shield turns more (its own block instead of the 40%) for less Stamina
            const majors = this.call.mmoClass(tgt.char.classId)?.majorSkills || [];
            const mit = Math.max(0, Math.min(0.9, ((tgt.shield?.block ?? 0.4) + this.call.mmoSkill(tgt.char, 'block') * 0.004 + (majors.includes('block') ? 0.1 : 0)) * (1 + this.statSum(tgt, 'skill_block')) + this.statSum(tgt, 'blockPct')));
            dmg *= 1 - mit;
            if (!tgt.traits?.has('oathkeeper')) this.spendStam(tgt, (4 + dmg * 0.25) * (tgt.shield ? 0.6 : 1));
            blocked = true;
            if (tgt.traits?.has('bulwark') && src.kind === 'mob' && !src.dead)          // (Bulwark) the blow rebounds
                this.mmoApplyAura(src, { id: 'staggered', title: 'Staggered', icon: 'stun', debuff: true, duration: this.tp('bulwark').stagger || 1, stats: { stun: 1 } }, tgt, tgt.level);
        } else if (tgt.blocking && tgt.char && school !== 'physical' && !opts.isDot && tgt.traits?.has('spellward') && this.inFront(tgt, src, 1.3) && this.stamOf(tgt) > 0) {
            dmg *= 1 - this.tp('spellward').turn;                    // (Spellward) the shield turns spells too
            this.spendStam(tgt, 4 + dmg * 0.25);
            blocked = true;
        }
        dmg *= 1 + this.statSum(src, 'damageDone') + (src.power || 0);
        dmg *= Math.max(0, 1 + this.statSum(tgt, 'damageTaken'));
        if (src.traits?.size) dmg *= this.traitsOut(src, tgt, school, opts, sneakAttack);
        if (tgt.traits?.size) dmg *= this.traitsIn(src, tgt);
        if (school !== 'physical') dmg *= 1 - Math.min(0.85, this.statSum(tgt, 'resist_' + school) + this.statSum(tgt, 'resist_magic'));
        if (school === 'physical' && !opts.isDot) {
            const armor = Math.max(0, tgt.armor * (1 + this.statSum(tgt, 'armorPct')) * (1 - Math.min(0.9, this.statSum(src, 'armorPen'))));
            const dr = armor / (armor + 400 + 85 * src.level);
            dmg *= 1 - Math.min(0.75, dr);
        }
        // Deadeye: a full draw on one who hasn't seen you never misses its mark
        const deadeye = opts.arrow && opts.draw >= 1 && unaware && src.traits?.has('deadeye');
        const crit = opts.crit ?? (deadeye || (!opts.isDot && !opts.proc && Math.random() < this.cfg.critChance + this.statSum(src, 'critChance')));
        if (crit) dmg *= this.cfg.critMultiplier + this.statSum(src, 'critMult');
        if (sneakAttack) {
            dmg *= RpgCombatSystem.SNEAK_ATTACK + (this.call.mmoSkill(src.char, 'sneak') - 15) / 85 + this.statSum(src, 'sneakMult');     // up to x3.5 for a master; daggers more
            this.call.mmoSkillUse(src, 'sneak', 4);
        }
        dmg = Math.max(1, Math.round(dmg));

        // Absorb shields
        let absorbed = 0;
        for (const aura of tgt.auras) {
            if (!aura.absorbLeft || dmg <= 0) continue;
            const take = Math.min(aura.absorbLeft, dmg);
            aura.absorbLeft -= take;
            dmg -= take;
            absorbed += take;
            if (aura.absorbLeft <= 0) aura.expires = now;   // expire next tick
        }

        tgt.hp = Math.max(0, tgt.hp - dmg);
        tgt.lastHitSchool = school;

        this.call.mmoEmit({
            t: 'dmg', s: src.id, d: tgt.id, v: dmg, sc: school,
            c: crit ? 1 : 0, ab: absorbed || undefined, sp: opts.spellId || null, dot: opts.isDot ? 1 : 0, sn: sneakAttack ? 1 : undefined, bl: blocked ? 1 : undefined
        }, tgt.x, tgt.z);
        // practice: a swing trains its weapon skill (spells train on casting); a blow taken trains
        // the armor worn, a blow turned trains Block
        if (dmg > 0 && skill && opts.swing) this.call.mmoSkillUse(src, skill, 1);
        if (tgt.kind === 'player' && tgt.char && !opts.isDot && src.kind === 'mob') {
            const armor = this.call.mmoArmorSkill(tgt.char.equipment);
            if (armor) this.call.mmoSkillUse(tgt, armor, 0.6);
            if (blocked) this.call.mmoSkillUse(tgt, 'block', 1.5);
        }

        // Combat bookkeeping
        this.enterCombat(src, tgt);
        this.enterCombat(tgt, src);
        if (src.kind === 'player' && tgt.kind === 'mob') this.tap(tgt, src);
        if (tgt.kind === 'mob') this.mmoAddThreat(tgt, src, (dmg + absorbed) * (opts.threatMult || 1));
        if (dmg > 0) {
            tgt.auras = tgt.auras.filter(x => !(x.breakOnDamage && now - x.appliedAt > 0.2) && !x.seated);
            if (tgt.sitting) this.game.mmoWorldSystem?.setSitting(tgt, false);
        }

        // Rage from dealing (auto-attack) and taking damage
        const conv = (L) => 0.0091 * L * L + 3.23 * L + 4.27;


        // what a blow sets off: enchantments, bleeding, traits (not from a DoT or another proc)
        if (dmg > 0 && !opts.isDot && !opts.proc) this.afterHit(src, tgt, dmg, school, opts, skill);

        if (tgt.hp <= 0) this.mmoKill(tgt, src);
        return dmg;
    }

    // ==================== GEAR: ENCHANTMENTS AND TRAITS ====================
    // (tools/content/gear.mjs writes the numbers: data/traits, data/gearRules; KINGDOM.md "Gear")

    /** The always-on stats a unique's trait gives (folded into itemStats by mmoRecalcStats). */
    traitStats(id, p) {
        switch (id) {
            case 'ambusher': return { sneakMult: p.sneak };
            case 'frenzy': return { damageTaken: p.taken };
            case 'glassEdge': return { critChance: p.crit, critMult: p.critMult };
            case 'windDancer': return { moveSpeed: p.move, sprintCost: p.sprint };
            case 'reaver': return { bleed: p.bleed };
            case 'earthshaker': return { attackSpeed: -p.slow };
            case 'oathkeeper': return { damageDone: p.dmg };
            case 'windwhisper': return { armorPen: p.pen };
            case 'gravePact': return { skill_destruction: p.destro };
            case 'overcharge': return { skill_destruction: p.destro, costReduce: -p.cost };
            case 'sunwell': return { healthPct: p.health };
            case 'dawn': return { skill_restoration: p.resto };
            case 'lucky': return { critChance: p.crit };
            case 'fenwarden': return { resist_nature: p.poison };
            case 'colossus': return { healthPct: p.health };
            case 'abbotsGrace': return { skill_restoration: p.resto };
            case 'cinderforged': return { resist_fire: p.fire };
            case 'drakebane': return { resist_fire: p.fire };
            case 'gravewarden': return { resist_shadow: p.shadow };
            case 'outlaw': return { skill_sneak: p.sneak, sneakMove: p.move };
            case 'oathbreaker': return { blockPct: p.block };
            case 'glassMask': return { sneakHide: p.hide };
            case 'spellward': return { resist_magic: p.magic };
            default: return {};
        }
    }

    tp(id) { return this.call.mmoTrait(id)?.p || {}; }
    static DRAKE = /drake|dragon|wyrm|redfang/i;
    static UNDEAD = /hollow|dead|wight|skelet|ghost|grave|barrow|kneeler|wraith|crypt|bone|ninth rank|lich|revenant/i;

    /** Damage `src` deals, by its traits. */
    traitsOut(src, tgt, school, opts, sneakAttack) {
        const T = src.traits;
        let m = 1;
        if (T.has('ambusher') && !sneakAttack && !opts.isDot && !opts.proc && !opts.spellId) m *= 1 + this.tp('ambusher').open;
        if (T.has('defiance') && src.hp / src.maxHp < this.tp('defiance').below) m *= 1 + this.tp('defiance').dmg;
        if (T.has('drakeblood') && tgt.auras.some(x => x.id === 'burning')) m *= 1 + this.tp('drakeblood').vsBurning;
        if (T.has('reaver') && tgt.auras.some(x => x.id === 'bleeding')) m *= 1 + this.tp('reaver').vsBleeding;
        if (T.has('pretender') && tgt.elite) m *= 1 + this.tp('pretender').dmg;
        if (T.has('drakebane') && RpgCombatSystem.DRAKE.test(tgt.name || '')) m *= 1 + this.tp('drakebane').dmg;
        if (T.has('gravewarden') && RpgCombatSystem.UNDEAD.test(tgt.name || '')) m *= 1 + this.tp('gravewarden').dmg;
        if (T.has('bloodrage')) m *= 1 + (1 - src.hp / Math.max(1, src.maxHp)) * this.tp('bloodrage').per;
        if (T.has('lastEmber') && school === 'fire') m *= 1 + this.tp('lastEmber').fire;
        if (T.has('stormcaller') && school === 'frost') m *= 1 + this.tp('stormcaller').frost;
        if (T.has('dawn') && school === 'holy') m *= 1 + this.tp('dawn').holy;
        if (T.has('deadeye') && opts.arrow && opts.draw < 1) m *= 1 + this.tp('deadeye').weak;
        if (src.kind === 'player') {                                   // a Warbanner near you (yours, or a party member's)
            const party = this.game.mmoPartySystem?.membersOf(src) || [src];
            const wb = party.find(x => x && !x.dead && x.traits?.has('warbanner') && Math.hypot(x.x - src.x, x.z - src.z) <= this.tp('warbanner').radius);
            if (wb) m *= 1 + this.tp('warbanner').dmg;
        }
        return m;
    }

    /** Damage `tgt` takes, by its traits. */
    traitsIn(src, tgt) {
        const T = tgt.traits;
        let m = 1;
        if (T.has('pretender') && src.elite) m *= 1 - this.tp('pretender').taken;
        if (T.has('drakebane') && RpgCombatSystem.DRAKE.test(src.name || '')) m *= 1 - this.tp('drakebane').taken;
        if (T.has('watchful') && this.isBehind(src, tgt)) m *= 1 - this.tp('watchful').behind;
        return m;
    }

    /** What a landed blow sets off: the weapon's enchantments and bleeding, and traits on either side. */
    afterHit(src, tgt, dmg, school, opts, skill) {
        const weaponHit = opts.swing && skill !== 'block';
        const proc = (amount, sch) => !tgt.dead && this.mmoDealDamage(src, tgt, amount, sch, { proc: true });
        const L = src.level;
        if (weaponHit) {
            const v = (k) => this.statSum(src, k);
            if (v('fireHit')) proc(v('fireHit'), 'fire');
            if (v('frostHit')) {
                proc(v('frostHit'), 'frost');
                if (!tgt.dead) this.mmoApplyAura(tgt, { id: 'chilled', title: 'Chilled', icon: 'frostbolt', debuff: true, duration: 3, stats: { moveSpeed: -0.3 } }, src, L);
            }
            if (v('shockHit')) {
                proc(v('shockHit'), 'shock');
                const arc = this.call.mmoNearbyActors(tgt.x, tgt.z, 250, o => o !== tgt && o !== src && !o.dead && this.isAttackable(src, o))[0];
                if (arc) this.mmoDealDamage(src, arc, v('shockHit') * 0.5, 'shock', { proc: true });
            }
            if (v('drainHit')) { proc(v('drainHit'), 'shadow'); src.hp = Math.min(src.maxHp, src.hp + v('drainHit')); }
            if (v('staminaHit')) this.gainStam(src, v('staminaHit'));
            if (v('paralyzeHit') && !tgt.dead && Math.random() < v('paralyzeHit'))
                this.mmoApplyAura(tgt, { id: 'paralyzed', title: 'Paralyzed', icon: 'stun', debuff: true, duration: 2, stats: { stun: 1 } }, src, L);
            if (v('bleed') && !tgt.dead)
                this.mmoApplyAura(tgt, { id: 'bleeding', title: 'Bleeding', icon: 'sword_blood', debuff: true, duration: 5, interval: 1, dot: { school: 'physical', total: dmg * v('bleed') } }, src, L);
        }
        const T = src.traits;
        if (T?.size) {
            if (weaponHit && T.has('drakeblood') && !tgt.dead)
                this.mmoApplyAura(tgt, { id: 'burning', title: 'Burning', icon: 'fireball', debuff: true, duration: 4, interval: 1, dot: { school: 'fire', total: dmg * this.tp('drakeblood').burn } }, src, L);
            if (T.has('defiance') && src.hp / src.maxHp < this.tp('defiance').below) src.hp = Math.min(src.maxHp, src.hp + dmg * this.tp('defiance').leech);
            if (T.has('spellsword')) {
                if (weaponHit && src.resType === 'magicka') src.res = Math.min(src.resMax, src.res + src.resMax * this.tp('spellsword').magicka);
                if (opts.spellId) this.gainStam(src, (src.spMax || src.resMax) * this.tp('spellsword').stamina);
            }
            if (T.has('thornroot') && opts.arrow && opts.draw >= 1 && !tgt.dead)
                this.mmoApplyAura(tgt, { id: 'thornroot', title: 'Rooted', icon: 'entangle', debuff: true, duration: this.tp('thornroot').root, stats: { root: 1 } }, src, L);
            if (T.has('stormcaller') && school === 'frost' && opts.spellId && !tgt.dead)
                this.mmoApplyAura(tgt, { id: 'chilled', title: 'Chilled', icon: 'frostbolt', debuff: true, duration: 3, stats: { moveSpeed: -this.tp('stormcaller').slow } }, src, L);
        }
        const D = tgt.traits;
        if (D?.size && !tgt.dead) {
            if (D.has('cinderforged') && opts.swing && !opts.arrow && !src.weapon?.ranged && src !== tgt)
                this.mmoDealDamage(tgt, src, dmg * this.tp('cinderforged').thorns, 'fire', { proc: true });
            if (D.has('secondWind') && tgt.hp / tgt.maxHp < this.tp('secondWind').below && this.now() >= (tgt.secondWindAt || 0)) {
                tgt.secondWindAt = this.now() + (this.tp('secondWind').cd || 60);
                this.mmoApplyAura(tgt, { id: 'secondWind', title: 'Second Wind', icon: 'holyShield', duration: 10, absorb: { total: tgt.maxHp * this.tp('secondWind').shield } }, tgt, tgt.level);
                this.call.mmoToast(tgt, 'Second Wind!', 'info');
            }
        }
    }

    /** A kill's rewards for the killer's traits. */
    traitsOnKill(victim, killer) {
        const T = killer?.traits;
        if (!T?.size) return;
        if (T.has('frenzy')) {
            const p = this.tp('frenzy');
            this.mmoApplyAura(killer, { id: 'frenzy', title: 'Frenzy', icon: 'berserkerRage', duration: p.dur || 10, maxStacks: p.stacks || 5, stats: { damageDone: p.per, attackSpeed: p.per } }, killer, killer.level);
        }
        if (T.has('soulSiphon')) {
            const p = this.tp('soulSiphon');
            if (killer.resType === 'magicka') killer.res = Math.min(killer.resMax, killer.res + killer.resMax * p.magicka);
            killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * p.health);
        }
        if (T.has('lastEmber') && victim.lastHitSchool === 'fire') {          // the pyre spreads
            const p = this.tp('lastEmber');
            this.call.mmoEmit({ t: 'fx', fx: 'explosion_fire', x: victim.x, z: victim.z }, victim.x, victim.z);
            for (const o of this.call.mmoNearbyActors(victim.x, victim.z, p.radius || 220, x => x !== victim && !x.dead && this.isAttackable(killer, x)))
                this.mmoDealDamage(killer, o, victim.maxHp * p.burst, 'fire', { proc: true });
        }
    }

    gainStam(a, n) {
        if (a.resType === 'stamina') a.res = Math.min(a.resMax, a.res + n);
        else if (a.spMax) a.sp = Math.min(a.spMax, (a.sp ?? 0) + n);
    }

    /** What a power attack, bash or sprint costs, after gear (and its traits). */
    stamCostMult(a, power) {
        let m = 1 - this.statSum(a, 'staminaCost');
        if (power && a.traits?.has('oathbreaker')) m -= this.tp('oathbreaker').cost;
        if (!power) m -= this.statSum(a, 'sprintCost');
        return Math.max(0.2, m);
    }

    mmoHeal(src, tgt, amount, opts = {}) {
        if (!tgt || tgt.dead) return 0;
        let heal = amount * (1 + (src.power || 0));
        if (src.kind === 'player' && src.char && opts.spellId) {
            const sk = this.call.mmoSpellSkill(this.call.mmoSpell(opts.spellId), src.char.equipment?.weapon, src.char.classId);
            heal *= this.call.mmoSkillMult(src.char, sk) * (1 + this.statSum(src, 'skill_' + sk));
        }
        heal *= 1 + this.statSum(src, 'healingDone');
        if (opts.potion && tgt.traits?.has('herbalist')) heal *= 1 + this.tp('herbalist').potion;
        const crit = opts.crit ?? (!opts.isHot && Math.random() < this.cfg.critChance + this.statSum(src, 'critChance'));
        if (crit) heal *= this.cfg.healCritMultiplier;
        heal = Math.round(heal);
        const effective = Math.min(heal, tgt.maxHp - tgt.hp);
        tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
        if (src !== tgt && src.traits?.has('abbotsGrace') && effective > 0) src.hp = Math.min(src.maxHp, src.hp + effective * this.tp('abbotsGrace').self);
        this.call.mmoEmit({ t: 'heal', s: src.id, d: tgt.id, v: heal, c: crit ? 1 : 0, sp: opts.spellId || null, hot: opts.isHot ? 1 : 0 }, tgt.x, tgt.z);

        // Healing threat: half the effective heal, split across mobs fighting the target.
        if (src.kind === 'player' && effective > 0) {
            const engaged = [];
            for (const m of this.call.mmoActors().values()) {
                if (m.kind === 'mob' && !m.dead && m.threat?.has(tgt.id)) engaged.push(m);
            }
            for (const m of engaged) this.mmoAddThreat(m, src, (effective * 0.5) / engaged.length);
        }
        return heal;
    }

    addResource(a, amount) {
        if (!a.resType) return;
        a.res = Math.max(0, Math.min(a.resMax, a.res + amount));
    }

    // ==================== DEATH ====================

    mmoKill(victim, killer) {
        if (victim.dead) return;
        victim.dead = true;
        victim.diedAt = this.now();
        victim.hp = 0;
        victim.autoAttack = false;
        victim.target = null;
        victim.moving = false;
        victim.sitting = false;
        if (victim.cast) victim.cast = null;
        victim.auras = [];
        victim.inCombat = false;
        victim.ver++;
        this.call.mmoEmit({ t: 'die', id: victim.id, k: killer?.id ?? null }, victim.x, victim.z);
        if (killer && killer !== victim) this.traitsOnKill(victim, killer);

        // Remove the dead from every threat table and drop attackers' auto-attack.
        for (const a of this.call.mmoActors().values()) {
            if (a.threat?.has(victim.id)) a.threat.delete(victim.id);
            if (a.target === victim.id) a.autoAttack = false;
        }
        this.game.triggerEvent('onMmoKill', { victim, killer });
    }

    releaseSpirit(a) {
        if (!a.dead || a.kind !== 'player') return;
        // Nearest spirit healer in any zone (measured from an interior's door outside, if you fell in one).
        const it = this.game.mmoGameSystem?.mmoInteriorAt(a.x, a.z);
        const from = it ? it.outside : a;
        const yards = this.call.mmoZones().flatMap(z => [z.graveyard, ...(z.graveyards || [])]).filter(Boolean);
        const gy = yards.sort((p, q) => Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z))[0] || this.call.mmoStartZone(a.char?.appearance?.race).spawn;
        this.mmoResurrect(a, 0.5);
        this.call.mmoTeleport(a, gy.x + (Math.random() - 0.5) * 60, gy.z + (Math.random() - 0.5) * 60, -Math.PI / 2);
        this.call.mmoToast(a, 'You return to the land of the living.', 'info');
    }

    mmoResurrect(a, frac = 1) {
        a.dead = false;
        a.hp = Math.max(1, Math.round(a.maxHp * frac));
        a.res = a.resType === 'magicka' ? Math.round(a.resMax * frac) : a.resMax;
        if (a.spMax) a.sp = a.spMax;
        a.combatUntil = 0;
        a.inCombat = false;
        a.ver++;
        this.call.mmoEmit({ t: 'res', id: a.id }, a.x, a.z);
    }

    // ==================== SPELLS ====================

    error(a, text) {
        if (a.kind === 'player') this.call.mmoSend(a.socketId, 'MMO_ERROR', { text });
        return false;
    }

    /** A character's Stamina: a fighter's ability pool, or a caster's second pool. */
    stamOf(a) { return a.resType === 'stamina' ? a.res : (a.sp ?? 0); }
    spendStam(a, n) {
        if (a.resType === 'stamina') a.res = Math.max(0, a.res - n);
        else a.sp = Math.max(0, (a.sp ?? 0) - n);
        a.lastStamSpend = this.now();
    }

    playerCast(a, d) {
        const spellId = d.spell;
        const def = this.call.mmoSpell(spellId);
        if (!a.char?.spells?.includes(spellId) && !def?.universal) return this.error(a, 'You don\'t know that spell.');
        if (def?.hand) return this.equipHand(a, { hand: d.left ? 'left' : 'right', spell: spellId });      // a favorite spell: ready it
        if (!def?.power && !def?.universal) return this.error(a, 'That is not something you can do any more. Power attacks, spells and powers are your tools now.');
        if (a.flight) return this.error(a, "You can't do that while flying.");
        if (Number.isFinite(d.f)) a.facing = d.f;
        if (d.target !== undefined && d.target !== a.target) this.setTarget(a, d.target);
        this.mmoCastSpell(a, spellId, a.target);
    }

    /**
     * Start (or instantly resolve) a spell. Returns true on success; on failure
     * players get an error message.
     */
    mmoCastSpell(a, spellId, targetId = null) {
        const spell = this.call.mmoSpell(spellId);
        if (!spell) return false;
        const now = this.now();
        if (a.dead) return this.error(a, 'You are dead.');
        if (this.hasStat(a, 'stun')) return this.error(a, 'You are stunned.');
        if (a.silencedUntil > now) return this.error(a, 'Can\'t do that yet.');
        if (a.cast) return this.error(a, 'Another action is in progress.');
        if (spell.gcd && a.gcdUntil > now) return this.error(a, 'Ability is not ready yet.');
        if ((a.cooldowns[spellId] || 0) > now) return this.error(a, 'Ability is not ready yet.');

        const mod = a.spellMods?.[spellId];
        let cost = Math.max(0, Math.round(this.call.mmoSpellCost(spell, a.level) * (1 + (mod?.cost || 0))));
        if (a.kind === 'player' && a.char && a.resType === 'magicka' && spell.costType !== 'stamina') {
            const sk = this.call.mmoSpellSkill(spell, a.char.equipment?.weapon, a.char.classId);
            cost = Math.round(cost * Math.max(0.6, 1 - (this.call.mmoSkill(a.char, sk) - 15) / 300) * Math.max(0.3, 1 - this.statSum(a, 'costReduce')));
        }
        const pool = spell.costType === 'stamina' ? this.stamOf(a) : a.res;
        if (a.kind === 'player' && cost > pool) {
            const names = { stamina: 'stamina', magicka: 'magicka' };
            return this.error(a, `Not enough ${spell.costType === 'stamina' ? 'stamina' : names[a.resType] || 'power'}.`);
        }

        // Resolve the target.
        let target = null;
        if (spell.target === 'enemy') {
            target = this.call.mmoActor(targetId);
            if (!target || !this.isAttackable(a, target)) return this.error(a, 'Invalid target.');
        } else if (spell.target === 'ally') {
            const t = this.call.mmoActor(targetId);
            target = (t && this.isFriendlyTarget(a, t)) ? t : a;      // no friendly target: cast on self
            if (a.kind === 'mob') target = a;
        } else {
            target = a;
        }

        if (target !== a) {
            const range = this.call.mmoSpellRange(spell, a.weapon?.ranged ? a.weapon.range : null);
            if (this.mmoDistance(a, target) > range) return this.error(a, 'Out of range.');
        }
        if (spell.requires?.targetHealthBelow && target.hp / target.maxHp >= spell.requires.targetHealthBelow) {
            return this.error(a, 'Target must be below 20% health.');
        }
        if (spell.requires?.behind && !this.isBehind(a, target)) return this.error(a, 'You must be behind your target.');
        if (spell.finisher && !(a.combo.target === target.id && a.combo.points > 0)) return this.error(a, 'That ability requires combo points.');

        const hasCastTime = spell.castTime > 0 || spell.channel;
        if (hasCastTime && a.kind === 'player' && now - a.lastMoveTime < 0.12) return this.error(a, 'You can\'t do that while moving.');

        if (target !== a) a.facing = Math.atan2(target.z - a.z, target.x - a.x);
        if (spell.gcd) a.gcdUntil = now + this.cfg.gcd;
        if (a.sitting) this.game.mmoWorldSystem?.setSitting(a, false);

        if (hasCastTime) {
            const dur = spell.channel ? spell.channel.duration : spell.castTime;
            a.cast = { spellId, targetId: target.id, start: now, end: now + dur, channel: !!spell.channel, ticks: 0, cost };
            if (spell.channel) this.pay(a, spell, cost);
            this.call.mmoEmit({ t: 'cast', s: a.id, sp: spellId, d: target.id, dur, ch: spell.channel ? 1 : 0, an: spell.anim || 'cast' }, a.x, a.z);
            if (this.mmoIsEnemy(a, target)) { this.enterCombat(a, target); }
            return true;
        }

        this.pay(a, spell, cost);
        this.resolveSpell(a, spell, target);
        return true;
    }

    pay(a, spell, cost) {
        if (a.kind === 'player' && a.char) this.call.mmoSkillUse(a, this.call.mmoSpellSkill(spell, a.char.equipment?.weapon, a.char.classId), 1 + cost / 25);
        if (cost > 0 && spell.costType === 'stamina') this.spendStam(a, cost);
        else if (cost > 0) {
            if (a.res < cost && a.traits?.has('gravePact')) a.hp = Math.max(1, a.hp - Math.round(cost * (this.call.mmoTrait('gravePact')?.p?.rate || 1.5)));      // paid in blood
            else a.res = Math.max(0, a.res - cost);
            if (a.resType === 'magicka') a.lastManaSpend = this.now();
        }
        if (spell.cooldown) a.cooldowns[spell.id] = this.now() + Math.max(0, spell.cooldown + (a.spellMods?.[spell.id]?.cooldown || 0));
    }

    cancelCast(a, reason = 'Interrupted') {
        if (!a.cast) return;
        const sp = a.cast.spellId;
        a.cast = null;
        this.call.mmoEmit({ t: 'castEnd', s: a.id, sp, ok: 0 }, a.x, a.z);
        if (a.kind === 'player' && reason) this.error(a, reason);
    }

    updateCast(a, now) {
        const c = a.cast;
        if (!c) return;
        const spell = this.call.mmoSpell(c.spellId);
        const target = this.call.mmoActor(c.targetId);
        if (!spell || !target || target.dead || (spell.target === 'enemy' && !this.isAttackable(a, target))) {
            return this.cancelCast(a, null);
        }
        if (a.kind === 'player' && a.lastMoveTime > c.start + 0.05) return this.cancelCast(a, 'Interrupted');
        if (this.hasStat(a, 'stun')) return this.cancelCast(a, 'Interrupted');

        if (c.channel) {
            const ticks = spell.channel.ticks;
            const due = Math.min(ticks, Math.floor(((now - c.start) / (c.end - c.start)) * ticks + 1e-6));
            while (c.ticks < due) {
                c.ticks++;
                this.resolveSpell(a, spell, target, { channelTick: true });
            }
            if (now >= c.end) {
                a.cast = null;
                this.call.mmoEmit({ t: 'castEnd', s: a.id, sp: spell.id, ok: 1 }, a.x, a.z);
            }
            return;
        }

        if (now < c.end) return;
        const range = this.call.mmoSpellRange(spell, a.weapon?.ranged ? a.weapon.range : null);
        if (target !== a && this.mmoDistance(a, target) > range * 1.15) return this.cancelCast(a, 'Out of range.');
        if (a.kind === 'player' && c.cost > a.res) return this.cancelCast(a, 'Not enough power.');
        a.cast = null;
        this.pay(a, spell, c.cost);
        this.call.mmoEmit({ t: 'castEnd', s: a.id, sp: spell.id, ok: 1 }, a.x, a.z);
        this.resolveSpell(a, spell, target);
    }

    /** Apply a spell's effects (after costs). Handles AoE, projectiles, combo points. */
    resolveSpell(a, spell, primary, opts = {}) {
        if (a.kind === 'mob' && spell.fx?.projectile && primary && primary !== a && !opts.landed) {
            // a creature's bolt flies at you as cast (spread and all): step aside and it misses
            if (!opts.channelTick) this.call.mmoEmit({ t: 'spell', s: a.id, sp: spell.id, d: primary.id, an: spell.anim || 'cast', fx: spell.fx?.cast || null }, a.x, a.z);
            const S = RpgCombatSystem.BOLT_SPEED, o = this.launchPoint(a, primary), P = this.aimPointAt(a, primary, o), { f, p } = this.solveArc(o, P, S, 0);
            this.launchShot(a, o, f, p, S, 0, { fx: spell.fx.projectile, sp: spell.id, maxT: 2.5, onHit: (hit) => this.resolveSpell(a, spell, hit, { landed: true, channelTick: true }) });
            return;
        }
        if (!opts.channelTick) {
            this.call.mmoEmit({ t: 'spell', s: a.id, sp: spell.id, d: primary?.id ?? null, an: spell.anim || 'cast', fx: spell.fx?.cast || null }, a.x, a.z);
        }

        // Targets
        let targets = [primary];
        if (spell.aoe) {
            const center = spell.aoe.center === 'target' ? primary : a;
            const wantAllies = !!spell.aoe.allies;
            const party = this.game.mmoPartySystem;
            let list = this.call.mmoNearbyActors(center.x, center.z, spell.aoe.radius + 40, (o) => {
                if (o.dead) return false;
                if (wantAllies) {
                    if (o.kind !== 'player') return false;
                    if (spell.aoe.partyOnly && o !== a && !party?.sameParty(a, o)) return false;
                    return true;
                }
                return this.isAttackable(a, o);
            });
            list = list.filter(o => Math.hypot(o.x - center.x, o.z - center.z) - this.radiusOf(o) <= spell.aoe.radius);
            list.sort((p, q) => (p === primary ? -1 : q === primary ? 1 : Math.hypot(p.x - center.x, p.z - center.z) - Math.hypot(q.x - center.x, q.z - center.z)));
            if (spell.aoe.maxTargets) list = list.slice(0, spell.aoe.maxTargets);
            if (spell.target === 'self' && !wantAllies) targets = list;         // nova-style: self is the center only
            else targets = list.length ? list : [primary];
        }

        const combo = spell.finisher && a.combo.target === primary?.id ? a.combo.points : 0;
        if (spell.finisher) a.combo = { target: null, points: 0 };

        for (const t of targets) {
            if (!t) continue;
            const sc = this._scale || 1, apply = () => this.applyEffects(a, spell, t, combo, sc);
            if (spell.fx?.projectile && t !== a && !opts.landed) {
                const tt = this.travelTime(a, t);
                this.call.mmoEmit({ t: 'proj', s: a.id, d: t.id, fx: spell.fx.projectile, tt, sp: spell.id }, a.x, a.z);
                this.later(tt, apply);
            } else {
                apply();
            }
        }

        if (spell.combo && primary && primary !== a) {
            if (a.combo.target !== primary.id) a.combo = { target: primary.id, points: 0 };
            a.combo.points = Math.min(5, a.combo.points + spell.combo);
        }
    }

    applyEffects(a, spell, t, combo = 0, sc = 0) {
        if (a.dead && a.kind === 'mob') return;
        const L = a.level, scale = sc || this._scale || 1;      // a stream's tick is a fraction of the spell
        for (const eff of spell.effects || []) {
            if (t.dead && eff.type !== 'resource') continue;
            switch (eff.type) {
                case 'damage': {
                    const [min, max] = this.call.mmoEffectValue(eff, L);
                    let amount = min + Math.random() * (max - min);
                    if (eff.weapon) amount += eff.weapon * (a.weapon.min + Math.random() * (a.weapon.max - a.weapon.min));
                    if (eff.perCombo) amount *= Math.max(1, combo);
                    amount *= (1 + (a.spellMods?.[spell.id]?.damage || 0)) * scale;
                    this.mmoDealDamage(a, t, amount, eff.school || 'physical', { spellId: spell.id, threatMult: eff.threatMult, canMiss: spell.anim === 'attack' && spell.range === 'melee' });
                    break;
                }
                case 'heal': {
                    const [min, max] = this.call.mmoEffectValue(eff, L);
                    this.mmoHeal(a, t, (min + Math.random() * (max - min)) * (1 + (a.spellMods?.[spell.id]?.damage || 0)) * scale, { spellId: spell.id });
                    break;
                }
                case 'aura':
                    this.mmoApplyAura(t, eff.aura, a, L);
                    break;
                case 'threat':
                    this.mmoAddThreat(t, a, (eff.amount || 0) + (eff.perLevel || 0) * (L - 1));
                    break;
                case 'taunt':
                    if (t.kind === 'mob') {
                        const top = Math.max(0, ...t.threat?.values() || [0]);
                        this.mmoAddThreat(t, a, 1);
                        t.threat.set(a.id, top + 10);
                        t.tauntedBy = a.id;
                        t.tauntUntil = this.now() + (eff.duration || 3);
                    }
                    break;
                case 'interrupt':
                    if (t.cast) this.cancelCast(t, 'Interrupted');
                    t.silencedUntil = this.now() + 3;
                    break;
                case 'resource':
                    this.addResource(a, eff.amount || 0);
                    break;
                case 'blink': {
                    let x = a.x, z = a.z;
                    const step = 16, dirX = Math.cos(a.facing), dirZ = Math.sin(a.facing);
                    for (let d = step; d <= (eff.distance || 300); d += step) {
                        const nx = a.x + dirX * d, nz = a.z + dirZ * d;
                        if (!this.call.mmoCanStep(x, z, nx, nz)) break;
                        x = nx; z = nz;
                    }
                    this.call.mmoEmit({ t: 'fx', fx: spell.fx?.cast, x: a.x, z: a.z }, a.x, a.z);
                    this.call.mmoTeleport(a, x, z);
                    if (spell.fx?.impact) this.call.mmoEmit({ t: 'fx', fx: spell.fx.impact, x, z }, x, z);
                    break;
                }
                case 'cleanse':
                    a.auras = a.auras.filter(x => !(eff.stats || []).some(k => x.stats?.[k]));
                    break;
            }
        }
        if (spell.fx?.impact && !(spell.effects || []).some(e => e.type === 'blink')) {
            this.call.mmoEmit({ t: 'fx', fx: spell.fx.impact, x: t.x, z: t.z, id: t.id }, t.x, t.z);
        }
    }

    // ==================== AURAS ====================

    mmoApplyAura(t, def, src, level) {
        if (!t || t.dead) return null;
        const now = this.now();
        const L = Math.max(1, level || src?.level || 1) - 1;
        if (def.debuff && src && this.mmoIsEnemy(src, t)) {
            this.enterCombat(src, t); this.enterCombat(t, src);
            if (src.kind === 'player' && t.kind === 'mob') { this.tap(t, src); this.mmoAddThreat(t, src, 5); }
        }
        // Same aura from the same source refreshes (and stacks, if allowed).
        let aura = t.auras.find(x => x.id === def.id && (x.sourceId === src?.id || !def.debuff));
        if (!aura) {
            aura = { id: def.id, title: def.title, icon: def.icon, debuff: !!def.debuff, stacks: 0, sourceId: src?.id ?? null };
            t.auras.push(aura);
        }
        aura.appliedAt = now;
        let duration = def.duration || 0;
        if (src?.kind === 'player' && src.char && def.debuff && !def.dot && src.resType === 'magicka') duration *= this.call.mmoSkillMult(src.char, 'illusion') * (1 + this.statSum(src, 'skill_illusion'));
        aura.duration = duration;
        aura.expires = duration ? now + duration : 0;
        aura.stacks = Math.min(def.maxStacks || 1, (aura.stacks || 0) + 1);
        aura.stats = def.stats || null;
        aura.breakOnDamage = !!def.breakOnDamage;
        aura.seated = !!def.seated;
        aura.interval = def.interval || 0;
        aura.nextTick = def.interval ? now + def.interval : 0;
        if (def.dot) {
            const total = def.dot.total + (def.dot.perLevel || 0) * L;
            aura.dot = { school: def.dot.school, perTick: total / Math.max(1, Math.round(def.duration / def.interval)) };
        }
        if (def.hot) {
            const total = def.hot.total + (def.hot.perLevel || 0) * L;
            aura.hot = { perTick: total / Math.max(1, Math.round(def.duration / def.interval)) };
        }
        if (def.pulse) {
            aura.pulse = { ...def.pulse, min: def.pulse.min + (def.pulse.perLevel || 0) * L, max: def.pulse.max + (def.pulse.perLevel || 0) * L, x: t.x, z: t.z };
        }
        if (def.absorb) aura.absorbLeft = Math.round((def.absorb.total + (def.absorb.perLevel || 0) * L) * (src?.kind === 'player' && src.char ? this.call.mmoSkillMult(src.char, 'alteration') * (1 + this.statSum(src, 'skill_alteration')) : 1));
        if (def.regen) aura.regen = def.regen;
        if (def.stats?.stun && t.cast) this.cancelCast(t, 'Interrupted');
        if (def.stats?.stun && (def.id === 'staggered' || def.id === 'paralyzed') && !t.dead)     // the body reels (a hit reaction clip)
            this.call.mmoEmit({ t: 'act', s: t.id, an: 'stagger', ...(src && src !== t ? { from: src.id } : {}) }, t.x, t.z);
        if (def.stats?.stun || def.stats?.root) t.moving = false;
        return aura;
    }

    cancelAura(a, id) {
        a.auras = a.auras.filter(x => x.debuff || x.id !== id);
    }

    updateAuras(a, now) {
        if (!a.auras.length) return;
        for (const aura of a.auras) {
            if (aura.interval && now >= aura.nextTick && (!aura.expires || aura.nextTick <= aura.expires + 0.01)) {
                aura.nextTick += aura.interval;
                const src = this.call.mmoActor(aura.sourceId) || a;
                if (aura.dot) this.mmoDealDamage(src, a, aura.dot.perTick, aura.dot.school, { isDot: true, spellId: aura.id });
                if (aura.hot) this.mmoHeal(src, a, aura.hot.perTick, { isHot: true, spellId: aura.id });
                if (aura.pulse) {
                    const p = aura.pulse;
                    for (const o of this.call.mmoNearbyActors(p.x, p.z, p.radius)) {
                        if (this.isAttackable(src, o)) this.mmoDealDamage(src, o, p.min + Math.random() * (p.max - p.min), p.school, { spellId: aura.id, isDot: true });
                    }
                }
                if (aura.regen) {
                    if (aura.regen.hp) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * aura.regen.hp * aura.interval);
                    if (aura.regen.mana && a.resType === 'magicka') a.res = Math.min(a.resMax, a.res + a.resMax * aura.regen.mana * aura.interval);
                }
                if (a.dead) return;
            }
        }
        const before = a.auras.length;
        a.auras = a.auras.filter(x => !x.expires || x.expires > now);
        if (a.auras.length !== before) this.call.mmoEmit({ t: 'auras', id: a.id }, a.x, a.z, a.id);
    }

    // ==================== ITEMS ====================

    useItem(a, itemId) {
        const def = this.call.mmoItem(itemId);
        if (!def?.use || a.dead) return;
        if (this.call.mmoCountItem(a, itemId) < 1) return;
        const now = this.now();
        const cdKey = `item:${def.use.food || def.use.drink ? 'food' : def.use.buff && !def.use.heal && !def.use.mana ? 'elixir' : 'potion'}`;
        if ((a.cooldowns[cdKey] || 0) > now) return this.error(a, 'Item is not ready yet.');
        if ((def.use.food || def.use.drink) && a.inCombat) return this.error(a, 'You can\'t do that while in combat.');

        this.call.mmoTakeItem(a, itemId, 1);
        const act = def.use.food ? 'eat' : (def.use.drink || def.use.heal || def.use.mana || def.use.buff) ? 'drink' : null;
        if (act) this.call.mmoEmit({ t: 'act', s: a.id, an: act }, a.x, a.z);
        if (def.use.heal) this.mmoHeal(a, a, def.use.heal, { crit: false, potion: true });
        if (def.use.mana && a.resType === 'magicka') {
            a.res = Math.min(a.resMax, a.res + def.use.mana);
            this.call.mmoEmit({ t: 'energize', d: a.id, v: def.use.mana }, a.x, a.z, a.id);
        }
        if (def.use.food || def.use.drink) {
            this.game.mmoWorldSystem?.setSitting(a, true);
            this.mmoApplyAura(a, {
                id: def.use.food ? 'food' : 'drink', title: def.use.food ? 'Food' : 'Drink', icon: def.icon,
                duration: def.use.duration, interval: 1, seated: true,
                regen: { hp: def.use.food || 0, mana: def.use.drink || 0 }
            }, a, a.level);
        }
        if (def.use.buff) {                                     // Well Fed, elixirs: stats for a while
            const b = def.use.buff;
            this.mmoApplyAura(a, { id: b.id, title: b.title, icon: def.icon, duration: b.duration || 1800, stats: b.stats }, a, a.level);
            this.game.mmoWorldSystem?.mmoRecalcStats(a);
            this.call.mmoEmit({ t: 'auras', id: a.id }, a.x, a.z, a.id);
        }
        a.cooldowns[cdKey] = now + (def.use.cooldown || 1);
    }

    // ==================== TICK ====================

    update() {
        if (!this.game.isServer) return;
        const now = this.now();
        const dt = this.game.state.deltaTime || 0.05;

        this.updateShots(dt);

        // Delayed effects (projectile travel, swing impacts)
        if (this._pending.length) {
            const due = this._pending.filter(p => p.at <= now);
            if (due.length) {
                this._pending = this._pending.filter(p => p.at > now);
                for (const p of due) { try { p.fn(); } catch (e) { console.error('[combat] delayed effect failed', e); } }
            }
        }

        this._regenAccum += dt;
        const regenTick = this._regenAccum >= 1;
        if (regenTick) this._regenAccum -= 1;

        for (const a of this.call.mmoActors().values()) {
            if (a.kind === 'npc') continue;
            if (a.dead) continue;
            this.updateAuras(a, now);
            if (a.dead) continue;
            this.updateCast(a, now);
            this.updateSwing(a, now);

            // held past POWER_HOLD: a power attack; both hands held (two weapons): both strike
            if (a.charging && now - a.chargeStart >= RpgCombatSystem.POWER_HOLD) {
                a.charging = false;
                if (a.chargingL) { a.chargingL = false; this.melee(a, true, 'both'); } else this.melee(a, true);
            }
            if (a.chargingL && now - a.chargeStartL >= RpgCombatSystem.POWER_HOLD) {
                a.chargingL = false;
                if (a.charging) { a.charging = false; this.melee(a, true, 'both'); } else this.melee(a, true, 'left');
            }
            if (a.casting) this.updateHands(a, now);
            // Sprinting burns Stamina while moving; run dry and you slow to a run.
            if (a.sprinting) {
                if (a.moving) { this.spendStam(a, 14 * dt * this.stamCostMult(a, false)); a.lastSprintAt = now; }
                if (this.stamOf(a) <= 0) { a.sprinting = false; if (a.socketId) this.call.mmoSend(a.socketId, 'MMO_ERROR', { text: 'You are out of breath.' }); }
            }
            // Players leave combat when nothing has fought them for a while.
            if (a.kind === 'player' && a.inCombat && now > a.combatUntil) a.inCombat = false;
            if (regenTick) this.regen(a, now);
        }
    }

    regen(a, now) {
        if (a.kind === 'player') {
            // gear quickens each (healthRegen, magickaRegen, staminaRegen); Sunwell keeps Magicka coming in a
            // fight, the Drowned Cowl Health
            const R = (k) => Math.max(0, 1 + this.statSum(a, k));
            if (a.hp < a.maxHp) {
                if (!a.inCombat) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.02 * R('healthRegen'));
                else if (a.traits?.has('drowned')) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * this.tp('drowned').regen * R('healthRegen'));
            }
            switch (a.resType) {
                case 'magicka': {
                    const rate = now - (a.lastManaSpend || -99) > 5 || a.traits?.has('sunwell') ? 0.04 : 0.008;
                    a.res = Math.min(a.resMax, a.res + a.resMax * rate * R('magickaRegen'));
                    break;
                }
                case 'stamina': if (!(a.sprinting && a.moving)) a.res = Math.min(a.resMax, a.res + a.resMax * (a.inCombat ? 0.07 : 0.15) * R('staminaRegen')); break;
            }
            if (a.resType !== 'stamina' && a.spMax && !(a.sprinting && a.moving)) a.sp = Math.min(a.spMax, (a.sp ?? 0) + a.spMax * (a.inCombat ? 0.07 : 0.15) * R('staminaRegen'));
        }
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.RpgCombatSystem = RpgCombatSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.RpgCombatSystem = RpgCombatSystem; }
export default RpgCombatSystem;
export { RpgCombatSystem };
