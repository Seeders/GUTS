class MirrorImagesAbility extends GUTS.BaseAbility {
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
        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (casterHealth && casterHealth.current < casterHealth.max * 0.5) {
            return true;
        }
        
        const enemies = this.getEnemiesInRange(casterEntity, 150);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
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
        const casterTeam = this.game.getComponent(casterEntity, "team");
        const casterUnitType = this.game.getComponent(casterEntity, "unitType");
        const casterCombat = this.game.getComponent(casterEntity, "combat");
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const casterCollision = this.game.getComponent(casterEntity, "collision");
        const casterVelocity = this.game.getComponent(casterEntity, "velocity");
        
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


        try {
            // Add components in deterministic order (alphabetical by component type)
            this.game.addComponent(imageId, "aiState", {
                state: 'idle',
                targetPosition: null,
                target: null,
                aiControllerId: null,
                meta: {}
            });

            this.game.addComponent(imageId, "animation", {
                scale: 1,
                rotation: 0,
                flash: 0
            });

            this.game.addComponent(imageId, "collision", {
                radius: collision?.radius || 10,
                height: collision?.height || 50
            });

            this.game.addComponent(imageId, "combat", {
                damage: Math.floor(combat.damage * this.imageDamageRatio),
                range: combat.range,
                attackSpeed: combat.attackSpeed,
                projectile: combat.projectile || null,
                lastAttack: 0,
                element: combat.element || 'physical',
                armor: Math.floor((combat.armor || 0) * 0.5),
                fireResistance: combat.fireResistance || 0,
                coldResistance: combat.coldResistance || 0,
                lightningResistance: combat.lightningResistance || 0,
                poisonResistance: 0,
                visionRange: 300
            });

            this.game.addComponent(imageId, "equipment", {
                slots: {
                    mainHand: null,
                    offHand: null,
                    helmet: null,
                    chest: null,
                    legs: null,
                    feet: null,
                    back: null
                }
            });

            this.game.addComponent(imageId, "facing", {
                angle: 0
            });

            this.game.addComponent(imageId, "health", {
                max: Math.floor(health.max * this.imageHealthRatio),
                current: Math.floor(health.max * this.imageHealthRatio)
            });

            this.game.addComponent(imageId, "mirrorImage", {
                originalEntity: originalId,
                isIllusion: true,
                createdTime: this.game.state.now || 0
            });

            this.game.addComponent(imageId, "position", {
                x: imagePos.x,
                y: imagePos.y,
                z: imagePos.z
            });

            this.game.addComponent(imageId, "renderable", {
                objectType: "units",
                spawnType: unitType.id || unitType.title,
                capacity: 128
            });

            this.game.addComponent(imageId, "team", {
                team: team.team
            });

            this.game.addComponent(imageId, "unitType", {
                id: unitType.id || unitType.title,
                title: `Mirror Image`,
                value: 0
            });

            this.game.addComponent(imageId, "velocity", {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: velocity?.maxSpeed || 40,
                affectedByGravity: true,
                anchored: false
            });

            return imageId;
            
        } catch (error) {
            console.error(`Failed to create mirror image:`, error);
            return null;
        }
    }
    
    // FIXED: Deterministic removal instead of lifetime system
    removeMirrorImage(imageId) {
        if (!this.game.hasEntity || !this.game.hasEntity(imageId)) return;
        
        const transform = this.game.getComponent(imageId, "transform");
        const imagePos = transform?.position;
        
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