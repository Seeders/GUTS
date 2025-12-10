class UnitCreationSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.unitCreationSystem = this;
        this.SPEED_MODIFIER = 20;
        // Default component values for missing unit data
        this.defaults = {
            hp: 100,
            damage: 10,
            range: 30,
            speed: 40,
            attackSpeed: 1.0,
            size: 5,
            height: 50,
            armor: 0,
            fireResistance: 0,
            coldResistance: 0,
            lightningResistance: 0,
            element: 'physical',
            projectile: null,
            value: 50
        };
        
        // Equipment slot priorities for auto-equipping
        this.equipmentPriority = [
            'weapon',
            'armor',
            'helmet',
            'boots',
            'gloves',
            'accessory'
        ];
        
        // Team-specific configurations
        this.teamConfigs = {
            left: {
                initialFacing: 0,
                aiState: 'idle',
                colorTint: null
            },
            right: {
                initialFacing: Math.PI,
                aiState: 'idle',
                colorTint: 0xff4444
            }
        };
        
        // Component creation cache for performance
        this.componentCache = new Map();
        
        // Unit creation statistics
        this.stats = {
            totalCreated: 0,
            createdByTeam: new Map(),
            createdByType: new Map(),
            equipmentFailures: 0,
            abilityFailures: 0,
            squadsCreated: 0
        };
    }
    
    init() {
        this.game.register('createPlacement', this.createPlacement.bind(this));
        this.game.register('createUnit', this.createUnit.bind(this));
    }
    /**
     * Create a new unit entity with all required components from a placement
     * @param {Object} placement - Placement data with collection, unitTypeId, etc.
     * @param {Object} transform - Transform with position, rotation, scale
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {string|null} playerId - Optional player ID
     * @returns {number} Entity ID
     */
    createPlacement(placement, transform, team, playerId = null) {
        try {
            const entity = this.createUnit(placement.collection, placement.unitTypeId, transform, team, playerId);

            this.game.addComponent(entity, 'placement', {
                placementId: placement.placementId,
                gridPosition: placement.gridPosition,
                unitTypeId: placement.unitTypeId,
                collection: placement.collection,
                team: placement.team,
                playerId: placement.playerId,
                roundPlaced: placement.roundPlaced
            });
            console.log('created placement', placement.unitTypeId, team, entity);

            return entity;
        } catch (error) {
            console.error('Failed to create unit:', error);
            throw new Error(`Unit creation failed: ${error.message}`);
        }
    }

    /**
     * Create a new unit entity with all required components
     * @param {string} collection - Collection name (e.g., 'units', 'buildings')
     * @param {string} spawnType - Spawn type ID
     * @param {Object} transform - Transform with position, rotation, scale
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {string|null} playerId - Optional player ID
     * @param {string|null} entityId - Optional entity ID (for scene loading)
     * @returns {number} Entity ID
     */
    createUnit(collection, spawnType, transform, team, playerId = null, entityId = null) {
        const unitType = this.game.getCollections()[collection][spawnType];
        // Ensure transform has defaults
        const safeTransform = {
            position: transform?.position || { x: 0, y: 0, z: 0 },
            rotation: transform?.rotation || { x: 0, y: 0, z: 0 },
            scale: transform?.scale || { x: 1, y: 1, z: 1 }
        };

        try {
            // Use provided entityId or auto-incrementing numeric ID
            // OPTIMIZATION: Numeric IDs are faster than string IDs for Map operations
            // In deterministic lockstep, both client and server execute the same operations
            // in the same order, so the auto-incrementing counter produces identical IDs
            let entity;
            if (entityId) {
                entity = this.game.createEntity(entityId);
            } else {
                // Use auto-incrementing numeric ID for better performance
                entity = this.game.createEntity();
            }
            console.log('created unit', unitType.id || spawnType, team, entity);
            const teamConfig = this.teamConfigs[team];

            // OPTIMIZATION: Add all components in single batch call
            // This reduces cache invalidation from 13+ times to just once
            this.addAllComponents(entity, safeTransform, unitType, team, teamConfig, collection, spawnType);

            // Schedule equipment and abilities (async to avoid blocking)
            this.schedulePostCreationSetup(entity, unitType);

            // Set playerId on team component if provided
            if (playerId) {
                const teamComponent = this.game.getComponent(entity, "team");
                if (teamComponent) {
                    teamComponent.playerId = playerId;
                }
            }

            // Update statistics
            this.game.call('invalidateSupplyCache');
            return entity;
        } catch (error) {
            console.error('Failed to create unit:', error);
            throw new Error(`Unit creation failed: ${error.message}`);
        }
    }

    /**
     * Clean up squads by destroying their units and freeing grid cells
     * @param {Array} squads - Array of squad placement data
     */
    cleanupSquads(squads) {
        for (const squad of squads) {
            try {
                // Destroy squad units
                for (const unit of squad.squadUnits || []) {
                    if (this.game.destroyEntity && unit) {
                        this.game.destroyEntity(unit);
                    }
                }

                // Free grid cells
                if (this.game.gridSystem && squad.placementId) {
                    this.game.gridSystem.freeCells(squad.placementId);
                }

                // Remove from experience system
                if (this.game.squadExperienceSystem && squad.placementId) {
                    this.game.squadExperienceSystem.removeSquad(squad.placementId);
                }

            } catch (error) {
                console.warn(`Failed to cleanup squad ${squad.placementId}:`, error);
            }
        }
    }

    /**
     * Get squad information for a unit type
     * @param {Object} unitType - Unit type definition
     * @returns {Object} Squad information
     */
    getSquadInfo(unitType) {
        if (this.game.squadSystem) {
            return this.game.squadSystem.getSquadInfo(unitType);
        }
        
        // Fallback squad info
        return {
            unitName: unitType.title || unitType.id || 'Unknown',
            squadSize: 1,
            formationType: 'single',
            spacing: 1
        };
    }

    /**
     * Validate if a squad can be placed at the given position
     * @param {Object} gridPosition - Grid position {x, z}
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier
     * @returns {boolean} True if placement is valid
     */
    canPlaceSquad(gridPosition, unitType, team) {
        if (!this.game.squadSystem || !this.game.gridSystem) {
            return this.game.gridSystem ? 
                this.game.gridSystem.isValidPosition(gridPosition) : true;
        }

        try {
            const squadData = this.game.squadSystem.getSquadData(unitType);
            const validation = this.game.squadSystem.validateSquadConfig(squadData);
            
            if (!validation.valid) {
                return false;
            }

            const cells = this.game.squadSystem.getSquadCells(gridPosition, squadData);
            return this.game.gridSystem.isValidPlacement(cells, team);
            
        } catch (error) {
            console.warn('Squad placement validation failed:', error);
            return false;
        }
    }
    
    /**
     * Add all unit components in a single batch operation
     * OPTIMIZATION: Uses addComponents() for single cache invalidation
     * @param {number} entity - Entity ID
     * @param {Object} transform - Transform with position, rotation, scale
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier
     * @param {Object} teamConfig - Team configuration
     * @param {string} collection - Collection name
     * @param {string} spawnType - Spawn type ID
     */
    addAllComponents(entity, transform, unitType, team, teamConfig, collection, spawnType) {
        const position = transform.position || { x: 0, y: 0, z: 0 };
        const rotation = transform.rotation || { x: 0, y: teamConfig.initialFacing, z: 0 };
        const scale = transform.scale || { x: 1, y: 1, z: 1 };
        const maxSpeed = (unitType.speed) * this.SPEED_MODIFIER;
        const maxHP = unitType.hp || this.defaults.hp;

        // OPTIMIZATION: Add all components in single batch call
        // This does one cache invalidation instead of 13+ separate invalidations
        this.game.addComponents(entity, {
            // Core components
            transform: {
                position: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 },
                rotation: { x: rotation.x ?? 0, y: rotation.y ?? teamConfig.initialFacing, z: rotation.z ?? 0 },
                scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 }
            },
            velocity: {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: maxSpeed,
                affectedByGravity: true,
                anchored: unitType.collection == 'buildings' ? true : false
            },
            team: { team: team },
            unitType: unitType,

            // Combat components
            health: { max: maxHP, current: maxHP },
            combat: {
                damage: unitType.damage,
                range: unitType.range,
                attackSpeed: unitType.attackSpeed,
                projectile: unitType.projectile,
                lastAttack: 0,
                element: unitType.element,
                armor: unitType.armor,
                fireResistance: unitType.fireResistance,
                coldResistance: unitType.coldResistance,
                lightningResistance: unitType.lightningResistance,
                poisonResistance: 0,
                visionRange: unitType.visionRange
            },
            collision: {
                radius: unitType.size || this.defaults.size,
                height: unitType.height
            },

            // Behavior components
            aiState: {
                currentAction: null,
                rootBehaviorTree: "UnitBattleBehaviorTree",
                meta: {}
            },
            pathfinding: {
                path: null,
                pathIndex: 0,
                lastPathRequest: 0,
                useDirectMovement: false
            },
            combatState: {
                lastAttacker: null,
                lastAttackTime: 0
            },
            animation: {
                scale: 1,
                rotation: 0,
                flash: 0
            },
            equipment: {
                slots: {
                    mainHand: null,
                    offHand: null,
                    helmet: null,
                    chest: null,
                    legs: null,
                    feet: null,
                    back: null
                }
            },

            // Visual components
            renderable: {
                objectType: unitType.collection || collection,
                spawnType: unitType.id || spawnType,
                capacity: 128
            }
        });
    }

    /**
     * Add core position and identity components
     * @deprecated Use addAllComponents() for better performance
     */
    addCoreComponents(entity, transform, unitType, team, teamConfig) {
        const position = transform.position || { x: 0, y: 0, z: 0 };
        const rotation = transform.rotation || { x: 0, y: teamConfig.initialFacing, z: 0 };
        const scale = transform.scale || { x: 1, y: 1, z: 1 };

        this.game.addComponent(entity, "transform", {
            position: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 },
            rotation: { x: rotation.x ?? 0, y: rotation.y ?? teamConfig.initialFacing, z: rotation.z ?? 0 },
            scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 }
        });

        const maxSpeed = (unitType.speed) * this.SPEED_MODIFIER;
        this.game.addComponent(entity, "velocity", {
            vx: 0,
            vy: 0,
            vz: 0,
            maxSpeed: maxSpeed,
            affectedByGravity: true,
            anchored: unitType.collection == 'buildings' ? true : false
        });

        this.game.addComponent(entity, "team", { team: team });
        this.game.addComponent(entity, "unitType", unitType);
    }

    /**
     * Add combat-related components
     * @deprecated Use addAllComponents() for better performance
     */
    addCombatComponents(entity, unitType) {
        const maxHP = unitType.hp || this.defaults.hp;
        this.game.addComponent(entity, "health", { max: maxHP, current: maxHP });

        this.game.addComponent(entity, "combat", {
            damage: unitType.damage,
            range: unitType.range,
            attackSpeed: unitType.attackSpeed,
            projectile: unitType.projectile,
            lastAttack: 0,
            element: unitType.element,
            armor: unitType.armor,
            fireResistance: unitType.fireResistance,
            coldResistance: unitType.coldResistance,
            lightningResistance: unitType.lightningResistance,
            poisonResistance: 0,
            visionRange: unitType.visionRange
        });

        this.game.addComponent(entity, "collision", {
            radius: unitType.size || this.defaults.size,
            height: unitType.height
        });
    }

    /**
     * Add AI and behavior components
     * @deprecated Use addAllComponents() for better performance
     */
    addBehaviorComponents(entity) {
        this.game.addComponent(entity, "aiState", {
            currentAction: null,
            rootBehaviorTree: "UnitBattleBehaviorTree",
            meta: {}
        });

        this.game.addComponent(entity, "pathfinding", {
            path: null,
            pathIndex: 0,
            lastPathRequest: 0,
            useDirectMovement: false
        });

        this.game.addComponent(entity, "combatState", {
            lastAttacker: null,
            lastAttackTime: 0
        });

        this.game.addComponent(entity, "animation", {
            scale: 1,
            rotation: 0,
            flash: 0
        });

        this.game.addComponent(entity, "equipment", {
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
    }

    /**
     * Add visual and rendering components
     * @deprecated Use addAllComponents() for better performance
     */
    addVisualComponents(entity, unitType, teamConfig, collection, spawnType) {
        this.game.addComponent(entity, "renderable", {
            objectType: unitType.collection || collection,
            spawnType: unitType.id || spawnType,
            capacity: 128
        });
    }
    
    /**
     * Schedule post-creation setup (equipment and abilities)
     * @param {number} entityId - Entity ID
     * @param {Object} unitType - Unit type definition
     */
    schedulePostCreationSetup(entityId, unitType) {

        this.setupEquipment(entityId, unitType);
        this.setupAbilities(entityId, unitType);
    }
    
    /**
     * Equip unit with items from unit definition
     * @param {number} entityId - Entity ID
     * @param {Object} unitType - Unit type definition
     */
    async setupEquipment(entityId, unitType) {

        if (!this.game.equipmentSystem || !unitType?.render?.equipment) {
            return;
        }
        
        try {
            // Sort equipment by priority for better equipping order
            const equipmentList = [...unitType.render.equipment].sort((a, b) => {
                const priorityA = this.equipmentPriority.indexOf(a.slot) || 999;
                const priorityB = this.equipmentPriority.indexOf(b.slot) || 999;
                return priorityA - priorityB;
            });
            
            // Equip each item
            for (const equippedItem of equipmentList) {
                const itemData = this.getItemFromCollection(equippedItem.item);
                if (itemData) {
                    try {
                        await this.game.equipmentSystem.equipItem(
                            entityId, 
                            equippedItem, 
                            itemData, 
                            equippedItem.item
                        );
                    } catch (equipError) {
                        console.warn(`Failed to equip ${equippedItem.item} on slot ${equippedItem.slot}:`, equipError);
                        this.stats.equipmentFailures++;
                    }
                } else {
                    console.warn(`Item ${equippedItem.item} not found in collections`);
                    this.stats.equipmentFailures++;
                }
            }
        } catch (error) {
            console.error(`Equipment setup failed for entity ${entityId}:`, error);
            this.stats.equipmentFailures++;
        }
    }
    
    /**
     * Add abilities to unit from unit definition
     * @param {number} entityId - Entity ID
     * @param {Object} unitType - Unit type definition
     */
    setupAbilities(entityId, unitType) {
        if (!this.game.abilitySystem || !unitType?.abilities) {
            return;
        }
        
        try {
            // Validate abilities exist before adding
            const validAbilities = unitType.abilities.filter(abilityId => {
                const abilityData = this.getAbilityFromCollection(abilityId);
                if (!abilityData) {
                    console.warn(`Ability ${abilityId} not found in collections`);
                    this.stats.abilityFailures++;
                    return false;
                }
                return true;
            });
            
            if (validAbilities.length > 0) {
                this.game.abilitySystem.addAbilitiesToUnit(entityId, validAbilities);
            }
        } catch (error) {
            console.error(`Ability setup failed for entity ${entityId}:`, error);
            this.stats.abilityFailures++;
        }
    }
    
    /**
     * Get item data from game collections
     * @param {string} itemId - Item identifier
     * @returns {Object|null} Item data or null if not found
     */
    getItemFromCollection(itemId) {
        try {
            const collections = this.game.getCollections();
            if (!collections?.items?.[itemId]) {
                return null;
            }
            return collections.items[itemId];
        } catch (error) {
            console.warn(`Error accessing item collection for ${itemId}:`, error);
            return null;
        }
    }
    
    /**
     * Get ability data from game collections
     * @param {string} abilityId - Ability identifier
     * @returns {Object|null} Ability data or null if not found
     */
    getAbilityFromCollection(abilityId) {
        try {
            const collections = this.game.getCollections();
            if (!collections?.abilities?.[abilityId]) {
                return null;
            }
            return collections.abilities[abilityId];
        } catch (error) {
            console.warn(`Error accessing ability collection for ${abilityId}:`, error);
            return null;
        }
    }
    
    /**
     * Get terrain height at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Terrain height
     */
    getTerrainHeight(worldX, worldZ) {
        try {
            if (this.game.terrainSystem?.getTerrainHeightAtPosition) {
                return this.game.terrainSystem.getTerrainHeightAtPosition(worldX, worldZ);
            }
        } catch (error) {
            console.warn(`Error getting terrain height at (${worldX}, ${worldZ}):`, error);
        }
        return 0; // Default to ground level
    }
    
    

    
    /**
     * Reset creation statistics
     */
    resetStats() {
        this.stats = {
            totalCreated: 0,
            createdByTeam: new Map(),
            createdByType: new Map(),
            equipmentFailures: 0,
            abilityFailures: 0,
            squadsCreated: 0
        };
    }
    
    /**
     * Validate unit type definition
     * @param {Object} unitType - Unit type to validate
     * @returns {Object} Validation result
     */
    validateUnitType(unitType) {
        const errors = [];
        const warnings = [];
        
        if (!unitType) {
            errors.push('Unit type is required');
            return { valid: false, errors, warnings };
        }
        
        // Check required fields
        if (!unitType.id) warnings.push('Unit ID missing, using default');
        if (!unitType.title) warnings.push('Unit title missing, using ID or default');
        
        // Validate numeric stats
        const numericFields = ['hp', 'damage', 'range', 'speed', 'armor', 'value'];
        numericFields.forEach(field => {
            if (unitType[field] !== undefined && (isNaN(unitType[field]) || unitType[field] < 0)) {
                errors.push(`${field} must be a non-negative number`);
            }
        });
        
        // Check equipment references
        if (unitType.render?.equipment) {
            unitType.render.equipment.forEach((item, index) => {
                if (!item.item) {
                    warnings.push(`Equipment item ${index} missing item ID`);
                }
                if (!item.slot) {
                    warnings.push(`Equipment item ${index} missing slot`);
                }
            });
        }
        
        // Check ability references
        if (unitType.abilities && !Array.isArray(unitType.abilities)) {
            errors.push('Abilities must be an array');
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
    
    /**
     * Clean up resources and cache
     */
    dispose() {
        this.componentCache.clear();
        this.resetStats();
    }

    onSceneUnload() {
        this.dispose();
    }
}