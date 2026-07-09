// Buff store + per-tick handler for buff effects that aren't consumed by the
// shared global DamageSystem.
//
// MULTI-BUFF: each applied buff lives on its OWN entity (a bare entity holding
// just a `buff` component whose `targetEntity` field points at the buffed
// unit), so a unit can carry any number of simultaneous buffs. All reads go
// through the query API below (getBuffs / getBuffOfType / hasBuff), which
// iterates buff entities in entity-id order — deterministic for lockstep.
// This is the ONLY buff representation: never addComponent(unit, 'buff', ...)
// — a buff component belongs on a dedicated buff entity, nothing else.
//
// Per-tick effects handled here:
//   * expiry reaper:       destroys buff entities whose endTime passed or whose target died
//   * regenerating:        heals buff holders each second (healPerSecond)
//   * bloodlust:           credits a kill stack to the killer when an enemy dies
//   * poisoned_weapon:     applies poison-DoT when the attacker lands a hit
//   * enchant_weapon:      deals a bonus elemental hit when the attacker lands a hit
//   * bloodlust:           heals attacker for lifeSteal% of damage dealt
//   * thorns_aura/retaliation: reflects damage back to the attacker
//
// On-hit / on-take-damage effects are driven by watching combatState.lastAttackTime
// for changes per tick — that fires for melee, projectiles, and ability damage
// uniformly, since they all funnel through DamageSystem.applyDamage which stamps
// combatState. The bloodlust *damage bonus* itself is baked into the attacker's
// outgoing damage by AttackEnemyBehaviorAction (since it needs to land in the
// same hit), and wind_shield deflection is handled there too (pre-fire check).
class BuffEffectsSystem extends GUTS.BaseSystem {

    static services = [
        'applyBuff',
        'removeBuff',
        'getBuffs',
        'getBuffOfType',
        'hasBuff'
    ];

    static serviceDependencies = [
        'getBuffTypeDef',
        'scheduleDamage',
        'showDamageNumber'
    ];

    constructor(game) {
        super(game);
        this.game.buffEffectsSystem = this;

        this._regenAccumulator = 0;
        this._aliveLastTick = new Set();

        // Per-entity tracking for the on-hit watcher.
        this._lastAttackTimeSeen = new Map(); // entityId -> last seen combatState.lastAttackTime
        this._lastHealthSeen     = new Map(); // entityId -> last seen health.current

        // Per-entity tracking for the poison-tick damage-number emitter.
        this._lastPoisonTickSeen = new Map(); // entityId -> poison.lastTickTime

        // CC tracking: original maxSpeed / attackSpeed pre-debuff, restored on expiry.
        this._ccBaselines = new Map(); // entityId -> { maxSpeed, attackSpeed }
    }

    // ---- Buff store API ----------------------------------------------------

    // Applies a buff to targetId on its own buff entity. Re-applying a type the
    // target already has REFRESHES that buff in place (endTime/appliedTime/
    // sourceEntity/stacks overwritten with the incoming values) instead of
    // creating a second instance of the same type. Returns the buff entity id.
    applyBuff(targetId, { buffType, endTime, appliedTime, stacks, sourceEntity, weaponElement } = {}) {
        if (targetId == null || buffType == null) return null;
        const now = this.game.state.now || 0;

        const existingId = this._buffEntityOfType(targetId, buffType);
        if (existingId != null) {
            const buff = this.game.getComponent(existingId, 'buff');
            buff.endTime      = endTime ?? buff.endTime;
            buff.appliedTime  = appliedTime ?? now;
            buff.stacks       = stacks ?? buff.stacks ?? 1;
            if (sourceEntity !== undefined) buff.sourceEntity = sourceEntity;
            if (weaponElement !== undefined) buff.weaponElement = weaponElement;
            return existingId;
        }

        const buffEntity = this.game.createEntity();
        this.game.addComponent(buffEntity, 'buff', {
            buffType: buffType,
            endTime: endTime ?? 0,
            appliedTime: appliedTime ?? now,
            stacks: stacks ?? 1,
            sourceEntity: sourceEntity ?? null,
            weaponElement: weaponElement ?? null,
            targetEntity: targetId
        });
        return buffEntity;
    }

