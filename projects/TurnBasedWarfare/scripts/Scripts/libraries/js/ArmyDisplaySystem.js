
class ArmyDisplaySystem {
    constructor(app) {
        this.game = app;   
        this.updateInterval = null;
        this.lastUpdateData = null;
    }
    
    initialize() {
        this.addArmyDisplayCSS();
        this.setupUpdateLoop();
    }
    
    setupUpdateLoop() {
        // Update army display every 500ms to avoid performance issues
        this.updateInterval = setInterval(() => {
            this.update();
        }, 500);
    }
    
    update() {
        const playerArmy = document.getElementById('playerArmy');
        const enemyArmy = document.getElementById('enemyArmy');
        
        if (!playerArmy || !enemyArmy) return;
        
        const armyData = this.getArmyData();
        
        // Only update if data has changed to avoid unnecessary DOM manipulation
        if (this.hasDataChanged(armyData)) {
            this.displayArmy(playerArmy, armyData.playerUnits, 'player');
            this.displayArmy(enemyArmy, armyData.enemyUnits, 'enemy');
            this.lastUpdateData = armyData;
        }
        
        this.updateArmyStats(armyData);
    }
    
    hasDataChanged(newData) {
        if (!this.lastUpdateData) return true;
        
        return (
            JSON.stringify(newData.playerUnits) !== JSON.stringify(this.lastUpdateData.playerUnits) ||
            JSON.stringify(newData.enemyUnits) !== JSON.stringify(this.lastUpdateData.enemyUnits)
        );
    }
    
    getArmyData() {
        try {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const allUnits = this.game.getEntitiesWith(
                ComponentTypes.TEAM, 
                ComponentTypes.UNIT_TYPE, 
                ComponentTypes.HEALTH
            ) || [];
            
            const playerUnits = [];
            const enemyUnits = [];
            
            allUnits.forEach(entityId => {
                const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
                const unitType = this.game.getComponent(entityId, ComponentTypes.UNIT_TYPE);
                const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
                const position = this.game.getComponent(entityId, ComponentTypes.POSITION);
                const combat = this.game.getComponent(entityId, ComponentTypes.COMBAT);
                
                const unitInfo = {
                    id: entityId,
                    type: unitType?.type || 'Unknown',
                    name: unitType?.name || unitType?.type || 'Unit',
                    health: health?.current || 0,
                    maxHealth: health?.max || 1,
                    position: position ? { x: position.x, z: position.z } : null,
                    damage: combat?.damage || 0,
                    status: this.getUnitStatus(entityId)
                };
                
                if (team?.team === 'player') {
                    playerUnits.push(unitInfo);
                } else if (team?.team === 'enemy') {
                    enemyUnits.push(unitInfo);
                }
            });
            
            // Sort by health percentage (wounded units first, then by position)
            const sortUnits = (units) => {
                return units.sort((a, b) => {
                    const healthPercentA = a.health / a.maxHealth;
                    const healthPercentB = b.health / b.maxHealth;
                    
                    // Wounded units first
                    if (healthPercentA < 1 && healthPercentB >= 1) return -1;
                    if (healthPercentB < 1 && healthPercentA >= 1) return 1;
                    
                    // Then sort by position (front to back)
                    if (a.position && b.position) {
                        return a.position.x - b.position.x;
                    }
                    
                    return 0;
                });
            };
            
            return {
                playerUnits: sortUnits(playerUnits),
                enemyUnits: sortUnits(enemyUnits)
            };
        } catch (error) {
            console.warn('Error getting army data:', error);
            return { playerUnits: [], enemyUnits: [] };
        }
    }
    
    getUnitStatus(entityId) {
        try {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(entityId, ComponentTypes.AI_STATE);
            const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
            
            if (health?.current <= 0) return 'dead';
            if (aiState?.state === 'attacking') return 'attacking';
            if (aiState?.state === 'moving') return 'moving';
            if (aiState?.state === 'idle') return 'idle';
            
            return 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }
    
    displayArmy(container, units, armyType) {
        // Clear container
        container.innerHTML = '';
        
        if (units.length === 0) {
            this.displayEmptyArmy(container, armyType);
            return;
        }
        
        // Create army header
        this.createArmyHeader(container, units, armyType);
        
        // Display units
        units.forEach((unit, index) => {
            const unitElement = this.createUnitElement(unit, index, armyType);
            container.appendChild(unitElement);
        });
    }
    
    displayEmptyArmy(container, armyType) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'army-empty';
        emptyDiv.innerHTML = `
            <div class="empty-icon">${armyType === 'player' ? '🛡️' : '⚔️'}</div>
            <div class="empty-text">
                ${armyType === 'player' ? 'No units deployed' : 'Enemy preparing...'}
            </div>
        `;
        container.appendChild(emptyDiv);
    }
    
