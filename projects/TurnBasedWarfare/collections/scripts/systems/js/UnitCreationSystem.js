class UnitCreationSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.unitCreationSystem = this;
        this.SPEED_MODIFIER = 20;
        // Default component values for missing unit data (initialized in init after enums available)
        this.defaults = null;
        
        // Equipment slot priorities for auto-equipping
        this.equipmentPriority = [
            'weapon',
            'armor',
            'helmet',
            'boots',
            'gloves',
            'accessory'
        ];
        
        // Team-specific configurations (keyed by numeric team enum: left=2, right=3)
        // These will be re-keyed in init() when enums are available
        this.teamConfigs = {};
        
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
        // Initialize team configs with numeric keys
        const TEAM_LEFT = this.enums.team.left;
        const TEAM_RIGHT = this.enums.team.right;
        this.teamConfigs[TEAM_LEFT] = {
            initialFacing: 0,
            colorTint: null
        };
        this.teamConfigs[TEAM_RIGHT] = {
            initialFacing: Math.PI,
            colorTint: 0xff4444
        };

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
            element: this.enums.element.physical,
            projectile: -1,
            value: 50
        };
        this.game.register('createPlacement', this.createPlacement.bind(this));
        this.game.register('createUnit', this.createUnit.bind(this));
        this.game.register('getTerrainHeight', this.getTerrainHeight.bind(this));
        this.game.register('incrementSquadsCreated', () => { this.stats.squadsCreated++; });
    }
    /**
     * Create a new unit entity with all required components from a placement
     * @param {Object} networkUnitData - Placement data with collection, unitTypeId, unitType, etc.
     *                             collection/unitTypeId are numeric indices
     *                             unitType is the resolved definition object with string id/collection
     * @param {Object} transform - Transform with position, rotation, scale
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {string|null} entityId - Optional entity ID (for scene loading)
     * @returns {number} Entity ID
     */
    createPlacement(networkUnitData, transform, team, entityId = null) {
        try {
            // placement.collection and placement.unitTypeId are numeric indices
            const collectionIndex = networkUnitData.collection;
            const unitTypeIndex = networkUnitData.unitTypeId;

            if (collectionIndex < 0 || unitTypeIndex < 0) {
                console.log('Invalid placement - collection:', collectionIndex, 'unitTypeId:', unitTypeIndex, networkUnitData);
                throw new Error(`Invalid placement - missing collection or unitTypeId (collection=${collectionIndex}, unitTypeId=${unitTypeIndex})`);
            }

            const entity = this.createUnit(collectionIndex, unitTypeIndex, transform, team, entityId);

            this.game.addComponent(entity, 'placement', {
                placementId: networkUnitData.placementId,
                gridPosition: networkUnitData.gridPosition,
                unitTypeId: networkUnitData.unitTypeId,
                collection: networkUnitData.collection,
                team: team,
                playerId: networkUnitData.playerId ?? -1,
                roundPlaced: networkUnitData.roundPlaced,
                // Include building construction state if present
                isUnderConstruction: networkUnitData.isUnderConstruction ? 1 : 0,
                buildTime: networkUnitData.buildTime ?? 0,
                assignedBuilder: networkUnitData.assignedBuilder ?? -1
            });

            // If building is under construction, update renderable to show construction state
            if (networkUnitData.isUnderConstruction) {
                const renderComponent = this.game.getComponent(entity, 'renderable');
                if (renderComponent) {
                    renderComponent.spawnType = this.enums.buildings.underConstruction;
                }
            }

            console.log('created placement', networkUnitData.unitTypeId, team, entity, 'placementId:', networkUnitData.placementId);

            return entity;
        } catch (error) {
            console.error('Failed to create unit:', error);
            throw new Error(`Unit creation failed: ${error.message}`);
        }
    }

    /**
     * Create a new unit entity with all required components
     * @param {number} collectionIndex - Collection index (objectTypeDefinitions enum)
     * @param {number} spawnTypeIndex - Spawn type index (collection enum)
     * @param {Object} transform - Transform with position, rotation, scale
     * @param {number} team - Team identifier (numeric)
     * @param {number|null} entityId - Optional entity ID (for scene loading)
     * @returns {number} Entity ID
     */
    createUnit(collectionIndex, spawnTypeIndex, transform, team, entityId = null) {
        // Convert numeric indices to strings for collection lookup
        const collection = this.reverseEnums.objectTypeDefinitions?.[collectionIndex];
        const spawnType = collection ? this.reverseEnums[collection]?.[spawnTypeIndex] : null;

        if (!collection || !spawnType) {
            throw new Error(`Invalid unit indices: collection=${collectionIndex}, spawnType=${spawnTypeIndex}`);
        }

        const unitType = this.collections[collection][spawnType];
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
            // Pass numeric indices for renderable component
            this.addAllComponents(entity, safeTransform, unitType, team, teamConfig, collectionIndex, spawnTypeIndex);

            // Schedule equipment and abilities (async to avoid blocking)
            this.schedulePostCreationSetup(entity, unitType);

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
                if (squad.placementId) {
                    this.game.call('releaseGridCells', squad.placementId);
                }

                // Remove from experience system
                if (squad.placementId) {
                    this.game.call('removeSquadExperience', squad.placementId);
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
        const squadInfo = this.game.call('getSquadInfoFromType', unitType);
        if (squadInfo) {
            return squadInfo;
        }

        // Fallback squad info
        const enums = this.game.getEnums();
        return {
            unitName: unitType.title || unitType.id || 'Unknown',
            squadSize: 1,
            formationType: enums.formationType.single,
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
        try {
            const squadData = this.game.call('getSquadData', unitType);
            if (!squadData) {
                return this.game.call('isValidGridPosition', gridPosition) ?? true;
            }

            const validation = this.game.call('validateSquadConfig', squadData);

            if (!validation?.valid) {
                return false;
            }

            const cells = this.game.call('getSquadCells', gridPosition, squadData);
            return this.game.call('isValidGridPlacement', cells, team) ?? true;

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
     * @param {number} collectionIndex - Collection index (objectTypeDefinitions enum)
     * @param {number} spawnTypeIndex - Spawn type index (collection enum)
     */
    addAllComponents(entity, transform, unitType, team, teamConfig, collectionIndex, spawnTypeIndex) {
        const position = transform.position || { x: 0, y: 0, z: 0 };
        const rotation = transform.rotation || { x: 0, y: teamConfig.initialFacing, z: 0 };
        const scale = transform.scale || { x: 1, y: 1, z: 1 };
        const maxSpeed = (unitType.speed) * this.SPEED_MODIFIER;
        const maxHP = unitType.hp || this.defaults.hp;

        // Get collection name from index for component name lookup
        const collectionName = this.reverseEnums.objectTypeDefinitions?.[collectionIndex];
        // Convert collection name to singular component name
        // e.g., "units" -> "unit", "buildings" -> "building", "worldObjects" -> "worldObject"
        const collectionComponentName = this.getCollectionComponentName(collectionName);

        // OPTIMIZATION: Add all components in single batch call
        // This does one cache invalidation instead of 13+ separate invalidations
        const components = {
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
                affectedByGravity: 1,
                anchored: collectionName === 'buildings' ? 1 : 0
            },
            // team can be either a string ('left'/'right') or numeric enum value
            team: { team: typeof team === 'number' ? team : (this.enums.team?.[team] ?? 0) },
            unitType: {
                collection: collectionIndex,
                type: spawnTypeIndex
            },

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
                currentAction: -1,
                currentActionCollection: -1,
                rootBehaviorTree: this.enums.behaviorTrees.UnitBattleBehaviorTree,
                rootBehaviorTreeCollection: this.enums.behaviorCollection.behaviorTrees
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
                objectType: collectionIndex,
                spawnType: spawnTypeIndex,
                capacity: 128
            },

            // Experience component
            experience: {
                level: 1,
                experience: 0,
                experienceToNextLevel: 15,
                squadValue: 0,
                canLevelUp: 0,
                totalUnitsInSquad: 1,
                lastExperienceGain: 0
            }
        };

        // Add collection-type component for easy querying (e.g., unit, building, worldObject)
        // Store numeric type index (same as spawnTypeIndex) for TypedArray compatibility
        if (collectionComponentName) {
            components[collectionComponentName] = { type: spawnTypeIndex };
        }

        this.game.addComponents(entity, components);
    }

    /**
     * Convert collection name to singular component name
     * @param {string} collection - Collection name (e.g., 'units', 'buildings', 'worldObjects')
     * @returns {string|null} Singular component name or null if not mapped
     */
    getCollectionComponentName(collection) {
        const collectionToComponent = {
            'units': 'unit',
            'buildings': 'building',
            'worldObjects': 'worldObject',
            'cliffs': 'cliff',
            'items': 'item',
            'particles': 'particle',
            'projectiles': 'projectile',
            'visuals': 'visual'
        };
        return collectionToComponent[collection] || null;
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
            affectedByGravity: 1,
            anchored: unitType.collection == 'buildings' ? 1 : 0
        });

        // team can be either a string ('left'/'right') or numeric enum value
        const teamValue = typeof team === 'number' ? team : (this.enums.team?.[team] ?? 0);
        this.game.addComponent(entity, "team", { team: teamValue });
        // Store numeric indices for collection and type
        const collection = unitType.collection || 'units';
        const spawnType = unitType.id || unitType.title;
        this.game.addComponent(entity, "unitType", {
            collection: this.enums.objectTypeDefinitions[collection] ?? -1,
            type: this.enums[collection]?.[spawnType] ?? -1
        });
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
            currentAction: -1,
            currentActionCollection: -1,
            rootBehaviorTree: this.enums.behaviorTrees.UnitBattleBehaviorTree,
            rootBehaviorTreeCollection: this.enums.behaviorCollection.behaviorTrees
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
        const collectionName = unitType.collection || collection;
        const typeName = unitType.id || spawnType;
        const objectTypeIndex = this.enums.objectTypeDefinitions?.[collectionName] ?? -1;
        const spawnTypeIndex = this.enums[collectionName]?.[typeName] ?? -1;
        this.game.addComponent(entity, "renderable", {
            objectType: objectTypeIndex,
            spawnType: spawnTypeIndex,
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
                        await this.game.call('equipItem',
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
        if (!unitType?.abilities) {
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
                this.game.call('addAbilitiesToUnit', entityId, validAbilities);
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
            if (!this.collections.items?.[itemId]) {
                return null;
            }
            return this.collections.items[itemId];
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
            if (!this.collections.abilities?.[abilityId]) {
                return null;
            }
            return this.collections.abilities[abilityId];
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
            const height = this.game.call('getTerrainHeightAtPosition', worldX, worldZ);
            if (height !== undefined) {
                return height;
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
