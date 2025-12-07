class LeapSlamAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'leap_slam',
            name: 'Leap Slam',
            description: 'Leap into the air and slam down, dealing AoE damage',
            cooldown: 8.0,
            range: 200,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'attack',
            priority: 7,
            castTime: 0.3,
            ...params
        });

        this.leapDamage = 40;
        this.splashRadius = 60;
        this.leapHeight = 300;
    }

    defineEffects() {
        return {
            launch: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0x8B4513,
                    colorRange: { start: 0xa08060, end: 0x665544 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.5
                }
            },
            impact: {
                type: 'explosion',
                options: {
                    count: 15,
                    color: 0x8B4513,
                    colorRange: { start: 0xa08060, end: 0x443322 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 1.8
                }
            },
            shockwave: {
                type: 'damage',
                options: {
                    count: 12,
                    color: 0xCC6600,
                    colorRange: { start: 0xFF8800, end: 0x884400 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            }
        };
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity, this.range);

        // Don't leap if already leaping
        if (this.leapingEntities && this.leapingEntities.has(casterEntity)) return false;

        return enemies.length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        if (enemies.length === 0) return;

        // Find closest enemy deterministically
        const target = this.findClosestEnemy(casterEntity, enemies);
        if (!target) return;

        const targetTransform = this.game.getComponent(target, "transform");
        const targetPos = targetTransform?.position;
        if (!targetPos) return;

        // Store landing position at cast time
        const landingPos = { x: targetPos.x, y: targetPos.y, z: targetPos.z };

        // Launch effect
        this.createVisualEffect(pos, 'launch');
        this.logAbilityUsage(casterEntity, "Barbarian leaps into battle!", true);

        // Start the leap
        this.game.schedulingSystem.scheduleAction(() => {
            this.initiateLeap(casterEntity, landingPos);
        }, this.castTime, casterEntity);
    }

    findClosestEnemy(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));

        let closest = null;
        let closestDistance = Infinity;

        sortedEnemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            if (!enemyPos) return;

            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) +
                Math.pow(enemyPos.z - casterPos.z, 2)
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closest = enemyId;
            }
        });

        return closest;
    }

    initiateLeap(casterEntity, landingPos) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        const velocity = this.game.getComponent(casterEntity, "velocity");

        if (!pos || !velocity) return;

        // Get gravity from MovementSystem (single source of truth)
        const gravity = this.game.movementSystem?.GRAVITY || 200;

        // Calculate leap duration from desired height: t = 2 * sqrt(2h/g)
        const leapDuration = 2 * Math.sqrt((2 * this.leapHeight) / gravity);

        // Calculate horizontal velocity to reach landing position in leapDuration
        const dx = landingPos.x - pos.x;
        const dz = landingPos.z - pos.z;

        velocity.vx = dx / leapDuration;
        velocity.vz = dz / leapDuration;

        // Calculate initial upward velocity for parabolic arc: vy0 = sqrt(2 * g * h)
        velocity.vy = Math.sqrt(2 * gravity * this.leapHeight);

        // Store leap duration for scheduling
        this.currentLeapDuration = leapDuration;

        // Store landing info for damage on complete
        this.leapingEntities = this.leapingEntities || new Map();
        this.leapingEntities.set(casterEntity, {
            landingPos: landingPos,
            damage: this.leapDamage,
            splashRadius: this.splashRadius
        });

        // Add leaping component so behavior system skips this unit
        this.game.addComponent(casterEntity, "leaping", { isLeaping: true });

        // Trigger attack animation for the duration of the leap
        // The animation should play once during the entire leap, paced to match the leap duration
        if (this.game.hasService('triggerSinglePlayAnimation')) {
            this.game.call('triggerSinglePlayAnimation', casterEntity, 'attack', 1.0, leapDuration);
        }

        // Dust burst at launch (client only)
        if (!this.game.isServer && this.game.gameSystem) {
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(pos.x, pos.y + 10, pos.z),
                layers: [
                    {
                        count: 20,
                        lifetime: 0.5,
                        color: 0x8b7355,
                        colorRange: { start: 0xa08060, end: 0x665544 },
                        scale: 18,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-60, 60], y: [10, 50], z: [-60, 60] },
                        gravity: 80,
                        drag: 0.9,
                        blending: 'normal'
                    }
                ]
            });
        }

        // Complete the leap after duration
        this.game.schedulingSystem.scheduleAction(() => {
            this.completeLeap(casterEntity);
        }, leapDuration, casterEntity);
    }

    completeLeap(casterEntity) {
        if (!this.leapingEntities || !this.leapingEntities.has(casterEntity)) return;

        const leapData = this.leapingEntities.get(casterEntity);
        const transform = this.game.getComponent(casterEntity, "transform");
        const velocity = this.game.getComponent(casterEntity, "velocity");

        if (!transform) return;

        const landingPos = leapData.landingPos;
        const damage = leapData.damage;
        const splashRadius = leapData.splashRadius;

        // Stop movement and snap to landing position for determinism
        if (velocity) {
            velocity.vx = 0;
            velocity.vy = 0;
            velocity.vz = 0;
        }

        // Snap position to landing pos to ensure client/server sync
        if (transform.position) {
            transform.position.x = landingPos.x;
            transform.position.y = landingPos.y;
            transform.position.z = landingPos.z;
        }

        // Remove from leaping tracking
        this.leapingEntities.delete(casterEntity);

        // Remove leaping component
        if (this.game.hasComponent(casterEntity, "leaping")) {
            this.game.removeComponent(casterEntity, "leaping");
        }

        // Impact effects
        this.createVisualEffect(landingPos, 'impact');
        this.createVisualEffect(landingPos, 'shockwave');

        // Epic ground slam effect (client only)
        if (!this.game.isServer && this.game.gameSystem) {
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(landingPos.x, landingPos.y + 10, landingPos.z),
                layers: [
                    // Central impact flash
                    {
                        count: 8,
                        lifetime: 0.2,
                        color: 0xFFAA00,
                        colorRange: { start: 0xFFFFFF, end: 0xFF6600 },
                        scale: 35,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-30, 30], y: [30, 80], z: [-30, 30] },
                        gravity: 0,
                        drag: 0.7,
                        blending: 'additive'
                    },
                    // Dust explosion
                    {
                        count: 30,
                        lifetime: 0.8,
                        color: 0x8b7355,
                        colorRange: { start: 0xa08060, end: 0x443322 },
                        scale: 25,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-100, 100], y: [40, 120], z: [-100, 100] },
                        gravity: 150,
                        drag: 0.92,
                        blending: 'normal'
                    },
                    // Ground ring shockwave
                    {
                        count: 24,
                        lifetime: 0.4,
                        color: 0xCC8844,
                        colorRange: { start: 0xDDAA66, end: 0x886633 },
                        scale: 15,
                        scaleMultiplier: 1.2,
                        velocityRange: { x: [-150, 150], y: [5, 20], z: [-150, 150] },
                        gravity: 50,
                        drag: 0.85,
                        emitterShape: 'ring',
                        emitterRadius: 20,
                        blending: 'normal'
                    },
                    // Rock debris
                    {
                        count: 15,
                        lifetime: 0.6,
                        color: 0x666666,
                        colorRange: { start: 0x888888, end: 0x444444 },
                        scale: 8,
                        scaleMultiplier: 0.6,
                        velocityRange: { x: [-80, 80], y: [100, 200], z: [-80, 80] },
                        gravity: 400,
                        drag: 0.98,
                        blending: 'normal'
                    }
                ]
            });
        }

        // Screen shake
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.5, 3);
        }

        // Deal AoE damage
        this.handleSplashDamage(casterEntity, landingPos, damage, splashRadius);
    }

    handleSplashDamage(casterEntity, impactPos, damage, splashRadius) {
        const allEntities = this.game.getEntitiesWith("transform", "health", "team");
        const casterTeam = this.game.getComponent(casterEntity, "team");
        if (!casterTeam) return;

        const splashTargets = [];

        allEntities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const entityPos = transform?.position;
            const entityTeam = this.game.getComponent(entityId, "team");

            if (!entityPos || !entityTeam || entityTeam.team === casterTeam.team) return;

            const distance = Math.sqrt(
                Math.pow(entityPos.x - impactPos.x, 2) +
                Math.pow(entityPos.z - impactPos.z, 2)
            );

            if (distance <= splashRadius) {
                splashTargets.push({
                    id: entityId,
                    distance: distance,
                    position: entityPos
                });
            }
        });

        // Sort deterministically
        splashTargets.sort((a, b) => {
            if (Math.abs(a.distance - b.distance) > 0.001) {
                return a.distance - b.distance;
            }
            return String(a.id).localeCompare(String(b.id));
        });

        // Apply damage with falloff
        splashTargets.forEach(target => {
            const damageMultiplier = Math.max(0.5, 1.0 - (target.distance / splashRadius) * 0.5);
            const splashDamage = Math.floor(damage * damageMultiplier);

            this.dealDamageWithEffects(casterEntity, target.id, splashDamage, 'physical', {
                isLeapSlam: true
            });
        });
    }

    onBattleEnd() {
        // Clean up any leaping entities when battle ends
        if (this.leapingEntities) {
            for (const entityId of this.leapingEntities.keys()) {
                // Stop velocity
                const velocity = this.game.getComponent(entityId, "velocity");
                if (velocity) {
                    velocity.vx = 0;
                    velocity.vy = 0;
                    velocity.vz = 0;
                }
                // Remove leaping component
                if (this.game.hasComponent(entityId, "leaping")) {
                    this.game.removeComponent(entityId, "leaping");
                }
            }
            this.leapingEntities.clear();
        }
    }
}
