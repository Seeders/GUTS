class MirrorImagesAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.imageCount       = abilityData.imageCount       ?? 2;
        this.imageDuration    = abilityData.imageDuration    ?? 5.0;
        this.imageHealthRatio = abilityData.imageHealthRatio ?? 0.4;
        this.imageDamageRatio = abilityData.imageDamageRatio ?? 0.3;
    }
    
    canExecute(casterEntity) {
        // Fire whenever any enemy is in range — resources (cooldown, etc.) are the only gate.
        const enemies = this.getEnemiesInRange(casterEntity, 150);
        return enemies.length >= 1;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Reality fractures as mirror images appear!`);
        
        // Schedule mirror image creation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createMirrorImages(casterEntity, casterPos);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
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
        this.playConfiguredEffects('burst', casterPos);
        
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
                this.playConfiguredEffects('summon', imagePos);
                
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
            const enums = this.game.getEnums();

            // aiState needs rootBehaviorTree pointer or BehaviorSystem won't drive
            // the illusion. UnitBattleBehaviorTree handles find-target/move/attack.
            this.game.addComponent(imageId, "aiState", {
                currentAction: null,
                currentActionCollection: null,
                rootBehaviorTree: enums.behaviorTrees?.UnitBattleBehaviorTree,
                rootBehaviorTreeCollection: enums.behaviorCollection?.behaviorTrees
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

            // Projectile and element are numeric enum indices. Use ?? not ||
            // because projectile index 0 (the first projectile alphabetically —
            // "arrow") and element 0 ("physical") are both valid values that
            // || would clobber to null, making an archer's illusion fire nothing.
            this.game.addComponent(imageId, "combat", {
                damage: Math.floor(combat.damage * this.imageDamageRatio),
                range: combat.range,
                attackSpeed: combat.attackSpeed,
                projectile: combat.projectile ?? null,
                lastAttack: 0,
                element: combat.element ?? enums.element?.physical ?? 0,
                armor: Math.floor((combat.armor || 0) * 0.5),
                fireResistance: combat.fireResistance || 0,
                coldResistance: combat.coldResistance || 0,
                lightningResistance: combat.lightningResistance || 0,
                poisonResistance: 0,
                visionRange: 99999,
                awareness: 100
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

            this.game.addComponent(imageId, "transform", {
                position: { x: imagePos.x, y: imagePos.y, z: imagePos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            });

            // Use unitType's numeric indices directly for renderable
            this.game.addComponent(imageId, "renderable", {
                objectType: unitType.collection,
                spawnType: unitType.type,
                capacity: 128
            });

            this.game.addComponent(imageId, "team", {
                team: team.team
            });

            this.game.addComponent(imageId, "unitType", {
                collection: unitType.collection,
                type: unitType.type
            });

            this.game.addComponent(imageId, "velocity", {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: velocity?.maxSpeed || 40,
                affectedByGravity: true,
                anchored: false
            });

            // Pathfinding + aiMovement are required for the illusion to navigate
            // toward enemies (BaseMovementSystem reads these to drive velocity).
            this.game.addComponent(imageId, "pathfinding", {
                path: null,
                pathIndex: 0,
                lastPathRequest: 0,
                useDirectMovement: false
            });
            this.game.addComponent(imageId, "aiMovement", {});

            // Tag as summoned so HeroRosterSystem cleans illusions up at round end.
            this.game.addComponent(imageId, "summoned", {
                summoner: originalId,
                summonType: unitType.type,
                originalStats: null,
                createdTime: this.game.state.now || 0,
                isSummoned: true
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
            this.playConfiguredEffects('expiration', imagePos);
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