    createArmyHeader(container, units, armyType) {
        const header = document.createElement('div');
        header.className = `army-header army-header-${armyType}`;
        
        const totalHealth = units.reduce((sum, unit) => sum + unit.health, 0);
        const maxHealth = units.reduce((sum, unit) => sum + unit.maxHealth, 0);
        const healthPercent = maxHealth > 0 ? Math.round((totalHealth / maxHealth) * 100) : 0;
        
        const aliveCount = units.filter(unit => unit.health > 0).length;
        
        header.innerHTML = `
            <div class="army-summary">
                <span class="unit-count">${aliveCount}/${units.length} Units</span>
                <span class="health-percent ${this.getHealthPercentClass(healthPercent)}">${healthPercent}% HP</span>
            </div>
            <div class="army-health-bar">
                <div class="health-bar-fill" style="width: ${healthPercent}%"></div>
            </div>
        `;
        
        container.appendChild(header);
    }
    
    createUnitElement(unit, index, armyType) {
        const unitDiv = document.createElement('div');
        unitDiv.className = `army-unit army-unit-${armyType}`;
        unitDiv.dataset.unitId = unit.id;
        
        const healthPercent = unit.health / unit.maxHealth;
        const healthClass = this.getHealthClass(healthPercent);
        const statusIcon = this.getStatusIcon(unit.status);
        
        unitDiv.innerHTML = `
            <div class="unit-info">
                <div class="unit-name-row">
                    <span class="unit-name">${unit.name}</span>
                    <span class="unit-status">${statusIcon}</span>
                </div>
                <div class="unit-health-row">
                    <span class="unit-health ${healthClass}">${unit.health}/${unit.maxHealth}</span>
                    <span class="unit-damage">⚔️${unit.damage}</span>
                </div>
                <div class="unit-health-bar">
                    <div class="health-bar-fill ${healthClass}" 
                         style="width: ${Math.max(0, healthPercent * 100)}%"></div>
                </div>
            </div>
        `;
        
        // Add click handler for unit selection/info
        unitDiv.addEventListener('click', () => {
            this.showUnitDetails(unit, armyType);
        });
        
        // Add hover effects
        unitDiv.addEventListener('mouseenter', () => {
            this.highlightUnit(unit.id);
        });
        
        unitDiv.addEventListener('mouseleave', () => {
            this.unhighlightUnit(unit.id);
        });
        
        return unitDiv;
    }
    
    getHealthClass(healthPercent) {
        if (healthPercent <= 0) return 'health-dead';
        if (healthPercent <= 0.25) return 'health-critical';
        if (healthPercent <= 0.5) return 'health-wounded';
        if (healthPercent <= 0.75) return 'health-damaged';
        return 'health-full';
    }
    
    getHealthPercentClass(percent) {
        if (percent <= 25) return 'health-critical';
        if (percent <= 50) return 'health-wounded';
        if (percent <= 75) return 'health-damaged';
        return 'health-full';
    }
    
    getStatusIcon(status) {
        const icons = {
            attacking: '⚔️',
            moving: '🏃',
            idle: '🛡️',
            dead: '💀',
            unknown: '❓'
        };
        return icons[status] || icons.unknown;
    }
    
    showUnitDetails(unit, armyType) {
        const details = `
            <h3>${unit.name} Details</h3>
            <div class="unit-details">
                <div class="detail-row">
                    <span>Health:</span>
                    <span class="${this.getHealthClass(unit.health / unit.maxHealth)}">
                        ${unit.health}/${unit.maxHealth}
                    </span>
                </div>
                <div class="detail-row">
                    <span>Damage:</span>
                    <span>${unit.damage}</span>
                </div>
                <div class="detail-row">
                    <span>Status:</span>
                    <span>${this.getStatusIcon(unit.status)} ${unit.status}</span>
                </div>
                ${unit.position ? `
                <div class="detail-row">
                    <span>Position:</span>
                    <span>(${unit.position.x.toFixed(1)}, ${unit.position.z.toFixed(1)})</span>
                </div>
                ` : ''}
            </div>
        `;
        
        // Use the input handler to show modal
        if (this.game.uiManager.input) {
            this.game.uiManager.input.showModal(`${armyType === 'player' ? '🛡️' : '⚔️'} Unit Info`, details);
        }
    }
    
    highlightUnit(unitId) {
        // Visual highlight on the battlefield (could integrate with effects system)
        if (this.game.uiManager.effects) {
            // Get unit position and show highlight effect
            try {
                const ComponentTypes = this.game.componentManager.getComponentTypes();
                const position = this.game.getComponent(unitId, ComponentTypes.POSITION);
                if (position) {
                    // Convert world position to screen position and show highlight
                    // This is a placeholder - actual implementation would depend on rendering system
                    console.log(`Highlighting unit ${unitId} at position (${position.x}, ${position.z})`);
                }
            } catch (error) {
                console.warn('Could not highlight unit:', error);
            }
        }
    }
    
    unhighlightUnit(unitId) {
        // Remove highlight
        console.log(`Unhighlighting unit ${unitId}`);
    }
    
    updateArmyStats(armyData) {
        this.updateArmyStrength(armyData);
        this.updateArmyComposition(armyData);
    }
    