    // Removes all buffs of `buffType` from targetId.
    // Pass buffType == null to strip everything.
    removeBuff(targetId, buffType = null) {
        for (const buffEntity of [...this.game.getEntitiesWith('buff')]) {
            const buff = this.game.getComponent(buffEntity, 'buff');
            if (!buff || buff.targetEntity !== targetId) continue;
            if (buffType != null && buff.buffType !== buffType) continue;
            this.game.destroyEntity(buffEntity);
        }
    }

    // All ACTIVE (unexpired) buffs on targetId, in deterministic order.
    // Returns buff component proxies — callers may mutate fields (e.g. stacks).
    getBuffs(targetId) {
        const now = this.game.state.now || 0;
        const result = [];
        for (const buffEntity of this.game.getEntitiesWith('buff')) {
            const buff = this.game.getComponent(buffEntity, 'buff');
            if (!buff || buff.targetEntity !== targetId) continue;
            if (buff.endTime && now > buff.endTime) continue;
            result.push(buff);
        }
        return result;
    }

    getBuffOfType(targetId, buffType) {
        const buffs = this.getBuffs(targetId);
        for (const buff of buffs) {
            if (buff.buffType === buffType) return buff;
        }
        return null;
    }

    hasBuff(targetId, buffType) {
        return this.getBuffOfType(targetId, buffType) !== null;
    }

    // Buff entity id (not proxy) holding `buffType` on targetId, or null.
    _buffEntityOfType(targetId, buffType) {
        for (const buffEntity of this.game.getEntitiesWith('buff')) {
            const buff = this.game.getComponent(buffEntity, 'buff');
            if (buff && buff.targetEntity === targetId && buff.buffType === buffType) {
                return buffEntity;
            }
        }
        return null;
    }

    // Destroys buff entities whose duration ended or whose target is gone.
    // Central expiry — abilities no longer need their own scheduled removals
    // (their scheduled EFFECTS/visuals are unaffected).
    _reapExpiredBuffs() {
        const now = this.game.state.now || 0;
        for (const buffEntity of [...this.game.getEntitiesWith('buff')]) {
            const buff = this.game.getComponent(buffEntity, 'buff');
            if (!buff) continue;
            // No target = malformed/orphaned buff entity — reap it too.
            const orphaned = buff.targetEntity == null;
            const expired = buff.endTime && now > buff.endTime;
            const targetGone = !orphaned && !this.game.entityAlive?.[buff.targetEntity];
            if (orphaned || expired || targetGone) this.game.destroyEntity(buffEntity);
        }
    }

    // ---- Lifecycle -----------------------------------------------------------

    // End-of-round teardown. buff.endTime is compared against the battle clock,
    // which RESETS each round — a leftover buff on an entity that persists
    // across rounds (buildings) would zombie-reactivate next battle. Restore
    // CC-modified stats, destroy all buff entities, and reset per-battle
    // tracking.
    onBattleEnd() {
        for (const [entityId, baseline] of this._ccBaselines.entries()) {
            const vel    = this.game.getComponent(entityId, 'velocity');
            const combat = this.game.getComponent(entityId, 'combat');
            if (vel && baseline.maxSpeed != null)       vel.maxSpeed = baseline.maxSpeed;
            if (combat && baseline.attackSpeed != null) combat.attackSpeed = baseline.attackSpeed;
        }
        this._ccBaselines.clear();

        for (const entityId of [...this.game.getEntitiesWith('buff')]) {
            this.game.destroyEntity(entityId); // buffs only live on dedicated buff entities
        }
        for (const entityId of [...this.game.getEntitiesWith('poison')]) {
            this.game.removeComponent(entityId, 'poison');
        }

        this._aliveLastTick.clear();
        this._lastAttackTimeSeen.clear();
        this._lastHealthSeen.clear();
        this._lastPoisonTickSeen.clear();
        this._regenAccumulator = 0;
    }

