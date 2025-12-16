class FireBallAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            name: 'Fire Ball',
            description: 'Launch a fiery projectile that explodes on impact',
            cooldown: 1,
            range: 300,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'attack',
            priority: 7,
            castTime: 0.5,
            ...params
        });

        this.damage = 30;
        this.splashRadius = 80;
        this.element = this.enums.element.fire;

        // Store target position at cast time for ballistic trajectory
        this.targetPosition = null;
    }

    defineEffects() {
        return {
            // Charging effect at caster
            cast: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0xff6600,
                    colorRange: { start: 0xffaa00, end: 0xff2200 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.6
                }
            },
            // Trail particles during flight
            trail_fire: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xff4400,
                    colorRange: { start: 0xffff00, end: 0xff2200 },
                    scaleMultiplier: 0.8,
                    speedMultiplier: 0.5
                }
            },
            trail_sparks: {
                type: 'magic',
                options: {
                    count: 2,
                    color: 0xffaa00,
                    scaleMultiplier: 0.3,
                    speedMultiplier: 2.0
                }
            },
            // Main explosion
            explosion_core: {
                type: 'explosion',
                options: {
                    count: 15,
                    color: 0xffff00,
                    colorRange: { start: 0xffffff, end: 0xff4400 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 1.8
                }
            },
            explosion_fire: {
                type: 'explosion',
                options: {
                    count: 20,
                    color: 0xff6600,
                    colorRange: { start: 0xff8800, end: 0xff0000 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.5
                }
            },
            explosion_smoke: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0x444444,
                    colorRange: { start: 0x666666, end: 0x222222 },
                    scaleMultiplier: 3.0,
                    speedMultiplier: 0.4
                }
            },
            explosion_embers: {
                type: 'damage',
                options: {
                    count: 12,
                    color: 0xff4400,
                    colorRange: { start: 0xffaa00, end: 0xff2200 },
                    scaleMultiplier: 0.4,
                    speedMultiplier: 2.5
                }
            },
            // Impact on targets
            impact: {
                type: 'damage',
                options: {
                    count: 5,
                    color: 0xff4400,
                    colorRange: { start: 0xffaa00, end: 0xff0000 },
                    scaleMultiplier: 1.2
                }
            }
        };
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        return enemies.length > 0;
    }

    execute(casterEntity, targetData = null) {
        if (!this.game.projectileSystem) return;

        const casterTransform = this.game.getComponent(casterEntity, "transform");
        const casterPos = casterTransform?.position;
        if (!casterPos) return;

        const enemies = this.getEnemiesInRange(casterEntity, this.range);

        // DESYNC SAFE: Find closest enemy deterministically
        const closestEnemy = this.findClosestEnemy(casterEntity, enemies);
        if (!closestEnemy) return;

        // IMPORTANT: Capture target position at cast time for ballistic trajectory
        const targetTransform = this.game.getComponent(closestEnemy, "transform");
        const targetPos = targetTransform?.position;
        if (!targetPos) return;

        this.targetPosition = {
            x: targetPos.x,
            y: targetPos.y,
            z: targetPos.z
        };

        // Immediate cast effect - charging energy
        this.createCastEffect(casterPos);

        this.logAbilityUsage(casterEntity, `Fireball launched at enemy target!`, true);

        this.fireProjectile(casterEntity, closestEnemy);
    }

    // Create impressive charging effect at caster
    createCastEffect(casterPos) {
        if (!this.game.effectsSystem) return;
        // Main cast particles
        this.createVisualEffect(casterPos, 'cast');

        // Use preset fire effects for charging
        if (!this.game.isServer) {
            const pos = new THREE.Vector3(casterPos.x, casterPos.y + 75, casterPos.z);
            this.game.call('playEffect', 'fire_burst_core', pos);
            this.game.call('playEffect', 'fire_burst_secondary', pos);
        }
    }

    // DESYNC SAFE: Deterministic closest enemy finding
    findClosestEnemy(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);

        let closestEnemy = null;
        let closestDistance = Infinity;

        sortedEnemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            if (!enemyPos) return;

            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) +
                Math.pow(enemyPos.z - casterPos.z, 2)
            );

            // Use < for consistent tie-breaking (first in sorted order wins)
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemyId;
            }
        });

        return closestEnemy;
    }

    fireProjectile(casterEntity, targetId) {
        if (!this.game.projectileSystem) return;

        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos || !this.targetPosition) return;

        // Create fireball projectile with enhanced effects
        // Uses captured target position for true ballistic trajectory
        const projectileData = {
            id: 'fireball',
            title: 'Fireball',
            damage: this.damage,
            speed: 120,
            element: this.element,
            ballistic: true,
            splashRadius: this.splashRadius,
            homing: false,
            homingStrength: 0,
            // Store the captured target position
            targetPosition: this.targetPosition,
            onHit: (impactPos) => {
                // Epic explosion effect
                this.createExplosionEffect(impactPos);

                // DESYNC SAFE: Handle splash damage deterministically
                this.handleSplashDamage(casterEntity, impactPos);
            },
            onTravel: (currentPos) => {
                // Rich trail effect during flight
                this.createTrailEffect(currentPos);
            }
        };

        this.game.call('fireProjectile', casterEntity, targetId, projectileData);
    }

    // Create rich trail effect for projectile
    createTrailEffect(currentPos) {
        if (!this.game.effectsSystem) return;
        // Fire trail
        this.createVisualEffect(currentPos, 'trail_fire', { heightOffset: 0 });

        // Sparks
        this.createVisualEffect(currentPos, 'trail_sparks', { heightOffset: 0 });

        // Use preset trail effects
        if (!this.game.isServer) {
            const pos = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);
            this.game.call('playEffect', 'fire_trail', pos);
            this.game.call('playEffect', 'smoke_rising', pos);
        }
    }

    // Create epic multi-layered explosion effect
    createExplosionEffect(impactPos) {
        if (!this.game.effectsSystem) return;

        // Standard explosion effects
        this.createVisualEffect(impactPos, 'explosion_core');
        this.createVisualEffect(impactPos, 'explosion_fire');
        this.createVisualEffect(impactPos, 'explosion_embers');

        // Delayed smoke rising
        this.game.schedulingSystem.scheduleAction(() => {
            this.createVisualEffect(impactPos, 'explosion_smoke');
        }, 0.1);

        // Use preset explosion_fire effect system
        if (!this.game.isServer) {
            const pos = new THREE.Vector3(impactPos.x, impactPos.y + 75, impactPos.z);
            this.game.call('playEffectSystem', 'explosion_fire', pos);
        }
    }

    // DESYNC SAFE: Handle splash damage deterministically
    handleSplashDamage(casterEntity, impactPos) {
        // Get all entities in splash radius
        const allEntities = this.game.getEntitiesWith(
            "transform",
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
            // Calculate damage falloff based on distance
            const damageMultiplier = Math.max(0.3, 1.0 - (target.distance / this.splashRadius));
            const splashDamage = Math.floor(this.damage * damageMultiplier);

            // Apply damage
            this.dealDamageWithEffects(casterEntity, target.id, splashDamage, this.element, {
                isSplash: true
            });

            // Impact effect on each target
            this.createVisualEffect(target.position, 'impact');
        });
    }
}
