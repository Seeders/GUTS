class HealAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'heal',
            name: 'Heal',
            description: 'Restores health to the most injured ally',
            cooldown: 30,
            range: 200,
            manaCost: 40,
            targetType: 'ally',
            animation: 'cast',
            priority: 8,
            castTime: 1.0,
            autoTrigger: 'injured_ally',
            ...params
        });
        
        this.healAmount = 80;
        this.element = 'divine';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 12,
                    color: 0xffdd66,
                    colorRange: { start: 0xffffff, end: 0xffaa00 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.8
                }
            },
            heal: {
                type: 'heal',
                options: {
                    count: 20,
                    color: 0xffff88,
                    colorRange: { start: 0xffffff, end: 0x88ff88 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 0.6
                }
            },
            sparkles: {
                type: 'magic',
                options: {
                    count: 15,
                    color: 0xffffff,
                    colorRange: { start: 0xffffff, end: 0xffffaa },
                    scaleMultiplier: 0.6,
                    speedMultiplier: 1.5
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        return allies.some(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            return health && health.current < health.max; // Ally needs healing
        });
    }
        
    execute(casterEntity, targetData = null) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const allies = this.getAlliesInRange(casterEntity);
        const target = this.findMostInjuredAlly(allies);
        
        if (!target) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Divine light mends wounds!`);
        
    
        this.game.schedulingSystem.scheduleAction(() => {
            const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
            if (targetPos) {
                this.performHeal(casterEntity, target, targetPos);
            }
        }, this.castTime, casterEntity);
    }
    
    performHeal(casterEntity, targetId, targetPos) {
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        if (!targetHealth) return;

        // Heal effect
        this.createVisualEffect(targetPos, 'heal');
        this.createVisualEffect(targetPos, 'sparkles');

        // Enhanced holy light effect (client only)
        if (!this.game.isServer && this.game.gameManager) {
            const healPos = new THREE.Vector3(targetPos.x, targetPos.y + 50, targetPos.z);

            this.game.gameManager.call('createLayeredEffect', {
                position: healPos,
                layers: [
                    // Rising golden light
                    {
                        count: 20,
                        lifetime: 1.2,
                        color: 0xffdd66,
                        colorRange: { start: 0xffffff, end: 0xffaa00 },
                        scale: 20,
                        scaleMultiplier: 1.5,
                        velocityRange: { x: [-20, 20], y: [40, 100], z: [-20, 20] },
                        gravity: -80,
                        drag: 0.95,
                        blending: 'additive'
                    },
                    // Spiral healing particles
                    {
                        count: 15,
                        lifetime: 1.0,
                        color: 0x88ff88,
                        colorRange: { start: 0xffffff, end: 0x44ff44 },
                        scale: 15,
                        scaleMultiplier: 1.2,
                        velocityRange: { x: [-40, 40], y: [30, 80], z: [-40, 40] },
                        gravity: -60,
                        drag: 0.92,
                        emitterShape: 'ring',
                        emitterRadius: 20,
                        blending: 'additive'
                    },
                    // White sparkles
                    {
                        count: 12,
                        lifetime: 0.8,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xffffaa },
                        scale: 8,
                        scaleMultiplier: 0.5,
                        velocityRange: { x: [-30, 30], y: [50, 120], z: [-30, 30] },
                        gravity: -40,
                        drag: 0.98,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Apply healing
        const actualHeal = Math.min(this.healAmount, targetHealth.max - targetHealth.current);
        targetHealth.current += actualHeal;

        // Show heal number (client only)
        if (!this.game.isServer && this.game.gameManager && this.game.gameManager.has('showDamageNumber')) {
            this.game.gameManager.call('showDamageNumber',
                targetPos.x, targetPos.y + 50, targetPos.z,
                actualHeal, 'heal'
            );
        }
    }
        
    findMostInjuredAlly(allies) {
        // Sort allies deterministically first
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let mostInjured = null;
        let lowestHealthRatio = 1.0;
        
        sortedAllies.forEach(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            if (health && health.max > 0) {
                const healthRatio = health.current / health.max;
                // Use <= for consistent tie-breaking (first in sorted order wins)
                if (healthRatio <= lowestHealthRatio) {
                    lowestHealthRatio = healthRatio;
                    mostInjured = allyId;
                }
            }
        });
        
        return mostInjured;
    }
}