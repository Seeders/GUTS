class ShopSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.shopSystem = this;
        
        this.ownedBuildings = new Map();
        this.buildingUpgrades = new Map();
        this.buildingProductionProgress = new Map();
        this.game.state.selectedEntity = {
            "collection": null,
            "entityId": null
        };
        this.townHallLevel = 0;
        
        this.lastExperienceUpdate = 0;
        this.uiEnhancements = new GUTS.FantasyUIEnhancements(game);
    }

    init() {
        this.game.gameManager.register('addBuilding', this.addBuilding.bind(this));
        this.game.gameManager.register('resetShop', this.reset.bind(this));
        this.game.gameManager.register('updateSquadExperience', this.updateSquadExperience.bind(this));
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
    onUnitSelected(entityId){
        const unitType = this.game.getComponent(entityId, "unitType");
        if(unitType.collection == "buildings") {
            const placement = this.game.getComponent(entityId, "placement");

            // Ensure completed buildings are registered with ShopSystem
            // This handles cases where construction completed but addBuilding wasn't called
            // (e.g., client syncing state from server where ShopSystem doesn't exist)
            if (placement && !placement.isUnderConstruction && !this.buildingProductionProgress.has(entityId)) {
                this.addBuilding(unitType.id, entityId);
            }

            this.renderBuildingActions(placement);
        }
    }
    renderBuildingActions(placement) {
        const building = placement.unitType;
        const container = document.getElementById('actionPanel');  
        if (!container) return;
        container.innerHTML = '';
        if (!building) {
            this.clearSelectedEntity();
            return;
        }
       
        const buildingId = this.game.state.selectedEntity.entityId;
        if(this.buildingProductionProgress.has(buildingId)){
            const hasUnits = building.units && building.units.length > 0;
            const hasUpgrades = building.upgrades && building.upgrades.length > 0;
            if (hasUnits) {
                const unitsSection = this.createUnitsSection(building);
                container.appendChild(unitsSection);
            }

            if (hasUpgrades) {
                const upgradesSection = this.createUpgradesSection(building);
                container.appendChild(upgradesSection);
            }

            if (!hasUnits && !hasUpgrades) {
                const empty = document.createElement('div');
                empty.className = 'action-empty';
                empty.textContent = 'No actions available';
                container.appendChild(empty);
            }
        } else {
            // Building is under construction - show cancel button
            const buildingEntityId = this.game.state.selectedEntity.entityId;

            if (placement.isUnderConstruction) {
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
                cancelBtn.title = `Cancel and refund ${placement.unitType.value || 0} gold`;
                grid.appendChild(cancelBtn);

                constructionSection.appendChild(grid);
                container.appendChild(constructionSection);
            } else {
                const empty = document.createElement('div');
                empty.className = 'action-empty';
                empty.textContent = 'No actions available';
                container.appendChild(empty);
            }
        }
        
        container.removeAttribute('style');
    }

    createUnitsSection(building) {
        const section = document.createElement('div');
        section.className = 'action-section';

        const grid = document.createElement('div');
        grid.className = 'action-grid';
        const UnitTypes = this.game.getCollections().units;
        
        const buildingId = this.game.state.selectedEntity.entityId;
        const productionProgress = this.buildingProductionProgress.get(buildingId);
        const remainingCapacity = 1 - productionProgress;
        
        building.units.forEach(unitId => {
            const unit = UnitTypes[unitId];
            const buildTime = unit.buildTime || 1;
            const canAfford = this.game.state.playerGold >= unit.value;
            const hasCapacity = buildTime <= remainingCapacity + 0.001;
            
            const hasSupply = !this.game.supplySystem || this.game.supplySystem.canAffordSupply(this.game.state.mySide, unit);
            
            let locked = !canAfford || !hasCapacity || !hasSupply;
            let lockReason = null;
            if (!canAfford) {
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

        section.appendChild(grid);
        return section;
    }

    createUpgradesSection(building) {
        const section = document.createElement('div');
        section.className = 'action-section';

        const header = document.createElement('div');
        header.className = 'action-section-header';
        header.textContent = 'UPGRADES';
        section.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'action-grid';

        const buildingId = this.game.state.selectedEntity.entityId;
        const purchasedUpgrades = this.buildingUpgrades.get(buildingId) || new Set();

        building.upgrades.forEach(upgradeId => {
            const upgrade = this.game.getCollections().upgrades[upgradeId];
            if (!upgrade) return;

            const isOwned = purchasedUpgrades.has(upgradeId);
            const locked = isOwned || this.game.state.playerGold < upgrade.value;

            const btn = this.createActionButton({
                icon: upgrade.icon || '⭐',
                title: upgrade.title,
                cost: upgrade.value,
                locked: locked,
                lockReason: isOwned ? 'Owned' : (locked ? "Can't afford" : null),
                owned: isOwned,
                onClick: () => !isOwned && this.purchaseUpgrade(upgradeId, upgrade, buildingId)
            });
            grid.appendChild(btn);
        });

        section.appendChild(grid);
        return section;
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
            const icon = this.game.getCollections().icons[iconId];
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
        return this.game.state.playerGold < building.value ||
               (building.requires && !this.hasRequirements(building.requires));
    }

    getLockReason(buildingId, building) {
        if (this.game.state.playerGold < building.value) return "Can't afford";
        if (building.requires && !this.hasRequirements(building.requires)) {
            return 'Missing requirements';
        }
        return null;
    }

    hasRequirements(requirements) {
        if (requirements.townHallLevel) {
            if (this.townHallLevel < requirements.townHallLevel) return false;
        }
        if (requirements.buildings) {
            for (const reqBuilding of requirements.buildings) {
                if (!this.ownedBuildings.has(reqBuilding)) return false;
            }
        }
        return true;
    }

    addBuilding(buildingId, entityId){
        if(!this.ownedBuildings.has(buildingId)){
            this.ownedBuildings.set(buildingId, [entityId]);
        } else {
            this.ownedBuildings.get(buildingId).push(entityId)            
        }

        this.buildingProductionProgress.set(entityId, 0);
        this.buildingUpgrades.set(buildingId, new Set());        
    }

    purchaseUnit(unitId, unit) {
        const buildingId = this.game.state.selectedEntity.entityId;
        const placementId = this.getBuildingPlacementId(buildingId);
        
        if (!placementId) {
            console.log('no building selected');
            this.showNotification('No building selected!', 'error');
            return;
        }

        const buildTime = unit.buildTime || 1;
        const productionProgress = this.buildingProductionProgress.get(buildingId);
        const remainingCapacity = 1 - productionProgress;
        
        if (buildTime > remainingCapacity + 0.001) {
            this.showNotification(`Not enough production capacity! Need ${buildTime.toFixed(1)} rounds`, 'error');
            return;
        }

        unit.id = unitId;
        unit.collection = 'units';
        const placementPos = this.findBuildingPlacementPosition(placementId, unit);
        if (!placementPos) {
            console.log('no valid placement');
            this.showNotification('No valid placement near building!', 'error');
            return;
        }
        const placement = this.game.gameManager.call('createPlacementData', placementPos, unit, this.game.state.mySide);

        this.game.networkManager.submitPlacement(placement, (success, response) => {
            if(success){
                const newProgress = productionProgress + buildTime;
                this.buildingProductionProgress.set(buildingId, newProgress);
                this.game.gameManager.call('placeSquadOnBattlefield', placement);
            }
        });       
    }

    findBuildingPlacementPosition(placementId, unitDef) {
        const buildingGridPos = this.getBuildingGridPosition(placementId);
        const placement = this.game.gameManager.call('getPlacementById', placementId);
        if (!buildingGridPos) return null;

        const gridSystem = this.game.gridSystem;
        const placementSystem = this.game.placementSystem;
        if (!gridSystem || !placementSystem) return null;

        const buildingCells = placement.cells || [];
        const buildingCellSet = new Set(buildingCells.map(cell => `${cell.x},${cell.z}`));

        const searchRadius = 12;
        const spiralOffsets = this.generateSpiralOffsets(searchRadius);

        for (const offset of spiralOffsets) {
            const testPos = {
                x: buildingGridPos.x + offset.x,
                z: buildingGridPos.z + offset.z
            };
            
            const testCellKey = `${testPos.x},${testPos.z}`;
            if (buildingCellSet.has(testCellKey)) {
                continue;
            }
            
            const unitSquadData = this.game.squadManager.getSquadData(unitDef);
            const unitCells = this.game.squadManager.getSquadCells(testPos, unitSquadData);
            
            const overlapsBuilding = unitCells.some(cell => 
                buildingCellSet.has(`${cell.x},${cell.z}`)
            );
            
            if (overlapsBuilding) {
                continue;
            }

            const worldPos = gridSystem.gridToWorld(testPos.x, testPos.z);
            if (placementSystem.isValidGridPlacement(worldPos, unitDef)) {
                return testPos;
            }
        }

        return null;
    }

    generateSpiralOffsets(maxRadius) {
        const offsets = [];
        let x = 0, z = 0;
        let dx = 0, dz = -1;
        
        for (let i = 0; i < (maxRadius * 2) * (maxRadius * 2); i++) {
            if ((-maxRadius < x && x <= maxRadius) && (-maxRadius < z && z <= maxRadius)) {
                offsets.push({ x, z });
            }
            
            if (x === z || (x < 0 && x === -z) || (x > 0 && x === 1 - z)) {
                const temp = dx;
                dx = -dz;
                dz = temp;
            }
            
            x += dx;
            z += dz;
        }
        
        return offsets;
    }

    getBuildingPlacementId(buildingId) {
        const state = this.game.state;
        const mySide = state.mySide;
        const placements = this.game.gameManager.call('getPlacementsForSide', mySide);
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
        const placement = this.game.gameManager.call('getPlacementById', placementId);
        console.log('got placement', placement);
        return placement.gridPosition;
    }

    purchaseUpgrade(upgradeId, upgrade) {
        this.game.networkManager.purchaseUpgrade({ 
            upgradeId, 
            buildingId: this.game.state.selectedEntity.entityId 
        }, (success, response) => {
            if (success) {
                if (!this.buildingUpgrades.has(this.game.state.selectedEntity.entityId)) {
                    this.buildingUpgrades.set(this.game.state.selectedEntity.entityId, new Set());
                }
                this.buildingUpgrades.get(this.game.state.selectedEntity.entityId).add(upgradeId);
                this.game.state.playerGold -= upgrade.value;
                this.applyUpgradeEffects(this.game.state.mySide, upgrade);
                this.showNotification(`${upgrade.title} purchased!`, 'success');
            }
        });
    }

    applyUpgradeEffects(team, upgrade) {
        if (upgrade.effects) {
            upgrade.effects.forEach(effectId => {
                const effect = this.game.getCollections().effects[effectId];
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
        this.ownedBuildings.keys().forEach(buildingType => {
            this.ownedBuildings.get(buildingType).forEach((buildingEntityId) => {
                this.buildingProductionProgress.set(buildingEntityId, 0);
            });
        });
    }

    createExperiencePanel() {
        const container = document.getElementById('unitPromotions');
        if (!container) return;

        container.innerHTML = '';

        const squadsReadyToLevelUp = this.game.gameManager.call('getSquadsReadyToLevelUp');
        
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
                this.game.gameManager.call('showSpecializationSelection',
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
                this.game.gameManager.call('levelUpSquad', squad.placementId, squad.team);
            };
            buttonContainer.appendChild(levelUpBtn);
        }

        card.appendChild(buttonContainer);
        return card;
    }

    getCurrentUnitType(placementId, team) {
        const state = this.game.state;
        const placement = state.placements?.[team]?.[placementId];
        if (!placement) return null;
        
        const UnitTypes = this.game.getCollections().units;
        return placement.unitType ? UnitTypes[placement.unitType] : null;
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
        const inPlacementPhase = state.phase === 'placement';

        if (inPlacementPhase) {
            if (this.game.state.now - this.lastExperienceUpdate > 2) {
                const squadsReadyToLevelUp = this.game.gameManager.call('getSquadsReadyToLevelUp');
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

        // Send cancel request to server
        if (this.game.networkManager && this.game.networkManager.cancelBuilding) {
            this.game.networkManager.cancelBuilding({ 
                placementId: placement.placementId,
                buildingEntityId: buildingEntityId 
            }, (success, response) => {
                if (!success) {
                    this.game.uiSystem?.showNotification('Failed to cancel construction', 'error', 1500);
                    console.error('Cancel construction failed:', response);
                    return;
                }
                
                // Server confirmed, now do local cleanup
                this.performLocalCancelConstruction(buildingEntityId, placement);
            });
        } else {
            // Fallback for single-player or when network not available
            this.performLocalCancelConstruction(buildingEntityId, placement);
        }
    }

    performLocalCancelConstruction(buildingEntityId, placement) {
        // Refund the gold
        const refundAmount = placement.unitType.value || 0;
        if (refundAmount > 0) {
            this.game.state.playerGold += refundAmount;
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
            this.game.gameManager.call('removeInstance', buildingEntityId);
        }
        this.game.destroyEntity(buildingEntityId);

        // Deselect all
        if (this.game.selectedUnitSystem) {
            this.game.selectedUnitSystem.deselectAll();
        }
    }

    reset() {
        this.clearSelectedEntity();
    }

  
}