class BashAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Bash',
            description: 'Slam your shield into the enemy, stunning them',
            cooldown: 6.0,
            range: 60,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'attack',
            priority: 8,
            castTime: 0.3,
            ...abilityData
        });

        this.bashDamage = 15;
        this.stunDuration = 2.5;
        this.element = this.enums.element.physical;
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        return enemies.length > 0;
    }

    execute(casterEntity, targetData = null) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        if (enemies.length === 0) return;

        // Find closest enemy deterministically
        const target = this.findClosestEnemy(casterEntity, enemies);
        if (!target) return;

        this.logAbilityUsage(casterEntity, `Shield bash! Target stunned!`);

        // Play cast effect
        this.playConfiguredEffects('cast', casterPos);

        // Schedule the bash impact
        this.game.schedulingSystem.scheduleAction(() => {
            this.performBash(casterEntity, target);
        }, this.castTime, casterEntity);
    }

    findClosestEnemy(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);

        let closestEnemy = null;
        let closestDistance = Infinity;

        sortedEnemies.forEach(enemyId => {
            const enemyTransform = this.game.getComponent(enemyId, "transform");
            const enemyPos = enemyTransform?.position;
            if (!enemyPos) return;

            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) +
                Math.pow(enemyPos.z - casterPos.z, 2)
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemyId;
            }
        });

        return closestEnemy;
    }

    performBash(casterEntity, targetId) {
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;
        const targetHealth = this.game.getComponent(targetId, "health");

        if (!targetPos || !targetHealth) return;

        // Impact effect
        this.playConfiguredEffects('impact', targetPos);

        // Deal bash damage
        this.dealDamageWithEffects(casterEntity, targetId, this.bashDamage, this.element, {
            isMelee: true
        });

        // Apply stun using buff system
        const enums = this.game.getEnums();
        this.game.addComponent(targetId, "buff", {
            buffType: enums.buffTypes.stunned,
            endTime: this.game.state.now + this.stunDuration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });

        // Schedule stun removal
        this.game.schedulingSystem.scheduleAction(() => {
            this.removeStun(targetId);
        }, this.stunDuration, targetId);

        // Screen shake for impact
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 2);
        }
    }

    removeStun(targetId) {
        const enums = this.game.getEnums();
        if (this.game.hasComponent(targetId, "buff")) {
            const buff = this.game.getComponent(targetId, "buff");
            if (buff && buff.buffType === enums.buffTypes.stunned) {
                this.game.removeComponent(targetId, "buff");

                // Visual effect when stun expires
                const transform = this.game.getComponent(targetId, "transform");
                const targetPos = transform?.position;
                if (targetPos) {
                    this.playConfiguredEffects('expiration', targetPos);
                }
            }
        }
    }
}
