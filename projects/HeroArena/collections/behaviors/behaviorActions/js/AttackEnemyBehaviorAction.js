/**
 * AttackEnemyBehaviorAction - Combat action
 * Attacks the target enemy stored in shared state
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key in shared state for target entity ID
 *
 * Returns RUNNING while attacking (continuous action)
 */
class AttackEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'setBillboardAnimation',
        'triggerSinglePlayAnimation',
        'scheduleDamage',
        'getEntityAbilities',
        'fireProjectile',
        'getVisibleEnemiesInRange'
    ];

    // Anti-building damage scaling by attacker shop tier (ArmyShopSystem.unitTier).
    // Sieging is the job of high-tier units — the win condition is the enemy Town
    // Hall, and tier 1 chip damage shouldn't threaten it. Applies to basic attacks
    // (melee + projectile) against entities with a buildingOwner component.
    static BUILDING_DAMAGE_MULT = { 1: 0.25, 2: 1.0, 3: 4.0 };
    static BUILDING_DAMAGE_MULT_DEFAULT = 0.5; // summons/specials with no shop tier

    // Mechabellum turn speed: units rotate toward their target at
    // combat.turnSpeed rad/s and may only fire once facing within this cone.
    static FIRE_CONE = 0.35; // rad (~20°)

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.getUnitTypeDef( unitTypeComp);

        // Air rule: a grounded melee attacker can never engage a flyer, even
        // if another node handed it one — drop the target and report failure.
        if (targetId != null) {
            const targetDefAir = game.getUnitTypeDef(game.getComponent(targetId, 'unitType'));
            const techAntiAir = game.getComponent(entityId, 'heroRosterInfo')?.canTargetAir;
            if (targetDefAir?.isFlying && !unitDef?.canTargetAir && !unitDef?.isFlying && !techAntiAir) {
                shared[targetKey] = null;
                return this.failure();
            }
        }
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;
        const unitName = unitDef?.id || 'unknown';

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            log.trace('AttackEnemy', `${unitName}(${entityId}) [${teamName}] FAILURE - no valid target`, {
                targetId
            });
            return this.failure();
        }

        const combat = game.getComponent(entityId, 'combat');
        if (!combat) {
            log.trace('AttackEnemy', `${unitName}(${entityId}) [${teamName}] FAILURE - no combat component`);
            return this.failure();
        }

        // Hard CC (stun / freeze / polymorph / banish) blocks any attack action.
        // Stop velocity too so the unit doesn't drift while stunned.
        if (game.buffEffectsSystem?.isHardCC?.(entityId)) {
            const v = game.getComponent(entityId, 'velocity');
            if (v) { v.vx = 0; v.vz = 0; }
            return this.running({ target: targetId, attacking: false, ccLocked: true });
        }

        // Fear: the unit can't attack and runs AWAY from its target. Hand the
        // movement system a flee target (behaviorMeta.targetPosition) directly away
        // from the threat, and don't attack. Hard CC above takes priority.
        if (game.buffEffectsSystem?.isFeared?.(entityId)) {
            const myPos = game.getComponent(entityId, 'transform')?.position;
            const threatPos = game.getComponent(targetId, 'transform')?.position;
            if (myPos && threatPos) {
                const dx = myPos.x - threatPos.x;
                const dz = myPos.z - threatPos.z;
                const d = Math.sqrt(dx * dx + dz * dz) || 1;
                const FLEE_DIST = 300;
                return this.running({
                    attacking: false, feared: true,
                    targetPosition: { x: myPos.x + (dx / d) * FLEE_DIST, z: myPos.z + (dz / d) * FLEE_DIST }
                });
            }
            return this.running({ attacking: false, feared: true });
        }

        // Taunt: if this entity is taunted, force the target to be the taunt's
        // source instead of whatever the behavior tree picked.
        const tauntTarget = game.buffEffectsSystem?.getTauntForcedTarget?.(entityId);
        if (tauntTarget != null) {
            // Mutate the shared state so subsequent steps (and any frame the
            // behavior tree reads shared state) also see the forced target.
            shared[targetKey] = tauntTarget;
        }
        const effectiveTargetId = tauntTarget != null ? tauntTarget : targetId;

        log.debug('AttackEnemy', `${unitName}(${entityId}) [${teamName}] ATTACKING target`, {
            targetId,
            damage: combat.damage,
            attackSpeed: combat.attackSpeed,
            range: combat.range,
            hasProjectile: combat.projectile !== null && combat.projectile !== -1 && combat.projectile !== undefined
        });

        // Stop movement while attacking
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.vx = 0;
            vel.vz = 0;
        }

        // Perform attack
        this.performAttack(entityId, effectiveTargetId, game, combat, log, unitName, teamName);

        // Return running - attacking is a continuous action
        return this.running({
            target: effectiveTargetId,
            attacking: true
        });
    }

    onEnd(entityId, game) {
        // Reset animation to idle when combat ends
        if (!game.isServer && game.hasService('setBillboardAnimation')) {
            const enums = game.getEnums();
            this.call.setBillboardAnimation( entityId, enums.animationType.idle, true);
        }
    }

    performAttack(attackerId, targetId, game, combat, log, unitName, teamName) {
        // Casting blocks basic attacks: a queued (non-passive) ability owns
        // the attack slot until it executes — an apprentice mid-cast must not
        // also throw its basic projectile in the same moment. Passives never
        // queue, so they're unaffected.
        const queuedAbility = game.getComponent(attackerId, 'abilityQueue');
        if (queuedAbility && (queuedAbility.abilityId != null || queuedAbility.abilityStringId)) {
            return;
        }

        // Face the target
        const attackerTransform = game.getComponent(attackerId, 'transform');
        const attackerPos = attackerTransform?.position;
        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;

        // Mechabellum turn speed: rotate toward the target at combat.turnSpeed
        // rad/s and HOLD FIRE until facing within FIRE_CONE. Anchored units
        // (buildings/towers) skip rotation and fire in any direction.
        const velocity = game.getComponent(attackerId, 'velocity');
        if (attackerPos && targetPos && attackerTransform && !velocity?.anchored) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            if (!attackerTransform.rotation) attackerTransform.rotation = { x: 0, y: 0, z: 0 };
            const desired = Math.atan2(dz, dx);
            const current = attackerTransform.rotation.y || 0;
            let diff = desired - current;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const turnSpeed = combat.turnSpeed || 10;
            const maxStep = turnSpeed * (game.deltaTime || 0.05);
            const remaining = Math.abs(diff) - maxStep;
            if (remaining <= 0) {
                attackerTransform.rotation.y = Math.round(desired * 1000000) / 1000000;
            } else {
                let next = current + Math.sign(diff) * maxStep;
                if (next > Math.PI) next -= 2 * Math.PI;
                if (next < -Math.PI) next += 2 * Math.PI;
                attackerTransform.rotation.y = Math.round(next * 1000000) / 1000000;
            }
            // Still swinging around — can't fire yet (applies to abilities too).
            if (remaining > AttackEnemyBehaviorAction.FIRE_CONE) return;
        }

        // Note: projectile index 0 is valid (first alphabetically sorted projectile like "arrow")
        // null, undefined, or -1 means "no projectile"
        const hasProjectile = combat.projectile !== null && combat.projectile !== -1 && combat.projectile !== undefined;

        // Ability-only units (damage = 0, no projectile) use abilities for combat
        // Abilities have their own cooldowns managed by AbilitySystem
        if (!hasProjectile && combat.damage <= 0 && game.abilitySystem) {
            log.trace('AttackEnemy', `${unitName}(${attackerId}) [${teamName}] using offensive ability`);
            this.useOffensiveAbility(attackerId, targetId, game);
            return;
        }

        // Basic attacks (projectile or melee) use attackSpeed cooldown
        if (!combat.lastAttack) combat.lastAttack = 0;
        const effectiveAttackSpeed = this.getEffectiveAttackSpeed(attackerId, game, combat.attackSpeed);

        if (effectiveAttackSpeed > 0) {
            const timeSinceLastAttack = game.state.now - combat.lastAttack;
            if (timeSinceLastAttack < 1 / effectiveAttackSpeed) {
                log.trace('AttackEnemy', `${unitName}(${attackerId}) [${teamName}] attack on cooldown`, {
                    timeSinceLastAttack: timeSinceLastAttack.toFixed(2),
                    cooldown: (1 / effectiveAttackSpeed).toFixed(2)
                });
                return;
            }
        }

        combat.lastAttack = game.state.now;

        // Trigger attack animation (sprite direction is derived from rotation.y set above)
        if (!game.isServer && game.hasService('triggerSinglePlayAnimation') && effectiveAttackSpeed > 0) {
            const enums = game.getEnums();
            const animationSpeed = combat.attackSpeed;
            const minAnimationTime = 1 / combat.attackSpeed * 0.8;
            this.call.triggerSinglePlayAnimation( attackerId, enums.animationType.attack, animationSpeed, minAnimationTime);
        }

        // Bloodlust bonus damage is baked into the outgoing damage value so it
        // flows through both melee and projectile paths. On-hit side-effects
        // (poison, lifesteal, enchant elemental, thorns reflect) are handled by
        // BuffEffectsSystem watching combatState.lastAttackTime per tick, so they
        // fire when damage actually lands regardless of delivery method.
        const bonusDamage = this._getBloodlustBonusDamage(attackerId, game);
        const totalDamage = ((combat.damage || 0) + bonusDamage) *
            this._buildingDamageMultiplier(attackerId, targetId, game);

        // Handle projectile or melee damage
        // Note: projectile index 0 is valid, only -1 means "no projectile"
        if (hasProjectile) {
            log.trace('AttackEnemy', `${unitName}(${attackerId}) [${teamName}] firing projectile at target ${targetId}`, {
                projectileIndex: combat.projectile,
                damage: totalDamage,
                bonus: bonusDamage
            });
            // Schedule projectile to fire at 50% through the attack animation (release point)
            const projectileDelay = effectiveAttackSpeed > 0 ? (1 / combat.attackSpeed) * 0.5 : 0;
            game.schedulingSystem.scheduleAction(() => {
                // A cast queued between swing start and the release point
                // ABORTS the swing — otherwise the unit visibly casts (one
                // animation) yet its basic projectile still comes out an
                // instant later.
                const q = game.getComponent(attackerId, 'abilityQueue');
                if (q && (q.abilityId != null || q.abilityStringId)) return;

                // Multi-Shot passive: every attack fires at up to maxTargets
                // distinct enemies, and ALL arrows (primary too) take the
                // damage penalty — the specialization tradeoff.
                const ms = this._multishotAbility(attackerId);
                const arrowDamage = ms ? totalDamage * (ms.arrowDamageMult ?? 1) : totalDamage;
                this.fireProjectile(attackerId, targetId, game, combat, arrowDamage);
                if (ms) this.fireMultishotExtras(attackerId, targetId, game, combat, arrowDamage, ms);
            }, projectileDelay, attackerId);
        } else if (combat.damage > 0) {
            const damageDelay = effectiveAttackSpeed > 0 ? (1 / combat.attackSpeed) * 0.5 : 0;
            const element = this.getDamageElement(attackerId, game, combat);

            log.trace('AttackEnemy', `${unitName}(${attackerId}) [${teamName}] melee attack on target ${targetId}`, {
                damage: totalDamage,
                bonus: bonusDamage
            });

            this.call.scheduleDamage(
                attackerId,
                targetId,
                totalDamage,
                element,
                damageDelay,
                {
                    isMelee: true,
                    weaponRange: (combat.range || 50) + 10
                }
            );
        }
    }

    // Looks up a buff type definition from its numeric enum index. Walks the
    // sorted collection keys the same way DamageSystem.getBuffTypeDef does.
    _getBuffDefByIndex(game, buffTypeIndex) {
        const buffTypes = game.getCollections()?.buffTypes;
        if (!buffTypes) return null;
        const key = Object.keys(buffTypes).sort()[buffTypeIndex];
        return buffTypes[key] || null;
    }

    // Bloodlust stacks grant flat bonus damage per stack (damagePerKill field).
    // Stacks are awarded by BuffEffectsSystem when an enemy dies.
    _getBloodlustBonusDamage(attackerId, game) {
        const enums = game.getEnums();
        const buff = game.buffEffectsSystem?.getBuffOfType(attackerId, enums.buffTypes?.bloodlust);
        if (!buff) return 0;
        const buffTypeDef = this._getBuffDefByIndex(game, buff.buffType);
        if (!buffTypeDef) return 0;
        const perStack = buffTypeDef.damagePerKill ?? 0;
        return (buff.stacks || 0) * perStack;
    }

    useOffensiveAbility(attackerId, targetId, game) {
        const abilities = this.call.getEntityAbilities( attackerId);
        if (!abilities || abilities.length === 0) return;

        // Find available offensive abilities
        const availableAbilities = abilities
            .filter(ability => game.abilitySystem.isAbilityOffCooldown(attackerId, ability.id))
            .filter(ability => !ability.canExecute || ability.canExecute(attackerId))
            .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));

        if (availableAbilities.length > 0) {
            // Pass targetId directly as a number - ECS components require numeric values
            game.abilitySystem.useAbility(attackerId, availableAbilities[0].id, targetId);
        }
    }

    _multishotAbility(attackerId) {
        const abilities = this.call.getEntityAbilities?.(attackerId);
        if (!abilities || abilities.length === 0) return null;
        return abilities.find(a => a.id === 'MultiShotAbility') || null;
    }

    // Multi-Shot passive (unit tech): fire arrows at OTHER enemies in attack
    // range — one per distinct target, closest first, up to maxTargets total
    // arrows (primary included). Deterministic: distance sort, entity-id
    // tiebreak. `arrowDamage` arrives pre-penalized (see the release callback).
    fireMultishotExtras(attackerId, primaryTargetId, game, combat, arrowDamage, ms) {
        if (!ms) return;
        const extraCount = Math.max(0, (ms.maxTargets ?? 3) - 1);
        if (extraCount === 0) return;

        const myPos = game.getComponent(attackerId, 'transform')?.position;
        if (!myPos) return;
        const myDef = game.getUnitTypeDef(game.getComponent(attackerId, 'unitType'));
        const canHitAir = !!(myDef?.canTargetAir || myDef?.isFlying ||
            game.getComponent(attackerId, 'heroRosterInfo')?.canTargetAir);

        const range = combat.range || 100;
        const candidates = this.call.getVisibleEnemiesInRange?.(attackerId, range) || [];

        const scored = [];
        for (const eid of candidates) {
            if (eid === primaryTargetId) continue;
            const hp = game.getComponent(eid, 'health');
            if (!hp || hp.current <= 0) continue;
            if (!canHitAir) {
                const def = game.getUnitTypeDef(game.getComponent(eid, 'unitType'));
                if (def?.isFlying) continue;
            }
            const pos = game.getComponent(eid, 'transform')?.position;
            if (!pos) continue;
            const d = Math.hypot(pos.x - myPos.x, pos.z - myPos.z);
            scored.push({ eid, d });
        }
        scored.sort((a, b) =>
            Math.abs(a.d - b.d) < 0.001 ? a.eid - b.eid : a.d - b.d);

        for (const { eid } of scored.slice(0, extraCount)) {
            this.fireProjectile(attackerId, eid, game, combat, arrowDamage);
        }
    }

    fireProjectile(attackerId, targetId, game, combat, damageOverride) {
        const log = GUTS.HeadlessLogger;
        const targetHealth = game.getComponent(targetId, 'health');
        if (!targetHealth || targetHealth.current <= 0) {
            log.trace('AttackEnemy', `fireProjectile cancelled - target ${targetId} dead`);
            return;
        }

        const projectileDamage = damageOverride ?? combat.damage;

        // Wind shield: target may deflect projectiles, optionally reflecting damage.
        if (this._tryDeflectProjectile(attackerId, targetId, game, projectileDamage)) {
            log.trace('AttackEnemy', `fireProjectile deflected by wind_shield on target ${targetId}`);
            return;
        }

        // combat.projectile is a numeric index, need to convert to string name
        const reverseEnums = game.getReverseEnums();
        const projectileName = reverseEnums?.projectiles?.[combat.projectile];
        if (!projectileName) {
            log.warn('AttackEnemy', `fireProjectile failed - unknown projectile index`, {
                projectileIndex: combat.projectile
            });
            return;
        }

        const projectileData = game.getCollections().projectiles?.[projectileName];
        if (projectileData) {
            log.trace('AttackEnemy', `fireProjectile ${projectileName} from ${attackerId} to ${targetId} dmg=${projectileDamage}`);
            this.call.fireProjectile( attackerId, targetId, {
                id: projectileName,
                ...projectileData,
                damage: projectileDamage
            });
        }
    }

    // Returns true if the projectile is deflected (caller should skip the fire).
    // When projectileReflection is enabled on the buff, deflection also schedules
    // damage back at the attacker for the projectile's damage value.
    _tryDeflectProjectile(attackerId, targetId, game, projectileDamage) {
        const enums = game.getEnums();
        const targetBuff = game.buffEffectsSystem?.getBuffOfType(targetId, enums.buffTypes?.wind_shield);
        if (!targetBuff) return false;

        const buffTypeDef = this._getBuffDefByIndex(game, targetBuff.buffType);
        if (!buffTypeDef) return false;

        const chance = buffTypeDef.deflectionChance ?? 0;
        if (chance <= 0) return false;

        // Deterministic per-(attacker,target,attack-time) roll.
        const seed = attackerId * 9301 + targetId * 49297 + Math.floor(game.state.now * 1000);
        const roll = ((seed % 233280) + 233280) % 233280 / 233280;
        if (roll >= chance) return false;

        if (buffTypeDef.projectileReflection) {
            const reflectDmg = projectileDamage || 0;
            if (reflectDmg > 0) {
                this.call.scheduleDamage(targetId, attackerId, reflectDmg, enums.element.physical, 0.2, {});
            }
        }
        return true;
    }

    getEffectiveAttackSpeed(entityId, game, baseAttackSpeed) {
        return baseAttackSpeed;
    }

    // ×1 against units. Against buildings, scale by the attacker's shop tier so
    // tier 3 units excel at sieging while tier 1 units barely scratch walls.
    _buildingDamageMultiplier(attackerId, targetId, game) {
        if (!game.getComponent(targetId, 'buildingOwner')) return 1;
        const unitTypeComp = game.getComponent(attackerId, 'unitType');
        const def = game.getUnitTypeDef(unitTypeComp);
        const tier = game.armyShopSystem?.constructor?.unitTier?.(def?.id);
        return AttackEnemyBehaviorAction.BUILDING_DAMAGE_MULT[tier]
            ?? AttackEnemyBehaviorAction.BUILDING_DAMAGE_MULT_DEFAULT;
    }

    getDamageElement(entityId, game, combat) {
        if (combat.element) {
            return combat.element;
        }
        return game.getEnums().element.physical;
    }
}