    update() {
        // Gameplay logic is server-authoritative (local-machine 2-player counts).
        if (this.game.isServer || this.game.state?.isLocalGame) {
            this._reapExpiredBuffs();
            this._tickRegeneration();
            this._tickKillDetection();
            this._tickOnHitEffects();
            this._tickCCEffects();
        }

        // Visual: poison ticks are silent in global DamageSystem (only flash, no
        // floating numbers). Emit them ourselves. Poison stack updates are
        // deterministic on both client and server, so running this everywhere
        // covers both local and networked play.
        this._tickPoisonDamageNumbers();
    }

    // ---- Per-tick effects ------------------------------------------------------

    // Applies movement / attack-speed modifiers from active CC buffs each tick.
    // Multipliers from MULTIPLE simultaneous buffs multiply together. Stores the
    // entity's pre-debuff baseline so we can restore it when the buffs expire.
    // The other CC dimensions (action prevention for stun / freeze / polymorph /
    // silence) are handled inline by the gating code in
    // AttackEnemyBehaviorAction.execute and AbilitySystem.useAbility — those
    // call BuffEffectsSystem.isHardCC()/isSilenced() to check.
    _tickCCEffects() {
        const now = this.game.state.now || 0;

        // Aggregate combined move/attack multipliers per buffed target.
        const combined = new Map(); // targetId -> { moveMult, atkMult }
        for (const buffEntity of this.game.getEntitiesWith('buff')) {
            const buff = this.game.getComponent(buffEntity, 'buff');
            if (!buff || buff.targetEntity == null) continue;
            const targetId = buff.targetEntity;
            if (buff.endTime && now > buff.endTime) continue;

            const buffTypeDef = this.call.getBuffTypeDef(buff.buffType);
            if (!buffTypeDef) continue;

            // Two CC representations exist in the buff data:
            //   * multiplier form: movementSpeedMultiplier / attackSpeedMultiplier (0..N)
            //   * disabled flag:   movementDisabled / attackDisabled (1 = fully blocked)
            // Honor both. A disabled flag overrides the multiplier (sets it to 0).
            let moveMult = buffTypeDef.movementSpeedMultiplier;
            let atkMult  = buffTypeDef.attackSpeedMultiplier;
            if (buffTypeDef.movementDisabled) moveMult = 0;
            if (buffTypeDef.attackDisabled)   atkMult  = 0;

            const moveActive = (moveMult != null && moveMult !== 1);
            const atkActive  = (atkMult  != null && atkMult  !== 1);
            if (!moveActive && !atkActive) continue;

            let agg = combined.get(targetId);
            if (!agg) { agg = { moveMult: 1, atkMult: 1 }; combined.set(targetId, agg); }
            if (moveActive) agg.moveMult *= moveMult;
            if (atkActive)  agg.atkMult  *= atkMult;
        }

        for (const [entityId, agg] of combined.entries()) {
            // Cache original values once, then apply the modified ones each tick.
            if (!this._ccBaselines.has(entityId)) {
                const vel    = this.game.getComponent(entityId, 'velocity');
                const combat = this.game.getComponent(entityId, 'combat');
                this._ccBaselines.set(entityId, {
                    maxSpeed:    vel?.maxSpeed,
                    attackSpeed: combat?.attackSpeed
                });
            }
            const baseline = this._ccBaselines.get(entityId);
            const vel    = this.game.getComponent(entityId, 'velocity');
            const combat = this.game.getComponent(entityId, 'combat');
            if (vel && baseline.maxSpeed != null && agg.moveMult !== 1) {
                vel.maxSpeed = baseline.maxSpeed * agg.moveMult;
                // Hard stop: zero current velocity too so the unit halts immediately,
                // not after gradual deceleration through the movement system.
                if (agg.moveMult === 0) { vel.vx = 0; vel.vz = 0; }
            }
            if (combat && baseline.attackSpeed != null && agg.atkMult !== 1) {
                combat.attackSpeed = baseline.attackSpeed * agg.atkMult;
            }
        }

        // Restore baselines for entities no longer under speed-modifying CC.
        for (const entityId of [...this._ccBaselines.keys()]) {
            if (combined.has(entityId)) continue;
            const baseline = this._ccBaselines.get(entityId);
            const vel    = this.game.getComponent(entityId, 'velocity');
            const combat = this.game.getComponent(entityId, 'combat');
            if (vel && baseline.maxSpeed != null)       vel.maxSpeed = baseline.maxSpeed;
            if (combat && baseline.attackSpeed != null) combat.attackSpeed = baseline.attackSpeed;
            this._ccBaselines.delete(entityId);
        }
    }

