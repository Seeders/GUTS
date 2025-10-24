class BuildingShopSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.buildingShopSystem = this;
        this.lastUpdate = 0;
        this.ownedBuildings = new Set();
        this.buildingUpgrades = new Map();
        this.townHallLevel = 0;
        this.peasantCount = 0;
    }


    createShop() {
        const shop = document.getElementById('buildingShop');
        if (!shop) return;
        
        shop.innerHTML = '';
        
        const BuildingTypes = this.game.getCollections().buildings;

        console.log('building types:', BuildingTypes);
        if (!BuildingTypes) return;

        const categories = {
            townhall: [],
            units: [],
            attributes: []
        };

        Object.keys(BuildingTypes).forEach(buildingId => {
            const building = { id: buildingId, ...BuildingTypes[buildingId] };
            if (building.category === 'townhall') {
                categories.townhall.push(building);
            } else if (building.category === 'unit') {
                categories.units.push(building);
            } else if (building.category === 'attribute') {
                categories.attributes.push(building);
            }
        });

        if (categories.townhall.length > 0) {
            this.createSection(shop, '🏛️ Town Hall', categories.townhall);
        }

        if (categories.attributes.length > 0) {
            this.createSection(shop, '⚡ Attributes', categories.attributes);
        }

        if (categories.units.length > 0) {
            this.createSection(shop, '⚔️ Units', categories.units);
        }
    }

    createSection(shop, title, buildings) {
        const section = document.createElement('div');
        section.className = 'building-section';
        
        const header = document.createElement('h4');
        header.className = 'building-section-header';
        header.textContent = title;
        section.appendChild(header);

        buildings.forEach(building => {
            const card = this.createBuildingCard(building.id, building);
            if (card) {
                section.appendChild(card);
            }
        });

        shop.appendChild(section);
    }

    createBuildingCard(buildingId, buildingType) {
        const owned = this.ownedBuildings.has(buildingId);
        const locked = this.isBuildingLocked(buildingId, buildingType);
        
        const card = document.createElement('div');
        card.className = 'building-card';
        if (owned) card.classList.add('owned');
        if (locked) card.classList.add('locked');
        card.dataset.buildingId = buildingId;

        const upgrades = this.buildingUpgrades.get(buildingId) || new Set();
        const upgradeCount = upgrades.size;
        const totalUpgrades = buildingType.upgrades ? buildingType.upgrades.length : 0;

        const headerDiv = document.createElement('div');
        headerDiv.className = 'building-card-header';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'building-card-title';
        titleDiv.textContent = `${this.getBuildingIcon(buildingType)} ${buildingType.title}`;
        headerDiv.appendChild(titleDiv);

        if (owned && totalUpgrades > 0) {
            const progressDiv = document.createElement('div');
            progressDiv.className = 'building-card-progress';
            progressDiv.textContent = `${upgradeCount}/${totalUpgrades}`;
            headerDiv.appendChild(progressDiv);
        }

        card.appendChild(headerDiv);

        if (!owned) {
            const costDiv = document.createElement('div');
            costDiv.className = 'building-card-cost';
            costDiv.textContent = `💰 Cost: ${buildingType.value}g`;
            card.appendChild(costDiv);
        }

        if (locked) {
            const lockDiv = document.createElement('div');
            lockDiv.className = 'building-card-locked';
            lockDiv.textContent = `🔒 ${this.getLockReason(buildingId, buildingType)}`;
            card.appendChild(lockDiv);
        }

        const descDiv = document.createElement('div');
        descDiv.className = 'building-card-description';
        descDiv.textContent = buildingType.description || '';
        card.appendChild(descDiv);

        if (owned) {
            const ownedDiv = document.createElement('div');
            ownedDiv.className = 'building-card-owned';
            ownedDiv.textContent = '✓ Built';
            card.appendChild(ownedDiv);
        }

        if (!locked) {
            card.addEventListener('click', () => {
                if (owned) {
                    this.showUpgradePanel(buildingId, buildingType);
                } else {
                     this.game.networkManager.purchaseBuilding({ buildingId: buildingId }, (success, response) => {
                        if(success){
                            this.purchaseBuilding(buildingId, buildingType, card);
                        } else {
                            this.showNotification(`Could not purchase ${buildingType.title}!`, 'error');
                        }
                    });        
                }
            });
            this.addBuildingCardHoverEffects(card);
        }

        return card;
    }

    isBuildingLocked(buildingId, buildingType) {
        if (buildingType.requires) {
            if (buildingType.requires.townHallLevel) {
                if (this.townHallLevel < buildingType.requires.townHallLevel) {
                    return true;
                }
            }
            if (buildingType.requires.buildings) {
                for (const reqBuilding of buildingType.requires.buildings) {
                    if (!this.ownedBuildings.has(reqBuilding)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    getLockReason(buildingId, buildingType) {
        if (buildingType.requires) {
            if (buildingType.requires.townHallLevel) {
                if (this.townHallLevel < buildingType.requires.townHallLevel) {
                    const names = ['Town Hall', 'Keep', 'Castle'];
                    return `Requires ${names[buildingType.requires.townHallLevel - 1]}`;
                }
            }
            if (buildingType.requires.buildings) {
                const BuildingTypes = this.game.getCollections().buildings;
                for (const reqBuilding of buildingType.requires.buildings) {
                    if (!this.ownedBuildings.has(reqBuilding)) {
                        return `Requires ${BuildingTypes[reqBuilding]?.title || reqBuilding}`;
                    }
                }
            }
        }
        return 'Locked';
    }

    purchaseBuilding(buildingId, buildingType, card) {
        const state = this.game.state;
        const cost = buildingType.value;

        if (state.playerGold < cost) {
            this.showInsufficientGoldEffect(card);
            this.showNotification('Not enough gold!', 'error');
            return;
        }
        console.log('purchase building', buildingId);
        if (buildingId === 'goldMine') {
            if (this.game.goldMineSystem) {
                const result = this.game.goldMineSystem.buildGoldMine(state.mySide);
                
                if (!result.success) {
                    this.showNotification(result.error, 'error');
                    this.showInsufficientGoldEffect(card);
                    return;
                }
            }
        }
        state.playerGold -= cost;
        this.ownedBuildings.add(buildingId);
        
        if (buildingType.category == 'attribute') {
            this.townHallLevel = buildingType.townHallLevel || 1;
        }
       
        this.applyBuildingEffects(buildingType);
        
        this.showNotification(`${buildingType.title} constructed!`, 'success');
        this.createShop();
        
        if (buildingType.unlocksUnit && this.game.shopSystem) {
            this.game.shopSystem.createShop();
        }
    }

    showUpgradePanel(buildingId, buildingType) {
        if (!buildingType.upgrades || buildingType.upgrades.length === 0) {
            this.showNotification('No upgrades available', 'info');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'upgrade-modal';

        const panel = document.createElement('div');
        panel.className = 'upgrade-panel';

        const currentUpgrades = this.buildingUpgrades.get(buildingId) || new Set();

        const header = document.createElement('h3');
        header.className = 'upgrade-panel-header';
        header.textContent = `${this.getBuildingIcon(buildingType)} ${buildingType.title}`;
        panel.appendChild(header);

        const upgradeList = document.createElement('div');
        upgradeList.className = 'upgrade-list';
        
        buildingType.upgrades.forEach(upgradeId => {
            const upgrade = this.game.getCollections().upgrades[upgradeId];
            const purchased = currentUpgrades.has(upgrade.id);
            const canAfford = this.game.state.playerGold >= upgrade.value;
            const locked = upgrade.requires && !this.upgradeRequirementsMet(upgrade.requires, buildingId);

            const upgradeCard = document.createElement('div');
            upgradeCard.className = 'upgrade-card';
            if (purchased) upgradeCard.classList.add('purchased');
            if (locked) upgradeCard.classList.add('locked');
            if (!purchased && !locked) upgradeCard.classList.add('available');

            const upgradeHeader = document.createElement('div');
            upgradeHeader.className = 'upgrade-card-header';

            const upgradeName = document.createElement('div');
            upgradeName.className = 'upgrade-card-name';
            upgradeName.textContent = upgrade.title;
            upgradeHeader.appendChild(upgradeName);
            const upgradeStatus = document.createElement('div');
            upgradeStatus.className = 'upgrade-card-status';
            if (purchased) {
                upgradeStatus.textContent = '✓';
            } else if (locked) {
                upgradeStatus.textContent = '🔒';
            } else {
                upgradeStatus.textContent = `${upgrade.value}g`;
            }
            upgradeHeader.appendChild(upgradeStatus);

            upgradeCard.appendChild(upgradeHeader);

            const upgradeDesc = document.createElement('div');
            upgradeDesc.className = 'upgrade-card-description';
            upgradeDesc.textContent = upgrade.description;
            upgradeCard.appendChild(upgradeDesc);

            if (locked && upgrade.requires) {
                const requirementDiv = document.createElement('div');
                requirementDiv.className = 'upgrade-card-requirement';
                requirementDiv.textContent = this.getUpgradeRequirementText(upgrade.requires, buildingId);
                upgradeCard.appendChild(requirementDiv);
            }

            if (!purchased && !locked) {
                upgradeCard.addEventListener('click', () => {
                    this.game.networkManager.purchaseUpgrade({ upgradeId: upgradeId, buildingId: buildingId }, (success, response) => {
                        if(success){
                            this.purchaseUpgrade(buildingId, buildingType, upgrade, modal);
                        } else {
                            modal.remove();
                            this.showNotification(`Could not purchase ${upgrade.title}!`, 'error');
                        }
                    });        
                });
            }

            upgradeList.appendChild(upgradeCard);
        });

        panel.appendChild(upgradeList);

        const closeButton = document.createElement('button');
        closeButton.className = 'btn upgrade-close-button';
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', () => {
            modal.remove();
        });
        panel.appendChild(closeButton);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modal.appendChild(panel);
        document.body.appendChild(modal);
    }

    upgradeRequirementsMet(requires, buildingId) {
        const currentUpgrades = this.buildingUpgrades.get(buildingId) || new Set();
        
        if (requires.upgrades) {
            for (const reqUpgrade of requires.upgrades) {
                if (!currentUpgrades.has(reqUpgrade)) {
                    return false;
                }
            }
        }
        
        return true;
    }

    getUpgradeRequirementText(requires, buildingId) {
        if (requires.upgrades) {
            const BuildingTypes = this.game.getCollections().buildings;
            const building = BuildingTypes[buildingId];
            const missingUpgrades = requires.upgrades.filter(upId => {
                const currentUpgrades = this.buildingUpgrades.get(buildingId) || new Set();
                return !currentUpgrades.has(upId);
            });
            
            if (missingUpgrades.length > 0) {
                const upgradeName = building.upgrades.find(u => u.id === missingUpgrades[0])?.title || missingUpgrades[0];
                return `Requires: ${upgradeName}`;
            }
        }
        return 'Requirements not met';
    }

    purchaseUpgrade(buildingId, buildingType, upgrade, modal) {
        const state = this.game.state;

        if (state.playerGold < upgrade.value) {
            this.showNotification('Not enough gold!', 'error');
            return;
        }

        state.playerGold -= upgrade.value;
        
        if (!this.buildingUpgrades.has(buildingId)) {
            this.buildingUpgrades.set(buildingId, new Set());
        }
        this.buildingUpgrades.get(buildingId).add(upgrade.id);

        this.applyUpgradeEffects(upgrade);

        this.showNotification(`${upgrade.title} purchased!`, 'success');
        
        modal.remove();
        this.showUpgradePanel(buildingId, buildingType);
        this.createShop();
    }

    applyBuildingEffects(buildingType) {
        if (buildingType.effects) {
            buildingType.effects.forEach(effectId => {
                const effect = this.game.getCollections().effects[effectId];   
                effect.id = effectId;
                this.applyEffect(effect);
            });
        }
    }

    applyUpgradeEffects(upgrade) {
        if (upgrade.effects) {
            upgrade.effects.forEach(effectId => {
                const effect = this.game.getCollections().effects[effectId];     
                effect.id = effectId;           
                this.applyEffect(effect);
            });
        }

        if (upgrade.unlocksAbility && this.game.shopSystem) {
            this.game.shopSystem.createShop();
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

    getBuildingIcon(buildingType) {
        return buildingType.icon || '🏛️';
    }

    addBuildingCardHoverEffects(card) {
        card.addEventListener('mouseenter', () => {
            if (!card.classList.contains('locked')) {
                card.classList.add('hover');
            }
        });

        card.addEventListener('mouseleave', () => {
            card.classList.remove('hover');
        });
    }

    showInsufficientGoldEffect(card) {
        card.classList.add('shake');
        setTimeout(() => {
            card.classList.remove('shake');
        }, 500);
    }

    showNotification(message, type) {
        if (this.game.shopSystem?.uiEnhancements) {
            this.game.shopSystem.uiEnhancements.showNotification(message, type);
        } 
    }

    update() {
        const state = this.game.state;
        const inPlacementPhase = state.phase === 'placement';
        
        if (this.game.state.now - this.lastUpdate > 2) {
            document.querySelectorAll('.building-card').forEach(card => {
                if (inPlacementPhase) {
                    card.classList.remove('phase-disabled');
                } else {
                    card.classList.add('phase-disabled');
                }
            });
            
            this.lastUpdate = this.game.state.now;
        }
    }

    reset() {
        this.lastUpdate = 0;
    }

    saveState() {
        return {
            ownedBuildings: Array.from(this.ownedBuildings),
            buildingUpgrades: Array.from(this.buildingUpgrades.entries()).map(([k, v]) => [k, Array.from(v)]),
            townHallLevel: this.townHallLevel,
            peasantCount: this.peasantCount
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
        if (savedState.peasantCount !== undefined) {
            this.peasantCount = savedState.peasantCount;
        }
        this.createShop();
    }
}