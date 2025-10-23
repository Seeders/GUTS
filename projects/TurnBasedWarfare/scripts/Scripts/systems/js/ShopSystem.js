class ShopSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.shopSystem = this;
        
        this.ownedBuildings = new Set();
        this.buildingUpgrades = new Map();
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

        const BuildingTypes = this.game.getCollections().buildings;
        
        this.ownedBuildings.forEach(buildingId => {
            const building = BuildingTypes[buildingId];
            if (!building) return;
            
            const item = document.createElement('div');
            item.className = 'building-list-item';
            if (this.game.state.selectedEntity.entityId === buildingId) {
                item.classList.add('selected');
            }
            
            const icon = document.createElement('div');
            icon.className = 'building-list-icon';
            icon.textContent = building.icon || '🏛️';
            item.appendChild(icon);
            
            const info = document.createElement('div');
            info.className = 'building-list-info';
            
            const title = document.createElement('div');
            title.className = 'building-list-title';
            title.textContent = building.title;
            info.appendChild(title);
            
            const upgrades = this.buildingUpgrades.get(buildingId) || new Set();
            const totalUpgrades = building.upgrades ? building.upgrades.length : 0;
            
            if (totalUpgrades > 0) {
                const progress = document.createElement('div');
                progress.className = 'building-list-progress';
                progress.textContent = `${upgrades.size}/${totalUpgrades} upgrades`;
                info.appendChild(progress);
            }
            
            item.appendChild(info);
            
            item.addEventListener('click', () => {
                this.game.state.selectedEntity.entityId = buildingId;
                this.game.state.selectedEntity.type = "building";
                this.createShop();
            });
            
            container.appendChild(item);
        });
        
        if (this.ownedBuildings.size === 0) {
            const empty = document.createElement('div');
            empty.className = 'building-list-empty';
            empty.textContent = 'No buildings yet';
            container.appendChild(empty);
        }
    }

    renderActionPanel() {
        const container = document.getElementById('actionPanel');
        if (!container) return;
        container.innerHTML = '';

        if (this.game.state.selectedEntity.type == 'building') {
            this.renderBuildingActions(container);
        } else {
            this.renderBuildOptions(container);
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
                onClick: () => this.purchaseBuilding(buildingId, building)
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
            this.renderBuildOptions(container);
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
        building.units.forEach(unitId => {
            const unit = UnitTypes[unitId];

            const locked = this.game.state.playerGold < unit.value;
            console.log('locked:', locked, unit.value, this.game.state.playerGold);
            const btn = this.createActionButton({
                icon: unit.icon || '⚔️',
                title: unit.title,
                cost: unit.value,
                locked: locked,
                lockReason: locked ? "Can't afford" : null,
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

        const currentUpgrades = this.buildingUpgrades.get(this.game.state.selectedEntity.entityId) || new Set();

        building.upgrades.forEach(upgradeId => {
            const upgrade = this.game.getCollections().upgrades[upgradeId];
            if (upgrade) {
                const purchased = currentUpgrades.has(upgradeId);
                const locked = !purchased && upgrade.requires && !this.upgradeRequirementsMet(upgrade.requires);
                
                const btn = this.createActionButton({
                    icon: upgrade.icon || '⭐',
                    title: upgrade.title,
                    cost: purchased ? null : upgrade.value,
                    locked: locked,
                    purchased: purchased,
                    lockReason: locked ? 'Requires other upgrades' : null,
                    onClick: purchased ? null : () => this.purchaseUpgrade(upgradeId, upgrade)
                });
                grid.appendChild(btn);
            }
        });

        section.appendChild(grid);
        return section;
    }

    createActionButton(options) {
        const btn = document.createElement('button');
        btn.className = 'action-btn';

        if (options.locked) btn.classList.add('locked');
        if (options.purchased) btn.classList.add('purchased');
        if (!options.locked && !options.purchased && options.cost !== null && this.game.state.playerGold < options.cost) {
            btn.classList.add('disabled');
        }

        const icon = document.createElement('div');
        icon.className = 'action-btn-icon';
        icon.textContent = options.icon;
        btn.appendChild(icon);

        const title = document.createElement('div');
        title.className = 'action-btn-title';
        title.textContent = options.title;
        btn.appendChild(title);

        if (options.cost !== null && !options.purchased) {
            const cost = document.createElement('div');
            cost.className = 'action-btn-cost';
            cost.textContent = `${options.cost}g`;
            btn.appendChild(cost);
        }

        if (options.purchased) {
            const check = document.createElement('div');
            check.className = 'action-btn-check';
            check.textContent = '✓';
            btn.appendChild(check);
        }

        if (options.locked) {
            const lock = document.createElement('div');
            lock.className = 'action-btn-lock';
            lock.textContent = '🔒';
            btn.appendChild(lock);

            if (options.lockReason) {
                const tooltip = document.createElement('div');
                tooltip.className = 'action-btn-tooltip';
                tooltip.textContent = options.lockReason;
                btn.appendChild(tooltip);
            }
        }

        if (options.onClick && !options.locked && !options.purchased) {
            btn.addEventListener('click', options.onClick);
        }

        return btn;
    }

    canBuildingProduceUnit(building, unitId, unit) {
        if (!unit.requires || !unit.requires.buildings) return false;
        return unit.requires.buildings.includes(this.game.state.selectedEntity.entityId);
    }

    purchaseBuilding(buildingId, building){ 
        const state = this.game.state;
        
        if (state.playerGold < building.value) {
            this.showNotification('Not enough gold!', 'error');
            return;
        }

        state.selectedUnitType = { id: buildingId, collection: 'buildings', ...building };
        if (this.game.placementSystem) {
            this.game.placementSystem.handleUnitSelectionChange();
        }
    }

    oldpurchaseBuilding(buildingId, building) {
        this.game.networkManager.purchaseBuilding({ buildingId }, (success, response) => {
            if (success) {                
                if (building.category === 'attribute') {
                    this.townHallLevel = building.townHallLevel || 1;
                }
                this.game.state.playerGold -= building.value;
                this.showNotification(`${building.title} constructed!`, 'success');
                this.addBuilding(buildingId, building);
            } else {
                this.showNotification(`Could not purchase ${building.title}!`, 'error');
            }
        });
    }

    addBuilding(buildingId, building){
        if(!this.ownedBuildings.has(buildingId)){
            this.ownedBuildings.add(buildingId);
            this.applyBuildingEffects(building);
            this.createShop();
        }
    }

    purchaseUnit(unitId, unit) {
        const state = this.game.state;
        
        if (state.playerGold < unit.value) {
            this.showNotification('Not enough gold!', 'error');
            return;
        }

        const CT = this.game.componentManager.getComponentTypes();
        const team = this.game.getComponent(state.selectedEntity.entityId, CT.TEAM);        
        const placementId = team.placementId;
        if (!placementId) {
            this.showNotification('No building selected!', 'error');
            return;
        }

        unit.id = unitId;
        unit.collection = 'units';
        const placementPos = this.findBuildingPlacementPosition(placementId, unit);
        if (!placementPos) {
            this.showNotification('No valid placement near building!', 'error');
            return;
        }
        const placement = this.game.placementSystem.createPlacementData(placementPos, unit, this.game.state.mySide);
        console.log('purchase', placement, unit);
        this.game.networkManager.submitPlacement(placement, (success, response) => {
            if(success){
                this.game.placementSystem.placeSquad(placement);
                if(placement.collection == "buildings" && placement.unitType.id === 'goldMine'){
                    this.game.shopSystem.addBuilding(placement.unitType.id, placement.unitType);
                } else {
                    if(placement.collection == "buildings"){
                        this.game.shopSystem.addBuilding(placement.unitType.id, placement.unitType);
                    }
                }
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
                this.applyUpgradeEffects(upgrade);
                this.showNotification(`${upgrade.title} purchased!`, 'success');
                this.createShop();
            } else {
                this.showNotification(`Could not purchase ${upgrade.title}!`, 'error');
            }
        });
    }

    isBuildingLocked(buildingId, building) {
        if (building.requires) {
            if (building.requires.townHallLevel && this.townHallLevel < building.requires.townHallLevel) {
                return true;
            }
            if (building.requires.buildings) {
                for (const reqBuilding of building.requires.buildings) {
                    if (!this.ownedBuildings.has(reqBuilding)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    getLockReason(buildingId, building) {
        if (building.requires) {
            if (building.requires.townHallLevel && this.townHallLevel < building.requires.townHallLevel) {
                return `Requires Town Hall Level ${building.requires.townHallLevel}`;
            }
            if (building.requires.buildings) {
                const BuildingTypes = this.game.getCollections().buildings;
                for (const reqBuilding of building.requires.buildings) {
                    if (!this.ownedBuildings.has(reqBuilding)) {
                        const reqBuildingData = BuildingTypes[reqBuilding];
                        return `Requires ${reqBuildingData?.title || reqBuilding}`;
                    }
                }
            }
        }
        return 'Locked';
    }

    meetsRequirements(requires) {
        if (requires.buildings) {
            for (const reqBuilding of requires.buildings) {
                if (!this.ownedBuildings.has(reqBuilding)) {
                    return false;
                }
            }
        }
        return true;
    }

    upgradeRequirementsMet(requires) {
        const currentUpgrades = this.buildingUpgrades.get(this.game.state.selectedEntity.entityId) || new Set();
        
        if (requires.upgrades) {
            for (const reqUpgrade of requires.upgrades) {
                if (!currentUpgrades.has(reqUpgrade)) {
                    return false;
                }
            }
        }
        
        return true;
    }

    applyBuildingEffects(building) {
        if (building.effects) {
            building.effects.forEach(effectId => {
                const effect = this.game.getCollections().effects[effectId];
                if (effect) {
                    effect.id = effectId;
                    this.applyEffect(effect);
                }
            });
        }
    }

    applyUpgradeEffects(upgrade) {
        if (upgrade.effects) {
            upgrade.effects.forEach(effectId => {
                const effect = this.game.getCollections().effects[effectId];
                if (effect) {
                    effect.id = effectId;
                    this.applyEffect(effect);
                }
            });
        }
    }

    applyEffect(effectData) {
        const state = this.game.state;
        
        if (!state.buildingBonuses) {
            state.buildingBonuses = {
                goldPerRound: 0,
                unitStats: {}
            };
        }
        state.buildingBonuses[effectData.id] = 1;
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
        } else if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(message);
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

    saveState() {
        return {
            ownedBuildings: Array.from(this.ownedBuildings),
            buildingUpgrades: Array.from(this.buildingUpgrades.entries()).map(([k, v]) => [k, Array.from(v)]),
            townHallLevel: this.townHallLevel
        };
    }

    loadState(savedState) {
        if (savedState.ownedBuildings) {
            this.ownedBuildings = new Set(savedState.ownedBuildings);
        }
        if (savedState.buildingUpgrades) {
            this.buildingUpgrades = new Map(
                savedState.buildingUpgrades.map(([k, v]) => [k, new Set(v)])
            );
        }
        if (savedState.townHallLevel !== undefined) {
            this.townHallLevel = savedState.townHallLevel;
        }
        this.createShop();
    }
}