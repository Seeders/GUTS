class UnitCreationManager {
    constructor(game) {
        this.game = game;
        this.game.unitCreationManager = this;
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
    
    /**
     * Create a new unit entity with all required components
     * @param {number} worldX - World X coordinate
     * @param {number} worldY - World Y coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {string|null} playerId - Optional player ID
     * @returns {number} Entity ID
     */
    create(worldX, worldY, worldZ, targetPosition, placement, team, playerId = null) {
        const unitType = placement.unitType;
        try {
            // Round world coordinates to ensure deterministic entity IDs across client and server
            const roundedX = Math.round(worldX * 100) / 100;
            const roundedZ = Math.round(worldZ * 100) / 100;
            const entity = this.game.createEntity(`${unitType.id}_${roundedX}_${roundedZ}_${team}_${this.game.state.round}`);
            console.log('created unit', unitType.id, team, entity);
            const teamConfig = this.teamConfigs[team];
            // Add core components
            this.addCoreComponents(entity, worldX, worldY, worldZ, placement, team, teamConfig);

            // Add combat components
            this.addCombatComponents(entity, unitType);

            // Add AI and behavior components
            this.addBehaviorComponents(entity, targetPosition, unitType);

            // Add visual and interaction components
            this.addVisualComponents(entity, unitType, teamConfig);

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
            this.updateCreationStats(unitType, team);
            return entity;
        } catch (error) {
            console.error('Failed to create unit:', error);
            throw new Error(`Unit creation failed: ${error.message}`);
        }
    }


    /**
     * Create multiple squads efficiently from placement data
     * @param {Array} placements - Array of placement data from client
     * @param {string} team - Team identifier
     * @param {string|null} playerId - Optional player ID
     * @returns {Array} Array of created squad placement data
     */
    createSquadFromPlacement(placement, team, playerId = null) {

        const gridPosition = placement.gridPosition;
        const targetPosition = placement.targetPosition;
        const unitType = placement.unitType;

        try {
            // Get squad configuration
            const squadData = this.game.squadManager.getSquadData(unitType);
            const validation = this.game.squadManager.validateSquadConfig(squadData);
            
            if (!validation.valid) {
                console.log("invalid squad config");
                return false;
            }

            // Calculate unit positions within the squad
            const unitPositions = this.game.squadManager.calculateUnitPositions(
                gridPosition,
                unitType
            );

            // Calculate cells occupied by the squad
            const cells = this.game.squadManager.getSquadCells(gridPosition, squadData);

            // Generate unique placement ID
            const placementId = `squad_${team}_${gridPosition.x}_${gridPosition.z}`;
            const squadUnits = [];

            
            // Create individual units for the squad
            for (const pos of unitPositions) {
                const terrainHeight = this.getTerrainHeight(pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                const entityId = this.create(pos.x, unitY, pos.z, targetPosition, placement, team);

                // Add playerId to the team component if provided
                if (playerId && this.game.componentManager) {
                    const teamComponent = this.game.getComponent(entityId, "team");
                    if (teamComponent) {
                        teamComponent.playerId = playerId;
                    }
                }
                if(unitType.collection == 'buildings'){
                    this.game.placementSystem.saveBuilding(entityId, team, gridPosition, unitType)
                }
                squadUnits.push(entityId);
                this.game.gameManager.call('reserveGridCells', cells, entityId);
            }

            // Occupy grid cells
            // Update squad creation statistics
            this.stats.squadsCreated++;

            // Initialize squad in experience system if available
            if (this.game.squadExperienceSystem) {
                this.game.squadExperienceSystem.initializeSquad(placementId, unitType, squadUnits, team);
            }

            // const squadInfo = this.game.squadManager.getSquadInfo(unitType);
         
            return {
                placementId: placementId,
                gridPosition: gridPosition,
                unitType: unitType,
                squadUnits: squadUnits,
                cells: cells,
                isSquad: squadUnits.length > 1,
                team: team,
                playerId: playerId,
                timestamp: Date.now()
            };

        } catch (error) {
            console.error('Squad creation failed:', error);
            throw new Error(`Squad creation failed: ${error.message}`);
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
        if (this.game.squadManager) {
            return this.game.squadManager.getSquadInfo(unitType);
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
        if (!this.game.squadManager || !this.game.gridSystem) {
            return this.game.gridSystem ? 
                this.game.gridSystem.isValidPosition(gridPosition) : true;
        }

        try {
            const squadData = this.game.squadManager.getSquadData(unitType);
            const validation = this.game.squadManager.validateSquadConfig(squadData);
            
            if (!validation.valid) {
                return false;
            }

            const cells = this.game.squadManager.getSquadCells(gridPosition, squadData);
            return this.game.gridSystem.isValidPlacement(cells, team);
            
        } catch (error) {
            console.warn('Squad placement validation failed:', error);
            return false;
        }
    }
    
    /**
     * Add core position and identity components
     * @param {number} entity - Entity ID
     * @param {number} worldX - World X coordinate
     * @param {number} worldY - World Y coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier
     * @param {Object} teamConfig - Team configuration
     */
    addCoreComponents(entity, worldX, worldY, worldZ, placement, team, teamConfig) {
        const unitType = placement.unitType;

        // Position component
        this.game.addComponent(entity, "position", {
            x: worldX,
            y: worldY,
            z: worldZ
        });

        // Velocity component with movement capabilities
        const maxSpeed = (unitType.speed) * this.SPEED_MODIFIER;
        this.game.addComponent(entity, "velocity", {
            vx: 0,
            vy: 0,
            vz: 0,
            maxSpeed: maxSpeed,
            affectedByGravity: true,
            anchored: unitType.collection == 'buildings' ? true : false
        });

        // Team identification
        this.game.addComponent(entity, "team", {
            team: team
        });

        this.game.addComponent(entity, "placement",
            placement);

        // Unit type information
        this.game.addComponent(entity, "unitType",
            unitType);

        // Facing direction
        this.game.addComponent(entity, "facing", {
            angle: teamConfig.initialFacing
        });
    }
    
    /**
     * Add combat-related components
     * @param {number} entity - Entity ID
     * @param {Object} unitType - Unit type definition
     */
    addCombatComponents(entity, unitType) {
        // Health component
        const maxHP = unitType.hp || this.defaults.hp;
        this.game.addComponent(entity, "health", {
            max: maxHP,
            current: maxHP
        });

        // Combat component with all combat stats
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

        // Collision component for physical interactions
        this.game.addComponent(entity, "collision", {
            radius: unitType.size || this.defaults.size,
            height: unitType.height
        });
    }
    
    /**
     * Add AI and behavior components
     * @param {number} entity - Entity ID
     */
    addBehaviorComponents(entity, targetPosition, unitType) {
        // AI state for behavior control (only for behavior tree state management)
        this.game.addComponent(entity, "aiState", {
            state: 'idle',
            targetPosition: targetPosition,
            target: null,
            aiControllerId: null,
            meta: {}
        });

        // Player order component (for player commands)
        this.game.addComponent(entity, "playerOrder", {
            targetPosition: null,
            meta: {},
            issuedTime: 0
        });

        // Pathfinding component (for movement paths)
        this.game.addComponent(entity, "pathfinding", {
            path: null,
            pathIndex: 0,
            lastPathRequest: 0,
            useDirectMovement: false
        });

        // Combat state component (for combat tracking)
        this.game.addComponent(entity, "combatState", {
            lastAttacker: null,
            lastAttackTime: 0
        });

        // Animation state
        this.game.addComponent(entity, "animation", {
            scale: 1,
            rotation: 0,
            flash: 0
        });

        // Equipment container
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
     * @param {number} entity - Entity ID
     * @param {Object} unitType - Unit type definition
     * @param {Object} teamConfig - Team configuration
     */
    addVisualComponents(entity, unitType, teamConfig) {
        // Renderable component for visual representation
        this.game.addComponent(entity, "renderable", {
            objectType: unitType.collection,
            spawnType: unitType.id || 'default',
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
     * Update creation statistics
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier
     */
    updateCreationStats(unitType, team) {
        this.stats.totalCreated++;
        
        // Track by team
        const teamCount = this.stats.createdByTeam.get(team) || 0;
        this.stats.createdByTeam.set(team, teamCount + 1);
        
        // Track by unit type
        const unitTypeId = unitType.id || 'unknown';
        const typeCount = this.stats.createdByType.get(unitTypeId) || 0;
        this.stats.createdByType.set(unitTypeId, typeCount + 1);
    }
    
    /**
     * Get creation statistics
     * @returns {Object} Statistics summary
     */
    getStats() {
        return {
            totalCreated: this.stats.totalCreated,
            createdByTeam: Object.fromEntries(this.stats.createdByTeam),
            createdByType: Object.fromEntries(this.stats.createdByType),
            equipmentFailures: this.stats.equipmentFailures,
            abilityFailures: this.stats.abilityFailures,
            squadsCreated: this.stats.squadsCreated,
            successRate: {
                equipment: 1 - (this.stats.equipmentFailures / Math.max(1, this.stats.totalCreated)),
                abilities: 1 - (this.stats.abilityFailures / Math.max(1, this.stats.totalCreated))
            }
        };
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
}