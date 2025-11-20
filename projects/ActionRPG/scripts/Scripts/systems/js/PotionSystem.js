class PotionSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.potionSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Potion inventory per entity
        this.potionInventory = new Map();

        // Potion configuration
        this.potionConfig = {
            health: {
                healAmount: 100,
                cooldown: 5, // seconds
                maxStack: 20,
                icon: 'potion_health'
            },
            mana: {
                restoreAmount: 75,
                cooldown: 3,
                maxStack: 20,
                icon: 'potion_mana'
            },
            rejuvenation: {
                healAmount: 50,
                restoreAmount: 50,
                cooldown: 8,
                maxStack: 10,
                icon: 'potion_rejuv'
            },
            speed: {
                duration: 10,
                speedBonus: 1.5,
                cooldown: 30,
                maxStack: 5,
                icon: 'potion_speed'
            }
        };

        // Global cooldowns
        this.entityCooldowns = new Map();
    }

    init() {
        this.game.gameManager.register('usePotion', this.usePotion.bind(this));
        this.game.gameManager.register('addHealthPotions', this.addHealthPotions.bind(this));
        this.game.gameManager.register('addManaPotions', this.addManaPotions.bind(this));
        this.game.gameManager.register('addPotions', this.addPotions.bind(this));
        this.game.gameManager.register('getPotionCount', this.getPotionCount.bind(this));
        this.game.gameManager.register('getPotionInventory', this.getPotionInventory.bind(this));
        this.game.gameManager.register('getPotionCooldown', this.getPotionCooldown.bind(this));
        this.game.gameManager.register('canUsePotion', this.canUsePotion.bind(this));
    }

    initializeEntity(entityId) {
        if (!this.potionInventory.has(entityId)) {
            this.potionInventory.set(entityId, {
                health: 3, // Start with some potions
                mana: 3,
                rejuvenation: 0,
                speed: 0
            });
        }

        if (!this.entityCooldowns.has(entityId)) {
            this.entityCooldowns.set(entityId, {
                health: 0,
                mana: 0,
                rejuvenation: 0,
                speed: 0
            });
        }
    }

    getPotionInventory(entityId) {
        this.initializeEntity(entityId);
        return this.potionInventory.get(entityId);
    }

    getPotionCount(entityId, potionType) {
        this.initializeEntity(entityId);
        return this.potionInventory.get(entityId)[potionType] || 0;
    }

    getPotionCooldown(entityId, potionType) {
        this.initializeEntity(entityId);
        const cooldowns = this.entityCooldowns.get(entityId);
        const remaining = cooldowns[potionType] - this.game.state.now;
        return Math.max(0, remaining);
    }

    canUsePotion(entityId, potionType) {
        this.initializeEntity(entityId);

        const inventory = this.potionInventory.get(entityId);
        const cooldowns = this.entityCooldowns.get(entityId);

        // Check if we have potions
        if (!inventory[potionType] || inventory[potionType] <= 0) {
            return { canUse: false, reason: 'no_potions' };
        }

        // Check cooldown
        if (cooldowns[potionType] > this.game.state.now) {
            return {
                canUse: false,
                reason: 'on_cooldown',
                remaining: cooldowns[potionType] - this.game.state.now
            };
        }

        return { canUse: true };
    }

    addHealthPotions(entityId, count) {
        this.addPotions(entityId, 'health', count);
    }

    addManaPotions(entityId, count) {
        this.addPotions(entityId, 'mana', count);
    }

    addPotions(entityId, potionType, count) {
        this.initializeEntity(entityId);

        const inventory = this.potionInventory.get(entityId);
        const config = this.potionConfig[potionType];

        if (!config) {
            console.warn('Unknown potion type:', potionType);
            return;
        }

        const currentCount = inventory[potionType] || 0;
        const maxStack = config.maxStack;

        inventory[potionType] = Math.min(currentCount + count, maxStack);

        this.game.triggerEvent('onPotionsAdded', {
            entityId,
            potionType,
            count,
            total: inventory[potionType]
        });
    }

    usePotion(entityId, potionType) {
        const canUse = this.canUsePotion(entityId, potionType);
        if (!canUse.canUse) {
            this.game.triggerEvent('onPotionUseFailed', {
                entityId,
                potionType,
                reason: canUse.reason
            });
            return false;
        }

        const CT = this.componentTypes;
        const config = this.potionConfig[potionType];
        const inventory = this.potionInventory.get(entityId);
        const cooldowns = this.entityCooldowns.get(entityId);

        // Consume potion
        inventory[potionType]--;

        // Set cooldown
        cooldowns[potionType] = this.game.state.now + config.cooldown;

        // Apply effect
        this.applyPotionEffect(entityId, potionType, config);

        this.game.triggerEvent('onPotionUsed', {
            entityId,
            potionType,
            remaining: inventory[potionType]
        });

        return true;
    }

    applyPotionEffect(entityId, potionType, config) {
        const CT = this.componentTypes;

        switch (potionType) {
            case 'health':
                const health = this.game.getComponent(entityId, CT.HEALTH);
                if (health) {
                    health.current = Math.min(health.max, health.current + config.healAmount);
                    this.game.triggerEvent('onHealed', {
                        entityId,
                        amount: config.healAmount,
                        source: 'potion'
                    });
                }
                break;

            case 'mana':
                const resources = this.game.getComponent(entityId, CT.RESOURCE_POOL);
                if (resources) {
                    resources.mana = Math.min(resources.maxMana, resources.mana + config.restoreAmount);
                    this.game.triggerEvent('onManaRestored', {
                        entityId,
                        amount: config.restoreAmount,
                        source: 'potion'
                    });
                }
                break;

            case 'rejuvenation':
                // Heals both health and mana
                const health2 = this.game.getComponent(entityId, CT.HEALTH);
                if (health2) {
                    health2.current = Math.min(health2.max, health2.current + config.healAmount);
                }

                const resources2 = this.game.getComponent(entityId, CT.RESOURCE_POOL);
                if (resources2) {
                    resources2.mana = Math.min(resources2.maxMana, resources2.mana + config.restoreAmount);
                }
                break;

            case 'speed':
                // Apply speed buff
                this.applySpeedBuff(entityId, config);
                break;
        }
    }

    applySpeedBuff(entityId, config) {
        const CT = this.componentTypes;
        const Components = this.game.componentManager.getComponents();

        // Add speed buff component
        const existingBuff = this.game.getComponent(entityId, CT.BUFF);

        if (existingBuff && existingBuff.buffType === 'speed') {
            // Refresh duration
            existingBuff.endTime = this.game.state.now + config.duration;
        } else {
            // Add new buff
            this.game.addComponent(entityId, CT.BUFF, Components.Buff(
                'speed',
                { speedMultiplier: config.speedBonus },
                this.game.state.now + config.duration,
                false,
                1,
                this.game.state.now
            ));
        }

        // Modify velocity
        const vel = this.game.getComponent(entityId, CT.VELOCITY);
        if (vel) {
            vel.maxSpeed *= config.speedBonus;

            // Schedule to remove buff
            this.game.gameManager.call('scheduleAction', () => {
                this.removeSpeedBuff(entityId, config.speedBonus);
            }, config.duration);
        }
    }

    removeSpeedBuff(entityId, speedBonus) {
        const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
        if (vel) {
            vel.maxSpeed /= speedBonus;
        }

        // Remove buff component
        if (this.game.hasComponent(entityId, this.componentTypes.BUFF)) {
            const buff = this.game.getComponent(entityId, this.componentTypes.BUFF);
            if (buff.buffType === 'speed') {
                this.game.removeComponent(entityId, this.componentTypes.BUFF);
            }
        }
    }

    update() {
        // Clean up expired buffs could be done here
        // But generally the DamageSystem handles buff cleanup
    }
}
