class CombatSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
    }

    update(deltaTime, now) {
        const combatants = this.game.getEntitiesWith('Position', 'Combat');

        for (const entityId of combatants) {
            const combat = this.game.getComponent(entityId, 'Combat');
            const position = this.game.getComponent(entityId, 'Position');

            // Find attack target
            let target = null;

            // Check if player
            const playerController = this.game.getComponent(entityId, 'PlayerController');
            if (playerController && playerController.attackTarget) {
                target = playerController.attackTarget;
            }

            // Check if enemy AI
            const enemyAI = this.game.getComponent(entityId, 'EnemyAI');
            if (enemyAI && enemyAI.target) {
                target = enemyAI.target;
            }

            if (!target) continue;

            // Check if target is in range
            const targetPosition = this.game.getComponent(target, 'Position');
            if (!targetPosition) continue;

            const dx = targetPosition.x - position.x;
            const dz = targetPosition.z - position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance <= combat.range) {
                // Check attack cooldown
                const attackCooldown = 1 / combat.attackSpeed;
                if (now - combat.lastAttack >= attackCooldown) {
                    this.performAttack(entityId, target);
                    combat.lastAttack = now;
                }
            }
        }
    }

    performAttack(attackerId, targetId) {
        const combat = this.game.getComponent(attackerId, 'Combat');
        const targetHealth = this.game.getComponent(targetId, 'Health');

        if (!combat || !targetHealth) return;

        // Calculate damage
        let damage = combat.damage;

        // Check for critical hit
        if (Math.random() < combat.critChance) {
            damage *= combat.critMultiplier;
            this.showCriticalHit(targetId);
        }

        // Apply elemental resistance
        damage = this.applyElementalResistance(damage, combat.element, targetId);

        // Apply armor
        const targetCombat = this.game.getComponent(targetId, 'Combat');
        if (targetCombat) {
            const damageReduction = targetCombat.armor / (targetCombat.armor + 100);
            damage *= (1 - damageReduction);
        }

        // Deal damage
        this.dealDamage(targetId, damage, combat.element);

        // Trigger attack event for animations/effects
        this.game.triggerEvent('onAttack', {
            attacker: attackerId,
            target: targetId,
            damage,
            element: combat.element
        });
    }

    applyElementalResistance(damage, element, targetId) {
        const targetCombat = this.game.getComponent(targetId, 'Combat');
        if (!targetCombat) return damage;

        let resistance = 0;
        switch (element) {
            case 'fire':
                resistance = targetCombat.fireResistance;
                break;
            case 'cold':
                resistance = targetCombat.coldResistance;
                break;
            case 'lightning':
                resistance = targetCombat.lightningResistance;
                break;
            case 'poison':
                resistance = targetCombat.poisonResistance;
                break;
            default:
                resistance = 0;
        }

        // Resistance is capped at 75%
        resistance = Math.min(resistance, 75);
        return damage * (1 - resistance / 100);
    }

    dealDamage(entityId, damage, element = 'physical') {
        const health = this.game.getComponent(entityId, 'Health');
        if (!health) return;

        health.current -= damage;

        // Show damage number
        this.game.triggerEvent('showDamageNumber', {
            entityId,
            damage: Math.round(damage),
            element
        });

        // Check for death
        if (health.current <= 0) {
            this.handleDeath(entityId);
        }
    }

    handleDeath(entityId) {
        // Check if it's the player
        const playerController = this.game.getComponent(entityId, 'PlayerController');
        if (playerController) {
            this.game.gameManager.playerDied();
            return;
        }

        // Drop loot
        const lootTable = this.game.getComponent(entityId, 'LootTable');
        if (lootTable) {
            this.dropLoot(entityId, lootTable);
        }

        // Grant experience
        const expReward = this.game.getComponent(entityId, 'ExperienceReward');
        if (expReward) {
            this.grantExperience(expReward.amount);
        }

        // Trigger death event
        this.game.triggerEvent('onEntityDeath', { entityId });

        // Remove entity
        this.game.destroyEntity(entityId);
    }

    dropLoot(entityId, lootTable) {
        const position = this.game.getComponent(entityId, 'Position');
        if (!position) return;

        // Roll for item drops
        for (const item of lootTable.items) {
            if (Math.random() < lootTable.dropChance) {
                this.game.triggerEvent('spawnItem', {
                    item,
                    x: position.x + (Math.random() - 0.5),
                    z: position.z + (Math.random() - 0.5)
                });
            }
        }

        // Drop gold
        const goldAmount = Math.floor(
            lootTable.goldMin + Math.random() * (lootTable.goldMax - lootTable.goldMin)
        );
        if (goldAmount > 0) {
            this.game.triggerEvent('spawnGold', {
                amount: goldAmount,
                x: position.x,
                z: position.z
            });
        }
    }

    grantExperience(amount) {
        // Find player
        const players = this.game.getEntitiesWith('PlayerController', 'Stats');
        const playerId = players.values().next().value;
        if (!playerId) return;

        const stats = this.game.getComponent(playerId, 'Stats');
        stats.experience += amount;

        // Check for level up
        while (stats.experience >= stats.experienceToNextLevel) {
            stats.experience -= stats.experienceToNextLevel;
            stats.level++;
            stats.experienceToNextLevel = Math.floor(stats.experienceToNextLevel * 1.5);

            // Increase stats on level up
            stats.strength += 2;
            stats.dexterity += 2;
            stats.intelligence += 2;
            stats.vitality += 2;

            // Heal to full on level up
            const health = this.game.getComponent(playerId, 'Health');
            if (health) {
                health.max += 10;
                health.current = health.max;
            }

            const mana = this.game.getComponent(playerId, 'Mana');
            if (mana) {
                mana.max += 10;
                mana.current = mana.max;
            }

            this.game.triggerEvent('onLevelUp', { level: stats.level });
        }
    }

    showCriticalHit(targetId) {
        this.game.triggerEvent('showCriticalHit', { entityId: targetId });
    }
}
