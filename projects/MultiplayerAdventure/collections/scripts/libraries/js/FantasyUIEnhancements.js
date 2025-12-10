class FantasyUIEnhancements {
    constructor(game) {
        this.game = game;
        this.initializeEnhancements();
    }

    initializeEnhancements() {
        this.setupButtonAnimations();
        this.setupModeCardSelection();
        this.setupNotificationSystem();
        this.setupBattleLogAnimations();
        this.addParticleEffects();
    }

    /**
     * Enhanced button interactions with ripple effects
     */
    setupButtonAnimations() {
        document.addEventListener('DOMContentLoaded', () => {
            const buttons = document.querySelectorAll('.btn, .ready-btn, .level-up-button, .undo-button');
            buttons.forEach(button => {
                // Hover effects
                button.addEventListener('mouseenter', () => {
                    if (!button.disabled) {
                        button.style.transform = 'translateY(-2px) scale(1.02)';
                    }
                });
                
                button.addEventListener('mouseleave', () => {
                    if (!button.disabled) {
                        button.style.transform = 'translateY(0) scale(1)';
                    }
                });

                // Ripple effect on click
                button.addEventListener('click', (e) => {
                    this.createRippleEffect(e.target, e);
                });
            });
        });
    }

    /**
     * Creates ripple effect on button click
     */
    createRippleEffect(button, event) {
        const ripple = document.createElement('span');
        ripple.style.cssText = `
            position: absolute;
            border-radius: 50%;
            background: rgba(212, 175, 55, 0.6);
            transform: scale(0);
            animation: ripple 0.6s linear;
            pointer-events: none;
            z-index: 1;
        `;
        
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (event.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (event.clientY - rect.top - size / 2) + 'px';
        
        button.style.position = 'relative';
        button.style.overflow = 'hidden';
        button.appendChild(ripple);
        
        setTimeout(() => {
            if (ripple.parentNode) {
                ripple.remove();
            }
        }, 600);
    }

    /**
     * Enhanced mode card selection with animations
     */
    setupModeCardSelection() {
        document.addEventListener('click', (e) => {
            const modeCard = e.target.closest('.mode-card');
            if (modeCard) {
                // Remove selected class from all cards
                const allCards = document.querySelectorAll('.mode-card');
                allCards.forEach(card => {
                    card.classList.remove('selected');
                    card.style.animation = 'cardDeselect 0.3s ease-out';
                });
                
                // Add selected class to clicked card
                modeCard.classList.add('selected');
                modeCard.style.animation = 'cardSelect 0.4s ease-out';
                
                // Create selection sound effect (visual feedback)
                this.createSelectionEffect(modeCard);
            }
        });
    }

    /**
     * Creates visual selection effect for mode cards
     */
    createSelectionEffect(card) {
        const effect = document.createElement('div');
        effect.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 20px;
            height: 20px;
            background: radial-gradient(circle, rgba(255, 140, 0, 0.8), transparent);
            border-radius: 50%;
            transform: translate(-50%, -50%) scale(0);
            animation: selectionPulse 0.8s ease-out;
            pointer-events: none;
            z-index: 10;
        `;
        
        card.style.position = 'relative';
        card.appendChild(effect);
        
        setTimeout(() => {
            if (effect.parentNode) {
                effect.remove();
            }
        }, 800);
    }

    /**
     * Enhanced notification system
     */
    setupNotificationSystem() {
        this.notificationContainer = document.createElement('div');
        this.notificationContainer.id = 'notificationContainer';
        this.notificationContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 3000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(this.notificationContainer);
    }

    /**
     * Show enhanced notification with fantasy styling
     */
    showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `fantasy-notification ${type}`;
        notification.style.cssText = `
            background: linear-gradient(145deg, rgba(26, 13, 26, 0.95), rgba(13, 10, 26, 0.95));
            border: 2px solid var(--primary-gold);
            border-radius: 8px;
            padding: 1rem 1.5rem;
            color: var(--parchment);
            font-family: var(--font-title);
            min-width: 250px;
            max-width: 400px;
            box-shadow: 0 0 20px rgba(212, 175, 55, 0.3);
            animation: notificationSlideIn 0.3s ease-out;
            backdrop-filter: blur(10px);
        `;

        // Set border color based on type
        switch (type) {
            case 'success':
                notification.style.borderColor = 'var(--forest-green)';
                message = `✅ ${message}`;
                break;
            case 'error':
                notification.style.borderColor = 'var(--blood-red)';
                message = `❌ ${message}`;
                break;
            case 'warning':
                notification.style.borderColor = 'var(--accent-amber)';
                message = `⚠️ ${message}`;
                break;
            default:
                message = `ℹ️ ${message}`;
        }

        notification.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="background: none; border: none; color: var(--stone-gray); cursor: pointer; font-size: 1.2rem; margin-left: 1rem;">×</button>
            </div>
        `;

        this.notificationContainer.appendChild(notification);

        // Auto-hide after duration
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'notificationSlideOut 0.3s ease-in';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, duration);

        return notification;
    }

    /**
     * Enhanced battle log with smooth animations
     */
    setupBattleLogAnimations() {
        this.battleLogQueue = [];
        this.isProcessingLog = false;
    }

    /**
     * Add battle log entry with animation
     */
    addBattleLogEntry(message, type = 'default') {
        this.battleLogQueue.push({ message, type });
        if (!this.isProcessingLog) {
            this.processBattleLogQueue();
        }
    }

    /**
     * Process battle log queue with animations
     */
    processBattleLogQueue() {
        if (this.battleLogQueue.length === 0) {
            this.isProcessingLog = false;
            return;
        }

        this.isProcessingLog = true;
        const { message, type } = this.battleLogQueue.shift();
        
        const battleLog = document.getElementById('battleLog');
        if (!battleLog) {
            this.processBattleLogQueue();
            return;
        }

        const entry = document.createElement('div');
        entry.classList.add('log-entry');
        if (type !== 'default') {
            entry.classList.add(`log-${type}`);
        }
        
        entry.textContent = message;
        entry.style.cssText = `
            opacity: 0;
            transform: translateX(-20px);
            transition: all 0.4s ease;
        `;

        battleLog.appendChild(entry);

        // Animate in
        setTimeout(() => {
            entry.style.opacity = '1';
            entry.style.transform = 'translateX(0)';
        }, 10);

        // Auto-scroll to bottom
        battleLog.scrollTop = battleLog.scrollHeight;

        // Remove old entries if too many
        const entries = battleLog.querySelectorAll('.log-entry');
        if (entries.length > 50) {
            const oldEntry = entries[0];
            oldEntry.style.opacity = '0';
            oldEntry.style.transform = 'translateX(-20px)';
            setTimeout(() => {
                if (oldEntry.parentNode) {
                    oldEntry.remove();
                }
            }, 400);
        }

        // Process next entry after delay
        setTimeout(() => {
            this.processBattleLogQueue();
        }, 200);
    }

    /**
     * Add floating particle effects
     */
    addParticleEffects() {
        // Add particles to main menu
        const mainMenu = document.getElementById('mainMenu');
        if (mainMenu && !mainMenu.querySelector('.particle-container')) {
            this.createParticleSystem(mainMenu);
        }

        // Add subtle particles to game screen
        const gameScreen = document.getElementById('gameScreen');
        if (gameScreen && !gameScreen.querySelector('.particle-container')) {
            this.createParticleSystem(gameScreen, 'subtle');
        }
    }

    /**
     * Create particle system for backgrounds
     */
    createParticleSystem(container, intensity = 'normal') {
        const particleContainer = document.createElement('div');
        particleContainer.className = 'particle-container';
        particleContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
            overflow: hidden;
        `;

        const particleCount = intensity === 'subtle' ? 15 : 30;
        const particleSize = intensity === 'subtle' ? 2 : 3;
        const particleOpacity = intensity === 'subtle' ? 0.3 : 0.6;

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: ${particleSize}px;
                height: ${particleSize}px;
                background: radial-gradient(circle, rgba(212, 175, 55, ${particleOpacity}), transparent);
                border-radius: 50%;
                animation: particleFloat ${15 + Math.random() * 20}s linear infinite;
                animation-delay: ${Math.random() * 10}s;
                left: ${Math.random() * 100}%;
                top: ${Math.random() * 100}%;
            `;
            particleContainer.appendChild(particle);
        }

        container.style.position = 'relative';
        container.appendChild(particleContainer);
    }

    /**
     * Enhanced screen transitions
     */
    switchScreen(fromScreenId, toScreenId) {
        const fromScreen = document.getElementById(fromScreenId);
        const toScreen = document.getElementById(toScreenId);

        if (fromScreen) {
            fromScreen.style.animation = 'screenFadeOut 0.4s ease-in forwards';
            setTimeout(() => {
                fromScreen.classList.remove('active');
                fromScreen.style.animation = '';
            }, 400);
        }

        setTimeout(() => {
            if (toScreen) {
                toScreen.classList.add('active');
                toScreen.style.animation = 'screenFadeIn 0.6s ease-out';
                
                // Add particles if it's main menu
                if (toScreenId === 'mainMenu') {
                    this.addParticleEffects();
                }
            }
        }, fromScreen ? 200 : 0);
    }

    /**
     * Create enhanced unit card with animations
     */
    createEnhancedUnitCard(unitData) {
        const card = document.createElement('div');
        card.className = 'unit-card';
        card.dataset.unitId = unitData.id;
        card.style.animation = 'cardSlideIn 0.3s ease-out';

        // Add shimmer effect for rare/special units
        if (unitData.rarity && unitData.rarity !== 'common') {
            card.classList.add('rare-unit');
            this.addShimmerEffect(card, unitData.rarity);
        }

        card.innerHTML = `
            <div class="unit-name">${unitData.name || unitData.title}</div>
            <div class="unit-cost">💰 ${unitData.value || unitData.cost}g</div>
            <div class="unit-stats">⚔️ ${unitData.damage} | 🛡️ ${unitData.hp}</div>
        `;

        // Add tooltip
        if (unitData.description) {
            card.title = unitData.description;
        }

        // Add selection animation
        card.addEventListener('click', () => {
            this.animateUnitSelection(card);
        });

        return card;
    }

    /**
     * Add shimmer effect for rare units
     */
    addShimmerEffect(card, rarity) {
        const shimmer = document.createElement('div');
        shimmer.style.cssText = `
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.4), transparent);
            animation: shimmer 3s ease-in-out infinite;
            pointer-events: none;
            z-index: 1;
        `;
        
        card.style.position = 'relative';
        card.style.overflow = 'hidden';
        card.appendChild(shimmer);
    }

    /**
     * Animate unit card selection
     */
    animateUnitSelection(card) {
        // Remove selection from other cards
        document.querySelectorAll('.unit-card.selected').forEach(c => {
            c.classList.remove('selected');
        });

        // Add selection to this card
        card.classList.add('selected');
        
        // Create selection burst effect
        const burst = document.createElement('div');
        burst.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 10px;
            height: 10px;
            background: radial-gradient(circle, rgba(255, 140, 0, 0.8), transparent);
            border-radius: 50%;
            transform: translate(-50%, -50%) scale(0);
            animation: selectionBurst 0.6s ease-out;
            pointer-events: none;
            z-index: 10;
        `;
        
        card.appendChild(burst);
        setTimeout(() => burst.remove(), 600);
    }

    /**
     * Enhanced experience panel creation
     */
    createEnhancedExperiencePanel(squadData) {
        const panel = document.createElement('div');
        panel.className = 'experience-panel';
        panel.style.animation = 'experienceGlow 2s ease-in-out infinite alternate';

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="color: var(--stone-gray); font-size: 14px; font-weight: bold;">
                    ${squadData.displayName} (Lvl ${squadData.level})
                </span>
                <span style="color: var(--accent-amber); font-size: 12px;">
                    → ${squadData.nextLevelName}
                </span>
            </div>
            <div class="experience-bar">
                <div class="experience-fill" style="width: 100%;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--stone-gray); margin-bottom: 8px;">
                <span>Ready to level up!</span>
                <span>${squadData.levelUpCost}g cost</span>
            </div>
        `;

        const levelUpButton = document.createElement('button');
        levelUpButton.className = 'level-up-button';
        levelUpButton.textContent = `Level Up (-${squadData.levelUpCost}g)`;
        levelUpButton.addEventListener('click', () => {
            this.animateLevelUp(panel);
        });

        panel.appendChild(levelUpButton);
        return panel;
    }

    /**
     * Animate level up effect
     */
    animateLevelUp(panel) {
        // Create level up burst effect
        const burst = document.createElement('div');
        burst.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 20px;
            height: 20px;
            background: radial-gradient(circle, rgba(255, 215, 0, 0.9), rgba(255, 140, 0, 0.5), transparent);
            border-radius: 50%;
            transform: translate(-50%, -50%) scale(0);
            animation: levelUpBurst 1s ease-out;
            pointer-events: none;
            z-index: 10;
        `;
        
        panel.style.position = 'relative';
        panel.appendChild(burst);
        
        setTimeout(() => burst.remove(), 1000);
        
        // Show success notification
        this.showNotification('🌟 Squad leveled up successfully!', 'success');
    }

    /**
     * Copy room ID with enhanced feedback
     */
    copyRoomId() {
        const roomId = document.getElementById('lobbyRoomId').textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(roomId).then(() => {
                this.showNotification(`🏰 Room ID "${roomId}" copied to clipboard!`, 'success');
                
                // Visual feedback on the room ID element
                const roomIdEl = document.getElementById('lobbyRoomId');
                roomIdEl.style.animation = 'copyPulse 0.6s ease-out';
                setTimeout(() => {
                    roomIdEl.style.animation = '';
                }, 600);
            });
        } else {
            this.showNotification('📋 Copy feature not available in this browser', 'warning');
        }
    }
}

if(typeof FantasyUIEnhancements != 'undefined'){
        
    // Export for use in your game systems
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FantasyUIEnhancements;
    } else if (typeof window !== 'undefined') {
        window.FantasyUIEnhancements = FantasyUIEnhancements;
    }
}