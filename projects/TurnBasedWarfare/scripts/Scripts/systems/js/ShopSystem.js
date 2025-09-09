class ShopSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.shopSystem = this;
        
        // Experience UI state
        this.showingExperiencePanel = false;
        this.lastExperienceUpdate = 0;
    }
    
    createShop() {
        const shop = document.getElementById('unitShop');
        shop.innerHTML = '';
        
        // Add experience panel at the top (only during placement phase)
        if (this.game.state.phase === 'placement') {
            const experiencePanel = this.createExperiencePanel();
            if (experiencePanel) {
                shop.appendChild(experiencePanel);
            }
        }
        
        // Add undo button
        const undoButton = this.createUndoButton();
        shop.appendChild(undoButton);
        
        const UnitTypes = this.game.getCollections().units;

        // Get all valid units and sort by price (cheapest first)
        const sortedUnits = Object.keys(UnitTypes)
            .map(unitId => ({ id: unitId, ...UnitTypes[unitId] }))
            .filter(unit => unit.value >= 0)
            .sort((a, b) => a.value - b.value);

        sortedUnits.forEach(unit => {
            const card = this.createUnitCard(unit.id, unit);
            if(card){
                shop.appendChild(card);
            }
        });
    }
    
    createExperiencePanel() {
        if (!this.game.squadExperienceSystem) return null;
        
        const squadsReadyToLevelUp = this.game.squadExperienceSystem.getSquadsReadyToLevelUp();
        
        if (squadsReadyToLevelUp.length === 0) return null;
        
        const panel = document.createElement('div');
        panel.className = 'experience-panel';
        panel.style.cssText = `
            margin-bottom: 15px;
            padding: 12px;
            background: linear-gradient(135deg, rgba(0, 255, 0, 0.1), rgba(255, 255, 0, 0.1));
            border-radius: 8px;
            border: 2px solid #44ff44;
            animation: experienceGlow 2s ease-in-out infinite alternate;
        `;
        
        // Add CSS animation for glow effect
        if (!document.getElementById('experience-glow-style')) {
            const style = document.createElement('style');
            style.id = 'experience-glow-style';
            style.textContent = `
                @keyframes experienceGlow {
                    from { box-shadow: 0 0 5px rgba(68, 255, 68, 0.3); }
                    to { box-shadow: 0 0 15px rgba(68, 255, 68, 0.8); }
                }
                .level-up-button {
                    background: linear-gradient(135deg, #006600, #008800);
                    color: white;
                    border: 1px solid #00aa00;
                    padding: 6px 12px;
                    margin: 2px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s ease;
                    display: block;
                    width: 100%;
                }
                .level-up-button:hover {
                    background: linear-gradient(135deg, #008800, #00aa00);
                    transform: translateY(-1px);
                    box-shadow: 0 2px 5px rgba(0, 255, 0, 0.3);
                }
                .level-up-button:disabled {
                    background: #444;
                    color: #888;
                    cursor: not-allowed;
                    transform: none;
                    box-shadow: none;
                }
                .experience-bar {
                    width: 100%;
                    height: 8px;
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 4px;
                    overflow: hidden;
                    margin: 4px 0;
                }
                .experience-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #ffff00, #44ff44);
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }
            `;
            document.head.appendChild(style);
        }
        
        const title = document.createElement('h4');
        title.textContent = '⭐ SQUADS READY TO LEVEL UP! ⭐';
        title.style.cssText = `
            color: #44ff44;
            margin: 0 0 10px 0;
            text-align: center;
            font-size: 14px;
        `;
        panel.appendChild(title);
        
        squadsReadyToLevelUp.forEach(squad => {
            const squadDiv = this.createSquadLevelUpCard(squad);
            panel.appendChild(squadDiv);
        });
        
        return panel;
    }
    
    createSquadLevelUpCard(squad) {
        const card = document.createElement('div');
        card.style.cssText = `
            margin-bottom: 8px;
            padding: 8px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            border: 1px solid #333;
        `;
        
        const currentLevelName = squad.levelName || '';
        const currentLevelText = squad.level > 0 ? ` ${currentLevelName} Lv.${squad.level}` : '';
        
        // Check if this squad can specialize at the next level
        const isSpecializationLevel = (squad.level) == 2;
        const currentUnitType = this.game.squadExperienceSystem.getCurrentUnitType(squad.placementId);
        const hasSpecializations = currentUnitType && currentUnitType.specUnits && currentUnitType.specUnits.length > 0;
        const canSpecialize = isSpecializationLevel && hasSpecializations;
        
        const nextLevelText = canSpecialize ? ' & Specialize!' : ` → ${squad.nextLevelName}`;
        const buttonText = canSpecialize ? `Level Up & Choose Specialization (-${squad.levelUpCost}g)` : `Level Up to ${squad.nextLevelName} (-${squad.levelUpCost}g)`;
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="color: #ccc; font-size: 13px; font-weight: bold;">
                    ${squad.displayName}${currentLevelText}
                </span>
                <span style="color: ${canSpecialize ? '#ffaa00' : '#44ff44'}; font-size: 12px;">
                    ${nextLevelText}
                </span>
            </div>
            <div class="experience-bar">
                <div class="experience-fill" style="width: 100%;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: #999; margin-bottom: 6px;">
                <span>${canSpecialize ? 'Ready to specialize!' : 'Ready to level up!'}</span>
                <span>${squad.levelUpCost}g cost</span>
            </div>
        `;
        
        const levelUpButton = document.createElement('button');
        levelUpButton.className = 'level-up-button';
        levelUpButton.textContent = buttonText;
        levelUpButton.disabled = this.game.state.playerGold < squad.levelUpCost;
        
        if (canSpecialize) {
            levelUpButton.style.background = 'linear-gradient(135deg, #cc6600, #ff8800)';
            levelUpButton.style.borderColor = '#ffaa00';
        }
        
        levelUpButton.addEventListener('click', () => {

            const success = this.game.squadExperienceSystem.levelUpSquad(squad.placementId);
            if (success || canSpecialize) { // Also refresh if specialization dialog was shown
                // Refresh the shop to update the experience panel
                setTimeout(() => {
                    this.createShop();
                }, 100);
            }
     
        });
        
        card.appendChild(levelUpButton);
        
        // Add specialization preview if available
        if (canSpecialize && currentUnitType.specUnits.length > 0) {
            const previewDiv = document.createElement('div');
            previewDiv.style.cssText = `
                margin-top: 8px;
                padding: 6px;
                background: rgba(255, 170, 0, 0.1);
                border-radius: 3px;
                font-size: 10px;
                color: #ffaa00;
            `;
            
            const collections = this.game.getCollections();
            const specNames = currentUnitType.specUnits
                .map(specId => {
                    const spec = collections.units[specId];
                    return spec ? (spec.title || specId) : specId;
                })
                .join(', ');
            
            previewDiv.innerHTML = `⭐ Available: ${specNames}`;
            card.appendChild(previewDiv);
        }
        
        return card;
    }
    
    createUndoButton() {
        const undoContainer = document.createElement('div');
        undoContainer.className = 'undo-container';
        undoContainer.style.cssText = `
            margin-bottom: 10px;
            padding: 10px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 5px;
            border: 1px solid #444;
        `;
        
        const undoButton = document.createElement('button');
        undoButton.id = 'undoButton';
        undoButton.className = 'undo-button';
        undoButton.innerHTML = '↶ Undo (Ctrl+Z)';
        undoButton.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            background: #444;
            color: #fff;
            border: 1px solid #666;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
        `;
        
        undoButton.addEventListener('click', () => {
            if (this.game.placementSystem) {
                this.game.placementSystem.undoLastPlacement();
            }
        });
        
        undoButton.addEventListener('mouseenter', () => {
            if (!undoButton.disabled) {
                undoButton.style.background = '#555';
                undoButton.style.borderColor = '#777';
            }
        });
        
        undoButton.addEventListener('mouseleave', () => {
            if (!undoButton.disabled) {
                undoButton.style.background = '#444';
                undoButton.style.borderColor = '#666';
            }
        });
        
        undoContainer.appendChild(undoButton);
        return undoContainer;
    }
    
    createUnitCard(unitId, unitType) {
        if(unitType.value < 0 || !unitType.buyable) return null;
        
        const card = document.createElement('div');
        card.className = 'unit-card';
        // Store the unit ID directly on the element for reliable lookup
        card.dataset.unitId = unitId;
        
        // Enhanced unit card with potential level information
        const squadInfo = this.game.squadManager ? this.game.squadManager.getSquadInfo(unitType) : null;
        const statsText = squadInfo ? 
            `${squadInfo.squadSize} units, ${squadInfo.formationType} formation` :
            `${unitType.hp} HP, ${unitType.damage} DMG`;
        
        card.innerHTML = `
            <div class="unit-name">${unitType.title}</div>
            <div class="unit-cost">Cost: ${unitType.value}g</div>
            <div class="unit-stats"><p>${statsText}</p></div>
        `;
        
        card.addEventListener('click', () => this.selectUnit({ id: unitId, ...unitType }));
        return card;
    }
    
    selectUnit(unitType) {
        const state = this.game.state;
        if (state.phase !== 'placement' || state.playerGold < unitType.value) return;
        
        state.selectedUnitType = unitType;
        this.game.placementSystem.handleUnitSelectionChange(unitType);
        // Update UI selection
        document.querySelectorAll('.unit-card').forEach(card => {
            card.classList.remove('selected');
        });
        event.target.closest('.unit-card').classList.add('selected');
        
        const squadInfo = this.game.squadManager ? this.game.squadManager.getSquadInfo(unitType) : null;
        const message = squadInfo ? 
            `Selected ${unitType.title} squad (${squadInfo.squadSize} units, ${unitType.value}g)` :
            `Selected ${unitType.title} (${unitType.value}g)`;
        
        this.game.battleLogSystem.add(message);
    }
    
    update(deltaTime) {
        const state = this.game.state;
        const UnitTypes = this.game.getCollections().units;
        const inPlacementPhase = state.phase === 'placement';
        
        // Update undo button
        this.updateUndoButton(inPlacementPhase);
        
        // Update experience panel if needed
        if (inPlacementPhase && this.game.squadExperienceSystem) {
            const now = Date.now();
            if (now - this.lastExperienceUpdate > 2000) { // Update every 2 seconds
                const squadsReadyToLevelUp = this.game.squadExperienceSystem.getSquadsReadyToLevelUp();
                const hasReadySquads = squadsReadyToLevelUp.length > 0;
                const hasExperiencePanel = document.querySelector('.experience-panel') !== null;
                
                // Refresh shop if experience panel state changed
                if (hasReadySquads !== hasExperiencePanel) {
                    this.createShop();
                }
                
                this.lastExperienceUpdate = now;
            }
        }
        
        // Use dataset.unitId to reliably match cards with unit types
        document.querySelectorAll('.unit-card').forEach(card => {
            const unitId = card.dataset.unitId;
            const unitType = UnitTypes[unitId];
            
            if (!unitType) {
                console.warn(`Unit type not found for ID: ${unitId}`);
                return;
            }
            
            const canAfford = state.playerGold >= unitType.value;
            
            // Update card state
            card.classList.toggle('disabled', !canAfford || !inPlacementPhase);
            
            // Optional: Update card display with current affordability
            const costElement = card.querySelector('.unit-cost');
            if (costElement) {
                costElement.textContent = `Cost: ${unitType.value}g`;
                costElement.style.color = canAfford ? '' : '#ff4444';
            }
        });
        
        // Update level-up buttons if they exist
        document.querySelectorAll('.level-up-button').forEach(button => {
            const costMatch = button.textContent.match(/\((-?\d+)g\)/);
            if (costMatch) {
                const cost = parseInt(costMatch[1].replace('-', ''));
                button.disabled = state.playerGold < cost;
            }
        });
        
        // Update gold display
        const goldElement = document.getElementById('playerGold');
        if (goldElement) {
            goldElement.textContent = state.playerGold;
        }
        
        // Update enemy strength
        const strengthLevels = ['Weak', 'Normal', 'Strong', 'Elite', 'Legendary'];
        const strengthIndex = Math.min(Math.floor((state.round - 1) / 2), strengthLevels.length - 1);
        const strengthElement = document.getElementById('enemyStrength');
        if (strengthElement) {
            strengthElement.textContent = strengthLevels[strengthIndex];
        }
    }
    
    updateUndoButton(inPlacementPhase) {
        const undoButton = document.getElementById('undoButton');
        if (!undoButton || !this.game.placementSystem) return;
        
        const undoStatus = this.game.placementSystem.getUndoStatus();
        const canUndo = undoStatus.canUndo && inPlacementPhase;
        
        undoButton.disabled = !canUndo;
        
        if (canUndo) {
            undoButton.style.background = '#444';
            undoButton.style.color = '#fff';
            undoButton.style.cursor = 'pointer';
            undoButton.style.opacity = '1';
            
            // Show what can be undone
            if (undoStatus.lastAction) {
                const lastAction = undoStatus.lastAction;
                undoButton.innerHTML = `↶ Undo ${lastAction.unitType.title} (+${lastAction.cost}g)`;
            } else {
                undoButton.innerHTML = '↶ Undo (Ctrl+Z)';
            }
        } else {
            undoButton.style.background = '#222';
            undoButton.style.color = '#666';
            undoButton.style.cursor = 'not-allowed';
            undoButton.style.opacity = '0.5';
            undoButton.innerHTML = undoStatus.undoCount === 0 ? '↶ Nothing to undo' : '↶ Undo (placement phase only)';
        }
    }
    
    // Method to be called by experience system for UI updates
    updateSquadExperience() {
        if (this.game.state.phase === 'placement') {
            // Throttled shop refresh
            const now = Date.now();
            if (now - this.lastExperienceUpdate > 1000) {
                this.createShop();
                this.lastExperienceUpdate = now;
            }
        }
    }
    
    // Helper method to get all purchasable units
    getPurchasableUnits() {
        const UnitTypes = this.game.getCollections().units;
        return Object.keys(UnitTypes)
            .filter(unitId => UnitTypes[unitId].value >= 0)
            .map(unitId => ({ id: unitId, ...UnitTypes[unitId] }));
    }
    
    // Helper method to check if a specific unit is affordable
    isUnitAffordable(unitId) {
        const UnitTypes = this.game.getCollections().units;
        const unitType = UnitTypes[unitId];
        return unitType && this.game.state.playerGold >= unitType.value;
    }
    
    // Method to clear selection
    clearSelection() {
        this.game.state.selectedUnitType = null;
        document.querySelectorAll('.unit-card').forEach(card => {
            card.classList.remove('selected');
        });
    }
    
    // Method to update a specific unit card
    updateUnitCard(unitId) {
        const card = document.querySelector(`[data-unit-id="${unitId}"]`);
        if (!card) return;
        
        const UnitTypes = this.game.getCollections().units;
        const unitType = UnitTypes[unitId];
        if (!unitType) return;
        
        const state = this.game.state;
        const canAfford = state.playerGold >= unitType.value;
        const inPlacementPhase = state.phase === 'placement';
        
        card.classList.toggle('disabled', !canAfford || !inPlacementPhase);
        
        // Update cost display color
        const costElement = card.querySelector('.unit-cost');
        if (costElement) {
            costElement.style.color = canAfford ? '' : '#ff4444';
        }
    }
    
    // Method to refresh the entire shop
    refreshShop() {
        this.createShop();
    }
}