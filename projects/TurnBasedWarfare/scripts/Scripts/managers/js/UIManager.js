 class UIManager {
    constructor(app) {
        this.game = app;
        this.game.uiManager = this;
        this.phaseTimer = null;
        this.canvas = document.getElementById('gameCanvas');
        this.setupEventListeners();
    }
    setupEventListeners() {
        this.canvas.addEventListener('click', (event) => this.handleCanvasClick(event));

        document.getElementById('readyButton').addEventListener('click', (e) => {    
            this.toggleReady();
        });
        document.getElementById('startGameBtn').addEventListener('click', (e) => {                    
            this.game.state.isPaused = false;
            this.start();
        });
    }
    
    start() {
        this.createUnitShop();
        this.startPlacementPhase();
        
        // Update UI every 100ms
        setInterval(() => this.updateUI(), 100);
        this.updateUI();
        
        // Add initial help text
        this.addBattleLog('Welcome to Auto Battle Arena!');
        this.addBattleLog('Build your army during placement phase, then watch them fight!');
        this.addBattleLog('Each victory grants gold and increases difficulty.');
        this.addBattleLog('Click units in the shop, then click the battlefield to place them.');
    }
    
    createUnitShop() {
        const shop = document.getElementById('unitShop');
        shop.innerHTML = '';
        
        const UnitTypes = this.game.getCollections().units;

        Object.keys(UnitTypes).forEach(unitId => {
            const unitType = UnitTypes[unitId];
            const card = document.createElement('div');
            card.className = 'unit-card';
            card.innerHTML = `
                <div class="unit-name">${unitType.title}</div>
                <div class="unit-cost">Cost: ${unitType.value}g</div>
                <div class="unit-stats">${unitType.hp}</div>
            `;
            
            card.addEventListener('click', () => this.selectUnit({ id: unitId, ...unitType }));
            shop.appendChild(card);
        });
    }
    
    selectUnit(unitType) {
        if (this.game.state.phase !== 'placement' || this.game.state.playerGold < unitType.value) return;
        
        this.game.state.selectedUnitType = unitType;
        
        // Update UI
        document.querySelectorAll('.unit-card').forEach(card => {
            card.classList.remove('selected');
        });
        event.target.closest('.unit-card').classList.add('selected');
    }
    
    handleCanvasClick(event) {
        if (this.game.state.phase !== 'placement' || !this.game.state.selectedUnitType) return;
        const canvas = this.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Only allow placement on player side (left half)
        if (x > canvas.width / 2) return;
        
        // Check if player has enough gold
        if (this.game.state.playerGold < this.game.state.selectedUnitType.value) return;
        
        // Create unit
        this.createUnit(x, y, this.game.state.selectedUnitType, 'player');
        this.game.state.playerGold -= this.game.state.selectedUnitType.value;
        
        this.updateUI();
    }
    
    createUnit(x, y, unitType, team) {
        const entity = this.game.createEntity();
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        this.game.addComponent(entity, ComponentTypes.POSITION, 
            Components.Position(x, y));
        
        this.game.addComponent(entity, ComponentTypes.VELOCITY, 
            Components.Velocity(0, 0, unitType.speed * 20));
        
        this.game.addComponent(entity, ComponentTypes.RENDERABLE, 
            Components.Renderable(unitType.color, unitType.size, 'circle'));
        
        this.game.addComponent(entity, ComponentTypes.COLLISION, 
            Components.Collision(unitType.size));
        
        this.game.addComponent(entity, ComponentTypes.HEALTH, 
            Components.Health(unitType.hp));
    
        this.game.addComponent(entity, ComponentTypes.COMBAT, 
            Components.Combat(unitType.damage, unitType.range, unitType.attackSpeed));
        
        this.game.addComponent(entity, ComponentTypes.TEAM, 
            Components.Team(team));
            
        this.game.addComponent(entity, ComponentTypes.UNIT_TYPE, 
            Components.UnitType(unitType.id, unitType.title, unitType.value));
        
        this.game.addComponent(entity, ComponentTypes.AI_STATE, 
            Components.AIState('idle'));
        
        this.game.addComponent(entity, ComponentTypes.ANIMATION, 
            Components.Animation());
        
        return entity;
    }
    
    startPlacementPhase() {
        this.game.state.phase = 'placement';
        this.game.state.phaseTimeLeft = 30;
        this.game.state.playerReady = false;
        
        this.updatePhaseDisplay();
        
        this.phaseTimer = setInterval(() => {
            this.game.state.phaseTimeLeft--;
            this.updatePhaseDisplay();
            
            if (this.game.state.phaseTimeLeft <= 0 || this.game.state.playerReady) {
                clearInterval(this.phaseTimer);
                this.startBattlePhase();
            }
        }, 1000);
        
        // AI places units after a delay
        setTimeout(() => {
            this.placeEnemyUnits();
        }, 2000);
    }
    
    placeEnemyUnits() {
        const canvas = this.canvas;
        const unitCount = 3 + Math.floor(this.game.state.round / 2);
        
        const UnitTypes = this.game.getCollections().units;
        const availableUnits = Object.values(UnitTypes);        
        const availableUnitKeys = Object.keys(UnitTypes);

        for (let i = 0; i < unitCount; i++) {
            const chosen = Math.floor(Math.random() * availableUnits.length);
            const unitType = availableUnits[chosen];
            const unitId = availableUnitKeys[chosen];
            const x = canvas.width / 2 + 50 + Math.random() * (canvas.width / 2 - 100);
            const y = 50 + Math.random() * (canvas.height - 100);
            
            this.createUnit(x, y, { id: unitId, ...unitType }, 'enemy');
        }
        
        this.updateUI();
    }
    
    startBattlePhase() {
        this.game.state.phase = 'battle';
        this.updatePhaseDisplay();
        this.addBattleLog(`Round ${this.game.state.round} battle begins!`, 'log-victory');
        
        // Disable placement UI
        document.getElementById('readyButton').disabled = true;
      
    }
    
    endBattle(result) {
        this.game.state.phase = 'ended';
        
        setTimeout(() => {
            if (result === 'victory') {
                this.game.state.playerGold += 50 + (this.game.state.round * 10);
                this.game.state.round++;
            } else {
                // Game over - restart
                this.game.state.round = 1;
                this.game.state.playerGold = 100;
            }
            
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            // Clear battlefield
            const allUnits = this.game.getEntitiesWith(ComponentTypes.TEAM);
            allUnits.forEach(entityId => this.game.destroyEntity(entityId));
            
            // Start next round
            this.startPlacementPhase();
            this.updateUI();
        }, 3000);
    }
    
    toggleReady() {
        if (this.game.state.phase !== 'placement') return;
        
        this.game.state.playerReady = !this.game.state.playerReady;
        const button = document.getElementById('readyButton');
        
        if (this.game.state.playerReady) {
            button.textContent = 'Waiting for battle...';
            button.style.background = '#444400';
        } else {
            button.textContent = 'Ready for Battle!';
            button.style.background = '#003300';
        }
    }
    
    updatePhaseDisplay() {
        document.getElementById('roundNumber').textContent = this.game.state.round;
        document.getElementById('phaseTitle').textContent = 
            this.game.state.phase === 'placement' ? 'PLACEMENT PHASE' :
            this.game.state.phase === 'battle' ? 'BATTLE PHASE' : 'ROUND ENDED';
        
        if (this.game.state.phase === 'placement') {
            document.getElementById('phaseTimer').textContent = `${this.game.state.phaseTimeLeft}s`;
        } else {
            document.getElementById('phaseTimer').textContent = '';
        }
    }
    
    updateUI() {
        // Update gold
        document.getElementById('playerGold').textContent = this.game.state.playerGold;
        
        // Update enemy strength
        const strengthLevels = ['Weak', 'Normal', 'Strong', 'Elite', 'Legendary'];
        const strengthIndex = Math.min(Math.floor((this.game.state.round - 1) / 2), strengthLevels.length - 1);
        document.getElementById('enemyStrength').textContent = strengthLevels[strengthIndex];
        
        const UnitTypes = this.game.getCollections().units;
        // Update unit shop availability
        document.querySelectorAll('.unit-card').forEach((card, index) => {
            const unitType = Object.values(UnitTypes)[index];
            const canAfford = this.game.state.playerGold >= unitType.value;
            const inPlacementPhase = this.game.state.phase === 'placement';
            
            if (!canAfford || !inPlacementPhase) {
                card.classList.add('disabled');
            } else {
                card.classList.remove('disabled');
            }
        });
        
        // Update army lists
        this.updateArmyLists();
        
        // Update ready button
        const readyButton = document.getElementById('readyButton');
        if (this.game.state.phase === 'placement') {
            readyButton.disabled = false;
            readyButton.textContent = this.game.state.playerReady ? 'Waiting for battle...' : 'Ready for Battle!';
        } else {
            readyButton.disabled = true;
            readyButton.textContent = 'Battle in Progress';
        }
    }
    
    updateArmyLists() {
        const playerArmy = document.getElementById('playerArmy');
        const enemyArmy = document.getElementById('enemyArmy');
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        // Clear lists
        playerArmy.innerHTML = '';
        enemyArmy.innerHTML = '';
        
        // Get all units
        const allUnits = this.game.getEntitiesWith(ComponentTypes.TEAM, ComponentTypes.UNIT_TYPE, ComponentTypes.HEALTH);
        
        const playerUnits = [];
        const enemyUnits = [];
        
        allUnits.forEach(entityId => {
            const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
            const unitType = this.game.getComponent(entityId, ComponentTypes.UNIT_TYPE);
            const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
            
            const unitInfo = {
                type: unitType.type,
                health: health.current,
                maxHealth: health.max
            };
            
            if (team.team === 'player') {
                playerUnits.push(unitInfo);
            } else {
                enemyUnits.push(unitInfo);
            }
        });
        
        // Display player units
        playerUnits.forEach(unit => {
            const div = document.createElement('div');
            div.className = 'army-unit';
            div.style.color = unit.health > unit.maxHealth * 0.5 ? '#00ff00' : 
                                unit.health > unit.maxHealth * 0.25 ? '#ffff00' : '#ff0000';
            div.textContent = `${unit.type} (${unit.health}/${unit.maxHealth} HP)`;
            playerArmy.appendChild(div);
        });
        
        // Display enemy units
        enemyUnits.forEach(unit => {
            const div = document.createElement('div');
            div.className = 'army-unit';
            div.style.color = unit.health > unit.maxHealth * 0.5 ? '#ff8888' : 
                                unit.health > unit.maxHealth * 0.25 ? '#ffaa88' : '#ff0000';
            div.textContent = `${unit.type} (${unit.health}/${unit.maxHealth} HP)`;
            enemyArmy.appendChild(div);
        });
        
        // Show empty messages
        if (playerUnits.length === 0) {
            const div = document.createElement('div');
            div.className = 'army-unit';
            div.style.color = '#666';
            div.textContent = 'No units deployed';
            playerArmy.appendChild(div);
        }
        
        if (enemyUnits.length === 0) {
            const div = document.createElement('div');
            div.className = 'army-unit';
            div.style.color = '#666';
            div.textContent = 'Enemy preparing...';
            enemyArmy.appendChild(div);
        }
    }
    
    addBattleLog(message, className = '') {
        const log = document.getElementById('battleLog');
        const entry = document.createElement('div');
        entry.className = `log-entry ${className}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
        
        // Keep only last 50 entries
        while (log.children.length > 50) {
            log.removeChild(log.firstChild);
        }
    }
}
