class ShopSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.shopSystem = this;
        
        // Experience UI state
        this.showingExperiencePanel = false;
        this.lastExperienceUpdate = 0;
        
        // Initialize fantasy UI enhancements
        this.uiEnhancements = new FantasyUIEnhancements(game);
    }


    createShop() {
        const shop = document.getElementById('unitShop');
        shop.innerHTML = '';
        
        // Add experience panel at the top (only during placement phase)
        if (this.game.state.phase === 'placement') {
            this.createExperiencePanel();
        }
        
        // Add undo button with fantasy styling
        
        const UnitTypes = this.game.getCollections().units;

        // Get all valid units and sort by price (cheapest first)
        const sortedUnits = Object.keys(UnitTypes)
            .map(unitId => ({ id: unitId, ...UnitTypes[unitId] }))
            .filter(unit => unit.value >= 0)
            .sort((a, b) => a.value - b.value);

        // Create enhanced unit cards with animations
        sortedUnits.forEach(unit => {
            const card = this.createUnitCard(unit.id, unit);
            if (card) {
                shop.appendChild(card);
            }
        });
        if(this.game.buildingShopSystem){
            this.game.buildingShopSystem.createShop();
        }
    }

    createExperiencePanel() {
        if (!this.game.squadExperienceSystem) return null;
        
        const container = document.getElementById('unitPromotions');
        container.innerHTML = '';

        const squadsReadyToLevelUp = this.game.squadExperienceSystem.getSquadsReadyToLevelUp();
        
        if (squadsReadyToLevelUp.length === 0) return null;

        squadsReadyToLevelUp.forEach((squad, index) => {
            const panel = this.createExperienceCard(squad);
            container.appendChild(panel);
        });

        return container;
    }

    createExperienceCard(squad) {
        const currentUnitType = this.getCurrentUnitType(squad.placementId, squad.team);
        if (!currentUnitType) return null;

        const hasSpecializations = currentUnitType.specUnits && currentUnitType.specUnits.length > 0;
        const isSpecializationLevel = (squad.level) == 2;
        const canSpecialize = isSpecializationLevel && hasSpecializations;
        const card = document.createElement('div');
        card.className = 'experience-panel';

        // Add magical shimmer effect for specialization
        if (canSpecialize) {
            const shimmer = document.createElement('div');
            shimmer.classList.add("shimmer");
            card.appendChild(shimmer);
        }

        const currentLevelText = ` (Lvl ${squad.level})`;
        const nextLevelText = canSpecialize ? 
            '⭐ Ascend!' : ` → ${squad.nextLevelName}`;
        const buttonText = canSpecialize ? 
            `🌟 Ascend` : 
            `⚡ Level Up`;
        
        card.innerHTML = `
            <div class="experience-squad-info">
                <span class="experience-squad-name">
                    🛡️ ${squad.displayName}${currentLevelText}
                </span>
                <span class="${canSpecialize ? 'experience-nextLevelSpec' : 'experience-nextLevel'}">
                    ${nextLevelText}
                </span>
            </div>
            <div class="experience-bar">
                <div class="experience-fill"></div>
            </div>
            <div class="experience-levelUpCost">
                <span>💰 ${squad.levelUpCost}g cost</span>
            </div>
        `;
        
        const levelUpButton = document.createElement('button');
        levelUpButton.className = 'level-up-button';
        levelUpButton.textContent = buttonText;
        levelUpButton.disabled = this.game.state.playerGold < squad.levelUpCost;
        
        if (canSpecialize) {
            levelUpButton.classList.add('level-up-button-spec');
        }
        
        levelUpButton.addEventListener('click', () => {
            // Create level up animation
            this.animateLevelUp(card);
            
           this.game.squadExperienceSystem.levelUpSquad(squad.placementId, null, null, (success) => {
                if (success || canSpecialize) {
                    // Show success notification
                    this.uiEnhancements.showNotification(
                        `🌟 ${squad.displayName} has been enhanced!`, 
                        'success'
                    );                    
                    
                }
                this.createShop();
            });
      
        });
        
        card.appendChild(levelUpButton);
        
        // Add specialization preview if available
        if (canSpecialize && currentUnitType.specUnits.length > 0) {
            const previewDiv = document.createElement('div');
            previewDiv.classList.add('spec-unit-preview')
            
            const collections = this.game.getCollections();
            const specNames = currentUnitType.specUnits
                .map(specId => {
                    const spec = collections.units[specId];
                    return spec ? (spec.title || specId) : specId;
                })
                .join(', ');
            
            previewDiv.innerHTML = `⭐ Available Specializations: ${specNames}`;
            card.appendChild(previewDiv);
        }
        
        return card;
    }

    getUnitIcon(unitType) {
        // Extract the base unit name from the unit ID
        // This assumes your icon files follow the pattern: icon_<unitname>.png
        const unitId = unitType.id || unitType.type || '';
        
        // Map unit IDs to icon file names
        const iconMap = {
            // Primary units
            '1_d_archer': 'archer',
            '1_sd_soldier': 'soldier', 
            '1_s_barbarian': 'barbarian',
            '1_is_acolyte': 'acolyte',
            '1_i_apprentice': 'apprentice',
            '1_di_scout': 'rogue',
            '0_golemStone': 'stoneGolem'            
        };
        
        // Get the icon filename or fallback to a default
        const iconName = iconMap[unitId] || 'default';
        const iconPath = `/projects/TurnBasedWarfare/resources/images/icon_${iconName}.png`;
        
        // Return an img element instead of emoji
        return `<img src="${iconPath}" alt="${unitType.title}" class="unit-icon">`;
    }


    createUnitCard(unitId, unitType) {
        if (unitType.value < 0 || !unitType.buyable) return null;
        
        const card = document.createElement('div');
        card.className = 'unit-card';
        card.dataset.unitId = unitId;

        // Add rarity-based effects
        const rarity = this.determineUnitRarity(unitType);
        if (rarity !== 'common') {
            this.addRarityEffects(card, rarity);
        }

        // Enhanced unit card with squad info
        const squadInfo = this.game.squadManager ? 
            this.game.squadManager.getSquadInfo(unitType) : null;
        const statsText = squadInfo ? 
            `💥 ${squadInfo.squadSize} units, ${squadInfo.formationType} formation` :
            `⚔️ ${unitType.damage} DMG | 🛡️ ${unitType.hp} HP`;
        
        // Create the card content with proper HTML structure
        const nameDiv = document.createElement('div');
        nameDiv.className = 'unit-name';
        nameDiv.innerHTML = `${this.getUnitIcon(unitType)} ${unitType.title}`;
        
        const costDiv = document.createElement('div');
        costDiv.className = 'unit-cost';
        costDiv.textContent = `💰 Cost: ${unitType.value}g`;
        
        const statsDiv = document.createElement('div');
        statsDiv.className = 'unit-stats';
        statsDiv.textContent = statsText;
        
        // Add shimmer effect element for CSS hover animation
        const shimmerEffect = document.createElement('div');
        shimmerEffect.className = "shimmer";
        card.appendChild(shimmerEffect);
        
        // Append all elements to the card
        card.appendChild(nameDiv);
        card.appendChild(costDiv);
        card.appendChild(statsDiv);

        // Add unit description tooltip
        if (unitType.description) {
            card.title = unitType.description;
        }

        // Click handler only (no hover listeners)
        card.addEventListener('click', (e) => {
            this.selectUnitWithAnimation(card, { id: unitId, ...unitType }, e);
        });

        return card;
    }

    selectUnitWithAnimation(card, unitType, event) {
        const state = this.game.state;
        if (state.phase !== 'placement' || state.playerGold < unitType.value) {
            // Show insufficient gold animation
            this.showInsufficientGoldEffect(card);
            return;
        }
        
        state.selectedUnitType = unitType;
        this.game.placementSystem.handleUnitSelectionChange(unitType);
        
        // Update UI selection with animation
        document.querySelectorAll('.unit-card').forEach(c => {
            c.classList.remove('selected');
            c.style.transform = 'scale(1)';
        });
        
        card.classList.add('selected');
        
        // Create selection effect
        this.createSelectionEffect(card, event);
        
        // Show selection feedback
        const squadInfo = this.game.squadManager ? 
            this.game.squadManager.getSquadInfo(unitType) : null;
        const message = squadInfo ? 
            `🛡️ Selected ${unitType.title} squad (${squadInfo.squadSize} units, ${unitType.value}g)` :
            `⚔️ Selected ${unitType.title} (${unitType.value}g)`;
        
        this.game.battleLogSystem.add(message);
        this.uiEnhancements.showNotification(`Selected: ${unitType.title}`, 'success', 2000);
    }

    createSelectionEffect(card, event) {
        const ripple = document.createElement('div');
        ripple.className = 'selection-ripple';
        
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        ripple.style.left = `${x - 10}px`;
        ripple.style.top = `${y - 10}px`;
        
        card.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
        
        // Add golden glow effect
        card.style.boxShadow = '0 0 20px rgba(255, 140, 0, 0.6), inset 0 0 20px rgba(255, 140, 0, 0.1)';
    }

    showInsufficientGoldEffect(card) {
        const flash = document.createElement('div');
        flash.style.className = "insufficientGoldEffect";
        
        card.appendChild(flash);
        setTimeout(() => flash.remove(), 600);
        
        // Show error message
        this.uiEnhancements.showNotification('💰 Insufficient gold!', 'error', 2000);
    }


    determineUnitRarity(unitType) {
        if (unitType.value > 150) return 'legendary';
        if (unitType.value > 100) return 'epic';
        if (unitType.value > 50) return 'rare';
        return 'common';
    }

    addRarityEffects(card, rarity) {
        // Add rarity class for CSS styling
        card.classList.add(`rarity-${rarity}`);

        // Add animated border element for legendary units
        if (rarity === 'legendary') {
            const borderAnimation = document.createElement('div');
            borderAnimation.className = 'legendary-border';
            card.appendChild(borderAnimation);
        }
    }
    getCurrentUnitType(placementId, side) {
        if (!this.game.placementSystem) return null;
        const placements = this.game.placementSystem.getPlacementsForSide(side);
        const placement = placements.find(p => p.placementId === placementId);
        return placement ? placement.unitType : null;
    }

    animateLevelUp(panel) {
        // Create magical level up burst effect
        const burst = document.createElement('div');
        burst.className = 'level-up-burst';
        panel.appendChild(burst);
        
        // Create sparkle effects
        for (let i = 0; i < 6; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'level-up-sparkle';
            sparkle.style.top = `${20 + Math.random() * 60}%`;
            sparkle.style.left = `${20 + Math.random() * 60}%`;
            sparkle.style.animationDelay = `${Math.random() * 0.4}s`;
            panel.appendChild(sparkle);
            
            setTimeout(() => sparkle.remove(), 1200);
        }
        
        setTimeout(() => burst.remove(), 1200);
    }
    // Enhanced update method with better performance
    update() {
        const state = this.game.state;
        const UnitTypes = this.game.getCollections().units;
        const inPlacementPhase = state.phase === 'placement';
        
        // Update experience panel if needed (throttled)
        if (inPlacementPhase && this.game.squadExperienceSystem) {
            if (this.game.state.now - this.lastExperienceUpdate > 2) {
                const squadsReadyToLevelUp = this.game.squadExperienceSystem.getSquadsReadyToLevelUp();
                const hasReadySquads = squadsReadyToLevelUp.length > 0;
                const hasExperiencePanel = document.querySelector('.experience-panel') !== null;
                
                // Refresh shop if experience panel state changed
                if (hasReadySquads !== hasExperiencePanel) {
                    this.createShop();
                }
                
                this.lastExperienceUpdate = this.game.state.now;
            }
        }
        
        // Update unit card states efficiently using CSS classes
        document.querySelectorAll('.unit-card').forEach(card => {
            const unitId = card.dataset.unitId;
            const unitType = UnitTypes[unitId];
            
            if (!unitType) return;
            
            const canAfford = state.playerGold >= unitType.value;
            const wasDisabled = card.classList.contains('disabled');
            const shouldBeDisabled = !canAfford || !inPlacementPhase;
            
            if (wasDisabled !== shouldBeDisabled) {
                card.classList.toggle('disabled', shouldBeDisabled);
                
                // Update cost display color using CSS classes
                const costElement = card.querySelector('.unit-cost');
                if (costElement) {
                    if (canAfford) {
                        costElement.classList.add('cost-affordable');
                        costElement.classList.remove('cost-unaffordable');
                    } else {
                        costElement.classList.add('cost-unaffordable');
                        costElement.classList.remove('cost-affordable');
                    }
                }
            }
        });
    }

    reset() {
        this.lastExperienceUpdate = 0;
        this.showingExperiencePanel = false;
    }
}