    updateArmyStrength(armyData) {
        // Update army strength indicators
        const playerStrength = this.calculateArmyStrength(armyData.playerUnits);
        const enemyStrength = this.calculateArmyStrength(armyData.enemyUnits);
        
        // Update strength displays if they exist
        const playerStrengthEl = document.getElementById('playerArmyStrength');
        const enemyStrengthEl = document.getElementById('enemyArmyStrength');
        
        if (playerStrengthEl) {
            playerStrengthEl.textContent = playerStrength;
            playerStrengthEl.className = this.getStrengthClass(playerStrength);
        }
        
        if (enemyStrengthEl) {
            enemyStrengthEl.textContent = enemyStrength;
            enemyStrengthEl.className = this.getStrengthClass(enemyStrength);
        }
    }
    
    calculateArmyStrength(units) {
        return units.reduce((total, unit) => {
            const healthFactor = unit.health / unit.maxHealth;
            return total + (unit.damage * healthFactor);
        }, 0);
    }
    
    getStrengthClass(strength) {
        if (strength >= 100) return 'strength-very-high';
        if (strength >= 75) return 'strength-high';
        if (strength >= 50) return 'strength-medium';
        if (strength >= 25) return 'strength-low';
        return 'strength-very-low';
    }
    
    updateArmyComposition(armyData) {
        // Update army composition displays
        const playerComposition = this.analyzeComposition(armyData.playerUnits);
        const enemyComposition = this.analyzeComposition(armyData.enemyUnits);
        
        // Could update composition indicators here
        console.log('Player composition:', playerComposition);
        console.log('Enemy composition:', enemyComposition);
    }
    
    analyzeComposition(units) {
        const composition = {};
        units.forEach(unit => {
            composition[unit.type] = (composition[unit.type] || 0) + 1;
        });
        return composition;
    }
    
    addArmyDisplayCSS() {
        if (document.querySelector('#army-display-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'army-display-styles';
        style.textContent = `
            .army-empty {
                text-align: center; padding: 2rem; color: #666;
            }
            
            .empty-icon {
                font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5;
            }
            
            .empty-text {
                font-size: 0.9rem; opacity: 0.7;
            }
            
            .army-header {
                background: rgba(255, 255, 255, 0.05);
                padding: 0.8rem; margin-bottom: 0.5rem;
                border-radius: 5px; border-left: 3px solid;
            }
            
            .army-header-player { border-left-color: #00ff00; }
            .army-header-enemy { border-left-color: #ff4444; }
            
            .army-summary {
                display: flex; justify-content: space-between;
                align-items: center; margin-bottom: 0.5rem;
            }
            
            .unit-count {
                font-weight: bold; color: #ccc;
            }
            
            .health-percent {
                font-weight: bold; font-size: 0.9rem;
            }
            
            .army-health-bar {
                height: 4px; background: #333; border-radius: 2px; overflow: hidden;
            }
            
            .health-bar-fill {
                height: 100%; transition: width 0.3s ease;
            }
            
            .army-unit {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid transparent;
                border-radius: 4px; padding: 0.6rem;
                margin: 0.3rem 0; cursor: pointer;
                transition: all 0.2s ease;
            }
            
            .army-unit:hover {
                background: rgba(255, 255, 255, 0.08);
                border-color: rgba(255, 255, 255, 0.2);
                transform: translateX(2px);
            }
            
            .army-unit-player:hover { border-left-color: #00ff00; }
            .army-unit-enemy:hover { border-left-color: #ff4444; }
            
            .unit-info {
                font-size: 0.85rem;
            }
            
            .unit-name-row, .unit-health-row {
                display: flex; justify-content: space-between;
                align-items: center; margin-bottom: 0.3rem;
            }
            
            .unit-name {
                font-weight: bold; color: #ccc;
            }
            
            .unit-status {
                opacity: 0.8;
            }
            
            .unit-health {
                font-weight: bold;
            }
            
            .unit-damage {
                font-size: 0.8rem; opacity: 0.8;
            }
            
            .unit-health-bar {
                height: 3px; background: #333;
                border-radius: 2px; overflow: hidden;
            }
            
            /* Health color classes */
            .health-full, .health-full .health-bar-fill { color: #00ff00; background-color: #00ff00; }
            .health-damaged, .health-damaged .health-bar-fill { color: #88ff88; background-color: #88ff88; }
            .health-wounded, .health-wounded .health-bar-fill { color: #ffff00; background-color: #ffff00; }
            .health-critical, .health-critical .health-bar-fill { color: #ff8800; background-color: #ff8800; }
            .health-dead, .health-dead .health-bar-fill { color: #ff0000; background-color: #ff0000; opacity: 0.5; }
            
            /* Strength classes */
            .strength-very-high { color: #00ff88; }
            .strength-high { color: #88ff88; }
            .strength-medium { color: #ffff88; }
            .strength-low { color: #ff8888; }
            .strength-very-low { color: #ff4444; }
            
            /* Unit details modal content */
            .unit-details {
                font-family: monospace;
            }
            
            .detail-row {
                display: flex; justify-content: space-between;
                padding: 0.5rem 0; border-bottom: 1px solid #333;
            }
            
            .detail-row:last-child {
                border-bottom: none;
            }
        `;
        document.head.appendChild(style);
    }
    
    cleanup() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }
}
