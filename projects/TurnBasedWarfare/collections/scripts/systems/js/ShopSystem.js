class ShopSystem extends GUTS.BaseSystem {
    static services = [
        'resetShop',
        'updateSquadExperience'
    ];

    constructor(game) {
        super(game);
        this.game.shopSystem = this;

        this.game.state.selectedEntity = {
            "collection": null,
            "entityId": null
        };
        this.townHallLevel = 0;

        this.lastExperienceUpdate = 0;
        this.uiEnhancements = new GUTS.FantasyUIEnhancements(game);
    }

    init() {
    }

    // Alias for service name
    resetShop() {
        return this.reset();
    }

    /**
     * Get all completed buildings for a specific side
     * Queries entity data directly instead of maintaining a separate map
     */
    getOwnedBuildings(teamIndex) {
        const buildings = new Map(); // buildingType -> [entityIds]
        const entitiesWithPlacement = this.game.getEntitiesWith('placement', 'team');

        for (const entityId of entitiesWithPlacement) {
            const placement = this.game.getComponent(entityId, 'placement');
            const teamComp = this.game.getComponent(entityId, 'team');
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!placement || !unitType) continue;
            if (unitType.collection !== 'buildings') continue;
            if (teamComp.team !== teamIndex) continue;
            if (placement.isUnderConstruction) continue;

            const buildingType = unitType.id;
            if (!buildings.has(buildingType)) {
                buildings.set(buildingType, []);
            }
            buildings.get(buildingType).push(entityId);
        }

        return buildings;
    }

    /**
     * Get all owned units for a specific side (alive, not under construction)
     */
    getOwnedUnits(teamIndex) {
        const units = new Map(); // unitType -> [entityIds]
        const entitiesWithTeam = this.game.getEntitiesWith('unitType', 'team', 'health');

        for (const entityId of entitiesWithTeam) {
            const teamComp = this.game.getComponent(entityId, 'team');
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const health = this.game.getComponent(entityId, 'health');

            if (!unitType || !health) continue;
            if (unitType.collection !== 'units') continue;
            if (teamComp.team !== teamIndex) continue;
            if (health.current <= 0) continue;

            const unitTypeId = unitType.id;
            if (!units.has(unitTypeId)) {
                units.set(unitTypeId, []);
            }
            units.get(unitTypeId).push(entityId);
        }

        return units;
    }

    /**
     * Check if requirements are met for a unit or building
     * @param {Object} def - Unit or building definition with optional requiresUnits/requiresBuildings arrays
     * @returns {{met: boolean, reason: string|null}}
     */
    checkRequirements(def) {
        const teamIndex = this.game.call('getActivePlayerTeam');

        if (def.requiresBuildings && def.requiresBuildings.length > 0) {
            const ownedBuildings = this.getOwnedBuildings(teamIndex);
            for (const reqBuilding of def.requiresBuildings) {
                if (!ownedBuildings.has(reqBuilding)) {
                    const buildingDef = this.collections.buildings[reqBuilding];
                    const buildingName = buildingDef?.title || reqBuilding;
                    return { met: false, reason: `Requires ${buildingName}` };
                }
            }
        }

        if (def.requiresUnits && def.requiresUnits.length > 0) {
            const ownedUnits = this.getOwnedUnits(teamIndex);
            for (const reqUnit of def.requiresUnits) {
                if (!ownedUnits.has(reqUnit)) {
                    const unitDef = this.collections.units[reqUnit];
                    const unitName = unitDef?.title || reqUnit;
                    return { met: false, reason: `Requires ${unitName}` };
                }
            }
        }

        return { met: true, reason: null };
    }

    /**
     * Check if a building entity is completed (not under construction)
     */
    isBuildingCompleted(entityId) {
        const placement = this.game.getComponent(entityId, 'placement');
        return placement && !placement.isUnderConstruction;
    }

    /**
     * Get production progress for a building from its placement component
     */
    getBuildingProductionProgress(entityId) {
        const placement = this.game.getComponent(entityId, 'placement');
        return placement?.productionProgress || 0;
    }

    /**
     * Set production progress for a building on its placement component
     */
    setBuildingProductionProgress(entityId, progress) {
        const placement = this.game.getComponent(entityId, 'placement');
        if (placement) {
            placement.productionProgress = progress;
        }
    }

    updateSquadExperience() {
        this.createExperiencePanel();
    }

    clearActionPanel() {
        const container = document.getElementById('actionPanel');
        if (!container) return;
        container.innerHTML = '';
    }

    clearSelectedEntity() {
        this.game.state.selectedEntity.entityId = null;
        this.game.state.selectedEntity.collection = null;
    }

    refreshShopUI() {
        const entityId = this.game.state.selectedEntity?.entityId;
        if (entityId) {
            this.onMultipleUnitsSelected(new Set([entityId]));
        }
    }

    onMultipleUnitsSelected(unitIds) {
        // Get the first selected entity to display its action panel
        const entityId = unitIds.size > 0 ? Array.from(unitIds)[0] : null;
        if (!entityId) return;

        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        if (unitType && unitType.collection === "buildings") {
            const placement = this.game.getComponent(entityId, "placement");
            this.renderBuildingActions(placement);
        }
    }
    renderBuildingActions(placement) {
        // Get unitType from the entity, not from placement
        const buildingId = this.game.state.selectedEntity.entityId;
        const buildingComp = this.game.getComponent(buildingId, 'unitType');
        const building = this.game.call('getUnitTypeDef', buildingComp);
        const container = document.getElementById('actionPanel');
        if (!container) return;
        container.innerHTML = '';
        if (!building) {
            this.clearSelectedEntity();
            return;
        }

        // Check if building is completed (not under construction)
        if (this.isBuildingCompleted(buildingId)) {
            const hasUnits = building.units && building.units.length > 0;
            const hasUpgrades = building.upgrades && building.upgrades.length > 0;
            const hasUpgradesTo = !!building.upgradesToBuilding;

            if (!hasUnits && !hasUpgrades && !hasUpgradesTo) {
                const empty = document.createElement('div');
                empty.className = 'action-empty';
                empty.textContent = 'No actions available';
                container.appendChild(empty);
            } else {
                // Create single unified grid for all actions
                const section = document.createElement('div');
                section.className = 'action-section';

                const grid = document.createElement('div');
                grid.className = 'action-grid';

                // Add unit buttons
                if (hasUnits) {
                    this.addUnitButtons(grid, building);
                }

                // Add upgrade buttons
                if (hasUpgrades) {
                    this.addUpgradeButtons(grid, building);
                }

                // Add building upgrade button
                if (hasUpgradesTo) {
                    this.addBuildingUpgradeButton(grid, building);
                }

                section.appendChild(grid);
                container.appendChild(section);
            }
        } else if (placement.isUnderConstruction) {
            // Building is under construction - show cancel button
            const buildingEntityId = this.game.state.selectedEntity.entityId;

            const constructionSection = document.createElement('div');
            constructionSection.className = 'action-section';

            const statusText = document.createElement('div');
            statusText.className = 'action-empty';
            statusText.textContent = 'Under Construction';
            constructionSection.appendChild(statusText);

            const grid = document.createElement('div');
            grid.className = 'action-grid';

            const cancelBtn = this.createActionButton({
                iconId: null,
                title: 'Cancel Construction',
                cost: null,
                locked: false,
                onClick: () => this.cancelConstruction(buildingEntityId, placement)
            });
            cancelBtn.style.backgroundColor = '#8B0000';
            cancelBtn.title = `Cancel and refund ${building.value || 0} gold`;
            grid.appendChild(cancelBtn);

            constructionSection.appendChild(grid);
            container.appendChild(constructionSection);
        } else {
            const empty = document.createElement('div');
            empty.className = 'action-empty';
            empty.textContent = 'No actions available';
            container.appendChild(empty);
        }

        container.removeAttribute('style');
    }

    addUnitButtons(grid, building) {
        const UnitTypes = this.collections.units;
        const buildingId = this.game.state.selectedEntity.entityId;
        const productionProgress = this.getBuildingProductionProgress(buildingId);
        const remainingCapacity = 1 - productionProgress;

        building.units.forEach(unitId => {
            const unit = UnitTypes[unitId];
            const buildTime = unit.buildTime || 1;
            const canAfford = this.game.call('canAffordCost', unit.value);
            const hasCapacity = buildTime <= remainingCapacity + 0.001;
            const hasSupply = this.game.call('canAffordSupply', this.game.call('getActivePlayerTeam'), unit) ?? true;
            const requirements = this.checkRequirements(unit);

            let locked = !canAfford || !hasCapacity || !hasSupply || !requirements.met;
            let lockReason = null;
            if (!requirements.met) {
                lockReason = requirements.reason;
            } else if (!canAfford) {
                lockReason = "Can't afford";
            } else if (!hasCapacity) {
                lockReason = `Need ${buildTime.toFixed(1)} rounds`;
            } else if (!hasSupply) {
                lockReason = "Not enough supply";
            }

            const btn = this.createActionButton({
                iconId: unit.icon,
                title: unit.title,
                cost: unit.value,
                buildTime: buildTime,
                locked: locked,
                lockReason: lockReason,
                onClick: () => this.purchaseUnit(unitId, unit)
            });
            grid.appendChild(btn);
        });
    }

    addUpgradeButtons(grid, building) {
        // Get purchased upgrades from playerStats bitmask
        const playerStats = this.game.call('getLocalPlayerStats');
        const purchasedUpgradesBitmask = playerStats?.upgrades || 0;

        building.upgrades.forEach(upgradeId => {
            const upgrade = this.collections.upgrades[upgradeId];
            if (!upgrade) return;

            const upgradeIndex = this.enums.upgrades?.[upgradeId];
            const isOwned = upgradeIndex !== undefined && (purchasedUpgradesBitmask & (1 << upgradeIndex)) !== 0;
            const canAfford = this.game.call('canAffordCost', upgrade.value);
            const requirements = this.checkRequirements(upgrade);
            const locked = isOwned || !canAfford || !requirements.met;

            let lockReason = null;
            if (isOwned) {
                lockReason = 'Owned';
            } else if (!requirements.met) {
                lockReason = requirements.reason;
            } else if (!canAfford) {
                lockReason = "Can't afford";
            }

            const btn = this.createActionButton({
                iconId: upgrade.icon,
                title: upgrade.title,
                cost: upgrade.value,
                locked: locked,
                lockReason: lockReason,
                owned: isOwned,
                onClick: () => !isOwned && this.purchaseUpgrade(upgradeId, upgrade)
            });
            grid.appendChild(btn);
        });
    }

    addBuildingUpgradeButton(grid, building) {
        const targetBuildingId = building.upgradesToBuilding;
        const targetBuilding = this.collections.buildings[targetBuildingId];

        if (!targetBuilding) {
            console.error(`Target building ${targetBuildingId} not found`);
            return;
        }

        // Use target building's value as the upgrade cost
        const cost = targetBuilding.value || 0;
        const canAfford = this.game.call('canAffordCost', cost);
        const locked = !canAfford;

        const btn = this.createActionButton({
            iconId: targetBuilding.icon,
            title: `Upgrade to ${targetBuilding.title}`,
            cost: cost,
            locked: locked,
            lockReason: locked ? "Can't afford" : null,
            onClick: () => this.purchaseBuildingUpgrade(targetBuildingId)
        });
        grid.appendChild(btn);
    }

    purchaseBuildingUpgrade(targetBuildingId) {
        const buildingId = this.game.state.selectedEntity.entityId;
        const placementId = this.getBuildingPlacementId(buildingId);

        if (!placementId) {
            this.showNotification('No building selected!', 'error');
            return;
        }

        this.game.call('upgradeBuildingRequest', {
            buildingEntityId: buildingId,
            placementId: placementId,
            targetBuildingId: targetBuildingId
        }, (success, response) => {
            if (success) {
                this.showNotification(`Upgraded to ${this.collections.buildings[targetBuildingId].title}!`, 'success');
                // Clear selection since the old building is destroyed
                this.clearSelectedEntity();
                this.clearActionPanel();
            } else {
                this.showNotification(response?.error || 'Upgrade failed', 'error');
            }
        });
    }

    createActionButton(options) {
        const {
            iconId,
            title,
            cost,
            buildTime,
            locked = false,
            lockReason = null,
            onClick
        } = options;

        const btn = document.createElement('button');
        btn.className = 'action-btn';
        if (locked) btn.classList.add('locked');

        const iconEl = document.createElement('div');
        iconEl.className = 'action-btn-icon';
        if(iconId){
            const icon = this.collections.icons[iconId];
            if(icon && icon.imagePath){
                const img = document.createElement('img');
                img.src = `./resources/${icon.imagePath}`;
                iconEl.append(img);
            } else {
                iconEl.textContent =  '⚔️';
            }
        } else {
            iconEl.textContent =  '⚔️';
        }

        
        btn.appendChild(iconEl);
        let costTxt = `💰 ${cost}`;
        if (lockReason) {
            costTxt = lockReason;
        } 
        btn.title = `${title} ${costTxt}`;
        

        if (!locked) {
            btn.addEventListener('click', onClick);
        }

        return btn;
    }

    isBuildingLocked(buildingId, building) {
        const requirements = this.checkRequirements(building);
        return !this.game.call('canAffordCost', building.value) || !requirements.met;
    }

    getLockReason(buildingId, building) {
        const requirements = this.checkRequirements(building);
        if (!requirements.met) return requirements.reason;
        if (!this.game.call('canAffordCost', building.value)) return "Can't afford";
        return null;
    }

    purchaseUnit(unitId, unit) {
        const buildingId = this.game.state.selectedEntity.entityId;

        if (!buildingId) {
            this.showNotification('No building selected!', 'error');
            return;
        }

        // Use game.call - SAME code path as headless mode
        // This is the SINGLE source of truth for unit purchasing
        this.game.call('ui_purchaseUnit', unitId, buildingId, this.game.call('getActivePlayerTeam'), (success, response) => {
            if (!success) {
                // Show error notification from GameActionsInterface response
                this.showNotification(response?.error || 'Purchase failed', 'error');
            }
            // Success: gold deduction, placement, production progress all handled by GameActionsInterface
        });
    }

    getBuildingPlacementId(buildingId) {
        const state = this.game.state;
        const myTeam = state.myTeam;
        const placements = this.game.call('getPlacementsForSide', myTeam);
        if (!placements) return null;

        for (const [placementIndex, placement] of Object.entries(placements)) {
            for(const squadUnit of placement.squadUnits){
                if (squadUnit === buildingId) {
                    return placement.placementId;
                }
            }
        }
        return null;
    }

    getBuildingGridPosition(placementId) {
        const placement = this.game.call('getPlacementById', placementId);
        if (!placement || !placement.squadUnits || placement.squadUnits.length === 0) return null;

        // Get grid position from the building entity's transform
        const buildingEntityId = placement.squadUnits[0];
        const transform = this.game.getComponent(buildingEntityId, 'transform');
        const worldPos = transform?.position;
        if (!worldPos) return null;

        // Convert world position to grid position
        return this.game.call('worldToPlacementGrid', worldPos.x, worldPos.z);
    }

    purchaseUpgrade(upgradeId, upgrade) {
        this.game.call('purchaseUpgrade', { upgradeId: upgradeId }, (success, response) => {
            if (success) {
                // Domain logic (gold deduction, bitmask) now handled by ClientNetworkSystem
                // Here we just handle UI concerns: effects, notifications, UI refresh

                // Apply upgrade effects and show notification
                this.applyUpgradeEffects(this.game.call('getActivePlayerTeam'), upgrade);
                this.showNotification(`${upgrade.title} purchased!`, 'success');
                // Refresh the UI to show the upgrade as owned
                this.refreshShopUI();
            } else {
                this.showNotification(response?.error || 'Purchase failed', 'error');
            }
        });
    }

    applyUpgradeEffects(team, upgrade) {
        if (upgrade.effects) {
            upgrade.effects.forEach(effectId => {
                const effect = this.collections.effects[effectId];
                if (effect) {
                    effect.id = effectId;
                    this.applyEffect(team, effect);
                }
            });
        }
    }

    applyEffect(team, effectData) {
        if(!this.game.state.teams){
            this.game.state.teams = {};
        }
        if(!this.game.state.teams[team]) {
            this.game.state.teams[team] = {};
        } 
        if(!this.game.state.teams[team].effects) {
            this.game.state.teams[team].effects = {};
        }
        this.game.state.teams[team].effects[effectData.id] = effectData;
    }

    onPlacementPhaseStart() {
        // Reset production progress for all completed buildings on my side
        const ownedBuildings = this.getOwnedBuildings(this.game.call('getActivePlayerTeam'));
        for (const [buildingType, entityIds] of ownedBuildings) {
            for (const entityId of entityIds) {
                this.setBuildingProductionProgress(entityId, 0);
            }
        }
    }

    createExperiencePanel() {
        const container = document.getElementById('unitPromotions');
        if (!container) return;

        container.innerHTML = '';

        const squadsReadyToLevelUp = this.game.call('getSquadsReadyToLevelUp');
        
        if (squadsReadyToLevelUp.length === 0) return;

        squadsReadyToLevelUp.forEach(squad => {
            const panel = this.createExperienceCard(squad);
            if (panel) {
                container.appendChild(panel);
            }
        });
    }

    createExperienceCard(squad) {
        const currentUnitType = this.getCurrentUnitType(squad.placementId, squad.team);
        if (!currentUnitType) return null;

        const hasSpecializations = currentUnitType.specUnits && currentUnitType.specUnits.length > 0;
        const isSpecializationLevel = (squad.level) == 2;
        const canSpecialize = isSpecializationLevel && hasSpecializations;
        
        const card = document.createElement('div');
        card.className = 'experience-panel';

        if (canSpecialize) {
            const shimmer = document.createElement('div');
            shimmer.classList.add("shimmer");
            card.appendChild(shimmer);
        }

        const currentLevelText = ` (Lvl ${squad.level})`;
        const nextLevelText = canSpecialize ? '⭐ Ascend!' : ` Level ${squad.level + 1}`;

        const header = document.createElement('div');
        header.className = 'experience-header';

        const unitIcon = document.createElement('div');
        unitIcon.className = 'experience-unit-icon';
        unitIcon.textContent = currentUnitType.icon || '⚔️';
        header.appendChild(unitIcon);

        const info = document.createElement('div');
        info.className = 'experience-info';

        const title = document.createElement('div');
        title.className = 'experience-title';
        title.textContent = this.getSquadDisplayName(squad.placementId);
        info.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.className = 'experience-subtitle';
        subtitle.textContent = `${currentUnitType.title}${currentLevelText}`;
        info.appendChild(subtitle);

        header.appendChild(info);
        card.appendChild(header);

        const progress = document.createElement('div');
        progress.className = 'experience-progress';

        const progressBar = document.createElement('div');
        progressBar.className = 'experience-progress-bar';

        const progressFill = document.createElement('div');
        progressFill.className = 'experience-progress-fill';
        progressFill.style.width = '100%';
        progressBar.appendChild(progressFill);

        progress.appendChild(progressBar);

        const xpText = document.createElement('div');
        xpText.className = 'experience-xp-text';
        xpText.textContent = 'Ready to advance!';
        progress.appendChild(xpText);

        card.appendChild(progress);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'experience-buttons';

        if (canSpecialize) {
            const specBtn = document.createElement('button');
            specBtn.className = 'btn btn-primary experience-btn';
            specBtn.innerHTML = `${nextLevelText} (${squad.levelUpCost}g)`;
            specBtn.onclick = () => {
                // showSpecializationSelection is a UI method - it opens the selection dialog
                // The actual action happens when user selects via actions.selectSpecialization()
                this.game.call('showSpecializationSelection',
                    squad.placementId,
                    squad,
                    squad.levelUpCost
                );
            };
            buttonContainer.appendChild(specBtn);
        } else {
            const levelUpBtn = document.createElement('button');
            levelUpBtn.className = 'btn btn-primary experience-btn';
            levelUpBtn.innerHTML = `${nextLevelText} (${squad.levelUpCost}g)`;
            levelUpBtn.onclick = () => {
                // Use game.call - SAME code path as headless mode
                this.game.call('levelUpSquad', squad.placementId, squad.team);
            };
            buttonContainer.appendChild(levelUpBtn);
        }

        card.appendChild(buttonContainer);
        return card;
    }

    getCurrentUnitType(placementId, team) {
        // Get placement and unitType from entity via placement system
        const placement = this.game.call('getPlacementById', placementId);
        if (!placement || !placement.squadUnits || placement.squadUnits.length === 0) {
            return null;
        }
        const unitTypeComp = this.game.getComponent(placement.squadUnits[0], 'unitType');
        return this.game.call('getUnitTypeDef', unitTypeComp);
    }

    getSquadDisplayName(placementId) {
        const match = placementId.match(/^([a-z]+)_(\d+)$/);
        if (match) {
            const side = match[1];
            const index = parseInt(match[2], 10);
            const sideLabel = side === 'left' ? 'Left' : side === 'right' ? 'Right' : side === 'center' ? 'Center' : 'Unknown';
            return `${sideLabel} Squad ${index + 1}`;
        }
        return placementId;
    }

    showNotification(message, type) {
        if (this.uiEnhancements) {
            this.uiEnhancements.showNotification(message, type);
        } 
    }

    update() {
        const state = this.game.state;
        const inPlacementPhase = state.phase === this.enums.gamePhase.placement;

        if (inPlacementPhase) {
            if (this.game.state.now - this.lastExperienceUpdate > 2) {
                const squadsReadyToLevelUp = this.game.call('getSquadsReadyToLevelUp');
                const hasReadySquads = squadsReadyToLevelUp && squadsReadyToLevelUp.length > 0;
                const hasExperiencePanel = document.querySelector('.experience-panel') !== null;

                if (hasReadySquads !== hasExperiencePanel) {
                    this.createExperiencePanel();
                }

                this.lastExperienceUpdate = this.game.state.now;
            }
        }
    }

    cancelConstruction(buildingEntityId, placement) {
        if (!placement || !placement.isUnderConstruction) {
            this.game.uiSystem?.showNotification('Building is not under construction', 'warning', 1000);
            return;
        }

        this.game.call('cancelBuilding', {
            placementId: placement.placementId,
            buildingEntityId: buildingEntityId
        }, (success, response) => {
            if (!success) {
                this.game.uiSystem?.showNotification('Failed to cancel construction', 'error', 1500);
                console.error('Cancel construction failed:', response);
                return;
            }

            // Domain logic (refund, cleanup, destroy) now handled by ClientNetworkSystem
            // Here we just handle UI concerns: notification
            this.game.uiSystem?.showNotification(`Refunded ${response?.refundAmount || 0} gold`, 'success', 1500);
        });
    }

    performLocalCancelConstruction(buildingEntityId, placement) {
        // Refund the gold - get unitType from entity
        const unitTypeComp = this.game.getComponent(buildingEntityId, 'unitType');
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        const refundAmount = unitType?.value || 0;
        if (refundAmount > 0) {
            this.game.call('addPlayerGold', this.game.call('getActivePlayerTeam'), refundAmount);
            this.game.uiSystem?.showNotification(`Refunded ${refundAmount} gold`, 'success', 1500);
        }

        // Clear the assigned builder's command if there is one
        const assignedBuilder = placement.assignedBuilder;
        if (assignedBuilder) {
            // With behavior tree system, just clear the building state
            // The behavior tree will naturally switch to other behaviors

            // Remove the builder's BUILDING_STATE component
            if (this.game.hasComponent(assignedBuilder, "buildingState")) {
                this.game.removeComponent(assignedBuilder, "buildingState");
            }

            // Stop movement
            const builderVel = this.game.getComponent(assignedBuilder, "velocity");
            if (builderVel) {
                builderVel.vx = 0;
                builderVel.vz = 0;
            }
        }

        // Clear selection before destroying
        this.clearSelectedEntity();
        this.clearActionPanel();

        // Destroy the building entity
        if (this.game.renderSystem) {
            this.game.call('removeInstance', buildingEntityId);
        }
        this.game.destroyEntity(buildingEntityId);

        // Deselect all
        this.game.call('deselectAllUnits');
    }

    reset() {
        // Don't clear selected entity - selection should persist across phase transitions
        // The visual selection (circles, UI) is managed by SelectedUnitSystem
        // and remains intact; we need game.state.selectedEntity to match
    }

  
}
