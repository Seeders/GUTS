class BlizzardAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Blizzard',
            description: 'Summons a devastating blizzard of ice shards that freezes enemies in an area',
            cooldown: 5.0,
            range: 300,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'cast',
            priority: 10,
            castTime: 1.0,
            autoTrigger: 'many_enemies',
            ...abilityData
        });

        this.damage = 25;
        this.blizzardRadius = 120;
        this.duration = 3.0;
        this.tickInterval = 0.3;
        this.element = this.enums.element.cold;
        this.shardHeight = 400; // Height ice shards fall from
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        const enemies = this.getEnemiesInRange(casterEntity);
        const targetPos = this.findBestClusterPosition(enemies, 1);

        if (!targetPos) return;

        // Immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `An arctic blizzard engulfs the battlefield!`, true);

        // Schedule blizzard start after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createBlizzard(casterEntity, targetPos);
        }, this.castTime, casterEntity);
    }

    createBlizzard(casterEntity, targetPos) {
        // Screen effect
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#aaffff', 0.4);
        }

        // Create ambient snow/frost in the area
        this.createAmbientSnow(targetPos);

        // Schedule ice shard waves
        const totalTicks = Math.floor(this.duration / this.tickInterval);

        for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
            const tickDelay = this.tickInterval * tickIndex;

            this.game.schedulingSystem.scheduleAction(() => {
                this.spawnIceShardWave(casterEntity, targetPos, tickIndex);
            }, tickDelay, casterEntity);
        }

        // Final frost burst at end
        this.game.schedulingSystem.scheduleAction(() => {
            this.createFinalBurst(targetPos);
        }, this.duration, casterEntity);
    }

    createAmbientSnow(centerPos) {
        if (this.game.isServer) return;

        // Create continuous snow effect over the duration
        const snowInterval = 0.3;
        const snowCount = Math.floor(this.duration / snowInterval);

        for (let i = 0; i < snowCount; i++) {
            this.game.schedulingSystem.scheduleAction(() => {
                this.playConfiguredEffects('ambient', centerPos);
            }, i * snowInterval, null);
        }
    }

    spawnIceShardWave(casterEntity, centerPos, tickIndex) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (!casterHealth || casterHealth.current <= 0) return;

        // Spawn multiple ice shards falling in the area
        const shardsPerWave = 5 + Math.floor(tickIndex / 2); // Increase over time

        for (let i = 0; i < shardsPerWave; i++) {
            // Deterministic positioning based on tick and shard index
            const angle = ((tickIndex * 7 + i * 137) % 360) * Math.PI / 180;
            const radius = ((tickIndex * 13 + i * 31) % 100) / 100 * this.blizzardRadius;

            const shardX = centerPos.x + Math.cos(angle) * radius;
            const shardZ = centerPos.z + Math.sin(angle) * radius;

            // Stagger shard falls slightly
            const fallDelay = i * 0.03;

            this.game.schedulingSystem.scheduleAction(() => {
                this.createFallingIceShard(casterEntity, {
                    x: shardX,
                    y: centerPos.y,
                    z: shardZ
                });
            }, fallDelay, null);
        }

        // Apply damage to enemies in area on each tick
        this.applyAreaDamage(casterEntity, centerPos, tickIndex);
    }

    createFallingIceShard(casterEntity, targetPos) {
        if (this.game.isServer) return;

        // Create falling ice shard
        const fallDuration = 0.4;
        const trailInterval = 0.04;
        const trailCount = Math.floor(fallDuration / trailInterval);

        for (let i = 0; i < trailCount; i++) {
            const progress = i / trailCount;
            const currentY = this.shardHeight * (1 - progress) + targetPos.y * progress;
            const shardPos = {
                x: targetPos.x,
                y: currentY,
                z: targetPos.z
            };

            this.game.schedulingSystem.scheduleAction(() => {
                this.playConfiguredEffects('shard', shardPos);
            }, i * trailInterval, null);
        }

        // Impact effect when shard hits ground
        this.game.schedulingSystem.scheduleAction(() => {
            this.createShardImpact(targetPos);
        }, fallDuration, null);
    }

    createShardImpact(position) {
        this.playConfiguredEffects('impact', position);
    }

    applyAreaDamage(casterEntity, centerPos, tickIndex) {
        // Get all enemies in splash radius
        const allEntities = this.game.getEntitiesWith(
            "transform",
            "health",
            "team"
        );

        const casterTeam = this.game.getComponent(casterEntity, "team");
        if (!casterTeam) return;

        const targets = [];

        allEntities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const entityPos = transform?.position;
            const entityTeam = this.game.getComponent(entityId, "team");
            const entityHealth = this.game.getComponent(entityId, "health");

            if (!entityPos || !entityTeam || !entityHealth) return;
            if (entityTeam.team === casterTeam.team) return;
            if (entityHealth.current <= 0) return;

            const distance = Math.sqrt(
                Math.pow(entityPos.x - centerPos.x, 2) +
                Math.pow(entityPos.z - centerPos.z, 2)
            );

            if (distance <= this.blizzardRadius) {
                targets.push({
                    id: entityId,
                    distance: distance,
                    position: entityPos
                });
            }
        });

        // Sort deterministically
        targets.sort((a, b) => {
            if (Math.abs(a.distance - b.distance) > 0.001) {
                return a.distance - b.distance;
            }
            return a.id - b.id;
        });

        // Apply damage to each target
        targets.forEach(target => {
            // Damage with slight distance falloff
            const damageMultiplier = Math.max(0.7, 1.0 - (target.distance / this.blizzardRadius) * 0.3);
            const tickDamage = Math.floor(this.damage * damageMultiplier);

            this.dealDamageWithEffects(casterEntity, target.id, tickDamage, this.element, {
                isBlizzard: true,
                tickIndex: tickIndex
            });
        });
    }

    createFinalBurst(centerPos) {
        this.playConfiguredEffects('burst', centerPos);
    }

    // Override from BaseAbility - find best cluster for targeting
    findBestClusterPosition(enemies, minTargets) {
        if (enemies.length === 0) return null;

        const sortedEnemies = enemies.slice().sort((a, b) => a - b);

        let bestPosition = null;
        let maxTargetsHit = 0;
        let bestScore = 0;

        sortedEnemies.forEach(potentialCenter => {
            const transform = this.game.getComponent(potentialCenter, "transform");
            const centerPos = transform?.position;
            if (!centerPos) return;

            let targetsInRange = 0;
            let totalDistance = 0;

            sortedEnemies.forEach(enemyId => {
                const transform = this.game.getComponent(enemyId, "transform");
                const enemyPos = transform?.position;
                if (!enemyPos) return;

                const distance = Math.sqrt(
                    Math.pow(enemyPos.x - centerPos.x, 2) +
                    Math.pow(enemyPos.z - centerPos.z, 2)
                );

                if (distance <= this.blizzardRadius) {
                    targetsInRange++;
                    totalDistance += distance;
                }
            });

            const score = (targetsInRange * 1000) - totalDistance;

            if (targetsInRange > maxTargetsHit ||
                (targetsInRange === maxTargetsHit && score >= bestScore)) {
                maxTargetsHit = targetsInRange;
                bestScore = score;
                bestPosition = { x: centerPos.x, y: centerPos.y, z: centerPos.z };
            }
        });

        if (!bestPosition && sortedEnemies.length > 0) {
            const transform = this.game.getComponent(sortedEnemies[0], "transform");
            const firstEnemyPos = transform?.position;
            if (firstEnemyPos) {
                bestPosition = { x: firstEnemyPos.x, y: firstEnemyPos.y, z: firstEnemyPos.z };
            }
        }

        return bestPosition;
    }
}