    // True if the entity is under a hard-CC buff (can't attack/move).
    // Used by AttackEnemyBehaviorAction to early-out.
    isHardCC(entityId) {
        const t = this.enums.buffTypes || {};
        for (const buff of this.getBuffs(entityId)) {
            if (buff.buffType === t.stunned
                || buff.buffType === t.frozen
                || buff.buffType === t.polymorphed
                || buff.buffType === t.banished) return true;
        }
        return false;
    }

    // Feared: not hard CC (the unit keeps moving) — it flees instead of attacking.
    // AttackEnemyBehaviorAction reads this to redirect the unit away from its target.
    isFeared(entityId) {
        const feared = this.enums.buffTypes?.feared;
        if (feared == null) return false;
        for (const buff of this.getBuffs(entityId)) {
            if (buff.buffType === feared) return true;
        }
        return false;
    }

    isSilenced(entityId) {
        const t = this.enums.buffTypes || {};
        for (const buff of this.getBuffs(entityId)) {
            if (buff.buffType === t.silenced)    return true;
            if (buff.buffType === t.polymorphed) return true; // polymorphed can't cast either
            // Anything with `abilitiesDisabled` or `castDisabled` set in its buff type
            // def (e.g. disrupted, frozen, polymorphed) also blocks ability use.
            const def = this.call.getBuffTypeDef(buff.buffType);
            if (def?.abilitiesDisabled || def?.castDisabled) return true;
        }
        return false;
    }

    // If the entity is taunted, returns the entity they're forced to attack
    // (the taunt's sourceEntity). Returns null when not taunted, the source
    // is invalid, or the source is dead. Called by AttackEnemyBehaviorAction
    // and FindNearestEnemyBehaviorAction to override target selection.
    getTauntForcedTarget(entityId) {
        const buff = this.getBuffOfType(entityId, this.enums.buffTypes?.taunted);
        if (!buff) return null;

        const def = this.call.getBuffTypeDef(buff.buffType);
        if (!def?.forcedTarget) return null;

        const sourceId = buff.sourceEntity;
        if (sourceId == null || sourceId < 0) return null;

        const srcHealth = this.game.getComponent(sourceId, 'health');
        const srcDeath  = this.game.getComponent(sourceId, 'deathState');
        if (!srcHealth || srcHealth.current <= 0) return null;
        if (srcDeath && srcDeath.state !== this.enums.deathState?.alive) return null;

        return sourceId;
    }

    // Heals entities with the `regenerating` buff for `healPerSecond` HP / sec.
    // Granularity = 1 second so the numbers stay readable in combat logs.
    _tickRegeneration() {
        const now = this.game.state.now;
        if (now - this._regenAccumulator < 1.0) return;
        this._regenAccumulator = now;

        const regenBuffType = this.enums.buffTypes?.regenerating;
        if (regenBuffType == null) return;

        for (const buffEntity of this.game.getEntitiesWith('buff')) {
            const buff = this.game.getComponent(buffEntity, 'buff');
            if (!buff || buff.buffType !== regenBuffType) continue;
            if (buff.endTime && now > buff.endTime) continue;
            const targetId = buff.targetEntity;
            if (targetId == null) continue;

            const buffTypeDef = this.call.getBuffTypeDef(buff.buffType);
            if (!buffTypeDef?.healPerSecond) continue;

            const health = this.game.getComponent(targetId, 'health');
            if (!health || health.current <= 0 || health.current >= health.max) continue;

            health.current = Math.min(health.max, health.current + buffTypeDef.healPerSecond);
        }
    }

