class FireBallAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
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
            ...abilityData
        });

        this.damage = 30;
        this.splashRadius = 80;
        this.element = this.enums.element.fire;

        // Store target position at cast time for ballistic trajectory
        this.targetPosition = null;
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

        // Cast effect at caster position
        this.playConfiguredEffects('cast', casterPos);

        this.logAbilityUsage(casterEntity, `Fireball launched at enemy target!`, true);

        this.fireProjectile(casterEntity, closestEnemy);
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
                // Impact particle effects
                this.playConfiguredEffects('impact', { x: impactPos.x, y: impactPos.y + 10, z: impactPos.z });

                // DESYNC SAFE: Handle splash damage deterministically
                this.handleSplashDamage(casterEntity, impactPos);
            },
            onTravel: (currentPos) => {
                // Trail particle effects
                this.playConfiguredEffects('trail', currentPos);
            }
        };

        this.game.call('fireProjectile', casterEntity, targetId, projectileData);
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
            // Calculate damage falloff based on distance (100% at center, 50% at edge)
            const damageMultiplier = Math.max(0.5, 1.0 - (target.distance / this.splashRadius) * 0.5);
            const splashDamage = Math.floor(this.damage * damageMultiplier);

            // Apply damage
            this.dealDamageWithEffects(casterEntity, target.id, splashDamage, this.element, {
                isSplash: true
            });
        });
    }
}
