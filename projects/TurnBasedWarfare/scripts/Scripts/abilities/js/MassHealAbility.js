class MassHealAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'mass_heal',
            name: 'Mass Heal',
            description: 'Heal all injured allies across the battlefield',
            cooldown: 15.0,
            range: 300,
            manaCost: 60,
            targetType: 'auto',
            animation: 'cast',
            priority: 9,
            castTime: 2.0,
            autoTrigger: 'low_team_health',
            ...params
        });
        
        this.healPercent = 0.4; // 40% of max health
        this.minInjuredAllies = 3;
        this.element = 'divine';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x88ff88,
                    colorRange: { start: 0x88ff88, end: 0xffffaa },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            heal: {
                type: 'heal',
                options: {
                    count: 3,
                    color: 0x88ffaa,
                    scaleMultiplier: 1.2,
                    speedMultiplier: 0.8
                }
            },
            mass_heal: {
                type: 'heal',
                options: {
                    count: 3,
                    color: 0xaaffaa,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.6
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        const injuredAllies = this.getInjuredAllies(allies);
        return injuredAllies.length >= this.minInjuredAllies;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        const allies = this.getAlliesInRange(casterEntity);
        const injuredAllies = this.getInjuredAllies(allies);
        
        if (injuredAllies.length < this.minInjuredAllies) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Divine energy gathers to heal the wounded!`);
        
        // Schedule the mass heal to trigger after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performMassHeal(casterEntity, injuredAllies);
        }, this.castTime, casterEntity);
    }
    
    performMassHeal(casterEntity, targetAllies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        let healedCount = 0;
        let totalHealing = 0;

        // Sort allies deterministically for consistent processing order
        const sortedAllies = targetAllies.slice().sort((a, b) => String(a).localeCompare(String(b)));

        // Create central divine burst at caster
        if (this.game.gameSystem && casterPos) {
            // Central holy nova explosion
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(casterPos.x, casterPos.y + 40, casterPos.z),
                layers: [
                    // Bright divine core
                    {
                        count: 15,
                        lifetime: 0.4,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0x88ff88 },
                        scale: 50,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-30, 30], y: [50, 120], z: [-30, 30] },
                        gravity: -40,
                        drag: 0.85,
                        blending: 'additive'
                    },
                    // Expanding green healing wave
                    {
                        count: 30,
                        lifetime: 0.6,
                        color: 0x88ff88,
                        colorRange: { start: 0xaaffaa, end: 0x44cc44 },
                        scale: 20,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-150, 150], y: [20, 80], z: [-150, 150] },
                        gravity: -20,
                        drag: 0.92,
                        blending: 'additive'
                    },
                    // Golden sparkles
                    {
                        count: 20,
                        lifetime: 0.8,
                        color: 0xffffaa,
                        colorRange: { start: 0xffffff, end: 0xffdd66 },
                        scale: 8,
                        scaleMultiplier: 0.6,
                        velocityRange: { x: [-100, 100], y: [60, 140], z: [-100, 100] },
                        gravity: -30,
                        drag: 0.94,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Process each ally deterministically
        sortedAllies.forEach((allyId, index) => {
            const health = this.game.getComponent(allyId, "health");
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;

            if (!health || !allyPos) return;

            // Only heal if ally is still injured
            if (health.current < health.max) {
                const healAmount = Math.floor(health.max * this.healPercent);
                const actualHeal = Math.min(healAmount, health.max - health.current);

                if (actualHeal > 0) {
                    // Apply healing
                    health.current += actualHeal;
                    healedCount++;
                    totalHealing += actualHeal;

                    // Create heal effect on each ally
                    this.createVisualEffect(allyPos, 'heal');

                    // Enhanced individual healing effect with delay for cascade
                    if (this.game.gameSystem) {
                        const delay = index * 0.1;
                        this.game.schedulingSystem.scheduleAction(() => {
                            // Rising healing light column
                            this.game.call('createLayeredEffect', {
                                position: new THREE.Vector3(allyPos.x, allyPos.y + 20, allyPos.z),
                                layers: [
                                    // Green healing glow
                                    {
                                        count: 12,
                                        lifetime: 0.5,
                                        color: 0x88ff88,
                                        colorRange: { start: 0xaaffaa, end: 0x44aa44 },
                                        scale: 18,
                                        scaleMultiplier: 1.8,
                                        velocityRange: { x: [-20, 20], y: [60, 120], z: [-20, 20] },
                                        gravity: -50,
                                        drag: 0.9,
                                        blending: 'additive'
                                    },
                                    // White sparkles
                                    {
                                        count: 8,
                                        lifetime: 0.6,
                                        color: 0xffffff,
                                        colorRange: { start: 0xffffff, end: 0xaaffaa },
                                        scale: 6,
                                        scaleMultiplier: 0.5,
                                        velocityRange: { x: [-40, 40], y: [80, 150], z: [-40, 40] },
                                        gravity: -60,
                                        drag: 0.92,
                                        blending: 'additive'
                                    }
                                ]
                            });

                            // Healing ring at feet
                            this.game.call('createParticles', {
                                position: new THREE.Vector3(allyPos.x, allyPos.y + 5, allyPos.z),
                                count: 12,
                                lifetime: 0.4,
                                visual: {
                                    color: 0x88ff88,
                                    colorRange: { start: 0xaaffaa, end: 0x66cc66 },
                                    scale: 10,
                                    scaleMultiplier: 1.2,
                                    fadeOut: true,
                                    blending: 'additive'
                                },
                                velocityRange: { x: [-10, 10], y: [20, 50], z: [-10, 10] },
                                gravity: -20,
                                drag: 0.95,
                                emitterShape: 'ring',
                                emitterRadius: 25
                            });
                        }, delay, allyId);
                    }

                    // Show heal number
                    if (this.game.gameSystem && this.game.hasService('showDamageNumber')) {
                        this.game.call('showDamageNumber',
                            allyPos.x, allyPos.y + 50, allyPos.z,
                            actualHeal, 'heal'
                        );
                    }
                }
            }
        });

        // Create major healing effect at caster position
        if (casterPos && healedCount > 0) {
            this.createVisualEffect(casterPos, 'mass_heal');
        }

        // Screen effect for dramatic impact
        if (this.game.effectsSystem && healedCount > 0) {
            this.game.effectsSystem.playScreenFlash('#88ff88', 0.3);
        }

        // Log final results
        this.logAbilityUsage(casterEntity,
            `Mass heal restores ${healedCount} allies for ${totalHealing} total health!`);
    }
    
    // FIXED: Deterministic injured ally detection
    getInjuredAllies(allies) {
        // Sort allies deterministically first for consistent processing
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        return sortedAllies.filter(allyId => {
            const health = this.game.getComponent(allyId, "health");
            // Check if ally is injured (below 80% health threshold)
            return health && health.current < health.max * 0.8;
        });
    }
    
    // Helper method to get all valid heal targets (for future use)
    getAllHealTargets(allies) {
        // Sort allies deterministically first for consistent processing
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        return sortedAllies.filter(allyId => {
            const health = this.game.getComponent(allyId, "health");
            // Any ally that isn't at full health
            return health && health.current < health.max;
        });
    }
}