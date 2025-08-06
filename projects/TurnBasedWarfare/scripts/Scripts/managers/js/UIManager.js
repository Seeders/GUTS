class UIManager {
    constructor(app) {
        this.game = app;
        this.game.uiManager = this;
        this.phaseTimer = null;
        this.canvas = document.getElementById('gameCanvas');
        
        // Add raycaster for 3D mouse picking
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
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
        
        // Check if player has enough gold
        if (this.game.state.playerGold < this.game.state.selectedUnitType.value) return;
        
        // Get 3D world position from mouse click
        const worldPosition = this.getWorldPositionFromMouse(event);
        if (!worldPosition) {
            console.warn('UIManager: Could not determine world position from mouse click');
            return;
        }
        
        // Check if placement is on player side (left half of the battlefield)
        if (!this.isValidPlayerPlacement(worldPosition)) {
            console.log('UIManager: Invalid placement location - must be on player side');
            return;
        }
        
        // Create unit at the world position
        this.createUnit(worldPosition.x, worldPosition.z, this.game.state.selectedUnitType, 'player');
        this.game.state.playerGold -= this.game.state.selectedUnitType.value;
        
        this.updateUI();
        
        console.log('UIManager: Unit placed at world position:', worldPosition);
    }
    
    getWorldPositionFromMouse(event) {
        // Make sure we have access to the 3D scene components
        if (!this.game.scene || !this.game.camera) {
            console.warn('UIManager: 3D scene or camera not available for raycasting');
            return null;
        }
        
        const canvas = this.canvas;
        const rect = canvas.getBoundingClientRect();
        
        // Convert mouse coordinates to normalized device coordinates (-1 to +1)
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Update the raycaster
        this.raycaster.setFromCamera(this.mouse, this.game.camera);
        
        // Get the ground/terrain mesh to raycast against
        const ground = this.getGroundMesh();
        if (!ground) {
            console.warn('UIManager: Ground mesh not found for raycasting');
            return null;
        }
        
        // Perform raycast
        const intersects = this.raycaster.intersectObject(ground, false);
        
        if (intersects.length > 0) {
            const intersectPoint = intersects[0].point;
            return {
                x: intersectPoint.x,
                y: intersectPoint.y,
                z: intersectPoint.z
            };
        }
        
        return null;
    }
    
    getGroundMesh() {
        // Look for the ground mesh in the scene
        // This assumes your WorldSystem creates a ground mesh that we can raycast against
        if (this.game.scene) {
            // Try to find the ground mesh - it might be stored differently in your system
            // Check if WorldSystem exposes the ground mesh
            if (this.game.worldSystem && this.game.worldSystem.ground) {
                return this.game.worldSystem.ground;
            }
            
            // Fallback: search through scene children for a mesh that looks like ground
            for (let child of this.game.scene.children) {
                if (child.isMesh && child.geometry && child.geometry.type === 'PlaneGeometry') {
                    return child;
                }
            }
        }
        
        return null;
    }
    
    isValidPlayerPlacement(worldPosition) {
        // Get terrain dimensions from the world system
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        const extensionSize = this.game.worldSystem?.extensionSize || 0;
        
        // Calculate actual game board boundaries (excluding extension areas)
        // The game board is centered at origin, so it extends from -terrainSize/2 to +terrainSize/2
        const gameBoardMinX = -terrainSize / 2;
        const gameBoardMaxX = terrainSize / 2;
        const gameBoardMinZ = -terrainSize / 2;
        const gameBoardMaxZ = terrainSize / 2;
        
        // Check if position is within the actual game board (not in extension area)
        const withinGameBoard = worldPosition.x >= gameBoardMinX && 
                               worldPosition.x <= gameBoardMaxX &&
                               worldPosition.z >= gameBoardMinZ && 
                               worldPosition.z <= gameBoardMaxZ;
        
        if (!withinGameBoard) {
            console.log('UIManager: Placement outside game board boundaries');
            return false;
        }
        
        // Additional check: player side is the left half of the game board
        const playerSideMaxX = 0; // Player can place from left edge to center line
        const onPlayerSide = worldPosition.x <= playerSideMaxX;
        
        if (!onPlayerSide) {
            console.log('UIManager: Placement not on player side');
            return false;
        }
        
        console.log(`UIManager: Valid placement at (${worldPosition.x.toFixed(1)}, ${worldPosition.z.toFixed(1)}) within game board bounds`);
        return true;
    }
    
    createUnit(worldX, worldZ, unitType, team) {
        const entity = this.game.createEntity();
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        // Store world coordinates directly - no conversion needed
        this.game.addComponent(entity, ComponentTypes.POSITION, 
            Components.Position(worldX, worldZ));
        
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
        
        console.log(`UIManager: Created ${team} unit at world coordinates (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
        
        return entity;
    }
    
    placeEnemyUnits() {
        const unitCount = 3 + Math.floor(this.game.state.round / 2);
        
        const UnitTypes = this.game.getCollections().units;
        const availableUnits = Object.values(UnitTypes);        
        const availableUnitKeys = Object.keys(UnitTypes);

        // Get terrain dimensions for proper boundary calculation
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        
        // Calculate enemy side boundaries (right half of the game board)
        const gameBoardMinX = 0; // Enemy side starts at center line
        const gameBoardMaxX = terrainSize / 2; // Enemy side extends to right edge
        const gameBoardMinZ = -terrainSize / 2; // Full Z range
        const gameBoardMaxZ = terrainSize / 2;
        
        // Add some padding to keep units away from exact edges
        const padding = 20;
        const enemyMinX = gameBoardMinX + padding;
        const enemyMaxX = gameBoardMaxX - padding;
        const enemyMinZ = gameBoardMinZ + padding;
        const enemyMaxZ = gameBoardMaxZ - padding;

        for (let i = 0; i < unitCount; i++) {
            const chosen = Math.floor(Math.random() * availableUnits.length);
            const unitType = availableUnits[chosen];
            const unitId = availableUnitKeys[chosen];
            
            // Generate random position within enemy territory (world coordinates)
            const worldX = enemyMinX + Math.random() * (enemyMaxX - enemyMinX);
            const worldZ = enemyMinZ + Math.random() * (enemyMaxZ - enemyMinZ);
            
            // Create unit directly with world coordinates
            this.createUnit(worldX, worldZ, { id: unitId, ...unitType }, 'enemy');
        }
        
        this.updateUI();
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