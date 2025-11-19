class ExperienceSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.experienceSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Experience tracking
        this.entityExperience = new Map();

        // Leveling configuration
        this.MAX_LEVEL = 50;
        this.BASE_XP_REQUIREMENT = 100;
        this.XP_SCALING = 1.5; // Exponential scaling

        // Stat gains per level
        this.STAT_GAINS = {
            health: 20,
            damage: 2,
            armor: 1,
            mana: 5
        };

        // Skill points per level
        this.SKILL_POINTS_PER_LEVEL = 1;
    }

    init() {
        this.game.gameManager.register('awardExperience', this.awardExperience.bind(this));
        this.game.gameManager.register('getEntityLevel', this.getEntityLevel.bind(this));
        this.game.gameManager.register('getEntityExperience', this.getEntityExperience.bind(this));
        this.game.gameManager.register('getXPForNextLevel', this.getXPForNextLevel.bind(this));
        this.game.gameManager.register('getXPProgress', this.getXPProgress.bind(this));
        this.game.gameManager.register('getSkillPoints', this.getSkillPoints.bind(this));
        this.game.gameManager.register('spendSkillPoint', this.spendSkillPoint.bind(this));
    }

    initializeEntity(entityId) {
        if (!this.entityExperience.has(entityId)) {
            this.entityExperience.set(entityId, {
                currentXP: 0,
                totalXP: 0,
                level: 1,
                skillPoints: 0
            });
        }
    }

    getEntityLevel(entityId) {
        this.initializeEntity(entityId);
        return this.entityExperience.get(entityId).level;
    }

    getEntityExperience(entityId) {
        this.initializeEntity(entityId);
        return this.entityExperience.get(entityId);
    }

    getXPForLevel(level) {
        return Math.floor(this.BASE_XP_REQUIREMENT * Math.pow(this.XP_SCALING, level - 1));
    }

    getXPForNextLevel(entityId) {
        const expData = this.getEntityExperience(entityId);
        return this.getXPForLevel(expData.level);
    }

    getXPProgress(entityId) {
        const expData = this.getEntityExperience(entityId);
        const required = this.getXPForLevel(expData.level);
        return {
            current: expData.currentXP,
            required: required,
            percent: (expData.currentXP / required) * 100
        };
    }

    getSkillPoints(entityId) {
        this.initializeEntity(entityId);
        return this.entityExperience.get(entityId).skillPoints;
    }

    awardExperience(entityId, amount) {
        this.initializeEntity(entityId);

        const expData = this.entityExperience.get(entityId);
        expData.currentXP += amount;
        expData.totalXP += amount;

        // Check for level up
        let levelsGained = 0;
        while (expData.level < this.MAX_LEVEL) {
            const required = this.getXPForLevel(expData.level);
            if (expData.currentXP >= required) {
                expData.currentXP -= required;
                expData.level++;
                expData.skillPoints += this.SKILL_POINTS_PER_LEVEL;
                levelsGained++;

                // Apply stat gains
                this.applyLevelUpStats(entityId);

                this.game.triggerEvent('onLevelUp', {
                    entityId,
                    newLevel: expData.level,
                    skillPoints: expData.skillPoints
                });
            } else {
                break;
            }
        }

        this.game.triggerEvent('onExperienceGained', {
            entityId,
            amount,
            currentXP: expData.currentXP,
            totalXP: expData.totalXP,
            level: expData.level,
            levelsGained
        });

        return levelsGained;
    }

    applyLevelUpStats(entityId) {
        const CT = this.componentTypes;

        // Increase max health
        const health = this.game.getComponent(entityId, CT.HEALTH);
        if (health) {
            const healthGain = this.STAT_GAINS.health;
            health.max += healthGain;
            health.current += healthGain; // Also heal on level up
        }

        // Increase damage
        const combat = this.game.getComponent(entityId, CT.COMBAT);
        if (combat) {
            combat.damage += this.STAT_GAINS.damage;
            combat.armor += this.STAT_GAINS.armor;
        }

        // Increase mana
        const resources = this.game.getComponent(entityId, CT.RESOURCE_POOL);
        if (resources) {
            resources.maxMana += this.STAT_GAINS.mana;
            resources.mana = resources.maxMana; // Restore on level up
        }
    }

    spendSkillPoint(entityId, skillType) {
        const expData = this.getEntityExperience(entityId);

        if (expData.skillPoints <= 0) {
            return false;
        }

        const CT = this.componentTypes;
        let success = false;

        switch (skillType) {
            case 'health':
                const health = this.game.getComponent(entityId, CT.HEALTH);
                if (health) {
                    health.max += 50;
                    health.current += 50;
                    success = true;
                }
                break;

            case 'damage':
                const combat = this.game.getComponent(entityId, CT.COMBAT);
                if (combat) {
                    combat.damage += 5;
                    success = true;
                }
                break;

            case 'armor':
                const combat2 = this.game.getComponent(entityId, CT.COMBAT);
                if (combat2) {
                    combat2.armor += 3;
                    success = true;
                }
                break;

            case 'mana':
                const resources = this.game.getComponent(entityId, CT.RESOURCE_POOL);
                if (resources) {
                    resources.maxMana += 20;
                    resources.mana += 20;
                    success = true;
                }
                break;

            case 'attackSpeed':
                const combat3 = this.game.getComponent(entityId, CT.COMBAT);
                if (combat3) {
                    combat3.attackSpeed *= 1.05; // 5% increase
                    success = true;
                }
                break;
        }

        if (success) {
            expData.skillPoints--;
            this.game.triggerEvent('onSkillPointSpent', {
                entityId,
                skillType,
                remainingPoints: expData.skillPoints
            });
        }

        return success;
    }

    update() {
        // Clean up dead entities
        for (const [entityId] of this.entityExperience) {
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            if (!health) {
                this.entityExperience.delete(entityId);
            }
        }
    }
}
