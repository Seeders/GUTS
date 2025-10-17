class UnitCreationManager {
    constructor(game) {
        this.game = game;
        this.game.buildingCreationManager = this;
        
        // Default component values for missing unit data
        this.defaults = {
            hp: 100,
            damage: 0,
            range: 0,
            speed: 0,
            attackSpeed: 0,
            size: 50,
            height: 50,
            armor: 50,
            fireResistance: 0,
            coldResistance: 1,
            lightningResistance: 1,
            element: 'physical',
            projectile: null,
            value: 100
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
     * @returns {number} Entity ID
     */
    create(worldX, worldY, worldZ, targetPosition, unitType, team) {
        try {
            const entity = this.game.createEntity(`${unitType.id}_${worldX}_${worldZ}_${team}`);
            // Add core components
            this.addCoreComponents(entity, worldX, worldY, worldZ, unitType, team);
            
            // Add combat components
            this.addCombatComponents(entity, unitType);
            
            // Add AI and behavior components
            this.addBehaviorComponents(entity, targetPosition);
            
            // Add visual and interaction components
            this.addVisualComponents(entity, unitType);
            
            // Schedule equipment and abilities (async to avoid blocking)
            this.schedulePostCreationSetup(entity, unitType);
            
            // Update statistics
            this.updateCreationStats(unitType, team);
            return entity;
        } catch (error) {
            console.error('Failed to create unit:', error);
            throw new Error(`Unit creation failed: ${error.message}`);
        }
    }

    /**
     * Validate if a squad can be placed at the given position
     * @param {Object} gridPosition - Grid position {x, z}
     * @param {Object} unitType - Unit type definition
     * @param {string} team - Team identifier
     * @returns {boolean} True if placement is valid
     */
    canPlaceBuilding(gridPosition, unitType, team) {
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
     */
    addCoreComponents(entity, worldX, worldY, worldZ, unitType, team) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        // Position component
        this.game.addComponent(entity, ComponentTypes.POSITION, 
            Components.Position(worldX, worldY, worldZ));
                
        // Team identification
        this.game.addComponent(entity, ComponentTypes.TEAM, 
            Components.Team(team));
        
        // Unit type information
        this.game.addComponent(entity, ComponentTypes.UNIT_TYPE, 
            Components.UnitType(
                unitType.id || 'unknown', 
                'buildings', 
                unitType.title || 'Unknown Building',
                unitType.value || this.defaults.value
            ));
    }
    
    /**
     * Add combat-related components
     * @param {number} entity - Entity ID
     * @param {Object} unitType - Unit type definition
     */
    addCombatComponents(entity, unitType) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        // Health component
        const maxHP = unitType.hp || this.defaults.hp;
        this.game.addComponent(entity, ComponentTypes.HEALTH, 
            Components.Health(maxHP));
        
        // Combat component with all combat stats
        this.game.addComponent(entity, ComponentTypes.COMBAT, 
            Components.Combat(
                unitType.damage,
                unitType.range,
                unitType.attackSpeed,
                unitType.projectile,
                0, // Initial attack cooldown
                unitType.element,
                unitType.armor,
                unitType.fireResistance,
                unitType.coldResistance,
                unitType.lightningResistance
            ));
        
        // Collision component for physical interactions
        this.game.addComponent(entity, ComponentTypes.COLLISION, 
            Components.Collision(unitType.size || this.defaults.size, unitType.height));
    }
    
    /**
     * Add AI and behavior components
     * @param {number} entity - Entity ID
     */
    addBehaviorComponents(entity, targetPosition) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
         // AI state for behavior control
        this.game.addComponent(entity, ComponentTypes.AI_STATE, 
            Components.AIState('idle', targetPosition));
        
        // Animation state
        this.game.addComponent(entity, ComponentTypes.ANIMATION, 
            Components.Animation());
        
    }
    
    /**
     * Add visual and rendering components
     * @param {number} entity - Entity ID
     * @param {Object} unitType - Unit type definition
     */
    addVisualComponents(entity, unitType) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        // Renderable component for visual representation
        this.game.addComponent(entity, ComponentTypes.RENDERABLE, 
            Components.Renderable("buildings", unitType.id || 'default'));
        
    }

    schedulePostCreationSetup(entityId, unitType) {
        // Use setTimeout to avoid blocking unit creation
        setTimeout(() => {
            this.setupAbilities(entityId, unitType);
        }, 50); // Small delay to ensure entity is fully initialized
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
     * Clean up resources and cache
     */
    dispose() {
        this.componentCache.clear();
        this.resetStats();
    }
}