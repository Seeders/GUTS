class BlizzardAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'blizzard',
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
            ...params
        });

        this.damage = 25;
        this.blizzardRadius = 120;
        this.duration = 3.0;
        this.tickInterval = 0.3;
        this.element = 'cold';
        this.shardHeight = 400; // Height ice shards fall from
    }

    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 15,
                    color: 0x88ccff,
                    colorRange: { start: 0xaaddff, end: 0x4488ff },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 0.6
                }
            },
            ice_impact: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0x88ddff,
                    colorRange: { start: 0xffffff, end: 0x4488ff },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            },
            frost_burst: {
                type: 'explosion',
                options: {
                    count: 12,
                    color: 0xaaddff,
                    colorRange: { start: 0xffffff, end: 0x6699ff },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.2
                }
            },
            snow: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0xffffff,
                    colorRange: { start: 0xffffff, end: 0xddddff },
                    scaleMultiplier: 0.8,
                    speedMultiplier: 0.3
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 6,
                    color: 0x88ccff,
                    colorRange: { start: 0xaaddff, end: 0x4488ff },
                    scaleMultiplier: 1.2
                }
            }
        };
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
        this.createVisualEffect(casterPos, 'cast');
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
        const snowInterval = 0.15;
        const snowCount = Math.floor(this.duration / snowInterval);

        for (let i = 0; i < snowCount; i++) {
            this.game.schedulingSystem.scheduleAction(() => {
                const position = new THREE.Vector3(
                    centerPos.x,
                    centerPos.y + 200,
                    centerPos.z
                );

                // Falling snowflakes
                this.game.call('createParticles', {
                    position: position,
                    count: 15,
                    lifetime: 2.0,
                    visual: {
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xddddff },
                        scale: 8,
                        scaleMultiplier: 0.6,
                        fadeOut: true,
                        blending: 'additive'
                    },
                    velocityRange: { x: [-60, 60], y: [-80, -40], z: [-60, 60] },
                    gravity: 50,
                    drag: 0.98,
                    emitterShape: 'disk',
                    emitterRadius: this.blizzardRadius
                });

                // Swirling frost mist
                this.game.call('createParticles', {
                    position: new THREE.Vector3(centerPos.x, centerPos.y + 30, centerPos.z),
                    count: 8,
                    lifetime: 1.5,
                    visual: {
                        color: 0xaaddff,
                        colorRange: { start: 0xcceeFF, end: 0x6699ff },
                        scale: 25,
                        scaleMultiplier: 1.5,
                        fadeOut: true,
                        blending: 'additive'
                    },
                    velocityRange: { x: [-40, 40], y: [10, 40], z: [-40, 40] },
                    gravity: -20,
                    drag: 0.95,
                    emitterShape: 'ring',
                    emitterRadius: this.blizzardRadius * 0.5
                });
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

        // Create falling ice shard using particles
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
                const position = new THREE.Vector3(shardPos.x, shardPos.y, shardPos.z);

                // Ice shard core - bright cyan
                this.game.call('createParticles', {
                    position: position,
                    count: 6,
                    lifetime: 0.12,
                    visual: {
                        color: 0x88ffff,
                        colorRange: { start: 0xffffff, end: 0x44ddff },
                        scale: 20,
                        scaleMultiplier: 1.5,
                        fadeOut: true,
                        blending: 'additive'
                    },
                    velocityRange: { x: [-5, 5], y: [-5, 5], z: [-5, 5] },
                    gravity: 0,
                    drag: 0.9
                });

                // Outer frost glow
                this.game.call('createParticles', {
                    position: position,
                    count: 4,
                    lifetime: 0.15,
                    visual: {
                        color: 0x4488ff,
                        colorRange: { start: 0x88ccff, end: 0x2266ff },
                        scale: 30,
                        scaleMultiplier: 0.8,
                        fadeOut: true,
                        blending: 'additive'
                    },
                    velocityRange: { x: [-8, 8], y: [5, 15], z: [-8, 8] },
                    gravity: 0,
                    drag: 0.85
                });

                // Trail sparkles
                if (i % 2 === 0) {
                    this.game.call('createParticles', {
                        position: position,
                        count: 3,
                        lifetime: 0.5,
                        visual: {
                            color: 0xffffff,
                            colorRange: { start: 0xffffff, end: 0xaaddff },
                            scale: 6,
                            scaleMultiplier: 0.5,
                            fadeOut: true,
                            blending: 'additive'
                        },
                        velocityRange: { x: [-20, 20], y: [10, 40], z: [-20, 20] },
                        gravity: -10,
                        drag: 0.95
                    });
                }
            }, i * trailInterval, null);
        }

        // Impact effect when shard hits ground
        this.game.schedulingSystem.scheduleAction(() => {
            this.createShardImpact(targetPos);
        }, fallDuration, null);
    }

    createShardImpact(position) {
        // Impact particles
        this.createVisualEffect(position, 'ice_impact', { heightOffset: 0 });

        if (!this.game.isServer) {
            const impactPos = new THREE.Vector3(position.x, position.y + 10, position.z);

            // Ice shatter burst
            this.game.call('createParticles', {
                position: impactPos,
                count: 12,
                lifetime: 0.6,
                visual: {
                    color: 0x88ddff,
                    colorRange: { start: 0xffffff, end: 0x4488ff },
                    scale: 12,
                    scaleMultiplier: 0.8,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-60, 60], y: [20, 80], z: [-60, 60] },
                gravity: 150,
                drag: 0.95
            });

            // Frost ring on ground
            this.game.call('createParticles', {
                position: impactPos,
                count: 8,
                lifetime: 0.4,
                visual: {
                    color: 0xaaddff,
                    colorRange: { start: 0xcceeFF, end: 0x6699ff },
                    scale: 10,
                    scaleMultiplier: 1.0,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-50, 50], y: [5, 15], z: [-50, 50] },
                gravity: 30,
                drag: 0.9,
                emitterShape: 'ring',
                emitterRadius: 5
            });
        }
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
        // Big frost explosion at the end
        this.createVisualEffect(centerPos, 'frost_burst');

        if (!this.game.isServer) {
            const burstPos = new THREE.Vector3(centerPos.x, centerPos.y + 50, centerPos.z);

            this.game.call('createLayeredEffect', {
                position: burstPos,
                layers: [
                    // Central ice burst
                    {
                        count: 20,
                        lifetime: 0.8,
                        color: 0x88ffff,
                        colorRange: { start: 0xffffff, end: 0x44ddff },
                        scale: 40,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-100, 100], y: [30, 120], z: [-100, 100] },
                        gravity: -30,
                        drag: 0.85,
                        emitterShape: 'sphere',
                        emitterRadius: 20,
                        blending: 'additive'
                    },
                    // Frost ring expansion
                    {
                        count: 24,
                        lifetime: 0.6,
                        color: 0xaaddff,
                        colorRange: { start: 0xcceeFF, end: 0x6699ff },
                        scale: 15,
                        scaleMultiplier: 1.2,
                        velocityRange: { x: [-120, 120], y: [5, 20], z: [-120, 120] },
                        gravity: 50,
                        drag: 0.88,
                        emitterShape: 'ring',
                        emitterRadius: 30,
                        blending: 'additive'
                    },
                    // Ice crystal debris
                    {
                        count: 30,
                        lifetime: 1.5,
                        color: 0x88ddff,
                        colorRange: { start: 0xffffff, end: 0x4488ff },
                        scale: 8,
                        scaleMultiplier: 0.6,
                        velocityRange: { x: [-80, 80], y: [60, 150], z: [-80, 80] },
                        gravity: 200,
                        drag: 0.97,
                        emitterShape: 'sphere',
                        emitterRadius: 15,
                        blending: 'additive'
                    }
                ]
            });
        }
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