class CombatBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        // Check if player order prevents combat (build orders, force move)
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (playerOrder?.meta?.preventCombat) {
            return this.failure();
        }

        const aiState = game.getComponent(entityId, 'aiState');
        const combat = game.getComponent(entityId, 'combat');
        const health = game.getComponent(entityId, 'health');

        // Skip if unit can't fight (no combat component or dead)
        if (!combat || !health || health.current <= 0) {
            return this.failure();
        }

        // Skip units with 0 damage and no abilities (non-combat units like peasants mining)
        const unitType = game.getComponent(entityId, 'unitType');
        if (combat.damage === 0 && (!unitType.abilities || unitType.abilities.length === 0)) {
            return this.failure();
        }

        const memory = this.getMemory(entityId);
        const state = memory.combatState || 'seeking_target';

        switch (state) {
            case 'seeking_target':
                return this.seekTarget(entityId, memory, game);
            case 'moving_to_target':
                return this.moveToTarget(entityId, memory, game);
            case 'attacking':
                return this.doAttacking(entityId, memory, game);
        }
    }

    onEnd(entityId, game) {
        // Unanchor the unit
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) vel.anchored = false;

        // Clear per-entity memory (handled by base class)
        this.clearMemory(entityId);
    }

    seekTarget(entityId, memory, game) {
        const target = this.findNearestEnemy(entityId, game);

        if (!target) {
            // No enemies in range - don't take over behavior
            return this.failure();
        }

        const pos = game.getComponent(entityId, 'position');
        const targetPos = game.getComponent(target, 'position');
        const combat = game.getComponent(entityId, 'combat');

        const distance = this.distance(pos, targetPos);
        const attackRange = combat.range || 50;

        if (distance <= attackRange) {
            // Already in range, start attacking
            memory.combatState = 'attacking';
            memory.target = target;
            memory.targetPosition = { x: targetPos.x, z: targetPos.z };
            return this.running(memory);
        }

        // Need to move to target
        memory.combatState = 'moving_to_target';
        memory.target = target;
        memory.targetPosition = { x: targetPos.x, z: targetPos.z };
        return this.running(memory);
    }

    moveToTarget(entityId, memory, game) {
        const target = memory.target;

        // Check if target is still valid
        if (!target || !this.isValidTarget(target, game)) {
            // Target lost, seek new target
            memory.combatState = 'seeking_target';
            return this.seekTarget(entityId, memory, game);
        }

        const pos = game.getComponent(entityId, 'position');
        const targetPos = game.getComponent(target, 'position');
        const combat = game.getComponent(entityId, 'combat');

        const distance = this.distance(pos, targetPos);
        const attackRange = combat.range || 50;

        if (distance <= attackRange) {
            // In range, start attacking
            memory.combatState = 'attacking';
            memory.target = target;
            memory.targetPosition = { x: targetPos.x, z: targetPos.z };
            return this.running(memory);
        }

        // Keep moving toward target (MovementSystem reads targetPosition)
        memory.combatState = 'moving_to_target';
        memory.target = target;
        memory.targetPosition = { x: targetPos.x, z: targetPos.z };
        return this.running(memory);
    }

    doAttacking(entityId, memory, game) {
        const target = memory.target;

        // Check if target is still valid
        if (!target || !this.isValidTarget(target, game)) {
            // Target dead or lost, unanchor and seek new target
            const vel = game.getComponent(entityId, 'velocity');
            if (vel) vel.anchored = false;
            memory.combatState = 'seeking_target';
            return this.seekTarget(entityId, memory, game);
        }

        const pos = game.getComponent(entityId, 'position');
        const targetPos = game.getComponent(target, 'position');
        const combat = game.getComponent(entityId, 'combat');

        const distance = this.distance(pos, targetPos);
        const attackRange = combat.range || 50;

        if (distance > attackRange) {
            // Target moved out of range, unanchor and chase
            const vel = game.getComponent(entityId, 'velocity');
            if (vel) vel.anchored = false;
            memory.combatState = 'moving_to_target';
            memory.target = target;
            memory.targetPosition = { x: targetPos.x, z: targetPos.z };
            return this.running(memory);
        }

        // Anchor unit while attacking - stand still
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.anchored = true;
            vel.vx = 0;
            vel.vz = 0;
        }

        // Perform attack
        this.performAttack(entityId, target, game);

        // Return running state with no targetPosition so MovementSystem doesn't move us
        memory.combatState = 'attacking';
        memory.target = target;
        delete memory.targetPosition;
        return this.running(memory);
    }

    performAttack(attackerId, targetId, game) {
        const combat = game.getComponent(attackerId, 'combat');

        if (!combat.lastAttack) combat.lastAttack = 0;

        const effectiveAttackSpeed = this.getEffectiveAttackSpeed(attackerId, game, combat.attackSpeed);
        const timeSinceLastAttack = game.state.now - combat.lastAttack;

        if (timeSinceLastAttack < 1 / effectiveAttackSpeed) {
            // Attack on cooldown
            return;
        }

        combat.lastAttack = game.state.now;

        // Face the target
        const attackerPos = game.getComponent(attackerId, 'position');
        const targetPos = game.getComponent(targetId, 'position');
        const facing = game.getComponent(attackerId, 'facing');

        if (attackerPos && targetPos && facing) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            facing.angle = Math.atan2(dz, dx);
        }

        // Trigger attack animation
        if (game.gameManager && game.gameManager.has('triggerSinglePlayAnimation')) {
            const animationSpeed = combat.attackSpeed;
            const minAnimationTime = 1 / combat.attackSpeed * 0.8;
            game.gameManager.call('triggerSinglePlayAnimation', attackerId, 'attack', animationSpeed, minAnimationTime);
        }

        // Handle projectile or melee damage
        if (combat.projectile) {
            this.fireProjectile(attackerId, targetId, game, combat);
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

    findNearestEnemy(entityId, game) {
        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team) return null;

        const visionRange = combat.visionRange || 300;

        // Get all potential targets
        const potentialTargets = game.getEntitiesWith('position', 'team', 'health');

        // Sort for deterministic iteration
        const sortedTargets = potentialTargets.sort((a, b) => String(a).localeCompare(String(b)));

        let nearestEnemy = null;
        let nearestDistance = Infinity;

        for (const targetId of sortedTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            const targetHealth = game.getComponent(targetId, 'health');
            const targetPos = game.getComponent(targetId, 'position');
            const targetDeathState = game.getComponent(targetId, 'deathState');

            // Skip allies
            if (targetTeam.team === team.team) continue;

            // Skip dead or dying units
            if (!targetHealth || targetHealth.current <= 0) continue;
            if (targetDeathState && targetDeathState.isDying) continue;

            const distance = this.distance(pos, targetPos);

            // Check if within vision range
            if (distance > visionRange) continue;

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestEnemy = targetId;
            }
        }

        return nearestEnemy;
    }

    isValidTarget(targetId, game) {
        const targetHealth = game.getComponent(targetId, 'health');
        const targetDeathState = game.getComponent(targetId, 'deathState');

        if (!targetHealth || targetHealth.current <= 0) return false;
        if (targetDeathState && targetDeathState.isDying) return false;

        return true;
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

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
