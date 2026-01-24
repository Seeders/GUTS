class UnitCreationSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'addAbilitiesToUnit',
        'equipItem',
        'getSquadCells',
        'getSquadData',
        'getSquadInfoFromType',
        'getTerrainHeightAtPosition',
        'invalidateSupplyCache',
        'isValidGridPlacement',
        'isValidGridPosition',
        'releaseGridCells',
        'removeSquadExperience',
        'validateSquadConfig'
    ];

    static services = [
        'createPlacement',
        'createUnit',
        'createEntityFromPrefab',
        'getTerrainHeight',
        'incrementSquadsCreated'
    ];

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
        const TEAM_NEUTRAL = this.enums.team.neutral;
        const TEAM_HOSTILE = this.enums.team.hostile;
        const TEAM_LEFT = this.enums.team.left;
        const TEAM_RIGHT = this.enums.team.right;
        this.teamConfigs[TEAM_NEUTRAL] = {
            initialFacing: 0
        };
        this.teamConfigs[TEAM_HOSTILE] = {
            initialFacing: 0
        };
        this.teamConfigs[TEAM_LEFT] = {
            initialFacing: 0
        };
        this.teamConfigs[TEAM_RIGHT] = {
            initialFacing: Math.PI
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
            projectile: null,
            value: 50
        };
    }

    // Alias for service
    incrementSquadsCreated() {
        this.stats.squadsCreated++;
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
        const log = GUTS.HeadlessLogger;

        // Convert numeric indices to strings for collection lookup
        const collection = this.reverseEnums.objectTypeDefinitions?.[collectionIndex];
        const spawnType = collection ? this.reverseEnums[collection]?.[spawnTypeIndex] : null;


        if (!collection || !spawnType) {
            throw new Error(`Invalid unit indices: collection=${collectionIndex}, spawnType=${spawnTypeIndex}`);
        }

        const unitType = this.collections[collection][spawnType];

        // Check if typeData specifies a custom prefab
        // This allows spawn definitions to override the default collection-based prefab
        if (unitType.prefab) {
            return this.createEntityFromPrefab({
                prefab: unitType.prefab,
                type: spawnType,
                collection: collection,
                team: team,
                componentOverrides: { transform }
            });
        }

        // Ensure transform has defaults (rotation handled by addAllComponents based on team/building)
        const safeTransform = {
            position: transform?.position || { x: 0, y: 0, z: 0 },
            rotation: transform?.rotation, // Let addAllComponents set default facing
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
            const teamConfig = this.teamConfigs[team];
            const teamName = this.reverseEnums.team?.[team] || team;

            // Log unit creation with all component values
            log.debug('UnitCreation', `Creating ${spawnType}(${entity}) [${teamName}]`, {
                collection,
                spawnType,
                team,
                teamName,
                position: safeTransform.position
            });

            // OPTIMIZATION: Add all components in single batch call
            // This reduces cache invalidation from 13+ times to just once
            // Pass numeric indices for renderable component
            this.addAllComponents(entity, safeTransform, unitType, team, teamConfig, collectionIndex, spawnTypeIndex);

            // Log component details after creation
            log.trace('UnitCreation', `${spawnType}(${entity}) [${teamName}] components`, {
                health: { max: unitType.hp, current: unitType.hp },
                combat: {
                    damage: unitType.damage,
                    range: unitType.range,
                    attackSpeed: unitType.attackSpeed,
                    visionRange: unitType.visionRange,
                    projectile: unitType.projectile
                },
                speed: unitType.speed * this.SPEED_MODIFIER,
                size: unitType.size
            });

            // Schedule equipment and abilities (async to avoid blocking)
            this.schedulePostCreationSetup(entity, unitType);

            // Update statistics
            this.call.invalidateSupplyCache();
            return entity;
        } catch (error) {
            console.error('Failed to create unit:', error);
            throw new Error(`Unit creation failed: ${error.message}`);
        }
    }

    /**
     * Create an entity from a prefab definition
     * Only adds the components specified in the prefab's components array
     * @param {Object} params - Entity creation parameters
     * @param {string} params.prefab - Prefab name (e.g., 'worldObject', 'unit', 'building')
     * @param {string} params.type - Entity type within collection (e.g., 'tree_sprite', 'soldier')
     * @param {string} params.collection - Collection name (e.g., 'worldObjects', 'units')
     * @param {number} params.team - Team enum value (default: neutral)
     * @param {Object} params.componentOverrides - Component overrides (e.g., { transform: { position } })
     * @returns {number} Entity ID
     */
    createEntityFromPrefab({ prefab, type, collection, team, componentOverrides }) {
        const prefabData = this.collections.prefabs?.[prefab];
        if (!prefabData) {
            console.error(`[UnitCreationSystem] Unknown prefab: ${prefab}`);
            return null;
        }

        const typeData = this.collections[collection]?.[type];
        if (!typeData) {
            console.error(`[UnitCreationSystem] Unknown type: ${collection}/${type}`);
            return null;
        }

        // Get numeric indices for collection and type
        const collectionIndex = this.enums.objectTypeDefinitions?.[collection];
        const typeIndex = this.enums[collection]?.[type];

        if (collectionIndex === undefined || typeIndex === undefined) {
            console.error(`[UnitCreationSystem] Invalid enum indices for: ${collection}/${type}`);
            return null;
        }

        // Create entity
        const entity = this.game.createEntity();

        // Get team config
        const teamValue = team ?? this.enums.team.neutral;
        const teamConfig = this.teamConfigs[teamValue] || this.teamConfigs[this.enums.team.neutral];

        // Build only the components listed in the prefab
        const componentsToAdd = {};
        const prefabComponents = prefabData.components || [];

        for (const componentName of prefabComponents) {
            const componentData = this.buildComponentFromPrefab(
                componentName,
                typeData,
                teamValue,
                teamConfig,
                collectionIndex,
                typeIndex,
                collection,
                componentOverrides
            );
            if (componentData !== null) {
                componentsToAdd[componentName] = componentData;
            }
        }

        // Add all components in one batch
        this.game.addComponents(entity, componentsToAdd);

        // Setup abilities and equipment (same as createUnit)
        this.schedulePostCreationSetup(entity, typeData);

        return entity;
    }

    /**
     * Build a single component based on typeData and overrides
     * @param {string} name - Component name
     * @param {Object} typeData - Type definition data
     * @param {number} team - Team enum value
     * @param {Object} teamConfig - Team configuration
     * @param {number} collectionIndex - Collection enum index
     * @param {number} typeIndex - Type enum index
     * @param {string} collectionName - Collection name string
     * @param {Object} overrides - Component overrides from entity definition
     * @returns {Object} Component data
     */
    buildComponentFromPrefab(name, typeData, team, teamConfig, collectionIndex, typeIndex, collectionName, overrides) {
        const transform = overrides?.transform || {};
        const position = transform.position || { x: 0, y: 0, z: 0 };
        const scale = transform.scale || { x: 1, y: 1, z: 1 };

        // Determine rotation - buildings face Math.PI, others use team or override
        const isBuilding = collectionName === 'buildings';
        const defaultFacing = isBuilding ? Math.PI : (teamConfig?.initialFacing || 0);
        const hasExplicitRotation = transform.rotation != null;
        const rotationY = hasExplicitRotation ? (transform.rotation.y ?? defaultFacing) : defaultFacing;
        const rotationX = hasExplicitRotation ? (transform.rotation.x ?? 0) : 0;
        const rotationZ = hasExplicitRotation ? (transform.rotation.z ?? 0) : 0;

        switch (name) {
            case 'transform':
                return {
                    position: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 },
                    rotation: { x: rotationX, y: rotationY, z: rotationZ },
                    scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 }
                };

            case 'velocity':
                return {
                    vx: 0,
                    vy: 0,
                    vz: 0,
                    maxSpeed: (typeData.speed || 0) * this.SPEED_MODIFIER,
                    affectedByGravity: true,
                    anchored: collectionName === 'buildings' || collectionName === 'worldObjects'
                };

            case 'team':
                return { team: team };

            case 'unitType':
                return {
                    collection: collectionIndex,
                    type: typeIndex
                };

            case 'health':
                const maxHP = typeData.hp || this.defaults?.hp || 100;
                return { max: maxHP, current: maxHP };

            case 'combat':
                return {
                    damage: typeData.damage || 0,
                    range: typeData.range || 0,
                    attackSpeed: typeData.attackSpeed || 0,
                    projectile: typeData.projectile,
                    lastAttack: 0,
                    element: typeData.element,
                    armor: typeData.armor || 0,
                    fireResistance: typeData.fireResistance || 0,
                    coldResistance: typeData.coldResistance || 0,
                    lightningResistance: typeData.lightningResistance || 0,
                    poisonResistance: 0,
                    visionRange: typeData.visionRange || 0,
                    // Stealth/awareness system: awareness detects stealth (default 50, range 0-100)
                    awareness: typeData.awareness ?? 50,
                    stealth: typeData.stealth ?? 0
                };

            case 'collision':
                return {
                    radius: typeData.size || this.defaults?.size || 16,
                    height: typeData.height || 32
                };

            case 'aiState':
                return {
                    currentAction: null,
                    currentActionCollection: null,
                    rootBehaviorTree: this.enums.behaviorTrees?.UnitBattleBehaviorTree,
                    rootBehaviorTreeCollection: this.enums.behaviorCollection?.behaviorTrees
                };

            case 'pathfinding':
                return {
                    path: null,
                    pathIndex: 0,
                    lastPathRequest: 0,
                    useDirectMovement: false
                };

            case 'aiMovement':
                return {};

            case 'combatState':
                return {
                    lastAttacker: null,
                    lastAttackTime: 0
                };

            case 'animation':
                return {
                    scale: 1,
                    rotation: 0,
                    flash: 0
                };

            case 'equipment':
                return {
                    slots: {
                        mainHand: null,
                        offHand: null,
                        helmet: null,
                        chest: null,
                        legs: null,
                        feet: null,
                        back: null
                    }
                };

            case 'experience':
                return {
                    level: 1,
                    experience: 0,
                    experienceToNextLevel: 15,
                    squadValue: 0,
                    canLevelUp: false,
                    totalUnitsInSquad: 1,
                    lastExperienceGain: 0
                };

            case 'deathState':
                return {
                    state: this.enums.deathState?.alive || 0,
                    deathStartTime: 0,
                    deathAnimationDuration: 2,
                    corpseTime: 0,
                    teamAtDeath: 0
                };

            case 'renderable':
                return {
                    objectType: collectionIndex,
                    spawnType: typeIndex,
                    capacity: 128
                };

            // Collection-specific marker components
            case 'unit':
            case 'building':
            case 'worldObject':
                return { type: typeIndex };

            // Terrain component - level data provides world, feature flags, etc.
            case 'terrain':
                return {
                    level: typeIndex,
                    world: typeData.world,
                    cliffsEnabled: typeData.cliffsEnabled ?? true,
                    liquidsEnabled: typeData.liquidsEnabled ?? true,
                    grassEnabled: typeData.grassEnabled ?? false,
                    fogEnabled: typeData.fogEnabled ?? true,
                    shadowsEnabled: typeData.shadowsEnabled ?? true
                };

            case 'playerController':
                return {
                    isPlayer: overrides?.playerController?.isPlayer ?? 1,
                    movementSpeed: overrides?.playerController?.movementSpeed ?? typeData.speed ?? 60,
                    interactionRadius: overrides?.playerController?.interactionRadius ?? 50
                };

            case 'magicBelt':
                return {
                    slot0: overrides?.magicBelt?.slot0 ?? null,
                    slot1: overrides?.magicBelt?.slot1 ?? null,
                    slot2: overrides?.magicBelt?.slot2 ?? null,
                    selectedSlot: overrides?.magicBelt?.selectedSlot ?? -1
                };

            case 'collectible':
                return {
                    objectType: typeIndex
                };

            case 'exitZone':
                // Convert direction enum string to index if specified
                let directionEnumValue = null;
                if (typeData.exitDirection) {
                    const directionEnums = this.game.getEnums()?.direction;
                    if (directionEnums) {
                        directionEnumValue = directionEnums[typeData.exitDirection];
                    }
                }
                // Component overrides (from level entity data) take precedence over spawn definition
                const exitOverrides = overrides?.exitZone || {};
                return {
                    distance: exitOverrides.distance ?? typeData.exitDistance ?? typeData.exitRadius ?? 60,
                    directionEnum: exitOverrides.directionEnum ?? directionEnumValue,
                    directionTolerance: exitOverrides.directionTolerance ?? typeData.exitDirectionTolerance ?? 0.7,
                    nextLevel: exitOverrides.nextLevel ?? typeData.nextLevel ?? null,
                    isActive: exitOverrides.isActive ?? true
                };

            case 'mirror':
                return {
                    objectType: typeIndex
                };

            default:
                // Check if there's an override for this component
                if (overrides?.[name]) {
                    return overrides[name];
                }
                console.warn(`[UnitCreationSystem] Unknown component in prefab: ${name}`);
                return null;
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

                // Free grid cells (use entityId, not placementId)
                for (const unit of squad.squadUnits || []) {
                    this.call.releaseGridCells( unit);
                }

                // Remove from experience system
                if (squad.placementId) {
                    this.call.removeSquadExperience( squad.placementId);
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
        const squadInfo = this.call.getSquadInfoFromType( unitType);
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
            const squadData = this.call.getSquadData( unitType);
            if (!squadData) {
                return this.call.isValidGridPosition( gridPosition) ?? true;
            }

            const validation = this.call.validateSquadConfig( squadData);

            if (!validation?.valid) {
                return false;
            }

            const cells = this.call.getSquadCells( gridPosition, squadData);
            return this.call.isValidGridPlacement( cells, team) ?? true;

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
        const scale = transform.scale || { x: 1, y: 1, z: 1 };
        const maxSpeed = (unitType.speed) * this.SPEED_MODIFIER;
        const maxHP = unitType.hp || this.defaults.hp;

        // Get collection name from index for component name lookup
        const collectionName = this.reverseEnums.objectTypeDefinitions?.[collectionIndex];
        // Convert collection name to singular component name
        // e.g., "units" -> "unit", "buildings" -> "building", "worldObjects" -> "worldObject"
        const collectionComponentName = this.getCollectionComponentName(collectionName);

        // Buildings always face -X direction (Math.PI), units face based on team
        const isBuilding = collectionName === 'buildings';
        const defaultFacing = isBuilding ? Math.PI : teamConfig.initialFacing;
        // Only use transform.rotation if explicitly provided, otherwise use default facing
        const hasExplicitRotation = transform.rotation != null;
        const rotationY = hasExplicitRotation ? (transform.rotation.y ?? defaultFacing) : defaultFacing;
        const rotationX = hasExplicitRotation ? (transform.rotation.x ?? 0) : 0;
        const rotationZ = hasExplicitRotation ? (transform.rotation.z ?? 0) : 0;

        // OPTIMIZATION: Add all components in single batch call
        // This does one cache invalidation instead of 13+ separate invalidations
        const components = {
            // Core components
            transform: {
                position: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 },
                rotation: { x: rotationX, y: rotationY, z: rotationZ },
                scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 }
            },
            velocity: {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: maxSpeed,
                affectedByGravity: true,
                anchored: collectionName === 'buildings'
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
                // Convert element string to numeric enum value
                element: typeof unitType.element === 'string'
                    ? (this.enums.element?.[unitType.element] ?? this.enums.element.physical)
                    : (unitType.element ?? this.enums.element.physical),
                armor: unitType.armor,
                fireResistance: unitType.fireResistance,
                coldResistance: unitType.coldResistance,
                lightningResistance: unitType.lightningResistance,
                poisonResistance: 0,
                visionRange: unitType.visionRange,
                // Stealth/awareness system: awareness detects stealth (default 50, range 0-100)
                awareness: unitType.awareness ?? 50,
                stealth: unitType.stealth ?? 0
            },
            collision: {
                radius: unitType.size || this.defaults.size,
                height: unitType.height
            },

            // Behavior components
            aiState: {
                currentAction: null,
                currentActionCollection: null,
                rootBehaviorTree: this.enums.behaviorTrees.UnitBattleBehaviorTree,
                rootBehaviorTreeCollection: this.enums.behaviorCollection.behaviorTrees
            },
            aiMovement: {},
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
                canLevelUp: false,
                totalUnitsInSquad: 1,
                lastExperienceGain: 0
            },

            // Death state - always present, initialized to alive
            // This prevents stale TypedArray data from recycled entity IDs
            deathState: {
                state: this.enums.deathState.alive,
                deathStartTime: 0,
                deathAnimationDuration: 2,
                corpseTime: 0,
                teamAtDeath: 0
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
                        await this.call.equipItem(
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
                if (this.game.hasService('addAbilitiesToUnit')) {
                    this.call.addAbilitiesToUnit( entityId, validAbilities);
                }
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
            const height = this.call.getTerrainHeightAtPosition( worldX, worldZ);
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
