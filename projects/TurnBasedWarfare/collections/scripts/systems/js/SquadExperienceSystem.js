class SquadExperienceSystem extends GUTS.BaseSystem {
    static services = [
        'canAffordLevelUp',
        'applySpecialization',
        'levelUpSquad',
        'getLevelUpCost',
        'initializeSquad',
        'removeSquad',
        'getSquadsReadyToLevelUp',
        'showSpecializationSelection',
        'findSquadByUnitId',
        'getCurrentUnitType',
        'getSquadInfo',
        'setSquadInfo',
        'resetSquadExperience'
    ];

    constructor(game) {
        super(game);
        this.game.squadExperienceSystem = this;

        // Experience configuration
        this.config = {
            experiencePerLevel: 15,     // Base experience needed per level
            maxLevel: 10,                // Maximum squad level
            levelUpCostRatio: 0.5,       // Cost to level up = squad value * ratio
            experienceMultiplier: 1.0,   // Global experience gain multiplier
            baselineXPPerSecond: 1,   // tune: ~1–3% of a cheap unit's value per 10s
            baselineXPCombatOnly: true  // only tick during combat phase
        };

        // Level bonuses (applied to all units in squad)
        this.levelBonuses = {
            1: { hp: 1.0, damage: 1.0, name: "Rookie" },
            2: { hp: 1.15, damage: 1.15, name: "Veteran" },
            3: { hp: 1.3, damage: 1.3, name: "Ascended" },
            4: { hp: 1.4, damage: 1.4, name: "Elite" },
            5: { hp: 1.5, damage: 1.5, name: "Champion" },
            6: { hp: 1.6, damage: 1.6, name: "Legendary" },
            7: { hp: 1.7, damage: 1.7, name: "Mythic" },
            8: { hp: 1.8, damage: 1.8, name: "Holy" },
            9: { hp: 1.9, damage: 1.9, name: "Transcendent" },
            10: { hp: 2.0, damage: 2.0, name: "Godlike" }
        };

        // UI update throttling
        this.lastUIUpdate = 0;
        this.UI_UPDATE_INTERVAL = 500; // Update UI every 500ms

    }

    init() {
    }

    // Alias for service name
    resetSquadExperience() {
        return this.reset();
    }

    /**
     * Get experience data from the first unit in the squad
     * Experience is stored on individual unit entities
     * @param {number} placementId - Placement ID
     * @returns {Object|null} Experience data
     */
    getSquadExperience(placementId) {
        const unitIds = this.getSquadUnits(placementId);
        if (!unitIds.length) return null;
        // Get experience from first unit (all units in squad share same experience values)
        return this.game.getComponent(unitIds[0], 'experience') || null;
    }

    /**
     * Set experience data on all unit entities in the squad
     * @param {number} placementId - Placement ID
     * @param {Object} experienceData - Experience data to store
     */
    setSquadExperience(placementId, experienceData) {
        const unitIds = this.getSquadUnits(placementId);
        if (!unitIds.length) return false;

        for (const entityId of unitIds) {
            const existing = this.game.getComponent(entityId, 'experience');
            if (existing && experienceData) {
                Object.assign(existing, experienceData);
            }
        }
        return true;
    }

    /**
     * Get all squads with experience data for iteration
     * @returns {Array} Array of {placementId, experience} objects
     */
    getAllSquadsWithExperience() {
        const squads = [];
        const placements = this.game.getEntitiesWith('placement');
        for (const entityId of placements) {
            const placement = this.game.getComponent(entityId, 'placement');
            if (placement && placement.squadUnits?.length > 0) {
                const experience = this.game.getComponent(placement.squadUnits[0], 'experience');
                if (experience) {
                    squads.push({
                        placementId: placement.placementId,
                        experience: experience
                    });
                }
            }
        }
        return squads;
    }

    /**
     * Get squad unit IDs for a placement from PlacementSystem
     * @param {number} placementId - Placement ID
     * @returns {Array} Array of unit entity IDs
     */
    getSquadUnits(placementId) {
        const placement = this.game.call('getPlacementById', placementId);
        return placement?.squadUnits || [];
    }

    /**
     * Initialize experience tracking for a new squad
     * Experience components already exist on units from UnitCreationSystem,
     * this updates them with squad-specific values
     * @param {number} placementId - Unique placement identifier
     * @param {Object} unitType - Unit type definition (not squadData)
     * @param {Array} unitIds - Array of entity IDs in the squad (used for initial count)
     */
    initializeSquad(placementId, unitType, unitIds) {
        // Check if already initialized with squad-specific values
        const existingData = this.getSquadExperience(placementId);
        if (existingData && existingData.squadValue > 0) {
            // Already initialized, just apply level bonuses
            this.applyLevelBonuses(placementId);
            return existingData;
        }

        // Update experience components on all units with squad-specific values
        const squadValue = this.calculateSquadValue(unitType);
        const squadSize = unitIds.length;

        const experienceData = {
            level: 1,
            experience: 0,
            experienceToNextLevel: this.calculateExperienceNeeded(0),
            squadValue: squadValue,
            canLevelUp: false,
            totalUnitsInSquad: squadSize,
            lastExperienceGain: 0
        };

        // Update experience component on all units in squad
        this.setSquadExperience(placementId, experienceData);

        // Apply initial bonuses if any
        this.applyLevelBonuses(placementId);
        return experienceData;
    }
    /**
     * Add experience to a squad
     * @param {string} placementId - Squad placement ID
     * @param {number} experience - Experience to add
     */
    addExperience(placementId, experience) {
        const squadData = this.getSquadExperience(placementId);
        if (!squadData) return;

        // Don't gain experience if already at max level or ready to level up
        if (squadData.level >= this.config.maxLevel || squadData.canLevelUp) {
            return;
        }

        squadData.experience += experience;
        squadData.lastExperienceGain = this.game.state.now;

        // Check if squad can level up
        if (squadData.experience >= squadData.experienceToNextLevel) {
            squadData.canLevelUp = true;
            // Stop gaining experience until manually leveled up
            squadData.experience = squadData.experienceToNextLevel;
        }

        // Update UI periodically
        if (this.game.state.now - this.lastUIUpdate > this.UI_UPDATE_INTERVAL) {
            this.updateSquadUI();
            this.lastUIUpdate = this.game.state.now;
        }
    }
    getLevelUpCost(placementId){
        const squadData = this.getSquadExperience(placementId);
        if(squadData){
            return this.getLevelUpCostBySquadValue(squadData.squadValue);
        }
        return -1;
    }
    getLevelUpCostBySquadValue(squadValue){
        return Math.floor(squadValue * this.config.levelUpCostRatio);
    }
    canAffordLevelUp(placementId, playerGold){
                
        const levelUpCost = this.getLevelUpCost(placementId);

         if (levelUpCost < 0 || playerGold < levelUpCost) {    
            return false;
         }
         return true;
    }
    /**
     * Level up a squad (only during placement phase)
     * @param {string} placementId - Squad placement ID
     * @param {string} specializationId - Optional specialization unit ID (for level 3+)
     * @returns {boolean} Success status
     */
    async levelUpSquad(placementId, specializationId = null, playerId = null, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false);
            return;
        }

        const squadData = this.getSquadExperience(placementId);
        if (!squadData || !squadData.canLevelUp) {
            callback(false);
            return;
        }        
                        
        // Check for specialization selection UI (unchanged)
        const isSpecializationLevel = squadData.level >= 2;
        const currentUnitType = this.getCurrentUnitType(placementId);
        const hasSpecializations = currentUnitType && currentUnitType.specUnits && currentUnitType.specUnits.length > 0;
        if (!this.game.isServer && isSpecializationLevel && hasSpecializations && !specializationId) {
            this.showSpecializationSelection(placementId, squadData, callback);
            return;
        }
        
        
        try {
            if (!this.game.isServer) {
                // Handle specialization case
                if (specializationId && isSpecializationLevel && hasSpecializations) {
                    const success = await this.makeNetworkCall('LEVEL_SQUAD', 
                        { placementId, specializationId }, 'SQUAD_LEVELED');
       
                    if (!success) {
                        callback(false);
                    } 
                    this.applySpecialization(placementId, specializationId, playerId);
                } else {
                    // Handle regular level up
                    const success = await this.makeNetworkCall('LEVEL_SQUAD', 
                        { placementId }, 'SQUAD_LEVELED');
                    
                    if (!success) {
                        callback(false);
                    }
                }
            } 
                
            // Deduct cost optimistically
            callback(this.finishLevelingSquad(squadData, placementId, specializationId));
            
        } catch (error) {
            // Refund gold on any error
            callback(false);
        }
    }

    // Helper method to promisify network calls
    makeNetworkCall(action, data, expectedResponse) {
        return new Promise((resolve, reject) => {
            this.game.clientNetworkManager.call(action, data, expectedResponse, (responseData, error) => {
                if(responseData && responseData.success) {
                    resolve(responseData);
                } else {
                    reject(error);
                }
            });
        });
    }

    finishLevelingSquad(squadData, placementId, specializationId) {
        // Level up
        squadData.level++;
        squadData.experience = 0;
        squadData.experienceToNextLevel = this.calculateExperienceNeeded(squadData.level);
        squadData.canLevelUp = false;
        
        // Apply level bonuses to all units in squad
        this.applyLevelBonuses(placementId);
        
        const levelUpCost = this.getLevelUpCost(placementId);
        this.game.call('deductPlayerGold', levelUpCost);
            
        // Visual effects
        const unitIds = this.getSquadUnits(placementId);
        unitIds.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            if (pos) {
                const effectType = specializationId ? 'magic' : 'heal';
                this.game.call('createParticleEffect',
                    pos.x, pos.y + 20, pos.z,
                    effectType,
                    { count: 3, speedMultiplier: specializationId ? 1.5 : 1.2 }
                );
            }
        });
        return true;
    }
    
    /**
     * Apply specialization transformation to a squad
     * Uses the shared replaceUnit pipeline from BaseNetworkSystem
     * @param {string} placementId - Squad placement ID
     * @param {string} specializationId - Specialization unit type ID
     * @returns {boolean} Success status
     */
    applySpecialization(placementId, specializationId) {
        const squadData = this.getSquadExperience(placementId);
        if (!squadData) return false;

        // Get the specialization unit type
        if (!this.collections?.units?.[specializationId]) {
            console.error(`Specialization unit type ${specializationId} not found`);
            return false;
        }

        const specializationUnitType = this.collections.units[specializationId];

        // Find the placement in PlacementSystem
        const placement = this.game.call('getPlacementById', placementId);
        if (!placement) {
            console.error(`Placement ${placementId} not found`);
            return false;
        }

        // Verify replaceUnit service is available
        if (!this.game.hasService('replaceUnit')) {
            console.error('replaceUnit service not available');
            return false;
        }

        // Replace all units in the squad with the new unit type
        const oldUnitIds = [...this.getSquadUnits(placementId)];

        oldUnitIds.forEach(entityId => {
            // Use shared replaceUnit - no animation for specialization
            this.game.call('replaceUnit', entityId, specializationId);
        });

        // Update squad value based on new unit type
        squadData.squadValue = this.calculateSquadValue(specializationUnitType);

        return true;
    }
    
    /**
     * Show specialization selection UI
     * @param {string} placementId - Squad placement ID
     * @param {Object} squadData - Squad experience data
     */
    showSpecializationSelection(placementId, squadData, callback) {
        const currentUnitType = this.getCurrentUnitType(placementId, squadData.team);
        if (!currentUnitType || !currentUnitType.specUnits) return;
        
        
        // Create specialization selection modal
        const modal = document.createElement('div');
        modal.className = 'specialization-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.8); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(145deg, #1a1a2e, #16213e);
            border: 2px solid #ffaa00; border-radius: 10px;
            padding: 20px; max-width: 600px; width: 90%;
            color: #fff; text-align: center;
        `;
        
        const squadName = this.getSquadDisplayName(placementId);
        content.innerHTML = `
            <h3 style="color: #ffaa00; margin-bottom: 15px;">⭐ SPECIALIZATION AVAILABLE! ⭐</h3>
            <p style="margin-bottom: 20px;">Choose a specialization for your ${squadName}:</p>
            <div id="specialization-options" style="margin-bottom: 20px;"></div>
            <button id="cancel-specialization" style="
                background: #666; color: #fff; border: none; padding: 8px 16px;
                border-radius: 4px; cursor: pointer; margin-right: 10px;
            ">Cancel</button>
        `;
        
        modal.appendChild(content);
        
        // Add specialization options
        const optionsContainer = content.querySelector('#specialization-options');
        currentUnitType.specUnits.forEach(specId => {
            const specUnit = this.collections.units[specId];
            if (specUnit) {
                const optionButton = document.createElement('button');
                optionButton.style.cssText = `
                    display: block; width: 100%; margin: 8px 0; padding: 12px;
                    background: linear-gradient(135deg, #006600, #008800);
                    color: white; border: 1px solid #00aa00; border-radius: 4px;
                    cursor: pointer; transition: all 0.2s ease;
                `;
                
                const squadValue = this.calculateSquadValue(specUnit);
                const levelUpCost = this.getLevelUpCostBySquadValue(squadValue);
                optionButton.innerHTML = `
                    <strong>${specUnit.title || specId}</strong><br>
                    <small style="opacity: 0.8;">${specUnit.hp || 100} HP, ${specUnit.damage || 10} DMG - Cost: ${levelUpCost}g</small>
                `;
                
                optionButton.addEventListener('click', () => {
                    document.body.removeChild(modal);
                    this.levelUpSquad(placementId, specId, null, callback);
                });
                
                optionButton.addEventListener('mouseenter', () => {
                    optionButton.style.background = 'linear-gradient(135deg, #008800, #00aa00)';
                    optionButton.style.transform = 'translateY(-2px)';
                });
                
                optionButton.addEventListener('mouseleave', () => {
                    optionButton.style.background = 'linear-gradient(135deg, #006600, #008800)';
                    optionButton.style.transform = 'translateY(0)';
                });
                
                optionsContainer.appendChild(optionButton);
            }
        });
        
        // Cancel button
        content.querySelector('#cancel-specialization').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // Close on escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(modal);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        document.body.appendChild(modal);
    }
    
    /**
     * Get the current unit type for a squad
     * @param {string} placementId - Squad placement ID
     * @returns {Object|null} Unit type or null if not found
     */
    getCurrentUnitType(placementId) {
        // Find placement by ID from entity data
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            const placement = this.game.getComponent(entityId, 'placement');
            if (placement && placement.placementId === placementId && placement.squadUnits?.length > 0) {
                const unitTypeComp = this.game.getComponent(placement.squadUnits[0], 'unitType');
                return this.game.call('getUnitTypeDef', unitTypeComp);
            }
        }
        return null;
    }

    /**
     * Get team for a placement from the first unit's team component
     * @param {string} placementId - Squad placement ID
     * @returns {string|null} Team identifier or null
     */
    getPlacementTeam(placementId) {
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            const placement = this.game.getComponent(entityId, 'placement');
            if (placement && placement.placementId === placementId && placement.squadUnits?.length > 0) {
                const teamComp = this.game.getComponent(placement.squadUnits[0], 'team');
                return teamComp?.team || null;
            }
        }
        return null;
    }
    
    /**
     * Apply level bonuses to all units in a squad
     * @param {string} placementId - Squad placement ID
     */
    applyLevelBonuses(placementId) {
        const squadData = this.getSquadExperience(placementId);
        if (!squadData || squadData.level <= 1) {
            return;
        }

        const bonuses = this.levelBonuses[squadData.level];
        if (!bonuses) {
            return;
        }

        const unitIds = this.getSquadUnits(placementId);
        unitIds.forEach(entityId => {
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (unitType) {
                const baseUnitData = unitType;
            
                // Apply health bonus
                const health = this.game.getComponent(entityId, "health");
                if (health && bonuses.hp > 1) {
                    const newMaxHealth = Math.floor(baseUnitData.hp * bonuses.hp);
                    const healthIncrease = newMaxHealth - health.max;
                    health.max = newMaxHealth;
                    health.current += healthIncrease; // Also increase current health
                }
                
                // Apply damage bonus
                const combat = this.game.getComponent(entityId, "combat");
                if (combat && bonuses.damage > 1) {
                    combat.damage = Math.floor(baseUnitData.damage * bonuses.damage);
                }
                
                // Visual indicator (flash effect)
                const animation = this.game.getComponent(entityId, "animation");
                if (animation) {
                    animation.flash = 0.8;
                }
            }
        });
    }
    
    /**
     * Calculate total health of all units in a squad
     * @param {string} placementId - Squad placement ID
     * @returns {number} Total health
     */
    calculateSquadTotalHealth(placementId) {
        const unitIds = this.getSquadUnits(placementId);
        if (!unitIds.length) return 100; // Default fallback

        let totalHealth = 0;

        unitIds.forEach(entityId => {
            const health = this.game.getComponent(entityId, "health");
            if (health) {
                totalHealth += health.max;
            }
        });

        return Math.max(1, totalHealth); // Avoid division by zero
    }
    
    /**
     * Calculate squad value based on unit type
     * @param {Object} unitType - Unit type definition
     * @returns {number} Squad value (just the unit's base cost)
     */
    calculateSquadValue(unitType) {
        return unitType.value || 0;
    }
    
    /**
     * Calculate experience needed for next level
     * @param {number} currentLevel - Current level
     * @returns {number} Experience needed
     */
    calculateExperienceNeeded(currentLevel) {
        // Exponential scaling: level 1 = 100, level 2 = 150, level 3 = 225, etc.
        return Math.floor(this.config.experiencePerLevel * Math.pow(1.5, currentLevel));
    }
    
    /**
     * Find squad data by unit entity ID
     * @param {number} entityId - Unit entity ID
     * @returns {Object|null} Squad experience data
     */
    findSquadByUnitId(entityId) {
        for (const squad of this.getAllSquadsWithExperience()) {
            const unitIds = this.getSquadUnits(squad.placementId);
            if (unitIds.includes(entityId)) {
                return squad.experience;
            }
        }
        return null;
    }
    
    /**
     * Get display name for a squad
     * @param {string} placementId - Squad placement ID
     * @returns {string} Display name
     */
    getSquadDisplayName(placementId) {
        // Try to get the name from placement system - get unitType from entity
        const playerPlacements = this.game.call('getPlacementsForSide', this.game.call('getActivePlayerTeam'));
        if (playerPlacements) {
            const placement = playerPlacements.find(p => p.placementId === placementId);
            if (placement && placement.squadUnits && placement.squadUnits.length > 0) {
                const unitTypeComp = this.game.getComponent(placement.squadUnits[0], 'unitType');
                const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
                if (unitType) {
                    return unitType.title || unitType.id || 'Squad';
                }
            }
        }

        const enemyPlacements = this.game.call('getOpponentPlacements');
        if (enemyPlacements) {
            const enemyPlacement = enemyPlacements.find(p => p.placementId === placementId);
            if (enemyPlacement && enemyPlacement.squadUnits && enemyPlacement.squadUnits.length > 0) {
                const unitTypeComp = this.game.getComponent(enemyPlacement.squadUnits[0], 'unitType');
                const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
                if (unitType) {
                    return unitType.title || unitType.id || 'Enemy Squad';
                }
            }
        }

        return `Squad ${placementId.slice(-4)}`;
    }
    
    /**
     * Get level bonus name
     * @param {number} level - Squad level
     * @returns {string} Bonus name
     */
    getLevelBonusName(level) {
        return this.levelBonuses[level]?.name || '';
    }
    
    /**
     * Update squad experience UI
     */
    updateSquadUI() {
        // This method could update a dedicated squad experience panel
        // For now, we'll just ensure the shop system can access this data
        this.game.call('updateSquadExperience');
    }
    
    /**
     * Get all player squads that can level up
     * @returns {Array} Array of squad data that can level up
     */
    getSquadsReadyToLevelUp() {
        const readySquads = [];

        for (const squad of this.getAllSquadsWithExperience()) {
            const squadData = squad.experience;
            const team = this.getPlacementTeam(squad.placementId);
            if (squadData.canLevelUp && team === this.game.call('getActivePlayerTeam')) {
                readySquads.push({
                    ...squadData,
                    placementId: squad.placementId,
                    displayName: this.getSquadDisplayName(squad.placementId),
                    levelUpCost: Math.floor(squadData.squadValue * this.config.levelUpCostRatio),
                    nextLevelName: this.getLevelBonusName(squadData.level + 1)
                });
            }
        }

        return readySquads;
    }
    
    /**
     * Get squad experience info for display
     * @param {string} placementId - Squad placement ID
     * @returns {Object} Experience info
     */
    getSquadInfo(placementId) {
        return this.getSquadExperience(placementId);
    }

    setSquadInfo(placementId, placementExperience){
        if(placementExperience){
            this.setSquadExperience(placementId, placementExperience);
            this.applyLevelBonuses(placementId);
        }
    }

    getExperienceFromPlacements(placements){
        let experience = {};
        placements.forEach((placement) => {
            experience[placement.placementId] = this.getSquadInfo(placement.placementId)
        });
        return experience;
    }
    
    /**
     * Clean up squad data when units are destroyed
     * Experience components are removed when units are destroyed
     * @param {number} placementId - Squad placement ID
     */
    removeSquad(placementId) {
        // Experience components are automatically cleaned up when units are destroyed
        // No additional cleanup needed
    }

    /**
     * Update method called each frame
     */
    update() {
        this.tickBaselineXP();
    }

    tickBaselineXP() {
        // Optional: restrict to combat only
        if (this.config.baselineXPCombatOnly && this.game?.state?.phase !== this.enums.gamePhase.battle) return;

        for (const squad of this.getAllSquadsWithExperience()) {
            const squadData = squad.experience;
            // Respect caps: no gain if at max or waiting for manual level-up
            if (squadData.level >= this.config.maxLevel || squadData.canLevelUp) continue;

            const unitsAlive = this.unitsAliveInSquad(squad.placementId);
            if (unitsAlive > 0) {
                const squadLivingRatio = unitsAlive / squadData.totalUnitsInSquad;
                const xp = squadLivingRatio * this.config.baselineXPPerSecond * this.game.state.deltaTime * this.config.experienceMultiplier;
                if (xp > 0) this.addExperience(squad.placementId, xp);
            }
        }
    }

    unitsAliveInSquad(placementId) {
        const unitIds = this.getSquadUnits(placementId);
        if (!unitIds.length) return 0;
        let count = 0;
        for (const id of unitIds) {
            const h = this.game.getComponent(id, "health");
            if (h && h.current > 0) count++;
        }
        return count;
    }

    /**
     * Clean up experience data for squads with dead/missing units
     * No longer needed since unitIds are queried dynamically
     */
    onPlacementPhaseStart() {
        // unitIds are now retrieved dynamically via getSquadUnits
        // so no cleanup is needed here
    }

    /**
     * Reset all experience data (for new game)
     * Resets experience components on all units to default values
     */
    reset() {
        const defaultExperience = {
            level: 1,
            experience: 0,
            experienceToNextLevel: this.calculateExperienceNeeded(0),
            squadValue: 0,
            canLevelUp: false,
            totalUnitsInSquad: 1,
            lastExperienceGain: 0
        };
        for (const squad of this.getAllSquadsWithExperience()) {
            this.setSquadExperience(squad.placementId, defaultExperience);
        }
    }

    /**
     * Get debug information
     * @returns {Object} Debug info
     */
    getDebugInfo() {
        const enums = this.game.getEnums();
        const TEAM_LEFT = enums.team.left;
        const TEAM_RIGHT = enums.team.right;
        const allSquads = this.getAllSquadsWithExperience();
        const squads = allSquads.map(s => ({
            ...s.experience,
            team: this.getPlacementTeam(s.placementId)
        }));
        return {
            totalSquads: squads.length,
            leftSquads: squads.filter(s => s.team === TEAM_LEFT).length,
            rightSquads: squads.filter(s => s.team === TEAM_RIGHT).length,
            squadsReadyToLevelUp: squads.filter(s => s.canLevelUp).length,
            averageLevel: squads.length > 0 ? squads.reduce((sum, s) => sum + s.level, 0) / squads.length : 0,
            maxLevel: Math.max(0, ...squads.map(s => s.level))
        };
    }
}
