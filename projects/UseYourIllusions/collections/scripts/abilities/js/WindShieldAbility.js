class WindShieldAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'playEffect'
    ];

    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Wind Shield',
            description: 'Creates a swirling tornado that reflects projectiles back at attackers',
            cooldown: 8.0,
            range: 200,
            manaCost: 60,
            targetType: 'defensive',
            animation: 'cast',
            priority: 4,
            castTime: 1.2,
            autoTrigger: 'projectiles_incoming',
            ...abilityData
        });

        this.shieldDuration = 15.0;
        // Track active tornado effects per entity for cleanup
        this.activeTornadoEffects = new Map();
    }

    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        // Use when there are allies to protect and enemies with projectiles nearby
        const enemies = this.getEnemiesInRange(casterEntity, 300);
        return allies.length >= 1 && enemies.length >= 2;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        // Immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Protective winds swirl around allies!`);

        this.game.schedulingSystem.scheduleAction(() => {
            this.createWindShields(casterEntity);
        }, this.castTime, casterEntity);
    }

    createWindShields(casterEntity) {
        // DESYNC SAFE: Get and sort allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        const sortedAllies = allies.slice().sort((a, b) => a - b);

        sortedAllies.forEach(allyId => {
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;
            if (!allyPos) return;

            // DESYNC SAFE: Add shield component using scheduling system for duration
            const enums = this.game.getEnums();
            this.game.addComponent(allyId, "buff", {
                buffType: enums.buffTypes.wind_shield,
                endTime: this.game.state.now + this.shieldDuration,
                appliedTime: this.game.state.now,
                stacks: 1,
                sourceEntity: casterEntity
            });

            // Start tornado visual effect using the preset effect system (client only)
            if (!this.game.isServer) {
                this.startTornadoEffect(allyId);
            }

            // DESYNC SAFE: Schedule shield removal
            this.game.schedulingSystem.scheduleAction(() => {
                const enums = this.game.getEnums();
                if (this.game.hasComponent(allyId, "buff")) {
                    const buff = this.game.getComponent(allyId, "buff");
                    if (buff && buff.buffType === enums.buffTypes.wind_shield) {
                        this.game.removeComponent(allyId, "buff");

                        // Stop the tornado effect and play disperse effect
                        this.stopTornadoEffect(allyId);

                        // Play disperse effect at current position
                        const transform = this.game.getComponent(allyId, "transform");
                        const currentPos = transform?.position;
                        if (currentPos) {
                            this.playConfiguredEffects('expiration', currentPos);
                        }
                    }
                }
            }, this.shieldDuration, allyId);
        });
    }

    // Start the tornado effect using the repeating effect system
    startTornadoEffect(entityId) {
        if (this.game.isServer) return;

        // Stop any existing tornado effect for this entity
        this.stopTornadoEffect(entityId);

        const transform = this.game.getComponent(entityId, "transform");
        const pos = transform?.position;
        if (!pos) return;

        // Use the repeating tornado effect system
        // Since entities can move, we need to use our own loop to track position
        this.scheduleTornadoLoop(entityId);
    }

    // Schedule repeating tornado visual effect while buff is active
    scheduleTornadoLoop(entityId) {
        if (this.game.isServer) return;

        const interval = 0.4; // Match the tornado effect system repeat interval

        const spawnTornadoParticles = () => {
            // Check if entity still exists and has the buff
            if (!this.game.entityExists(entityId)) {
                this.activeTornadoEffects.delete(entityId);
                return;
            }

            const buff = this.game.getComponent(entityId, "buff");
            const enums = this.game.getEnums();

            if (!buff || buff.buffType !== enums.buffTypes?.wind_shield) {
                this.activeTornadoEffects.delete(entityId);
                return;
            }

            // Get current position (unit may have moved)
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            if (!pos) return;

            // Play single tornado effect at current position using preset effects
            this.call.playEffect( 'wind_swirl_base', new THREE.Vector3(pos.x, pos.y, pos.z));
            this.call.playEffect( 'wind_swirl_mid', new THREE.Vector3(pos.x, pos.y, pos.z));
            this.call.playEffect( 'wind_swirl_top', new THREE.Vector3(pos.x, pos.y, pos.z));
            this.call.playEffect( 'wind_wisps', new THREE.Vector3(pos.x, pos.y, pos.z));

            // Schedule next spawn
            this.game.schedulingSystem.scheduleAction(spawnTornadoParticles, interval, entityId);
        };

        // Mark as active
        this.activeTornadoEffects.set(entityId, true);

        // Start the loop immediately
        spawnTornadoParticles();
    }

    // Stop the tornado effect for an entity
    stopTornadoEffect(entityId) {
        this.activeTornadoEffects.delete(entityId);
    }
}