    // Detects deaths between ticks and credits the killer a bloodlust stack
    // when they have the buff active. Uses deathState transition (alive -> not-alive)
    // and reads `combatState.lastAttacker` to identify the killer.
    _tickKillDetection() {
        const bloodlustBuffType = this.enums.buffTypes?.bloodlust;
        if (bloodlustBuffType == null) return;

        const aliveState = this.enums.deathState?.alive;
        const allWithHealth = this.game.getEntitiesWith('health', 'deathState');

        const stillAlive = new Set();
        for (const entityId of allWithHealth) {
            const ds = this.game.getComponent(entityId, 'deathState');
            if (ds && ds.state === aliveState) stillAlive.add(entityId);
        }

        // Anything alive last tick but not alive this tick → just died.
        for (const entityId of this._aliveLastTick) {
            if (stillAlive.has(entityId)) continue;
            this._creditBloodlustKill(entityId, bloodlustBuffType);
        }

        this._aliveLastTick = stillAlive;
    }

    _creditBloodlustKill(deadEntityId, bloodlustBuffType) {
        const combatState = this.game.getComponent(deadEntityId, 'combatState');
        const killerId = combatState?.lastAttacker;
        if (killerId == null || killerId < 0) return;

        const killerBuff = this.getBuffOfType(killerId, bloodlustBuffType);
        if (!killerBuff) return;

        const buffTypeDef = this.call.getBuffTypeDef(killerBuff.buffType);
        const maxStacks = buffTypeDef?.maxStacks ?? 10;
        if ((killerBuff.stacks || 0) < maxStacks) {
            killerBuff.stacks = (killerBuff.stacks || 0) + 1;
        }
    }

    // Watches combatState.lastAttackTime per tick to detect newly-landed hits and
    // fires on-hit effects from the attacker's buffs and target-side reflect from
    // the target's buffs. Works for melee, projectiles, and ability damage alike.
    _tickOnHitEffects() {
        const entities = this.game.getEntitiesWith('combatState', 'health');

        for (const entityId of entities) {
            const combatState = this.game.getComponent(entityId, 'combatState');
            const health = this.game.getComponent(entityId, 'health');
            if (!combatState || !health) continue;

            const prevAttackTime = this._lastAttackTimeSeen.get(entityId) || 0;
            const prevHealth     = this._lastHealthSeen.get(entityId);
            const currHealth     = health.current;

            this._lastAttackTimeSeen.set(entityId, combatState.lastAttackTime || 0);
            this._lastHealthSeen.set(entityId, currHealth);

            // No new attack since last tick.
            if (!combatState.lastAttackTime || combatState.lastAttackTime <= prevAttackTime) continue;

            const attackerId = combatState.lastAttacker;
            if (attackerId == null || attackerId < 0 || attackerId === entityId) continue;

            // Damage dealt this tick — if missing (first observation) we can't size effects.
            const damageDealt = prevHealth != null ? Math.max(0, prevHealth - currHealth) : 0;
            if (damageDealt <= 0) continue;

            this._applyAttackerOnHit(attackerId, entityId, damageDealt);
            this._applyTargetReflect(attackerId, entityId, damageDealt);
        }

        this._gcStaleTrackers(entities);
    }

