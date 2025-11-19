class MeteorStrikeAbility extends engine.app.appClasses['BaseAbility'] {
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
        this.element = 'fire';
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
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
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

        // Create ground ring effect using layered particles
        if (this.game.gameManager) {
            const ringPos = new THREE.Vector3(position.x, position.y + 5, position.z);

            this.game.gameManager.call('createLayeredEffect', {
                position: ringPos,
                layers: [
                    // Expanding warning ring
                    {
                        count: 24,
                        lifetime: this.delay,
                        color: 0xff2200,
                        colorRange: { start: 0xff4400, end: 0xff0000 },
                        scale: 10,
                        scaleMultiplier: 0.8,
                        velocityRange: { x: [-80, 80], y: [5, 15], z: [-80, 80] },
                        gravity: 0,
                        drag: 0.98,
                        emitterShape: 'ring',
                        emitterRadius: 20,
                        blending: 'additive'
                    }
                ]
            });
        }
    }

    spawnFallingMeteor(casterEntity, targetPos) {
        // Create a projectile that falls from high above
        const startPos = {
            x: targetPos.x,
            y: this.meteorHeight,
            z: targetPos.z
        };

        // Use projectile system to create the falling meteor
        const projectileData = {
            id: 'meteor',
            title: 'Meteor',
            damage: 0, // Damage handled separately in meteorImpact
            speed: this.meteorHeight / this.delay, // Speed to reach ground in delay time
            element: this.element,
            ballistic: false,
            homing: false,
            targetPosition: targetPos,
            startPosition: startPos,
            onTravel: (currentPos) => {
                this.createMeteorTrail(currentPos);
            },
            onHit: () => {
                // Impact handled by scheduled meteorImpact
            }
        };

        // Fire projectile from sky position toward ground
        if (this.game.gameManager && this.game.gameManager.has('fireProjectileFromPosition')) {
            this.game.gameManager.call('fireProjectileFromPosition', startPos, targetPos, projectileData);
        } else {
            // Fallback: create trail effects manually during descent
            const trailInterval = 0.1;
            const trailCount = Math.floor(this.delay / trailInterval);

            for (let i = 0; i < trailCount; i++) {
                const progress = i / trailCount;
                const trailPos = {
                    x: targetPos.x,
                    y: this.meteorHeight * (1 - progress) + targetPos.y * progress,
                    z: targetPos.z
                };

                this.game.schedulingSystem.scheduleAction(() => {
                    this.createMeteorTrail(trailPos);
                }, i * trailInterval, null);
            }
        }
    }

    createMeteorTrail(currentPos) {
        // Fire trail
        this.createVisualEffect(currentPos, 'trail_fire', { heightOffset: 0 });

        // Smoke trail
        this.createVisualEffect(currentPos, 'trail_smoke', { heightOffset: 0 });

        // Additional layered trail effect
        if (this.game.gameManager) {
            const position = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);

            this.game.gameManager.call('createParticles', {
                position: position,
                count: 4,
                lifetime: 1.0,
                visual: {
                    color: 0xff4400,
                    colorRange: { start: 0xffaa00, end: 0xff2200 },
                    scale: 20,
                    scaleMultiplier: 1.5,
                    fadeOut: true,
                    scaleOverTime: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-30, 30], y: [20, 60], z: [-30, 30] },
                gravity: -20,
                drag: 0.95
            });
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

        // Advanced layered explosion
        if (this.game.gameManager) {
            const explosionPos = new THREE.Vector3(position.x, position.y + 50, position.z);

            this.game.gameManager.call('createLayeredEffect', {
                position: explosionPos,
                layers: [
                    // Bright flash core
                    {
                        count: 15,
                        lifetime: 0.4,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xffff00 },
                        scale: 60,
                        scaleMultiplier: 4.0,
                        velocityRange: { x: [-150, 150], y: [-50, 200], z: [-150, 150] },
                        gravity: 0,
                        drag: 0.75,
                        blending: 'additive'
                    },
                    // Main fireball expansion
                    {
                        count: 40,
                        lifetime: 1.0,
                        color: 0xff6600,
                        colorRange: { start: 0xffaa00, end: 0xff2200 },
                        scale: 35,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-120, 120], y: [30, 180], z: [-120, 120] },
                        gravity: -40,
                        drag: 0.88,
                        emitterShape: 'sphere',
                        emitterRadius: 30,
                        blending: 'additive'
                    },
                    // Secondary flames
                    {
                        count: 25,
                        lifetime: 1.5,
                        color: 0xff4400,
                        colorRange: { start: 0xff8800, end: 0x880000 },
                        scale: 30,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-80, 80], y: [50, 140], z: [-80, 80] },
                        gravity: -60,
                        drag: 0.9,
                        emitterShape: 'sphere',
                        emitterRadius: 40,
                        blending: 'additive'
                    },
                    // Rising smoke column
                    {
                        count: 20,
                        lifetime: 2.5,
                        color: 0x444444,
                        colorRange: { start: 0x555555, end: 0x111111 },
                        scale: 45,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-30, 30], y: [80, 160], z: [-30, 30] },
                        gravity: -50,
                        drag: 0.96,
                        blending: 'normal'
                    },
                    // Ground shockwave ring
                    {
                        count: 32,
                        lifetime: 0.8,
                        color: 0xff8800,
                        colorRange: { start: 0xffaa00, end: 0xff4400 },
                        scale: 20,
                        scaleMultiplier: 1.2,
                        velocityRange: { x: [-180, 180], y: [5, 30], z: [-180, 180] },
                        gravity: 80,
                        drag: 0.82,
                        emitterShape: 'ring',
                        emitterRadius: 20,
                        blending: 'additive'
                    },
                    // Flying debris/rocks
                    {
                        count: 30,
                        lifetime: 2.0,
                        color: 0x664422,
                        colorRange: { start: 0x886644, end: 0x442200 },
                        scale: 10,
                        scaleMultiplier: 0.8,
                        velocityRange: { x: [-140, 140], y: [100, 250], z: [-140, 140] },
                        gravity: 300,
                        drag: 0.98,
                        emitterShape: 'sphere',
                        emitterRadius: 20,
                        blending: 'normal'
                    },
                    // Flying embers
                    {
                        count: 35,
                        lifetime: 2.0,
                        color: 0xffaa00,
                        colorRange: { start: 0xffcc00, end: 0xff4400 },
                        scale: 8,
                        scaleMultiplier: 0.5,
                        velocityRange: { x: [-120, 120], y: [100, 220], z: [-120, 120] },
                        gravity: 250,
                        drag: 0.97,
                        emitterShape: 'sphere',
                        emitterRadius: 15,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Apply splash damage
        this.handleSplashDamage(casterEntity, position);
    }

    // DESYNC SAFE: Handle splash damage deterministically
    handleSplashDamage(casterEntity, impactPos) {
        // Get all entities in splash radius
        const allEntities = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.HEALTH,
            this.componentTypes.TEAM
        );

        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        if (!casterTeam) return;

        const splashTargets = [];

        // Find all valid targets in splash radius
        allEntities.forEach(entityId => {
            const entityPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const entityTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);

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
            return String(a.id).localeCompare(String(b.id));
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
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));

        let bestPosition = null;
        let maxTargetsHit = 0;
        let bestScore = 0; // For tie-breaking: prefer positions with lower total distance

        // Check each enemy position as potential impact center
        sortedEnemies.forEach(potentialCenter => {
            const centerPos = this.game.getComponent(potentialCenter, this.componentTypes.POSITION);
            if (!centerPos) return;

            let targetsInRange = 0;
            let totalDistance = 0;

            // Count enemies within splash radius of this position
            sortedEnemies.forEach(enemyId => {
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
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
            const firstEnemyPos = this.game.getComponent(sortedEnemies[0], this.componentTypes.POSITION);
            if (firstEnemyPos) {
                bestPosition = { x: firstEnemyPos.x, y: firstEnemyPos.y, z: firstEnemyPos.z };
            }
        }

        return bestPosition;
    }
}