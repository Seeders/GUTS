class ConsecrationAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            id: 'consecration',
            name: 'Consecration',
            description: 'Sanctify the ground, creating a zone that damages undead and heals the living',
            cooldown: 18.0,
            range: 0, // Centered on caster
            manaCost: 50,
            targetType: 'area',
            animation: 'cast',
            priority: 7,
            castTime: 2.0,
            ...abilityData
        });

        this.consecrationRadius = 120;
        this.duration = 15.0; // 15 seconds
        this.tickInterval = 2.0; // Every 2 seconds
        this.tickDamage = 12; // Damage to undead per tick
        this.tickHeal = 8; // Healing to living per tick
    }

    canExecute(casterEntity) {
        // Check if there are units nearby that would benefit from consecration
        const nearbyUnits = this.getUnitsInRange(casterEntity, this.consecrationRadius);
        return nearbyUnits.length >= 2; // At least 2 units to affect
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        // Immediate cast effect
        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Templar consecrates the battlefield with holy power!", true);

        // DESYNC SAFE: Use scheduling system for consecration creation
        this.game.schedulingSystem.scheduleAction(() => {
            this.createConsecration(casterEntity, pos);
        }, this.castTime, casterEntity);
    }

    createConsecration(casterEntity, consecrationPos) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (!casterHealth || casterHealth.current <= 0) return;

        // Create consecrated ground entity
        const consecrationId = this.game.createEntity();

        this.game.addComponent(consecrationId, "transform", {
            position: { x: consecrationPos.x, y: consecrationPos.y, z: consecrationPos.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        const enums = this.game.getEnums();
        this.game.addComponent(consecrationId, "temporaryEffect", {
            effectType: enums.temporaryEffectType.consecrated_ground,
            caster: casterEntity,
            radius: this.consecrationRadius,
            tickInterval: this.tickInterval,
            tickDamage: this.tickDamage,
            tickHeal: this.tickHeal,
            createdTime: this.game.state.now
        });

        const objectTypeIndex = this.enums.objectTypeDefinitions?.effects ?? -1;
        const spawnTypeIndex = this.enums.effects?.consecration ?? -1;
        this.game.addComponent(consecrationId, "renderable", {
            objectType: objectTypeIndex,
            spawnType: spawnTypeIndex,
            capacity: 128
        });

        // DESYNC SAFE: Schedule all consecration ticks using the scheduling system
        const totalTicks = Math.floor(this.duration / this.tickInterval);

        for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
            const tickDelay = this.tickInterval * tickIndex;

            this.game.schedulingSystem.scheduleAction(() => {
                this.executeConsecrationTick(consecrationId, casterEntity, consecrationPos, tickIndex);
            }, tickDelay, consecrationId);
        }

        // DESYNC SAFE: Schedule consecration cleanup
        this.game.schedulingSystem.scheduleAction(() => {
            this.cleanupConsecration(consecrationId);
        }, this.duration, consecrationId);

        // Screen effect for consecration creation
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ffffaa', 0.5);
        }

        // Create initial burst effect
        this.playConfiguredEffects('burst', consecrationPos);

        // Schedule continuous ground glow throughout duration
        if (!this.game.isServer) {
            const glowInterval = 0.5;
            const glowCount = Math.floor(this.duration / glowInterval);

            for (let i = 0; i < glowCount; i++) {
                this.game.schedulingSystem.scheduleAction(() => {
                    this.playConfiguredEffects('sustained', consecrationPos);
                }, i * glowInterval, consecrationId);
            }
        }
    }

    // DESYNC SAFE: Execute a single consecration tick deterministically
    executeConsecrationTick(consecrationId, casterEntity, consecrationPos, tickIndex) {
        // Check if consecration entity still exists
        if (!this.game.hasComponent(consecrationId, "temporaryEffect")) {
            return;
        }

        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const casterTeam = this.game.getComponent(casterEntity, "team");

        if (!casterHealth || casterHealth.current <= 0 || !casterTeam) {
            // Caster died, end consecration early
            this.cleanupConsecration(consecrationId);
            return;
        }

        // DESYNC SAFE: Get all units in area deterministically
        const allUnits = this.game.getEntitiesWith(
            "transform",
            "health",
            "team"
        );

        // Sort units for consistent processing order
        const sortedUnits = allUnits.slice().sort((a, b) => a - b);

        sortedUnits.forEach(unitId => {
            const transform = this.game.getComponent(unitId, "transform");
            const unitPos = transform?.position;
            const health = this.game.getComponent(unitId, "health");
            const team = this.game.getComponent(unitId, "team");
            const unitTypeComp = this.game.getComponent(unitId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!unitPos || !health || !team || health.current <= 0) return;

            // Check if unit is in consecration radius
            const distance = Math.sqrt(
                Math.pow(unitPos.x - consecrationPos.x, 2) +
                Math.pow(unitPos.z - consecrationPos.z, 2)
            );

            if (distance <= this.consecrationRadius) {
                // DESYNC SAFE: Determine if unit is undead/evil deterministically
                const isUndead = this.isUndeadUnit(unitType);

                if (isUndead) {
                    // Damage undead/evil units
                    this.dealDamageWithEffects(casterEntity, unitId, this.tickDamage, 'holy', {
                        isConsecration: true,
                        tickIndex: tickIndex
                    });
                    this.playConfiguredEffects('tick', unitPos);
                } else if (team.team === casterTeam.team) {
                    // Heal living allies
                    if (health.current < health.max) {
                        const healAmount = Math.min(this.tickHeal, health.max - health.current);
                        health.current += healAmount;

                        this.playConfiguredEffects('heal', unitPos);

                        if (!this.game.isServer && this.game.hasService('showDamageNumber')) {
                            this.game.call('showDamageNumber',
                                unitPos.x, unitPos.y + 15, unitPos.z,
                                healAmount, 'heal'
                            );
                        }
                    }
                }
            }
        });

        // Additional visual effects every few ticks
        if (tickIndex % 3 === 0) {
            this.playConfiguredEffects('burst', consecrationPos);
        }
    }

    // DESYNC SAFE: Determine if unit is undead deterministically
    isUndeadUnit(unitType) {
        if (!unitType) return false;

        // Check various undead/evil identifiers
        return (
            unitType.id === 'skeleton' ||
            unitType.id === 'zombie' ||
            unitType.id === 'lich' ||
            unitType.id === 'wraith' ||
            unitType.id === 'demon'
        );
    }

    // DESYNC SAFE: Get all units in range
    getUnitsInRange(casterEntity, radius) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return [];

        const allUnits = this.game.getEntitiesWith(
            "transform",
            "health"
        );

        return allUnits.filter(unitId => {
            const transform = this.game.getComponent(unitId, "transform");
            const unitPos = transform?.position;
            const health = this.game.getComponent(unitId, "health");

            if (!unitPos || !health || health.current <= 0) return false;

            const distance = Math.sqrt(
                Math.pow(unitPos.x - casterPos.x, 2) +
                Math.pow(unitPos.z - casterPos.z, 2)
            );

            return distance <= radius;
        }).sort((a, b) => a - b); // Sort for determinism
    }

    // DESYNC SAFE: Clean up consecration
    cleanupConsecration(consecrationId) {
        if (this.game.hasComponent(consecrationId, "temporaryEffect")) {
            // Visual effect for consecration ending
            const transform = this.game.getComponent(consecrationId, "transform");
            const consecrationPos = transform?.position;
            if (consecrationPos) {
                this.playConfiguredEffects('expiration', consecrationPos);
            }

            this.game.destroyEntity(consecrationId);
        }
    }
}
