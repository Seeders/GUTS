class BattleCryAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'battle_cry',
            name: 'Battle Cry',
            description: 'Rally nearby allies, boosting their damage and morale (does not stack)',
            cooldown: 15.0,
            range: 150,
            manaCost: 40,
            targetType: 'allies',
            animation: 'cast',
            priority: 8,
            castTime: 1.0,
            ...params
        });
        
        this.damageMultiplier = 1.3; // 30% damage boost
        this.duration = 20.0; // 20 seconds
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFFD700,
                    colorRange: { start: 0xFFD700, end: 0xFF4500 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.5
                }
            },
            rally: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFF6347,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        // Only use if there are at least 2 allies to rally (including potentially the caster)
        return allies.length >= 2;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // DESYNC SAFE: Use scheduling system for the rally effect
        this.game.schedulingSystem.scheduleAction(() => {
            this.performBattleCry(casterEntity);
        }, this.castTime, casterEntity);
        
        // Log immediately when cast starts
        const allies = this.getAlliesInRange(casterEntity);
        this.logAbilityUsage(casterEntity, `Warlord rallies ${allies.length} allies to battle!`, true);
    }
    
    performBattleCry(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;

        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;
        
        // DESYNC SAFE: Get and sort allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        const sortedAllies = allies.slice().sort((a, b) => a - b);
        
        let ralliedCount = 0;
        
        sortedAllies.forEach(allyId => {
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;
            const allyHealth = this.game.getComponent(allyId, "health");

            // Only rally living allies
            if (!allyPos || !allyHealth || allyHealth.current <= 0) return;

            // DESYNC SAFE: Check if already rallied - don't stack multiple battle cries
            const existingBuff = this.game.getComponent(allyId, "buff");
            
            if (existingBuff && existingBuff.buffType === 'rallied') {
                // DESYNC SAFE: Refresh duration instead of stacking
                existingBuff.endTime = this.game.state.now + this.duration;
                existingBuff.appliedTime = this.game.state.now; // Update applied time
            } else {
                // Apply new rally buff
                this.game.addComponent(allyId, "buff", {
                    buffType: 'rallied',
                    modifiers: {
                        damageMultiplier: this.damageMultiplier,
                        moralBoost: true,
                        fearImmunity: true
                    },
                    endTime: this.game.state.now + this.duration,
                    stackable: false,
                    stacks: 1,
                    appliedTime: this.game.state.now,
                    isActive: true
                });
            }
            
            // Visual rally effect on each ally
            this.createVisualEffect(allyPos, 'rally');

            // Enhanced individual rally effect
            if (!this.game.isServer) {
                this.game.call('createLayeredEffect', {
                    position: new THREE.Vector3(allyPos.x, allyPos.y + 25, allyPos.z),
                    layers: [
                        // Golden empowerment
                        {
                            count: 10,
                            lifetime: 0.5,
                            color: 0xffd700,
                            colorRange: { start: 0xffffff, end: 0xffaa00 },
                            scale: 15,
                            scaleMultiplier: 1.8,
                            velocityRange: { x: [-30, 30], y: [50, 120], z: [-30, 30] },
                            gravity: -40,
                            drag: 0.9,
                            blending: 'additive'
                        },
                        // Red/orange battle sparks
                        {
                            count: 8,
                            lifetime: 0.4,
                            color: 0xff6347,
                            colorRange: { start: 0xffaa66, end: 0xff4400 },
                            scale: 8,
                            scaleMultiplier: 0.8,
                            velocityRange: { x: [-50, 50], y: [60, 100], z: [-50, 50] },
                            gravity: 100,
                            drag: 0.94,
                            blending: 'additive'
                        }
                    ]
                });
            }

            // DESYNC SAFE: Schedule buff removal
            this.game.schedulingSystem.scheduleAction(() => {
                this.removeRallyBuff(allyId);
            }, this.duration, allyId);

            ralliedCount++;
        });

        // Screen effect for dramatic rally
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 2);
            this.game.effectsSystem.playScreenFlash('#FFD700', 0.4);
        }

        // Additional visual effect at caster position
        this.createVisualEffect(casterPos, 'rally', {
            count: 12,
            scaleMultiplier: 3.0,
            heightOffset: 20
        });

        // Enhanced central battle cry burst
        if (!this.game.isServer) {
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(casterPos.x, casterPos.y + 40, casterPos.z),
                layers: [
                    // Massive golden shockwave
                    {
                        count: 30,
                        lifetime: 0.7,
                        color: 0xffd700,
                        colorRange: { start: 0xffffff, end: 0xff8800 },
                        scale: 25,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-150, 150], y: [40, 100], z: [-150, 150] },
                        gravity: -30,
                        drag: 0.9,
                        blending: 'additive'
                    },
                    // Red battle fury
                    {
                        count: 20,
                        lifetime: 0.6,
                        color: 0xff4500,
                        colorRange: { start: 0xff6644, end: 0xcc2200 },
                        scale: 18,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-120, 120], y: [60, 140], z: [-120, 120] },
                        gravity: -20,
                        drag: 0.92,
                        blending: 'additive'
                    },
                    // White flash
                    {
                        count: 10,
                        lifetime: 0.3,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xffd700 },
                        scale: 45,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-40, 40], y: [30, 80], z: [-40, 40] },
                        gravity: 0,
                        drag: 0.8,
                        blending: 'additive'
                    }
                ]
            });
        }
 
    }
    
    // DESYNC SAFE: Remove rally buff
    removeRallyBuff(allyId) {
        // Check if ally still exists and has the rally buff
        if (this.game.hasComponent(allyId, "buff")) {
            const buff = this.game.getComponent(allyId, "buff");
            if (buff && buff.buffType === 'rallied') {
                this.game.removeComponent(allyId, "buff");

                // Visual effect when rally expires
                const transform = this.game.getComponent(allyId, "transform");
                const allyPos = transform?.position;
                if (allyPos) {
                    this.createVisualEffect(allyPos, 'rally', { 
                        count: 2, 
                        scaleMultiplier: 0.8,
                        color: 0xCD853F 
                    });
                }
       
            }
        }
    }
}