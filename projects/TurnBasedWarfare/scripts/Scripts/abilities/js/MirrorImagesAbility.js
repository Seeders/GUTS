class MirrorImagesAbility extends GUTS.app.appClasses['BaseAbility'] {
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
                    count: 3,
                    color: 0x6495ED,
                    scaleMultiplier: 2.5,
                    speedMultiplier: 1.5
                }
            },
            illusion: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xB0C4DE,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 3.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Use when low on health or facing multiple enemies
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        if (casterHealth && casterHealth.current < casterHealth.max * 0.5) {
            return true;
        }
        
        const enemies = this.getEnemiesInRange(casterEntity, 150);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Reality fractures as mirror images appear!`);
        
        // Schedule mirror image creation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createMirrorImages(casterEntity, casterPos);
        }, this.castTime, casterEntity);
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
        
        const createdImages = [];
        
        // Create images at deterministic positions
        for (let i = 0; i < this.imageCount; i++) {
            const imagePos = this.getDeterministicImagePosition(casterPos, i);
            
            const imageId = this.createMirrorImage(
                casterEntity, imagePos, casterTeam, casterUnitType, 
                casterCombat, casterHealth, casterCollision, casterVelocity
            );
            
            if (imageId !== null) {
                createdImages.push(imageId);
                // Illusion creation effect
                this.createVisualEffect(imagePos, 'illusion');
                
                // Schedule image removal deterministically
                this.game.schedulingSystem.scheduleAction(() => {
                    this.removeMirrorImage(imageId);
                }, this.imageDuration, imageId);
            }
        }
        
    }
    
    // FIXED: Deterministic positioning algorithm
    getDeterministicImagePosition(casterPos, imageIndex) {
        // Use predefined positions instead of trigonometry for determinism
        const positions = [
            { offsetX: -35, offsetZ: 25 },   // Left-back
            { offsetX: 35, offsetZ: 25 }     // Right-back
        ];
        
        const offset = positions[imageIndex % positions.length];
        
        return {
            x: casterPos.x + offset.offsetX,
            y: casterPos.y,
            z: casterPos.z + offset.offsetZ
        };
    }
    
    createMirrorImage(originalId, imagePos, team, unitType, combat, health, collision, velocity) {
        // Use deterministic entity creation if available, otherwise use standard method
        const imageId = this.game.createEntity ? this.game.createEntity() : this.generateDeterministicId(originalId);
        
        if (imageId === null || imageId === undefined) return null;
        
        const components = this.game.componentManager.getComponents();
        
        try {
            // Add components in deterministic order (alphabetical by component type)
            this.game.addComponent(imageId, this.componentTypes.AI_STATE, 
                components.AIState('idle'));
                
            this.game.addComponent(imageId, this.componentTypes.ANIMATION, 
                components.Animation());
                
            this.game.addComponent(imageId, this.componentTypes.COLLISION, 
                components.Collision(collision?.radius, collision.height));
                
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
                
            this.game.addComponent(imageId, this.componentTypes.EQUIPMENT, 
                components.Equipment());
                
            this.game.addComponent(imageId, this.componentTypes.FACING, 
                components.Facing(0));
                
            this.game.addComponent(imageId, this.componentTypes.HEALTH, 
                components.Health(Math.floor(health.max * this.imageHealthRatio)));
                
            this.game.addComponent(imageId, this.componentTypes.MIRROR_IMAGE, 
                components.MirrorImage(originalId, true, this.game.state.now || 0));
                
            this.game.addComponent(imageId, this.componentTypes.POSITION, 
                components.Position(imagePos.x, imagePos.y, imagePos.z));
                
            this.game.addComponent(imageId, this.componentTypes.RENDERABLE, 
                components.Renderable("units", unitType.id || unitType.title));
                
            this.game.addComponent(imageId, this.componentTypes.TEAM, 
                components.Team(team.team));
                
            this.game.addComponent(imageId, this.componentTypes.UNIT_TYPE, 
                components.UnitType(
                    unitType.id || unitType.title,
                    `Mirror Image`,
                    0 // No value - they're illusions
                ));
                
            this.game.addComponent(imageId, this.componentTypes.VELOCITY, 
                components.Velocity(0, 0, 0, velocity?.maxSpeed || 40));
            
            return imageId;
            
        } catch (error) {
            console.error(`Failed to create mirror image:`, error);
            return null;
        }
    }
    
    // FIXED: Deterministic removal instead of lifetime system
    removeMirrorImage(imageId) {
        if (!this.game.hasEntity || !this.game.hasEntity(imageId)) return;
        
        const imagePos = this.game.getComponent(imageId, this.componentTypes.POSITION);
        
        // Create disappearance effect
        if (imagePos) {
            this.createVisualEffect(imagePos, 'illusion');
        }
        
        // Remove the entity
        if (this.game.removeEntity) {
            this.game.removeEntity(imageId);
        } else if (this.game.destroyEntity) {
            this.game.destroyEntity(imageId);
        }
       
    }
    
    // Fallback method for deterministic ID generation (if needed)
    generateDeterministicId(originalId) {
        // This is a fallback - ideally the game should provide deterministic entity creation
        const timestamp = this.game.state.now || this.game.state.now || 0;
        return `mirror_${originalId}_${Math.floor(timestamp * 1000)}`;
    }
}