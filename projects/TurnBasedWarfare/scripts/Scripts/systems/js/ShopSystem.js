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
        card.style.cssText = `
            margin-bottom: 12px;
            padding: 12px;
            background: linear-gradient(135deg, rgba(255, 140, 0, 0.15), rgba(212, 175, 55, 0.15));
            border-radius: 10px;
            border: 2px solid var(--accent-amber);
            animation: experienceGlow 2s ease-in-out infinite alternate;
            position: relative;
            overflow: hidden;
        `;

        // Add magical shimmer effect for specialization
        if (canSpecialize) {
            const shimmer = document.createElement('div');
            shimmer.style.cssText = `
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.3), transparent);
                animation: shimmer 3s ease-in-out infinite;
                pointer-events: none;
                z-index: 1;
            `;
            card.appendChild(shimmer);
        }

        const currentLevelText = ` (Lvl ${squad.level})`;
        const nextLevelText = canSpecialize ? 
            '⭐ Ascend!' : ` → ${squad.nextLevelName}`;
        const buttonText = canSpecialize ? 
            `🌟 Ascend` : 
            `⚡ Level Up`;
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; position: relative; z-index: 2;">
                <span style="color: var(--parchment); font-size: 13px; font-weight: bold; font-family: var(--font-title);">
                    🛡️ ${squad.displayName}${currentLevelText}
                </span>
                <span style="color: ${canSpecialize ? '#ffaa00' : '#44ff44'}; font-size: 12px; font-weight: bold;">
                    ${nextLevelText}
                </span>
            </div>
            <div class="experience-bar" style="position: relative; z-index: 2;">
                <div class="experience-fill" style="width: 100%;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; position: relative; z-index: 2;">
                <span>💰 ${squad.levelUpCost}g cost</span>
            </div>
        `;
        
        const levelUpButton = document.createElement('button');
        levelUpButton.className = 'level-up-button';
        levelUpButton.textContent = buttonText;
        levelUpButton.disabled = this.game.state.playerGold < squad.levelUpCost;
        levelUpButton.style.position = 'relative';
        levelUpButton.style.zIndex = '2';
        
        if (canSpecialize) {
            levelUpButton.style.background = 'linear-gradient(135deg, #cc6600, #ff8800)';
            levelUpButton.style.borderColor = '#ffaa00';
            levelUpButton.style.boxShadow = '0 0 15px rgba(255, 170, 0, 0.4)';
        }
        
        levelUpButton.addEventListener('click', () => {
            // Create level up animation
            this.animateLevelUp(card);
            
            const success = this.game.squadExperienceSystem.levelUpSquad(squad.placementId);
            if (success || canSpecialize) {
                // Show success notification
                this.uiEnhancements.showNotification(
                    `🌟 ${squad.displayName} has been enhanced!`, 
                    'success'
                );
                
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
                border-radius: 4px;
                font-size: 10px;
                color: #ffaa00;
                position: relative;
                z-index: 2;
                border: 1px solid rgba(255, 170, 0, 0.3);
            `;
            
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

    animateLevelUp(panel) {
        // Create magical level up burst effect
        const burst = document.createElement('div');
        burst.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 20px;
            height: 20px;
            background: radial-gradient(circle, 
                rgba(255, 215, 0, 0.9) 0%, 
                rgba(255, 140, 0, 0.6) 50%, 
                transparent 100%);
            border-radius: 50%;
            transform: translate(-50%, -50%) scale(0);
            animation: levelUpBurst 1.2s ease-out;
            pointer-events: none;
            z-index: 10;
        `;
        
        panel.appendChild(burst);
        
        // Create sparkle effects
        for (let i = 0; i < 6; i++) {
            const sparkle = document.createElement('div');
            sparkle.style.cssText = `
                position: absolute;
                top: ${20 + Math.random() * 60}%;
                left: ${20 + Math.random() * 60}%;
                width: 4px;
                height: 4px;
                background: var(--primary-gold);
                transform: scale(0);
                animation: sparkle 0.8s ease-out ${Math.random() * 0.4}s;
                pointer-events: none;
                z-index: 10;
            `;
            panel.appendChild(sparkle);
            
            setTimeout(() => sparkle.remove(), 1200);
        }
        
        setTimeout(() => burst.remove(), 1200);
    }

    

    createUnitCard(unitId, unitType) {
        if (unitType.value < 0 || !unitType.buyable) return null;
        
        const card = document.createElement('div');
        card.className = 'unit-card';
        card.dataset.unitId = unitId;
        card.style.cssText = `
            background: linear-gradient(145deg, rgba(13, 10, 26, 0.8), rgba(26, 13, 26, 0.8));
            border: 2px solid var(--dark-bronze);
            border-radius: 8px;
            padding: 12px;
            cursor: pointer;
            text-align: center;
            transition: all 0.3s ease;
            font-size: 0.85rem;
            position: relative;
            overflow: hidden;
            animation: cardSlideIn 0.3s ease-out;
        `;

        // Add rarity-based effects
        const rarity = this.determineUnitRarity(unitType);
        if (rarity !== 'common') {
            this.addRarityEffects(card, rarity);
        }

        // Enhanced unit card with squad info
        const squadInfo = this.game.squadManager ? 
            this.game.squadManager.getSquadInfo(unitType) : null;
        const statsText = squadInfo ? 
            `👥 ${squadInfo.squadSize} units, ${squadInfo.formationType} formation` :
            `⚔️ ${unitType.damage} DMG | 🛡️ ${unitType.hp} HP`;
        
        card.innerHTML = `
            <div class="unit-name" style="font-family: var(--font-title); color: var(--primary-gold); font-weight: 600; margin-bottom: 6px; font-size: 0.9rem;">
                ${this.getUnitIcon(unitType)} ${unitType.title}
            </div>
            <div class="unit-cost" style="color: var(--accent-amber); font-size: 0.8rem; margin-bottom: 6px; font-weight: bold;">
                💰 Cost: ${unitType.value}g
            </div>
            <div class="unit-stats" style="font-size: 0.75rem; line-height: 1.2;">
                ${statsText}
            </div>
        `;

        // Add unit description tooltip
        if (unitType.description) {
            card.title = unitType.description;
        }

        // Enhanced click handler with animations
        card.addEventListener('click', (e) => {
            this.selectUnitWithAnimation(card, { id: unitId, ...unitType }, e);
        });

        // Add hover effects
        this.addUnitCardHoverEffects(card);

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
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        ripple.style.cssText = `
            position: absolute;
            left: ${x - 10}px;
            top: ${y - 10}px;
            width: 20px;
            height: 20px;
            background: radial-gradient(circle, rgba(255, 140, 0, 0.8), transparent);
            border-radius: 50%;
            transform: scale(0);
            animation: selectionRipple 0.6s ease-out;
            pointer-events: none;
            z-index: 10;
        `;
        
        card.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
        
        // Add golden glow effect
        card.style.boxShadow = '0 0 20px rgba(255, 140, 0, 0.6), inset 0 0 20px rgba(255, 140, 0, 0.1)';
    }

    showInsufficientGoldEffect(card) {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(183, 28, 28, 0.3);
            border-radius: 8px;
            animation: insufficientGoldFlash 0.6s ease-out;
            pointer-events: none;
            z-index: 5;
        `;
        
        card.appendChild(flash);
        setTimeout(() => flash.remove(), 600);
        
        // Show error message
        this.uiEnhancements.showNotification('💰 Insufficient gold!', 'error', 2000);
    }

    addUnitCardHoverEffects(card) {
        const shimmerEffect = document.createElement('div');
        shimmerEffect.style.cssText = `
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.2), transparent);
            transition: left 0.5s ease;
            pointer-events: none;
            z-index: 1;
        `;
        card.appendChild(shimmerEffect);

        card.addEventListener('mouseenter', () => {
            if (!card.classList.contains('disabled')) {
                card.style.borderColor = 'var(--primary-gold)';
                card.style.transform = 'translateY(-3px) scale(1.02)';
                card.style.boxShadow = '0 8px 20px rgba(212, 175, 55, 0.3), 0 0 15px rgba(212, 175, 55, 0.2)';
                shimmerEffect.style.left = '100%';
            }
        });

        card.addEventListener('mouseleave', () => {
            if (!card.classList.contains('selected') && !card.classList.contains('disabled')) {
                card.style.borderColor = 'var(--dark-bronze)';
                card.style.transform = 'translateY(0) scale(1)';
                card.style.boxShadow = 'none';
                shimmerEffect.style.left = '-100%';
            }
        });
    }

    determineUnitRarity(unitType) {
        if (unitType.value > 150) return 'legendary';
        if (unitType.value > 100) return 'epic';
        if (unitType.value > 50) return 'rare';
        return 'common';
    }

    addRarityEffects(card, rarity) {
        const colors = {
            rare: 'rgba(65, 105, 225, 0.3)',      // Blue
            epic: 'rgba(138, 43, 226, 0.3)',      // Purple
            legendary: 'rgba(255, 215, 0, 0.3)'   // Gold
        };

        const glowColor = colors[rarity] || colors.rare;
        
        card.style.borderColor = rarity === 'legendary' ? 'var(--primary-gold)' : 
                                rarity === 'epic' ? 'var(--rich-purple)' : 
                                'var(--mystic-blue)';
        
        card.style.background = `
            linear-gradient(145deg, rgba(13, 10, 26, 0.8), rgba(26, 13, 26, 0.8)),
            radial-gradient(circle at center, ${glowColor} 0%, transparent 70%)
        `;

        // Add animated border for legendary units
        if (rarity === 'legendary') {
            const borderAnimation = document.createElement('div');
            borderAnimation.style.cssText = `
                position: absolute;
                top: -2px;
                left: -2px;
                right: -2px;
                bottom: -2px;
                border-radius: 10px;
                background: linear-gradient(45deg, var(--primary-gold), var(--accent-amber), var(--primary-gold));
                animation: legendaryBorder 3s ease-in-out infinite;
                z-index: -1;
                pointer-events: none;
            `;
            card.appendChild(borderAnimation);
        }
    }

    getUnitIcon(unitType) {
        // Return appropriate icon based on unit type
        const iconMap = {
            knight: '🛡️',
            warrior: '⚔️',
            archer: '🏹',
            mage: '🔮',
            healer: '✨',
            dragon: '🐉',
            giant: '👹',
            assassin: '🗡️',
            paladin: '⚡',
            necromancer: '💀'
        };

        const unitName = unitType.title.toLowerCase();
        for (const [key, icon] of Object.entries(iconMap)) {
            if (unitName.includes(key)) {
                return icon;
            }
        }
        return '⚔️'; // Default icon
    }

    getCurrentUnitType(placementId, side) {
        if (!this.game.placementSystem) return null;
        const placements = this.game.placementSystem.getPlacementsForSide(side);
        const placement = placements.find(p => p.placementId === placementId);
        return placement ? placement.unitType : null;
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
        
        // Update unit card states efficiently
        document.querySelectorAll('.unit-card').forEach(card => {
            const unitId = card.dataset.unitId;
            const unitType = UnitTypes[unitId];
            
            if (!unitType) return;
            
            const canAfford = state.playerGold >= unitType.value;
            const wasDisabled = card.classList.contains('disabled');
            const shouldBeDisabled = !canAfford || !inPlacementPhase;
            
            if (wasDisabled !== shouldBeDisabled) {
                card.classList.toggle('disabled', shouldBeDisabled);
                
                // Update visual state
                if (shouldBeDisabled) {
                    card.style.opacity = '0.4';
                    card.style.cursor = 'not-allowed';
                    card.style.filter = 'grayscale(0.7)';
                } else {
                    card.style.opacity = '1';
                    card.style.cursor = 'pointer';
                    card.style.filter = 'none';
                }
                
                // Update cost display color
                const costElement = card.querySelector('.unit-cost');
                if (costElement) {
                    costElement.style.color = canAfford ? 'var(--accent-amber)' : 'var(--blood-red)';
                }
            }
        });
    }

    reset() {
        this.lastExperienceUpdate = 0;
        this.showingExperiencePanel = false;
    }
}


