class MeteorStrikeAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'meteor_strike',
            name: 'Meteor Strike',
            description: 'Devastating strike on the densest enemy formation',
            cooldown: 5.0,
            range: 300,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'cast',
            priority: 10,
            castTime: 1.0,
            ...params
        });

        this.damage = 200;
        this.splashRadius = 120;
        this.delay = 2.0;
        this.element = this.enums.element.fire;
        this.minTargets = 0;
        this.meteorHeight = 500; // Height meteor falls from
    }

    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 12,
                    color: 0xff4400,
                    colorRange: { start: 0xffaa00, end: 0xff2200 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 0.8
                }
            },
            warning: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0xff0000,
                    colorRange: { start: 0xff4400, end: 0xff0000 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.5
                }
            },
            trail_fire: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0xff4400,
                    colorRange: { start: 0xffff00, end: 0xff2200 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.6
                }
            },
            trail_smoke: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x555555,
                    colorRange: { start: 0x666666, end: 0x222222 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.3
                }
            },
            explosion_core: {
                type: 'explosion',
                options: {
                    count: 25,
                    color: 0xffff00,
                    colorRange: { start: 0xffffff, end: 0xff4400 },
                    scaleMultiplier: 5.0,
                    speedMultiplier: 2.0
                }
            },
            explosion_fire: {
                type: 'explosion',
                options: {
                    count: 30,
                    color: 0xff6600,
                    colorRange: { start: 0xff8800, end: 0xff0000 },
                    scaleMultiplier: 4.0,
                    speedMultiplier: 1.5
                }
            },
            explosion_debris: {
                type: 'damage',
                options: {
                    count: 20,
                    color: 0x664422,
                    colorRange: { start: 0x886644, end: 0x442200 },
                    scaleMultiplier: 1.0,
                    speedMultiplier: 3.0
                }
            },
            explosion_embers: {
                type: 'damage',
                options: {
                    count: 15,
                    color: 0xffaa00,
                    colorRange: { start: 0xffcc00, end: 0xff4400 },
                    scaleMultiplier: 0.6,
                    speedMultiplier: 2.5
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 8,
                    color: 0xff4400,
                    colorRange: { start: 0xffaa00, end: 0xff0000 },
                    scaleMultiplier: 1.5
                }
            }
        };
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        const enemies = this.getEnemiesInRange(casterEntity);
        const targetPos = this.findBestClusterPosition(enemies, this.minTargets);

        if (!targetPos) return null;

        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `A massive meteor approaches from the heavens!`);

        // Schedule warning indicator after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createMeteorWarning(targetPos);
            this.spawnFallingMeteor(casterEntity, targetPos);
        }, this.castTime, casterEntity);

        // Schedule meteor impact after cast time + delay
        this.game.schedulingSystem.scheduleAction(() => {
            this.meteorImpact(casterEntity, targetPos);
        }, this.castTime + this.delay, casterEntity);
    }

    createMeteorWarning(position) {
        // Create warning effect
        this.createVisualEffect(position, 'warning');

        // Schedule repeated warning effects during the delay period
        const warningInterval = 0.4;
        const warningCount = Math.floor(this.delay / warningInterval);

        for (let i = 1; i < warningCount; i++) {
            this.game.schedulingSystem.scheduleAction(() => {
                this.createVisualEffect(position, 'warning');
            }, i * warningInterval, null);
        }

        // Create ground ring effect using preset effect
        if (!this.game.isServer) {
            const ringPos = new THREE.Vector3(position.x, position.y + 5, position.z);
            this.game.call('playEffect', 'meteor_warning', ringPos);
        }
    }

    spawnFallingMeteor(casterEntity, targetPos) {
        // Create falling meteor using only particle effects
        const trailInterval = 0.05; // More frequent for smoother descent
        const trailCount = Math.floor(this.delay / trailInterval);

        for (let i = 0; i < trailCount; i++) {
            const progress = i / trailCount;
            const currentY = this.meteorHeight * (1 - progress) + targetPos.y * progress;
            const trailPos = {
                x: targetPos.x,
                y: currentY,
                z: targetPos.z
            };

            this.game.schedulingSystem.scheduleAction(() => {
                this.createMeteorTrail(trailPos);

                // Create the meteor "body" using preset effects
                if (!this.game.isServer) {
                    const position = new THREE.Vector3(trailPos.x, trailPos.y, trailPos.z);
                    this.game.call('playEffect', 'meteor_core', position);
                    this.game.call('playEffect', 'meteor_flame', position);
                }
            }, i * trailInterval, null);
        }
    }

    createMeteorTrail(currentPos) {
        // Fire trail
        this.createVisualEffect(currentPos, 'trail_fire', { heightOffset: 0 });

        // Smoke trail
        this.createVisualEffect(currentPos, 'trail_smoke', { heightOffset: 0 });

        // Use preset meteor trail effect
        if (!this.game.isServer) {
            this.game.call('playEffect', 'meteor_trail',
                new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z));
        }
    }

    meteorImpact(casterEntity, position) {
        // Create massive multi-layered explosion effect
        this.createVisualEffect(position, 'explosion_core');
        this.createVisualEffect(position, 'explosion_fire');
        this.createVisualEffect(position, 'explosion_debris');
        this.createVisualEffect(position, 'explosion_embers');

        // Screen effects for dramatic impact
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ff4400', 0.5);
        }

        // Use preset meteor_impact effect system
        if (!this.game.isServer) {
            this.game.call('playEffectSystem', 'meteor_impact',
                new THREE.Vector3(position.x, position.y + 50, position.z));
        }

        // Apply splash damage
        this.handleSplashDamage(casterEntity, position);
    }

    // DESYNC SAFE: Handle splash damage deterministically
    handleSplashDamage(casterEntity, impactPos) {
        // Get all entities in splash radius
        const allEntities = this.game.getEntitiesWith(
            "position",
            "health",
            "team"
        );

        const casterTeam = this.game.getComponent(casterEntity, "team");
        if (!casterTeam) return;

        const splashTargets = [];

        // Find all valid targets in splash radius
        allEntities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const entityPos = transform?.position;
            const entityTeam = this.game.getComponent(entityId, "team");

            if (!entityPos || !entityTeam || entityTeam.team === casterTeam.team) return;

            const distance = Math.sqrt(
                Math.pow(entityPos.x - impactPos.x, 2) +
                Math.pow(entityPos.z - impactPos.z, 2)
            );

            if (distance <= this.splashRadius) {
                splashTargets.push({
                    id: entityId,
                    distance: distance,
                    position: entityPos
                });
            }
        });

        // DESYNC SAFE: Sort splash targets deterministically
        splashTargets.sort((a, b) => {
            // Primary sort by distance
            if (Math.abs(a.distance - b.distance) > 0.001) {
                return a.distance - b.distance;
            }
            // Secondary sort by entity ID for deterministic tie-breaking
            return a.id - b.id;
        });

        // Apply splash damage to all targets
        splashTargets.forEach(target => {
            // Calculate damage falloff based on distance (less falloff for meteor)
            const damageMultiplier = Math.max(0.5, 1.0 - (target.distance / this.splashRadius) * 0.5);
            const splashDamage = Math.floor(this.damage * damageMultiplier);

            // Apply damage
            this.dealDamageWithEffects(casterEntity, target.id, splashDamage, this.element, {
                isSplash: true
            });

            // Impact effect on each target
            this.createVisualEffect(target.position, 'impact');
        });
    }

    // FIXED: Deterministic cluster position finding
    findBestClusterPosition(enemies, minTargets) {
        if (enemies.length === 0) return null;

        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);

        let bestPosition = null;
        let maxTargetsHit = 0;
        let bestScore = 0; // For tie-breaking: prefer positions with lower total distance

        // Check each enemy position as potential impact center
        sortedEnemies.forEach(potentialCenter => {
            const transform = this.game.getComponent(potentialCenter, "transform");
            const centerPos = transform?.position;
            if (!centerPos) return;

            let targetsInRange = 0;
            let totalDistance = 0;

            // Count enemies within splash radius of this position
            sortedEnemies.forEach(enemyId => {
                const transform = this.game.getComponent(enemyId, "transform");
                const enemyPos = transform?.position;
                if (!enemyPos) return;

                const distance = Math.sqrt(
                    Math.pow(enemyPos.x - centerPos.x, 2) +
                    Math.pow(enemyPos.z - centerPos.z, 2)
                );

                if (distance <= this.splashRadius) {
                    targetsInRange++;
                    totalDistance += distance;
                }
            });

            // Calculate score: prioritize more targets, then lower total distance for tie-breaking
            const score = (targetsInRange * 1000) - totalDistance;

            // Use >= for consistent tie-breaking (first in sorted order wins when scores are equal)
            if (targetsInRange > maxTargetsHit ||
                (targetsInRange === maxTargetsHit && score >= bestScore)) {
                maxTargetsHit = targetsInRange;
                bestScore = score;
                bestPosition = { x: centerPos.x, y: centerPos.y, z: centerPos.z };
            }
        });

        // If no good cluster found but we have enemies, target the first enemy deterministically
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
