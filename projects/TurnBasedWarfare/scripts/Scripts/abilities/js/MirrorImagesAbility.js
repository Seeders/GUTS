class MirrorImagesAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'mirror_images',
            name: 'Mirror Images',
            description: 'Creates 2 weaker illusions of self',
            cooldown: 10.0,
            range: 0, // Self-target
            manaCost: 0,
            targetType: 'self',
            animation: 'cast',
            priority: 6,
            castTime: 1.5,
            autoTrigger: 'low_health',
            ...params
        });
        
        this.imageCount = 2;
        this.imageDuration = 5.0;
        this.imageHealthRatio = 0.4; // 40% of original health
        this.imageDamageRatio = 0.6; // 60% of original damage
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x4169E1,
                    colorRange: { start: 0x4169E1, end: 0x87CEEB },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            },
            mirror: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0x6495ED,
                    scaleMultiplier: 2.5,
                    speedMultiplier: 1.5
                }
            },
            illusion: {
                type: 'magic',
                options: {
                    count: 2,
                    color: 0xB0C4DE,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 3.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
  
        // Use when low on health or facing multiple enemies
        return true;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Create mirror images
        setTimeout(() => {
            this.createMirrorImages(casterEntity, casterPos);
        }, this.castTime * 1000);
        
        this.logAbilityUsage(casterEntity, `Reality fractures as mirror images appear!`);
    }
    
    createMirrorImages(casterEntity, casterPos) {
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        const casterUnitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
        const casterCombat = this.game.getComponent(casterEntity, this.componentTypes.COMBAT);
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterCollision = this.game.getComponent(casterEntity, this.componentTypes.COLLISION);
        const casterVelocity = this.game.getComponent(casterEntity, this.componentTypes.VELOCITY);
        
        if (!casterTeam || !casterUnitType || !casterCombat || !casterHealth) return;
        
        // Mirror effect at caster
        this.createVisualEffect(casterPos, 'mirror');
        
        for (let i = 0; i < this.imageCount; i++) {
            // Position images around the caster
            const angle = (i / this.imageCount) * Math.PI * 2;
            const distance = 40;
            const imagePos = {
                x: casterPos.x + Math.cos(angle) * distance,
                y: casterPos.y,
                z: casterPos.z + Math.sin(angle) * distance
            };
            
            const imageId = this.createMirrorImage(
                casterEntity, imagePos, casterTeam, casterUnitType, 
                casterCombat, casterHealth, casterCollision, casterVelocity
            );
            
            if (imageId) {
                // Illusion creation effect
                this.createVisualEffect(imagePos, 'illusion');
            }
        }
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `${this.imageCount} mirror images shimmer into existence!`,
                'log-illusion'
            );
        }
    }
    
    createMirrorImage(originalId, imagePos, team, unitType, combat, health, collision, velocity) {
        const imageId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        
        // Create image with reduced stats
        this.game.addComponent(imageId, this.componentTypes.POSITION, 
            components.Position(imagePos.x, imagePos.y, imagePos.z));
        this.game.addComponent(imageId, this.componentTypes.VELOCITY, 
            components.Velocity(0, 0, 0, velocity?.maxSpeed || 40));
        this.game.addComponent(imageId, this.componentTypes.RENDERABLE, 
            components.Renderable("units", unitType.id || unitType.type));
        this.game.addComponent(imageId, this.componentTypes.COLLISION, 
            components.Collision(collision?.radius || 25));
        this.game.addComponent(imageId, this.componentTypes.HEALTH, 
            components.Health(Math.floor(health.max * this.imageHealthRatio)));
        this.game.addComponent(imageId, this.componentTypes.COMBAT, 
            components.Combat(
                Math.floor(combat.damage * this.imageDamageRatio),
                combat.range,
                combat.attackSpeed,
                combat.projectile,
                0,
                combat.element || 'physical',
                Math.floor((combat.armor || 0) * 0.5), // Half armor
                combat.fireResistance || 0,
                combat.coldResistance || 0,
                combat.lightningResistance || 0
            ));
        this.game.addComponent(imageId, this.componentTypes.TEAM, 
            components.Team(team.team));
        this.game.addComponent(imageId, this.componentTypes.UNIT_TYPE, 
            components.UnitType(
                unitType.id || unitType.type,
                `Mirror Image`,
                0 // No value - they're illusions
            ));
        this.game.addComponent(imageId, this.componentTypes.AI_STATE, 
            components.AIState('idle'));
        this.game.addComponent(imageId, this.componentTypes.ANIMATION, 
            components.Animation());
        this.game.addComponent(imageId, this.componentTypes.FACING, 
            components.Facing(0));
        this.game.addComponent(imageId, this.componentTypes.EQUIPMENT, 
            components.Equipment());
        this.game.addComponent(imageId, this.componentTypes.LIFETIME, 
            components.Lifetime(this.imageDuration, Date.now() / 1000));
       
        this.game.lifetimeSystem.addLifetime(imageId, this.imageDuration, {
            onDestroy: (entityId) => {
            }
        });
        // Add special mirror image component to mark as illusion
        this.game.addComponent(imageId, this.componentTypes.MIRROR_IMAGE, {
            originalEntity: originalId,
            isIllusion: true
        });
        
        return imageId;
    }
}