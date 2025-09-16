class SquadExperienceSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.squadExperienceSystem = this;
        
        // Squad experience tracking
        this.squadExperience = new Map(); // placementId -> experience data
        this.savedSquadExperience = new Map(); // placementId -> saved experience data
        
        // Experience configuration
        this.config = {
            experiencePerLevel: 15,     // Base experience needed per level
            maxLevel: 10,                // Maximum squad level
            levelUpCostRatio: 0.5,       // Cost to level up = squad value * ratio
            experienceMultiplier: 1.0,   // Global experience gain multiplier
            baselineXPPerSecond: 1,   // tune: ~1–3% of a cheap unit’s value per 10s
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
            8: { hp: 1.8, damage: 1.8, name: "Divine" },
            9: { hp: 1.9, damage: 1.9, name: "Transcendent" },
            10: { hp: 2.0, damage: 2.0, name: "Godlike" }
        };
        
        // UI update throttling
        this.lastUIUpdate = 0;
        this.UI_UPDATE_INTERVAL = 500; // Update UI every 500ms
        
    }
    
    /**
     * Initialize experience tracking for a new squad
     * @param {string} placementId - Unique placement identifier
     * @param {Object} unitType - Unit type definition (not squadData)
     * @param {Array} unitIds - Array of entity IDs in the squad
     * @param {string} team - Team identifier
     */
    initializeSquad(placementId, unitType, unitIds, team) {
        // Check if we already have experience data for this placement ID
        const existingData = this.squadExperience.get(placementId);
        if (existingData) {
       
            // Update unit IDs and size for respawned squad
            existingData.unitIds = [...unitIds];
            existingData.squadSize = unitIds.length;
            
            // Apply level bonuses to new units
            this.applyLevelBonuses(placementId);
            return existingData;
        }
        
        // Create new squad data
        const squadValue = this.calculateSquadValue(unitType);
        
        const experienceData = {
            placementId: placementId,
            level: 1,
            experience: 0,
            experienceToNextLevel: this.calculateExperienceNeeded(0),
            squadValue: squadValue,
            unitIds: [...unitIds],
            team: team,
            squadSize: unitIds.length,
            canLevelUp: false,
            totalUnitsInSquad: unitIds.length, // Just use actual unit count
            lastExperienceGain: 0,
            creationTime: this.game.state.now
        };
        
        this.squadExperience.set(placementId, experienceData);
        
        // Try to restore saved experience for player squads
  
        this.restoreSquadExperience(placementId, experienceData);
        
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
        const squadData = this.squadExperience.get(placementId);
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
        
        const squadData = this.squadExperience.get(placementId);
        if(squadData){
            const levelUpCost = Math.floor(squadData.squadValue * this.config.levelUpCostRatio);

            return levelUpCost;
        } else {
            return -1;
        }
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
    async levelUpSquad(placementId, specializationId = null, playerId = null) {
        if (this.game.state.phase !== 'placement') {
            console.log("incorrect phase to level up");
            return false;
        }
        
        const squadData = this.squadExperience.get(placementId);
        if (!squadData || !squadData.canLevelUp) {
            console.log("squad cant level up", placementId, squadData, this.squadExperience);
            return false;
        }
        const levelUpCost = Math.floor(squadData.squadValue * this.config.levelUpCostRatio);

        // Check for specialization selection UI (unchanged)
        const isSpecializationLevel = squadData.level >= 2;
        const currentUnitType = this.getCurrentUnitType(placementId, squadData.team);
        const hasSpecializations = currentUnitType && currentUnitType.specUnits && currentUnitType.specUnits.length > 0;
        if (!this.game.isServer && isSpecializationLevel && hasSpecializations && !specializationId) {
            this.showSpecializationSelection(placementId, squadData, levelUpCost);
            console.log('showing spec selection');
            return false;
        }
        
        
        console.log('leveling squad for cost', levelUpCost);
        try {
            if (!this.game.isServer) {
                // Handle specialization case
                if (specializationId && isSpecializationLevel && hasSpecializations) {
                    const success = await this.makeNetworkCall('APPLY_SPECIALIZATION', 
                        { placementId, specializationId }, 'SPECIALIZATION_APPLIED');
                    
                    const success2 = await this.makeNetworkCall('LEVEL_SQUAD', 
                        { placementId }, 'SQUAD_LEVELED');

                    
                    if (!success && success2) {
                        console.log('no success making network call apply_spec or level_squad');
                        return false;
                    } 
                    this.applySpecialization(placementId, specializationId, playerId);
                } else {
                    // Handle regular level up
                    const success = await this.makeNetworkCall('LEVEL_SQUAD', 
                        { placementId }, 'SQUAD_LEVELED');
                    
                    if (!success) {
                        console.log('no success making network call level_squad');
                        return false;
                    }
                }
            } 
                
            // Deduct cost optimistically
            return this.finishLevelingSquad(squadData, placementId, levelUpCost, specializationId);
            
        } catch (error) {
            // Refund gold on any error
            console.log('failed to level squad', error);
            return false;
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

    finishLevelingSquad(squadData, placementId, levelUpCost, specializationId) {
        console.log('finishLevelingSquad');
        // Level up
        squadData.level++;
        squadData.experience = 0;
        squadData.experienceToNextLevel = this.calculateExperienceNeeded(squadData.level);
        squadData.canLevelUp = false;
        
        // Apply level bonuses to all units in squad
        this.applyLevelBonuses(placementId);

        this.game.state.playerGold -= levelUpCost;
            
        // Visual effects
        if (this.game.effectsSystem) {
            squadData.unitIds.forEach(entityId => {
                const pos = this.game.getComponent(entityId, this.game.componentManager.getComponentTypes().POSITION);
                if (pos) {
                    const effectType = specializationId ? 'magic' : 'heal';
                    const particleCount = specializationId ? 12 : 8;
                    this.game.effectsSystem.createParticleEffect(
                        pos.x, pos.y + 20, pos.z,
                        effectType,
                        { count: particleCount, speedMultiplier: specializationId ? 1.5 : 1.2 }
                    );
                }
            });
        }
        return true;
    }
    
    /**
     * Apply specialization transformation to a squad
     * @param {string} placementId - Squad placement ID
     * @param {string} specializationId - Specialization unit type ID
     * @returns {boolean} Success status
     */
    applySpecialization(placementId, specializationId, playerId) {
        const squadData = this.squadExperience.get(placementId);
        if (!squadData) return false;
        
        // Get the specialization unit type
        const collections = this.game.getCollections();
        if (!collections || !collections.units || !collections.units[specializationId]) {
            console.error(`Specialization unit type ${specializationId} not found`);
            return false;
        }
        
        const specializationUnitType = collections.units[specializationId];
        
        // Find the placement in PlacementSystem to update the unit type
        if (!this.game.placementSystem) {
            console.error('PlacementSystem not found');
            return false;
        }
        
        const placement = this.game.placementSystem.getPlacementById(placementId);
        if (!placement) {
            console.error(`Placement ${placementId} not found`);
            return false;
        }
        
        // Update the placement's unit type
        const oldUnitType = placement.unitType;
        placement.unitType = { id: specializationId, ...specializationUnitType };
        
        // Recreate all units in the squad with the new unit type
        const componentTypes = this.game.componentManager.getComponentTypes();
        const newUnitIds = [];
        
        console.log('applying specialization to ', squadData, squadData.unitIds);
        console.log('placement', placement);
        // Store positions of old units
        const positions = [];
        squadData.unitIds.forEach(entityId => {
            const pos = this.game.getComponent(entityId, componentTypes.POSITION);
            if (pos) {
                positions.push({ x: pos.x, y: pos.y, z: pos.z });
            }
            // Destroy old unit
            if (this.game.destroyEntity) {
                this.game.destroyEntity(entityId);
            }
        });
        
        // Create new specialized units at the same positions
        positions.forEach(pos => {
            const terrainHeight = this.game.unitCreationManager.getTerrainHeight(pos.x, pos.z);
            const unitY = terrainHeight !== null ? terrainHeight : pos.y;
            
            const entityId = this.game.unitCreationManager.create(
                pos.x, unitY, pos.z, 
                placement.unitType, 
                squadData.team
            );
            console.log('created new unit', placement.unitType, entityId);
            newUnitIds.push(entityId);
        });
        
        // Update squad data with new unit IDs
        squadData.unitIds = newUnitIds;
        
        // Update squad value based on new unit type
        squadData.squadValue = this.calculateSquadValue(placement.unitType);
            // Refresh shop
        if (this.game.shopSystem) {
            this.game.shopSystem.createShop();
        }
        return true;
    }
    
    /**
     * Show specialization selection UI
     * @param {string} placementId - Squad placement ID
     * @param {Object} squadData - Squad experience data
     * @param {number} levelUpCost - Cost to level up
     */
    showSpecializationSelection(placementId, squadData, levelUpCost) {
        const currentUnitType = this.getCurrentUnitType(placementId, squadData.team);
        if (!currentUnitType || !currentUnitType.specUnits) return;
        
        const collections = this.game.getCollections();
        if (!collections || !collections.units) return;
        
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
            const specUnit = collections.units[specId];
            if (specUnit) {
                const optionButton = document.createElement('button');
                optionButton.style.cssText = `
                    display: block; width: 100%; margin: 8px 0; padding: 12px;
                    background: linear-gradient(135deg, #006600, #008800);
                    color: white; border: 1px solid #00aa00; border-radius: 4px;
                    cursor: pointer; transition: all 0.2s ease;
                `;
                
                optionButton.innerHTML = `
                    <strong>${specUnit.title || specId}</strong><br>
                    <small style="opacity: 0.8;">${specUnit.hp || 100} HP, ${specUnit.damage || 10} DMG - Cost: ${levelUpCost}g</small>
                `;
                
                optionButton.addEventListener('click', () => {
                    document.body.removeChild(modal);
                    this.levelUpSquad(placementId, specId);
                    
        
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
    getCurrentUnitType(placementId, side) {
        if (!this.game.placementSystem) return null;
        const placements = this.game.placementSystem.getPlacementsForSide(side);
        const placement = placements.find(p => p.placementId === placementId);
        return placement ? placement.unitType : null;
    }
    
    /**
     * Apply level bonuses to all units in a squad
     * @param {string} placementId - Squad placement ID
     */
    applyLevelBonuses(placementId) {
        const squadData = this.squadExperience.get(placementId);
        if (!squadData || squadData.level <= 1) {
            return;
        }
        
        const bonuses = this.levelBonuses[squadData.level];
        if (!bonuses) {
            return;
        }
        
        const componentTypes = this.game.componentManager.getComponentTypes();
        squadData.unitIds.forEach(entityId => {
            const unitType = this.game.getComponent(entityId, componentTypes.UNIT_TYPE);
            if (unitType) {
                const baseUnitData = this.game.getCollections().units[unitType.id];
            
                // Apply health bonus
                const health = this.game.getComponent(entityId, componentTypes.HEALTH);
                if (health && bonuses.hp > 1) {
                    const newMaxHealth = Math.floor(baseUnitData.hp * bonuses.hp);
                    const healthIncrease = newMaxHealth - health.max;
                    health.max = newMaxHealth;
                    health.current += healthIncrease; // Also increase current health
                }
                
                // Apply damage bonus
                const combat = this.game.getComponent(entityId, componentTypes.COMBAT);
                if (combat && bonuses.damage > 1) {
                    combat.damage = Math.floor(baseUnitData.damage * bonuses.damage);
                }
                
                // Visual indicator (flash effect)
                const animation = this.game.getComponent(entityId, componentTypes.ANIMATION);
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
        const squadData = this.squadExperience.get(placementId);
        if (!squadData) return 100; // Default fallback
        
        const componentTypes = this.game.componentManager.getComponentTypes();
        let totalHealth = 0;
        
        squadData.unitIds.forEach(entityId => {
            const health = this.game.getComponent(entityId, componentTypes.HEALTH);
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
        for (const [placementId, squadData] of this.squadExperience.entries()) {
            if (squadData.unitIds.includes(entityId)) {
                return squadData;
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
        // Try to get the name from placement system
        if (this.game.placementSystem) {
            const playerPlacements = this.game.placementSystem.getPlacementsForSide(this.game.state.mySide);
            const placement = playerPlacements.find(p => p.placementId === placementId);
            if (placement && placement.unitType) {
                return placement.unitType.title || placement.unitType.id || 'Squad';
            }
            
            const enemyPlacements = this.game.placementSystem.enemyPlacements;
            const enemyPlacement = enemyPlacements.find(p => p.placementId === placementId);
            if (enemyPlacement && enemyPlacement.unitType) {
                return enemyPlacement.unitType.title || enemyPlacement.unitType.id || 'Enemy Squad';
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
        if (this.game.shopSystem && this.game.shopSystem.updateSquadExperience) {
            this.game.shopSystem.updateSquadExperience();
        }
    }
    
    /**
     * Get all player squads that can level up
     * @returns {Array} Array of squad data that can level up
     */
    getSquadsReadyToLevelUp() {
        const readySquads = [];
        
        for (const [placementId, squadData] of this.squadExperience.entries()) {
            if (squadData.canLevelUp && squadData.team == this.game.state.mySide) {
                readySquads.push({
                    ...squadData,
                    displayName: this.getSquadDisplayName(placementId),
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
        return this.squadExperience.get(placementId);        
    }

    setSquadInfo(placementId, placementExperience){
        if(placementExperience){
            this.squadExperience.set(placementId, placementExperience);
            console.log('applying opponent level bonuses', placementId);
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
     * MODIFIED: Only remove on explicit request, not automatic cleanup
     * @param {string} placementId - Squad placement ID
     */
    removeSquad(placementId) {
        const squadData = this.squadExperience.get(placementId);
        if (squadData) {
           this.squadExperience.delete(placementId);
        }
    }
    
    /**
     * Update method called each frame
     */
    update() {

        this.tickBaselineXP();
    }
    tickBaselineXP() {
        // Optional: restrict to combat only
        if (this.config.baselineXPCombatOnly && this.game?.state?.phase !== 'battle') return;

        for (const [placementId, squadData] of this.squadExperience.entries()) {
            // Respect caps: no gain if at max or waiting for manual level-up
            if (squadData.level >= this.config.maxLevel || squadData.canLevelUp) continue;

            const unitsAliveInSquad = this.unitsAliveInSquad(squadData);
            if (unitsAliveInSquad > 0) {
                const squadLivingRatio = unitsAliveInSquad / squadData.totalUnitsInSquad;                
                const xp = squadLivingRatio * this.config.baselineXPPerSecond * this.game.state.deltaTime * this.config.experienceMultiplier;
                if (xp > 0) this.addExperience(placementId, xp);
            }
        }
    }
    unitsAliveInSquad(squadData) {
        if (!squadData || !squadData.unitIds?.length) return 0;
        const componentTypes = this.game.componentManager.getComponentTypes();
        let count = 0;
        for (const id of squadData.unitIds) {
            const h = this.game.getComponent(id, componentTypes.HEALTH);
            if (h && h.current > 0) count++;
        }
        return count;
    }
    /**
     * Clean up experience data for squads with dead/missing units
     * MODIFIED: Never remove experience data, just update unit lists
     */
    cleanupInvalidSquads() {
        const componentTypes = this.game.componentManager.getComponentTypes();
        
        for (const [placementId, squadData] of this.squadExperience.entries()) {
            // Check if any units in the squad still exist and are alive
            const validUnits = squadData.unitIds.filter(entityId => {
                const health = this.game.getComponent(entityId, componentTypes.HEALTH);
                return health && health.current > 0;
            });
            
            if (validUnits.length < squadData.unitIds.length) {
                // Update the unit list to remove dead units, but KEEP experience data
             
                squadData.unitIds = validUnits;
                squadData.squadSize = validUnits.length;
                
                // DO NOT remove the squad data - experience is permanent!
            }
        }
        
        // No longer remove squads entirely - experience persists even if all units die
    }
    
    /**
     * Reset all experience data (for new game)
     */
    reset() {
        this.squadExperience.clear();
        this.savedSquadExperience.clear();
    }

    /**
     * Save player squad experience before round cleanup
     */
    saveSquadExperience() {
        this.savedSquadExperience = new Map();
        
        for (const [placementId, squadData] of this.squadExperience.entries()) {

            // Save the experience data
            this.savedSquadExperience.set(placementId, {
                level: squadData.level,
                experience: squadData.experience,
                experienceToNextLevel: squadData.experienceToNextLevel,
                canLevelUp: squadData.canLevelUp,
                squadValue: squadData.squadValue,
                totalUnitsInSquad: squadData.totalUnitsInSquad
            });
            
        }
    }

    /**
     * Restore saved player experience to a respawned squad
     */
    restoreSquadExperience(placementId, squadData) {
        const saved = this.savedSquadExperience.get(placementId);
        if (saved) {
            squadData.level = saved.level;
            squadData.experience = saved.experience;
            squadData.experienceToNextLevel = saved.experienceToNextLevel;
            squadData.canLevelUp = saved.canLevelUp;
            
          
            // Apply level bonuses if squad has levels
            if (squadData.level > 0) {
                this.applyLevelBonuses(placementId);
            }
            
            return true;
        }
        return false;
    }
    /**
     * Get debug information
     * @returns {Object} Debug info
     */
    getDebugInfo() {
        const squads = Array.from(this.squadExperience.values());
        return {
            totalSquads: squads.length,
            leftSquads: squads.filter(s => s.team === 'left').length,
            rightSquads: squads.filter(s => s.team === 'right').length,
            squadsReadyToLevelUp: squads.filter(s => s.canLevelUp).length,
            averageLevel: squads.length > 0 ? squads.reduce((sum, s) => sum + s.level, 0) / squads.length : 0,
            maxLevel: Math.max(0, ...squads.map(s => s.level))
        };
    }
}