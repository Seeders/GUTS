// Per-tick handler for buff effects that aren't consumed by the shared
// global DamageSystem. Specifically:
//   * regenerating:       heals buff holders each second (healPerSecond)
//   * bloodlust:          credits a kill stack to the killer when an enemy dies
//   * poisoned_weapon:    applies poison-DoT when the attacker lands a hit
//   * enchant_weapon:     deals a bonus elemental hit when the attacker lands a hit
//   * bloodlust:          heals attacker for lifeSteal% of damage dealt
//   * thorns_aura/retaliation: reflects damage back to the attacker
//
// On-hit / on-take-damage effects are driven by watching combatState.lastAttackTime
// for changes per tick — that fires for melee, projectiles, and ability damage
// uniformly, since they all funnel through DamageSystem.applyDamage which stamps
// combatState. The bloodlust *damage bonus* itself is baked into the attacker's
// outgoing damage by AttackEnemyBehaviorAction (since it needs to land in the
// same hit), and wind_shield deflection is handled there too (pre-fire check).
class BuffEffectsSystem extends GUTS.BaseSystem {

    static services = [];

    static serviceDependencies = [
        'getBuffTypeDef',
        'scheduleDamage',
        'showDamageNumber'
    ];

    constructor(game) {
        super(game);
        this.game.buffEffectsSystem = this;
        console.log('[BuffFx] BuffEffectsSystem instantiated');

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

    // End-of-round teardown. Buff expiry normally runs off scheduled actions,
    // which ServerBattlePhaseSystem clears at battle end — and buff.endTime is
    // compared against the battle clock, which RESETS each round. A leftover
    // buff/poison on an entity that persists across rounds (buildings) would
    // therefore zombie-reactivate next battle. Restore CC-modified stats, strip
    // the components, and reset per-battle tracking.
    onBattleEnd() {
        for (const [entityId, baseline] of this._ccBaselines.entries()) {
            const vel    = this.game.getComponent(entityId, 'velocity');
            const combat = this.game.getComponent(entityId, 'combat');
            if (vel && baseline.maxSpeed != null)       vel.maxSpeed = baseline.maxSpeed;
            if (combat && baseline.attackSpeed != null) combat.attackSpeed = baseline.attackSpeed;
        }
        this._ccBaselines.clear();

        for (const entityId of [...this.game.getEntitiesWith('buff')]) {
            this.game.removeComponent(entityId, 'buff');
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
        if (!this._loggedFirstUpdate) {
            console.log('[BuffFx] First update() call', {
                isServer: this.game.isServer,
                isLocalGame: this.game.state?.isLocalGame,
                phase: this.game.state?.phase
            });
            this._loggedFirstUpdate = true;
        }
        // Gameplay logic is server-authoritative (local-machine 2-player counts).
        if (this.game.isServer || this.game.state?.isLocalGame) {
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

    // Applies movement / attack-speed modifiers from active CC buffs each tick.
    // Stores the entity's pre-debuff baseline so we can restore it when the buff
    // expires. The other CC dimensions (action prevention for stun / freeze /
    // polymorph / silence) are handled inline by the gating code in
    // AttackEnemyBehaviorAction.execute and AbilitySystem.useAbility — those
    // call BuffEffectsSystem.isHardCC()/isSilenced() to check.
    _tickCCEffects() {
        const now = this.enums ? this.game.state.now : 0;
        const entities = this.game.getEntitiesWith('buff', 'combat');

        const stillBuffed = new Set();
        for (const entityId of entities) {
            const buff = this.game.getComponent(entityId, 'buff');
            if (!buff) continue;
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

            stillBuffed.add(entityId);

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
            if (vel && baseline.maxSpeed != null && moveActive) {
                vel.maxSpeed = baseline.maxSpeed * moveMult;
                // Hard stop: zero current velocity too so the unit halts immediately,
                // not after gradual deceleration through the movement system.
                if (moveMult === 0) { vel.vx = 0; vel.vz = 0; }
            }
            if (combat && baseline.attackSpeed != null && atkActive) {
                combat.attackSpeed = baseline.attackSpeed * atkMult;
            }
        }

        // Restore baselines for entities no longer under speed-modifying CC.
        for (const entityId of this._ccBaselines.keys()) {
            if (stillBuffed.has(entityId)) continue;
            const baseline = this._ccBaselines.get(entityId);
            const vel    = this.game.getComponent(entityId, 'velocity');
            const combat = this.game.getComponent(entityId, 'combat');
            if (vel && baseline.maxSpeed != null)       vel.maxSpeed = baseline.maxSpeed;
            if (combat && baseline.attackSpeed != null) combat.attackSpeed = baseline.attackSpeed;
            this._ccBaselines.delete(entityId);
        }
    }

    // True if the entity is under a hard-CC buff (can't attack/move).
    // Used by AttackEnemyBehaviorAction to early-out. Doesn't check buff expiry
    // because the schedulingSystem actions added by the CC abilities themselves
    // remove the buff when its duration ends — defense in depth via endTime.
    isHardCC(entityId) {
        const buff = this.game.getComponent(entityId, 'buff');
        if (!buff) return false;
        if (buff.endTime && this.game.state.now > buff.endTime) return false;
        const t = this.enums.buffTypes || {};
        return buff.buffType === t.stunned
            || buff.buffType === t.frozen
            || buff.buffType === t.polymorphed
            || buff.buffType === t.banished;
    }

    isSilenced(entityId) {
        const buff = this.game.getComponent(entityId, 'buff');
        if (!buff) return false;
        if (buff.endTime && this.game.state.now > buff.endTime) return false;
        const t = this.enums.buffTypes || {};
        if (buff.buffType === t.silenced)    return true;
        if (buff.buffType === t.polymorphed) return true; // polymorphed can't cast either
        // Anything with `abilitiesDisabled` or `castDisabled` set in its buff type
        // def (e.g. disrupted, frozen, polymorphed) also blocks ability use.
        const def = this.call.getBuffTypeDef(buff.buffType);
        return !!(def?.abilitiesDisabled || def?.castDisabled);
    }

    // If the entity is taunted, returns the entity they're forced to attack
    // (the taunt's sourceEntity). Returns null when not taunted, the source
    // is invalid, or the source is dead. Called by AttackEnemyBehaviorAction
    // to override target selection.
    getTauntForcedTarget(entityId) {
        const buff = this.game.getComponent(entityId, 'buff');
        if (!buff) return null;
        if (buff.endTime && this.game.state.now > buff.endTime) return null;
        if (buff.buffType !== this.enums.buffTypes?.taunted) return null;

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

        const enums = this.enums;
        const regenBuffType = enums.buffTypes?.regenerating;
        if (regenBuffType == null) return;

        const entities = this.game.getEntitiesWith('buff', 'health');
        for (const entityId of entities) {
            const buff = this.game.getComponent(entityId, 'buff');
            if (!buff || buff.buffType !== regenBuffType) continue;
            if (buff.endTime && now > buff.endTime) continue;

            const buffTypeDef = this.call.getBuffTypeDef(buff.buffType);
            if (!buffTypeDef?.healPerSecond) continue;

            const health = this.game.getComponent(entityId, 'health');
            if (!health || health.current <= 0 || health.current >= health.max) continue;

            health.current = Math.min(health.max, health.current + buffTypeDef.healPerSecond);
        }
    }

    // Detects deaths between ticks and credits the killer a bloodlust stack
    // when they have the buff active. Uses deathState transition (alive -> not-alive)
    // and reads `combatState.lastAttacker` to identify the killer.
    _tickKillDetection() {
        const enums = this.enums;
        const bloodlustBuffType = enums.buffTypes?.bloodlust;
        if (bloodlustBuffType == null) return;

        const aliveState = enums.deathState?.alive;
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

        const killerBuff = this.game.getComponent(killerId, 'buff');
        if (!killerBuff || killerBuff.buffType !== bloodlustBuffType) return;

        const buffTypeDef = this.call.getBuffTypeDef(killerBuff.buffType);
        const maxStacks = buffTypeDef?.maxStacks ?? 10;
        if ((killerBuff.stacks || 0) < maxStacks) {
            killerBuff.stacks = (killerBuff.stacks || 0) + 1;
        }
    }

    // Watches combatState.lastAttackTime per tick to detect newly-landed hits and
    // fires on-hit effects from the attacker's buff and target-side reflect from
    // the target's buff. Works for melee, projectiles, and ability damage alike.
    _tickOnHitEffects() {
        const enums = this.enums;
        const entities = this.game.getEntitiesWith('combatState', 'health');

        if (!this._loggedEntityCount && entities.length > 0) {
            console.log('[BuffFx] On-hit watcher seeing', entities.length, 'combatState entities');
            this._loggedEntityCount = true;
        }

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

            // Diagnostic: log only when attacker has a buff (signal the on-hit hook is firing).
            const atkBuff = this.game.getComponent(attackerId, 'buff');
            if (atkBuff) {
                const buffName = this.reverseEnums?.buffTypes?.[atkBuff.buffType] ?? atkBuff.buffType;
                console.log('[BuffFx] On-hit triggered:', { attackerId, targetId: entityId, damageDealt, attackerBuff: buffName });
            }

            this._applyAttackerOnHit(attackerId, entityId, damageDealt);
            this._applyTargetReflect(attackerId, entityId, damageDealt);
        }

        this._gcStaleTrackers(entities);
    }

    _applyAttackerOnHit(attackerId, targetId, damageDealt) {
        const buff = this.game.getComponent(attackerId, 'buff');
        if (!buff) return;

        const enums = this.enums;
        const buffTypeDef = this.call.getBuffTypeDef(buff.buffType);
        if (!buffTypeDef) return;

        if (buff.buffType === enums.buffTypes?.poisoned_weapon) {
            const attackerCombat = this.game.getComponent(attackerId, 'combat');
            const baseDmg = attackerCombat?.damage || damageDealt;
            const multiplier = buffTypeDef.poisonDamageMultiplier ?? 0.4;
            const duration   = buffTypeDef.poisonDuration ?? 4;
            const poisonDmg  = Math.max(1, Math.round(baseDmg * multiplier));
            console.log('[BuffFx] Scheduling poison damage', { attackerId, targetId, poisonDmg, duration });
            this.call.scheduleDamage(attackerId, targetId, poisonDmg, enums.element.poison, 0, { duration });
            return;
        }

        if (buff.buffType === enums.buffTypes?.enchant_weapon) {
            const elementalDamage = buffTypeDef.elementalDamage ?? 0;
            if (elementalDamage > 0) {
                const element = buff.weaponElement ?? enums.element?.fire ?? enums.element?.physical;
                this.call.scheduleDamage(attackerId, targetId, elementalDamage, element, 0, {});
            }
            return;
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
            return;
        }
    }

    _applyTargetReflect(attackerId, targetId, damageDealt) {
        const targetBuff = this.game.getComponent(targetId, 'buff');
        if (!targetBuff) return;

        const enums = this.enums;
        const isThorns = targetBuff.buffType === enums.buffTypes?.thorns_aura
                      || targetBuff.buffType === enums.buffTypes?.retaliation;
        if (!isThorns) return;

        const buffTypeDef = this.call.getBuffTypeDef(targetBuff.buffType);
        const pct = buffTypeDef?.thornsPercent ?? 0;
        if (pct <= 0) return;

        const reflectDmg = Math.max(1, Math.round(damageDealt * pct));
        this.call.scheduleDamage(targetId, attackerId, reflectDmg, enums.element.physical, 0, {});
    }

    // Emit floating damage numbers for poison DoT ticks. Global DamageSystem
    // updates the target HP and a subtle flash but never calls showDamageNumber
    // for poison (the element early-returns from applyDamage). We watch
    // poison.lastTickTime per entity and emit the tick damage when it advances.
    _tickPoisonDamageNumbers() {
        const hasService = this.game.hasService?.('showDamageNumber');
        if (!hasService) {
            if (!this._loggedNoShowService) {
                console.warn('[BuffFx] showDamageNumber service NOT registered — poison numbers disabled');
                this._loggedNoShowService = true;
            }
            return;
        }

        const poisonElement = this.enums.element?.poison;
        const entities = this.game.getEntitiesWith('poison', 'transform');

        if (entities.length > 0 && !this._loggedFirstPoisoned) {
            console.log('[BuffFx] First poisoned entity detected:', entities[0]);
            this._loggedFirstPoisoned = true;
        }

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

            // console.log('[BuffFx] Poison tick number', { entityId, tickDamage, stacks: poison.stacks });
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
