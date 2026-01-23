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
        'getUnitTypeDef',
        'setBillboardAnimation',
        'triggerSinglePlayAnimation',
        'scheduleDamage',
        'getEntityAbilities',
        'fireProjectile',
        'getItemData'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = this.call.getUnitTypeDef( unitTypeComp);
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
        this.performAttack(entityId, targetId, game, combat, log, unitName, teamName);

        // Return running - attacking is a continuous action
        return this.running({
            target: targetId,
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
        // Face the target
        const attackerTransform = game.getComponent(attackerId, 'transform');
        const attackerPos = attackerTransform?.position;
        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;

        // Skip rotation for anchored units (buildings)
        const velocity = game.getComponent(attackerId, 'velocity');
        if (attackerPos && targetPos && attackerTransform && !velocity?.anchored) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            if (!attackerTransform.rotation) attackerTransform.rotation = { x: 0, y: 0, z: 0 };
            attackerTransform.rotation.y = Math.atan2(dz, dx);
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

        // Handle projectile or melee damage
        // Note: projectile index 0 is valid, only -1 means "no projectile"
        if (hasProjectile) {
            log.trace('AttackEnemy', `${unitName}(${attackerId}) [${teamName}] firing projectile at target ${targetId}`, {
                projectileIndex: combat.projectile
            });
            // Schedule projectile to fire at 50% through the attack animation (release point)
            const projectileDelay = effectiveAttackSpeed > 0 ? (1 / combat.attackSpeed) * 0.5 : 0;
            game.schedulingSystem.scheduleAction(() => {
                this.fireProjectile(attackerId, targetId, game, combat);
            }, projectileDelay, attackerId);
        } else if (combat.damage > 0) {
            log.trace('AttackEnemy', `${unitName}(${attackerId}) [${teamName}] melee attack on target ${targetId}`, {
                damage: combat.damage
            });
            // Melee attack - schedule damage
            const damageDelay = effectiveAttackSpeed > 0 ? (1 / combat.attackSpeed) * 0.5 : 0;
            const element = this.getDamageElement(attackerId, game, combat);

            this.call.scheduleDamage(
                attackerId,
                targetId,
                combat.damage,
                element,
                damageDelay,
                {
                    isMelee: true,
                    weaponRange: (combat.range || 50) + 10
                }
            );
        }
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

    fireProjectile(attackerId, targetId, game, combat) {
        const log = GUTS.HeadlessLogger;
        const targetHealth = game.getComponent(targetId, 'health');
        if (!targetHealth || targetHealth.current <= 0) {
            log.trace('AttackEnemy', `fireProjectile cancelled - target ${targetId} dead`);
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
            log.trace('AttackEnemy', `fireProjectile ${projectileName} from ${attackerId} to ${targetId}`);
            this.call.fireProjectile( attackerId, targetId, {
                id: projectileName,
                ...projectileData
            });
        }
    }

    getEffectiveAttackSpeed(entityId, game, baseAttackSpeed) {
        if (game.equipmentSystem) {
            const equipment = game.getComponent(entityId, 'equipment');
            if (equipment && equipment.attackSpeed) {
                return baseAttackSpeed * equipment.attackSpeed;
            }
        }
        return baseAttackSpeed;
    }

    getDamageElement(entityId, game, combat) {
        if (combat.element) {
            return combat.element;
        }

        const weaponElement = this.getWeaponElement(entityId, game);
        if (weaponElement) {
            return weaponElement;
        }

        return game.getEnums().element.physical;
    }

    getWeaponElement(entityId, game) {
        if (!game.equipmentSystem) return null;

        const equipment = game.getComponent(entityId, 'equipment');
        if (!equipment) return null;

        const mainHandItem = equipment.slots?.mainHand;
        if (mainHandItem) {
            const itemData = this.call.getItemData( mainHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        const offHandItem = equipment.slots?.offHand;
        if (offHandItem) {
            const itemData = this.call.getItemData( offHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        return null;
    }
}
