class RageAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'raging_strike',
            name: 'Raging Strike',
            description: 'Unleash primal fury with increased damage and attack speed',
            cooldown: 5.0,
            range: 0, // Self-buff
            manaCost: 20,
            targetType: 'self',
            animation: 'attack',
            priority: 6,
            castTime: 0.8,
            ...params
        });
        
        this.rageDuration = 8.0;
        this.damageMultiplier = 1.5;
        this.attackSpeedMultiplier = 1.3;
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: { 
                    count: 3, 
                    color: 0xff4444, 
                    colorRange: { start: 0xff4444, end: 0xff8800 },
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.5
                }
            },
            rage: {
                type: 'magic',
                options: { 
                    count: 3, 
                    color: 0xff0000, 
                    scaleMultiplier: 1.8,
                    speedMultiplier: 2.0
                }
            },
            fury: {
                type: 'magic',
                options: { 
                    count: 3, 
                    color: 0xcc0000, 
                    scaleMultiplier: 2.2,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if there are enemies nearby to rage against
        const enemies = this.getEnemiesInRange(casterEntity, 100);
        if (enemies.length === 0) return false;
        
        // Don't stack rage buffs - check if already raged
        const existingBuff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
        if (existingBuff && existingBuff.buffType === 'rage') return false;
        
        return true;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Primal fury begins to build...`);
        
        // Schedule the rage activation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.activateRage(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    activateRage(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;

        // Create dramatic rage effects
        this.createVisualEffect(casterPos, 'rage');

        // Enhanced rage activation with fiery burst
        if (this.game.gameManager) {
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(casterPos.x, casterPos.y + 30, casterPos.z),
                layers: [
                    // Red fury burst
                    {
                        count: 25,
                        lifetime: 0.6,
                        color: 0xff2200,
                        colorRange: { start: 0xff4444, end: 0xcc0000 },
                        scale: 30,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-100, 100], y: [60, 150], z: [-100, 100] },
                        gravity: -50,
                        drag: 0.9,
                        blending: 'additive'
                    },
                    // Orange flames rising
                    {
                        count: 20,
                        lifetime: 0.8,
                        color: 0xff6600,
                        colorRange: { start: 0xffaa44, end: 0xff4400 },
                        scale: 18,
                        scaleMultiplier: 1.8,
                        velocityRange: { x: [-60, 60], y: [80, 180], z: [-60, 60] },
                        gravity: -80,
                        drag: 0.92,
                        blending: 'additive'
                    },
                    // Hot white core
                    {
                        count: 8,
                        lifetime: 0.3,
                        color: 0xffffaa,
                        colorRange: { start: 0xffffff, end: 0xffaa44 },
                        scale: 40,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-30, 30], y: [40, 100], z: [-30, 30] },
                        gravity: 0,
                        drag: 0.8,
                        blending: 'additive'
                    }
                ]
            });

            // Anger aura ring
            this.game.gameManager.call('createParticles', {
                position: new THREE.Vector3(casterPos.x, casterPos.y + 5, casterPos.z),
                count: 20,
                lifetime: 0.6,
                visual: {
                    color: 0xff4400,
                    colorRange: { start: 0xff6644, end: 0xcc2200 },
                    scale: 15,
                    scaleMultiplier: 1.5,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-20, 20], y: [30, 80], z: [-20, 20] },
                gravity: -30,
                drag: 0.9,
                emitterShape: 'ring',
                emitterRadius: 30
            });
        }

        // Schedule a secondary fury effect for visual impact
        this.game.schedulingSystem.scheduleAction(() => {
            if (this.game.hasComponent && this.game.hasComponent(casterEntity, this.componentTypes.POSITION)) {
                const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
                if (pos) {
                    this.createVisualEffect(pos, 'fury');
                }
            }
        }, 0.5, casterEntity);
        
        // Apply rage buff with proper timing
        const Components = this.game.componentManager.getComponents();
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const endTime = currentTime + this.rageDuration;
        
        this.game.addComponent(casterEntity, this.componentTypes.BUFF, 
            Components.Buff(
                'rage', 
                { 
                    damageMultiplier: this.damageMultiplier, 
                    attackSpeedMultiplier: this.attackSpeedMultiplier,
                    moveSpeedMultiplier: 1.1 // Slight movement speed bonus
                }, 
                endTime,     // Proper end time
                false,       // Not stackable
                1,           // Single stack
                currentTime  // Applied time
            )
        );
        
        // Screen effects for dramatic impact
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 2);
            this.game.effectsSystem.playScreenFlash('#ff4444', 0.4);
        }
    
        
        // Schedule buff expiration warning
        this.game.schedulingSystem.scheduleAction(() => {
            this.warnRageEnding(casterEntity);
        }, this.rageDuration - 1.0, casterEntity);
    }
    
    // FIXED: Add rage ending warning for better gameplay feedback
    warnRageEnding(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        // Check if entity still exists and has the buff
        const buff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
        if (!buff || buff.buffType !== 'rage') return;
        
        if (casterPos) {
            // Create fading effect
            this.createVisualEffect(casterPos, 'cast', { 
                count: 5, 
                color: 0x884444,
                scaleMultiplier: 0.8 
            });
        }
       
    }
}