    // On-hit effects from EVERY active attacker buff — poisoned_weapon,
    // enchant_weapon, and bloodlust lifesteal can all fire off the same hit
    // now that they can coexist.
    _applyAttackerOnHit(attackerId, targetId, damageDealt) {
        const enums = this.enums;
        for (const buff of this.getBuffs(attackerId)) {
            const buffTypeDef = this.call.getBuffTypeDef(buff.buffType);
            if (!buffTypeDef) continue;

            if (buff.buffType === enums.buffTypes?.poisoned_weapon) {
                const attackerCombat = this.game.getComponent(attackerId, 'combat');
                const baseDmg = attackerCombat?.damage || damageDealt;
                const multiplier = buffTypeDef.poisonDamageMultiplier ?? 0.4;
                const duration   = buffTypeDef.poisonDuration ?? 4;
                const poisonDmg  = Math.max(1, Math.round(baseDmg * multiplier));
                this.call.scheduleDamage(attackerId, targetId, poisonDmg, enums.element.poison, 0, { duration });
                continue;
            }

            if (buff.buffType === enums.buffTypes?.enchant_weapon) {
                const elementalDamage = buffTypeDef.elementalDamage ?? 0;
                if (elementalDamage > 0) {
                    const element = buff.weaponElement ?? enums.element?.fire ?? enums.element?.physical;
                    this.call.scheduleDamage(attackerId, targetId, elementalDamage, element, 0, {});
                }
                continue;
            }

            if (buff.buffType === enums.buffTypes?.bloodlust) {
                const lifeStealPct = buffTypeDef.lifeSteal ?? 0;
                if (lifeStealPct > 0) {
                    const healAmount = Math.max(1, Math.round(damageDealt * lifeStealPct));
                    const attackerHealth = this.game.getComponent(attackerId, 'health');
                    if (attackerHealth && attackerHealth.current > 0) {
                        attackerHealth.current = Math.min(attackerHealth.max, attackerHealth.current + healAmount);
                    }
                }
                continue;
            }
        }
    }

    _applyTargetReflect(attackerId, targetId, damageDealt) {
        const enums = this.enums;
        for (const buff of this.getBuffs(targetId)) {
            const isThorns = buff.buffType === enums.buffTypes?.thorns_aura
                          || buff.buffType === enums.buffTypes?.retaliation;
            if (!isThorns) continue;

            const buffTypeDef = this.call.getBuffTypeDef(buff.buffType);
            const pct = buffTypeDef?.thornsPercent ?? 0;
            if (pct <= 0) continue;

            const reflectDmg = Math.max(1, Math.round(damageDealt * pct));
            this.call.scheduleDamage(targetId, attackerId, reflectDmg, enums.element.physical, 0, {});
        }
    }

    // Emit floating damage numbers for poison DoT ticks. Global DamageSystem
    // updates the target HP and a subtle flash but never calls showDamageNumber
    // for poison (the element early-returns from applyDamage). We watch
    // poison.lastTickTime per entity and emit the tick damage when it advances.
    _tickPoisonDamageNumbers() {
        if (!this.game.hasService?.('showDamageNumber')) return;

        const poisonElement = this.enums.element?.poison;
        const entities = this.game.getEntitiesWith('poison', 'transform');

        const live = new Set();

        for (const entityId of entities) {
            live.add(entityId);
            const poison = this.game.getComponent(entityId, 'poison');
            if (!poison || poison.stacks <= 0) continue;

            const prev = this._lastPoisonTickSeen.get(entityId) || 0;
            const curr = poison.lastTickTime || 0;
            this._lastPoisonTickSeen.set(entityId, curr);

            if (curr <= prev) continue;

            const tickDamage = (poison.damagePerStack || 0) * (poison.stacks || 0);
            if (tickDamage <= 0) continue;

            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.getUnitTypeDef?.(unitTypeComp);
            const yOffset = unitType?.height || 50;

            this.call.showDamageNumber(pos.x, pos.y + yOffset, pos.z, tickDamage, poisonElement);
        }

        // GC: forget entities that no longer have a poison component.
        if (this._lastPoisonTickSeen.size > live.size) {
            for (const id of this._lastPoisonTickSeen.keys()) {
                if (!live.has(id)) this._lastPoisonTickSeen.delete(id);
            }
        }
    }

    // Drop tracking entries for entities that no longer exist so the maps don't grow forever.
    _gcStaleTrackers(currentEntities) {
        if (this._lastAttackTimeSeen.size < 256) return;
        const live = new Set(currentEntities);
        for (const id of this._lastAttackTimeSeen.keys()) {
            if (!live.has(id)) {
                this._lastAttackTimeSeen.delete(id);
                this._lastHealthSeen.delete(id);
            }
        }
    }
}
