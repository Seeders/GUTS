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

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        if (entityId.includes('archer') && game.state?.phase === 'battle') {
            console.log(`[AttackEnemyBehaviorAction] execute: targetId=${targetId}`);
        }

        if (!targetId) {
            if (entityId.includes('archer') && game.state?.phase === 'battle') {
                console.log(`[AttackEnemyBehaviorAction] No target, returning failure`);
            }
            return this.failure();
        }

        const combat = game.getComponent(entityId, 'combat');
        if (!combat) {
            return this.failure();
        }

        // Anchor unit while attacking - stand still
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.anchored = true;
            vel.vx = 0;
            vel.vz = 0;
        }

        // Perform attack
        this.performAttack(entityId, targetId, game, combat);

        // Return running - attacking is a continuous action
        return this.running({
            target: targetId,
            attacking: true
        });
    }

    onEnd(entityId, game) {
        if (entityId.includes('archer') && game.state?.phase === 'battle') {
            console.log(`[AttackEnemyBehaviorAction] onEnd called for entity ${entityId}`);
        }

        // Unanchor when combat action ends
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.anchored = false;
        }

        // Reset animation to idle when combat ends
        if (game.gameManager && game.gameManager.has('setBillboardAnimation')) {
            if (entityId.includes('archer') && game.state?.phase === 'battle') {
                console.log(`[AttackEnemyBehaviorAction] Setting animation to idle for entity ${entityId}`);
            }
            game.gameManager.call('setBillboardAnimation', entityId, 'idle', true);
        }
    }

    performAttack(attackerId, targetId, game, combat) {
        if (!combat.lastAttack) combat.lastAttack = 0;

        const effectiveAttackSpeed = this.getEffectiveAttackSpeed(attackerId, game, combat.attackSpeed);
        const timeSinceLastAttack = game.state.now - combat.lastAttack;

        if (timeSinceLastAttack < 1 / effectiveAttackSpeed) {
            // Attack on cooldown
            return;
        }

        combat.lastAttack = game.state.now;

        // Face the target
        const attackerTransform = game.getComponent(attackerId, 'transform');
        const attackerPos = attackerTransform?.position;
        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;

        if (attackerPos && targetPos && attackerTransform) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            if (!attackerTransform.rotation) attackerTransform.rotation = { x: 0, y: 0, z: 0 };
            attackerTransform.rotation.y = Math.atan2(dz, dx);
        }

        // Trigger attack animation (sprite direction is derived from rotation.y set above)
        if (game.gameManager && game.gameManager.has('triggerSinglePlayAnimation')) {
            const animationSpeed = combat.attackSpeed;
            const minAnimationTime = 1 / combat.attackSpeed * 0.8;
            game.gameManager.call('triggerSinglePlayAnimation', attackerId, 'attack', animationSpeed, minAnimationTime);
        }

        // Handle projectile or melee damage
        if (combat.projectile) {
            // Schedule projectile to fire at 50% through the attack animation (release point)
            const projectileDelay = (1 / combat.attackSpeed) * 0.5;
            game.schedulingSystem.scheduleAction(() => {
                this.fireProjectile(attackerId, targetId, game, combat);
            }, projectileDelay, attackerId);
        } else if (combat.damage > 0) {
            // Melee attack - schedule damage
            const damageDelay = (1 / combat.attackSpeed) * 0.5;
            const element = this.getDamageElement(attackerId, game, combat);

            game.gameManager.call('scheduleDamage',
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
        } else if (game.abilitySystem) {
            // Ability-only units (damage = 0) - use abilities for combat
            this.useOffensiveAbility(attackerId, targetId, game);
        }
    }

    useOffensiveAbility(attackerId, targetId, game) {
        const abilities = game.gameManager.call('getEntityAbilities', attackerId);
        if (!abilities || abilities.length === 0) return;

        // Find available offensive abilities
        const availableAbilities = abilities
            .filter(ability => game.abilitySystem.isAbilityOffCooldown(attackerId, ability.id))
            .filter(ability => !ability.canExecute || ability.canExecute(attackerId))
            .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));

        if (availableAbilities.length > 0) {
            game.abilitySystem.useAbility(attackerId, availableAbilities[0].id, { target: targetId });
        }
    }

    fireProjectile(attackerId, targetId, game, combat) {
        const targetHealth = game.getComponent(targetId, 'health');
        if (!targetHealth || targetHealth.current <= 0) return;

        const projectileData = game.getCollections().projectiles[combat.projectile];
        if (projectileData) {
            game.gameManager.call('fireProjectile', attackerId, targetId, {
                id: combat.projectile,
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

        return game.damageSystem?.ELEMENT_TYPES?.PHYSICAL || 'physical';
    }

    getWeaponElement(entityId, game) {
        if (!game.equipmentSystem) return null;

        const equipment = game.getComponent(entityId, 'equipment');
        if (!equipment) return null;

        const mainHandItem = equipment.slots?.mainHand;
        if (mainHandItem) {
            const itemData = game.gameManager.call('getItemData', mainHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        const offHandItem = equipment.slots?.offHand;
        if (offHandItem) {
            const itemData = game.gameManager.call('getItemData', offHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        return null;
    }
}
