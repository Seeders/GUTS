class CurseAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'curse',
            name: 'Curse',
            description: 'Curses enemies, reducing their damage and making them vulnerable',
            cooldown: 7.0,
            range: 180,
            manaCost: 50,
            targetType: 'auto',
            animation: 'cast',
            priority: 5,
            castTime: 1.5,
            autoTrigger: 'strong_enemies',
            ...params
        });
        
        this.curseRadius = 100;
        this.damageReduction = 0.5; // Reduce enemy damage by 50%
        this.vulnerabilityIncrease = 1.3; // 30% more damage taken
        this.duration = 20.0;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x2F4F4F,
                    colorRange: { start: 0x2F4F4F, end: 0x000000 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.8
                }
            },
            curse: {
                type: 'magic',
                options: {
                    count: 2,
                    color: 0x696969,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.5
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyCurses(casterEntity, enemies);
        }, this.castTime, casterEntity);
    }
    
    applyCurses(casterEntity, enemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyCombat = this.game.getComponent(enemyId, this.componentTypes.COMBAT);
            
            if (!enemyPos || !enemyCombat) return;
            
            // Check if enemy is in curse radius
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.curseRadius) {
                // Apply curse effect
                this.createVisualEffect(enemyPos, 'curse');

                // Enhanced dark curse visual
                if (this.game.gameManager) {
                    // Dark energy swirl around target
                    this.game.gameManager.call('createLayeredEffect', {
                        position: new THREE.Vector3(enemyPos.x, enemyPos.y + 30, enemyPos.z),
                        layers: [
                            // Dark mist
                            {
                                count: 20,
                                lifetime: 0.8,
                                color: 0x1a1a1a,
                                colorRange: { start: 0x333333, end: 0x000000 },
                                scale: 25,
                                scaleMultiplier: 2.0,
                                velocityRange: { x: [-40, 40], y: [-20, 40], z: [-40, 40] },
                                gravity: -10,
                                drag: 0.9,
                                blending: 'normal'
                            },
                            // Purple curse energy
                            {
                                count: 15,
                                lifetime: 0.6,
                                color: 0x6622aa,
                                colorRange: { start: 0x8844cc, end: 0x330066 },
                                scale: 12,
                                scaleMultiplier: 1.5,
                                velocityRange: { x: [-30, 30], y: [20, 60], z: [-30, 30] },
                                gravity: -30,
                                drag: 0.92,
                                blending: 'additive'
                            },
                            // Sickly green sparks
                            {
                                count: 10,
                                lifetime: 0.5,
                                color: 0x44aa22,
                                colorRange: { start: 0x66cc44, end: 0x226611 },
                                scale: 8,
                                scaleMultiplier: 0.8,
                                velocityRange: { x: [-50, 50], y: [30, 80], z: [-50, 50] },
                                gravity: 50,
                                drag: 0.94,
                                blending: 'additive'
                            }
                        ]
                    });

                    // Curse symbols rising
                    this.game.gameManager.call('createParticles', {
                        position: new THREE.Vector3(enemyPos.x, enemyPos.y + 5, enemyPos.z),
                        count: 12,
                        lifetime: 1.0,
                        visual: {
                            color: 0x660066,
                            colorRange: { start: 0x882288, end: 0x440044 },
                            scale: 10,
                            scaleMultiplier: 0.6,
                            fadeOut: true,
                            blending: 'additive'
                        },
                        velocityRange: { x: [-15, 15], y: [30, 80], z: [-15, 15] },
                        gravity: -40,
                        drag: 0.95,
                        emitterShape: 'ring',
                        emitterRadius: 20
                    });
                }

                // Reduce enemy damage
                const originalDamage = enemyCombat.damage;
                enemyCombat.damage = Math.floor(enemyCombat.damage * this.damageReduction);

                // Create dark aura effect
                if (this.game.effectsSystem) {
                    this.game.effectsSystem.createAuraEffect(
                        enemyPos.x, enemyPos.y, enemyPos.z,
                        'magic',
                        this.duration * 1000
                    );
                }

                this.game.schedulingSystem.scheduleAction(() => {
                    if (this.game.getComponent(enemyId, this.componentTypes.COMBAT)) {
                        enemyCombat.damage = originalDamage;
                    }
                }, this.duration, enemyId);
            }
        });
    }
}
