class ShopSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.shopSystem = this;
        
        this.ownedBuildings = new Map();
        this.buildingUpgrades = new Map();
        this.buildingProductionProgress = new Map();
        this.game.state.selectedEntity = {
            "type": null,
            "entityId": null
        };
        this.townHallLevel = 0;
        
        this.lastExperienceUpdate = 0;
        this.uiEnhancements = new FantasyUIEnhancements(game);
    }

    createShop() {
        this.renderBuildingList();
        this.renderActionPanel();
        this.createExperiencePanel();
    }

    renderBuildingList() {
        const container = document.getElementById('buildingList');
        if (!container) return;
        
        container.innerHTML = '';

        // const BuildingTypes = this.game.getCollections().buildings;
        
        // this.ownedBuildings.forEach(buildingId => {
        //     const building = BuildingTypes[buildingId];
        //     if (!building) return;
            
        //     const item = document.createElement('div');
        //     item.className = 'building-list-item';
        //     if (this.game.state.selectedEntity.entityId === buildingId) {
        //         item.classList.add('selected');
        //     }
            
        //     const icon = document.createElement('div');
        //     icon.className = 'building-list-icon';
        //     icon.textContent = building.icon || '🏛️';
        //     item.appendChild(icon);
            
        //     const info = document.createElement('div');
        //     info.className = 'building-list-info';
            
        //     const title = document.createElement('div');
        //     title.className = 'building-list-title';
        //     title.textContent = building.title;
        //     info.appendChild(title);
            
        //     const upgrades = this.buildingUpgrades.get(buildingId) || new Set();
        //     const totalUpgrades = building.upgrades ? building.upgrades.length : 0;
            
        //     if (totalUpgrades > 0) {
        //         const progress = document.createElement('div');
        //         progress.className = 'building-list-progress';
        //         progress.textContent = `${upgrades.size}/${totalUpgrades} upgrades`;
        //         info.appendChild(progress);
        //     }
            
        //     const productionProgress = this.buildingProductionProgress.get(buildingId) || 0;
        //     if (productionProgress > 0) {
        //         const prodInfo = document.createElement('div');
        //         prodInfo.className = 'building-list-production';
        //         prodInfo.style.fontSize = '0.85em';
        //         prodInfo.style.color = '#ffa500';
        //         prodInfo.textContent = `Building: ${(productionProgress * 100).toFixed(0)}%`;
        //         info.appendChild(prodInfo);
        //     }
            
        //     item.appendChild(info);
            
        //     item.addEventListener('click', () => {
        //         this.game.state.selectedEntity.entityId = buildingId;
        //         this.game.state.selectedEntity.type = "building";
        //         this.createShop();
        //     });
            
        //     container.appendChild(item);
        // });
        
        // if (this.ownedBuildings.size === 0) {
        //     const empty = document.createElement('div');
        //     empty.className = 'building-list-empty';
        //     empty.textContent = 'No buildings yet';
        //     container.appendChild(empty);
        // }
    }

    renderActionPanel() {
        const container = document.getElementById('actionPanel');
        if (!container) return;
        container.innerHTML = '';

        if (this.game.state.selectedEntity.type == 'building') {
            this.renderBuildingActions(container);
        } else {
            //this.renderBuildOptions(container);
        }
    }

    renderBuildOptions(container) {
        const header = document.createElement('div');
        header.className = 'action-panel-header';
        header.textContent = 'BUILD';
        container.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'action-grid';

        const BuildingTypes = this.game.getCollections().buildings;
        let availableCount = 0;
        Object.keys(BuildingTypes).forEach(buildingId => {
            const building = BuildingTypes[buildingId];
            const btn = this.createActionButton({
                icon: building.icon || '🏛️',
                title: building.title,
                cost: building.value,
                locked: this.isBuildingLocked(buildingId, building),
                lockReason: this.getLockReason(buildingId, building),
                onClick: () => this.activateBuildingPlacement(buildingId, building)
            });
            grid.appendChild(btn);
            availableCount++;
        });

        container.appendChild(grid);

        if(availableCount == 0){
            container.style.display = 'none';
        } else {
            container.removeAttribute('style');
        }
    }

    clearSelectedEntity() {    
        this.game.state.selectedEntity.entityId = null;
        this.game.state.selectedEntity.type = null;
    }

    renderBuildingActions(placement) {
        const building = placement.unitType;
        const container = document.getElementById('actionPanel');  
        if (!container) return;
        container.innerHTML = '';
        if (!building) {
            this.clearSelectedEntity();
         //   this.renderBuildOptions(container);
            return;
        }

        const header = document.createElement('div');
        header.className = 'action-panel-header';
        header.innerHTML = `
            <button class="deselect-btn" id="deselectBtn">←</button>
            <span>${building.icon || '🏛️'} ${building.title}</span>
        `;
        container.appendChild(header);

        document.getElementById('deselectBtn').addEventListener('click', () => {
            this.clearSelectedEntity();
            this.createShop();
        });

       
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
            const empty = document.createElement('div');
            empty.className = 'action-empty';
            empty.textContent = 'Under Construction';
            container.appendChild(empty);
        }
        
        container.removeAttribute('style');
    }

    createUnitsSection(building) {
        const section = document.createElement('div');
        section.className = 'action-section';

        const header = document.createElement('div');
        header.className = 'action-section-header';
        header.textContent = 'RECRUIT';
        section.appendChild(header);

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
            
            let locked = !canAfford || !hasCapacity;
            let lockReason = null;
            if (!canAfford) {
                lockReason = "Can't afford";
            } else if (!hasCapacity) {
                lockReason = `Need ${buildTime.toFixed(1)} rounds`;
            }
            
            const btn = this.createActionButton({
                icon: unit.icon || '⚔️',
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
            icon,
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
        iconEl.textContent = icon;
        btn.appendChild(iconEl);

        const titleEl = document.createElement('div');
        titleEl.className = 'action-btn-title';
        titleEl.textContent = title;
        btn.appendChild(titleEl);

        if (buildTime !== undefined) {
            const buildTimeEl = document.createElement('div');
            buildTimeEl.className = 'action-btn-buildtime';
            buildTimeEl.style.fontSize = '0.8em';
            buildTimeEl.style.color = '#888';
            buildTimeEl.textContent = `⏱ ${buildTime.toFixed(1)} rounds`;
            btn.appendChild(buildTimeEl);
        }

        const costEl = document.createElement('div');
        costEl.className = 'action-btn-cost';
        
        if (lockReason) {
            costEl.textContent = lockReason;
            costEl.style.color = '#f44336';
        } else {
            costEl.innerHTML = `💰 ${cost}`;
        }
        
        btn.appendChild(costEl);

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

    activateBuildingPlacement(buildingId, building) {
        if (this.isBuildingLocked(buildingId, building)) {
            return;
        }
        this.game.state.selectedUnitType = { id: buildingId, collection: 'buildings', ...building };
        if (this.game.placementSystem) {
            this.game.placementSystem.handleUnitSelectionChange();
        }
    }

    addBuilding(buildingId, entityId){
        if(!this.ownedBuildings.has(buildingId)){
            this.ownedBuildings.set(buildingId, [entityId]);
        } else {
            this.ownedBuildings.get(buildingId).push(entityId)            
        }

        this.buildingProductionProgress.set(entityId, 0);
        console.log('set progress', buildingId, 0);
        this.buildingUpgrades.set(buildingId, new Set());
        this.createShop();
        
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
        const placement = this.game.placementSystem.createPlacementData(placementPos, unit, this.game.state.mySide);
        
        this.game.networkManager.submitPlacement(placement, (success, response) => {
            if(success){
                const newProgress = productionProgress + buildTime;
                this.buildingProductionProgress.set(buildingId, newProgress);
                console.log('set progress', buildingId, newProgress);
                this.game.placementSystem.placeSquad(placement);                
                this.createShop();
            }
        });       
    }

    findBuildingPlacementPosition(placementId, unitDef) {
        const buildingGridPos = this.getBuildingGridPosition(placementId);
        const placement = this.game.placementSystem.getPlacementById(placementId);
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
        const placements = this.game.placementSystem.getPlacementsForSide(mySide);
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
        const placement = this.game.placementSystem.getPlacementById(placementId);
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
        console.log('apply effect', effectData);
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
        console.log('onPlacementPhaseStart');
        this.ownedBuildings.keys().forEach(buildingType => {
            this.ownedBuildings.get(buildingType).forEach((buildingEntityId) => {
                this.buildingProductionProgress.set(buildingEntityId, 0);
                console.log('set progress', buildingEntityId, 0);
            });
        });
        this.createShop();
    }

    createExperiencePanel() {
        if (!this.game.squadExperienceSystem) return;
        
        const container = document.getElementById('unitPromotions');
        if (!container) return;
        
        container.innerHTML = '';

        const squadsReadyToLevelUp = this.game.squadExperienceSystem.getSquadsReadyToLevelUp();
        
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
                if (this.game.squadExperienceSystem) {
                    this.game.squadExperienceSystem.showSpecializationSelection(
                        squad.placementId, 
                        squad, 
                        squad.levelUpCost
                    );
                }
            };
            buttonContainer.appendChild(specBtn);
        } else {
            const levelUpBtn = document.createElement('button');
            levelUpBtn.className = 'btn btn-primary experience-btn';
            levelUpBtn.innerHTML = `${nextLevelText} (${squad.levelUpCost}g)`;
            levelUpBtn.onclick = () => {
                if (this.game.squadExperienceSystem) {
                    this.game.squadExperienceSystem.levelUpSquad(squad.placementId, squad.team);
                }
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
        
        if (inPlacementPhase && this.game.squadExperienceSystem) {
            if (this.game.state.now - this.lastExperienceUpdate > 2) {
                const squadsReadyToLevelUp = this.game.squadExperienceSystem.getSquadsReadyToLevelUp();
                const hasReadySquads = squadsReadyToLevelUp.length > 0;
                const hasExperiencePanel = document.querySelector('.experience-panel') !== null;
                
                if (hasReadySquads !== hasExperiencePanel) {
                    this.createExperiencePanel();
                }
                
                this.lastExperienceUpdate = this.game.state.now;
            }
        }
    }

    reset() {
        this.clearSelectedEntity();
    }

  
}