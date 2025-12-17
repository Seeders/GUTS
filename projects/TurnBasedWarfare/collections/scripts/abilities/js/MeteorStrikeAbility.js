class MeteorStrikeAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
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
            ...abilityData
        });

        this.damage = 200;
        this.splashRadius = 120;
        this.delay = 2.0;
        this.element = this.enums.element.fire;
        this.minTargets = 0;
        this.meteorHeight = 500; // Height meteor falls from
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
        this.playConfiguredEffects('cast', casterPos);
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
        this.playConfiguredEffects('warning', position);

        // Schedule repeated warning effects during the delay period
        const warningInterval = 0.4;
        const warningCount = Math.floor(this.delay / warningInterval);

        for (let i = 1; i < warningCount; i++) {
            this.game.schedulingSystem.scheduleAction(() => {
                this.playConfiguredEffects('warning', position);
            }, i * warningInterval, null);
        }
    }

    spawnFallingMeteor(casterEntity, targetPos) {
        if (this.game.isServer) return;

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
                this.playConfiguredEffects('trail', trailPos);
                this.playConfiguredEffects('meteor', trailPos);
            }, i * trailInterval, null);
        }
    }

    meteorImpact(casterEntity, position) {
        // Create massive multi-layered explosion effect
        this.playConfiguredEffects('impact', position);

        // Screen effects for dramatic impact
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ff4400', 0.5);
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

            // Target impact effect
            this.playConfiguredEffects('target', target.position);
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
