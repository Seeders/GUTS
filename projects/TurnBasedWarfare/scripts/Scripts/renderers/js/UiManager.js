class UiManager extends engine.Component {
        
    init({}) {
        this.canvas = this.game.canvas;
        this.canvasBuffer = this.game.canvasBuffer;
        if(this.game.getCollections().configs.game.is3D) {
            this.finalCtx = this.canvas.getContext("webgl2");
            this.ctx = this.canvasBuffer.getContext("webgl2");
        } else {
            this.finalCtx = this.canvas.getContext("2d");
            this.ctx = this.canvasBuffer.getContext("2d");
        }
        this.terrainCanvasBuffer = this.game.terrainCanvasBuffer;
        this.projectConfig = this.game.getCollections().configs.game;
        this.gridSize = this.projectConfig.gridSize;
        this.isometric = this.projectConfig.isIsometric || false;
        this.upgradeMenu = document.getElementById('upgradeMenu');
        this.upgradeOptionsDiv = document.getElementById('upgradeOptions');
        this.overlay = document.getElementById('overlay');
        this.tooltip = document.getElementById('tooltip');
        this.gameOverMenu = document.getElementById('gameOverMenu');
        this.victoryMenu = document.getElementById('victoryMenu');

        // Stats displays
        this.shardsDisplay = document.getElementById('shardsDisplay');
        this.essenceDisplay = document.getElementById('essenceDisplay');
        this.essenceNeededDisplay = document.getElementById('essenceNeededDisplay');
        this.populationDisplay = document.getElementById('populationDisplay');
        this.maxPopulationDisplay = document.getElementById('maxPopulationDisplay');
        this.hpDisplay = document.getElementById('hpDisplay');
        this.waveDisplay = document.getElementById('waveDisplay');
        this.waveProgress = document.getElementById('waveProgress');
        this.gameOverWave = document.getElementById('gameOverWave');
        this.towerMenu = document.getElementById('towerMenu');
        let towerMenuOptions = '';
        for(let type in this.game.getCollections().towers) {
            if(this.game.getCollections().towers[type].cost > 0){
                towerMenuOptions += `<button class="tower-option" data-type="${type}">${this.game.getCollections().towers[type].title} (${this.game.getCollections().towers[type].cost})</button>`;
            }
        }
        this.towerMenu.innerHTML = towerMenuOptions;
        this.setupTowerPlacement();
        this.setupEventListeners();
        this.game.uiManager = this;
       
    }
    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvasBuffer.width, this.canvasBuffer.height);
        this.finalCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);    
    }
    renderCanvas() {      
       this.finalCtx.drawImage(this.canvasBuffer, 0, 0);
    }

    setMousePosition(clientX, clientY) {
        if(!this.game.getCollections().configs.game.is3D) {
            const rect = this.canvas.getBoundingClientRect();
                
            // Account for canvas scaling and offset
            const scaleX = this.canvas.width / rect.width;   // Ratio of canvas pixel width to CSS width
            const scaleY = this.canvas.height / rect.height; // Ratio of canvas pixel height to CSS height
            
            const mapGridWidth = this.game.state.tileMap.length;
            // Calculate mouse position relative to canvas with scaling
            const mouseX = (clientX - rect.left) * scaleX + (this.isometric ? 0 : -( this.canvas.width - mapGridWidth * this.game.getCollections().configs.game.gridSize) / 2);
            const mouseY = (clientY - rect.top) * scaleY + (this.isometric ? 0 : -( this.canvas.height - mapGridWidth * this.game.getCollections().configs.game.gridSize) / 2);

            // Convert to isometric and grid coordinates
            const gridPos = this.game.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.game.translator.snapToGrid(gridPos.x, gridPos.y);
            const pixelIsoPos = this.game.translator.pixelToIso(mouseX, mouseY);

            // Update state with corrected coordinates
            this.game.state.mousePosition = { 
                x: mouseX, 
                y: mouseY, 
                isoX: pixelIsoPos.x, 
                isoY: pixelIsoPos.y, 
                gridX: snappedGrid.x, 
                gridY: snappedGrid.y 
            };
        } else {
            const rect = this.canvas.getBoundingClientRect();
            
            // Calculate normalized device coordinates (-1 to +1)
            const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
            const mouseY = -((clientY - rect.top) / rect.height) * 2 + 1;
            
            // Setup the raycaster
            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2(mouseX, mouseY);
            
            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.game.camera);
            
            // Create a plane at y=0 to represent our terrain
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            
            // Calculate the point where the ray intersects the ground plane
            const intersectPoint = new THREE.Vector3();
            raycaster.ray.intersectPlane(groundPlane, intersectPoint);
            
            if (intersectPoint) {
                // Convert to grid coordinates
                const gridX = Math.floor(intersectPoint.x / this.game.getCollections().configs.game.gridSize);
                const gridY = Math.floor(intersectPoint.z / this.game.getCollections().configs.game.gridSize);
                
                // Update state with world and grid coordinates
                this.game.state.mousePosition = {
                    x: intersectPoint.x,                    
                    y: intersectPoint.z,
                    gridX: gridX,
                    gridY: gridY,
                    worldX: intersectPoint.x,
                    worldY: intersectPoint.z
                };
            }

        }
    }

    setupEventListeners() {
        document.getElementById('startGameBtn').removeAttribute('style');
        document.getElementById('startGameBtn').addEventListener('click', (e) => {    
            this.game.state.isPaused = false;
            e.target.setAttribute('style','display:none;');
        });
        document.querySelector("#gameOverMenu .menu-button").addEventListener("click", (e) => {
            this.game.reset();
        });
        
        document.querySelector("#victoryMenu .menu-button").addEventListener("click", (e) => {
            this.game.reset();
        });
        this.canvas.addEventListener('mousemove', (e) => {
            this.setMousePosition(e.clientX, e.clientY);

            if (!this.game.state.selectedTowerType && !this.game.state.towers.length) return;

            if (this.game.state.selectedTowerType && this.game.state.previewTower) {
                this.game.state.previewTower.transform.position.x = this.game.state.mousePosition.gridX * this.gridSize + this.gridSize / 2;
                this.game.state.previewTower.transform.position.z = this.game.state.mousePosition.gridY * this.gridSize + this.gridSize / 2;
                this.game.state.previewTower.transform.position.y = this.game.gameEntity.getComponent('mapManager').getTerrainHeight(this.game.state.previewTower.transform.gridPosition);
                const isValidPosition = this.checkValidTowerPosition(this.game.state.mousePosition.gridX, this.game.state.mousePosition.gridY);
                this.canvas.style.cursor = isValidPosition ? 'pointer' : 'not-allowed';
            }

            let hoveredTower = null;
            for (const tower of this.game.state.towers) {
                const dist = Math.hypot(tower.transform.gridPosition.x - this.game.state.mousePosition.gridX, tower.transform.gridPosition.y + this.game.translator.tileHeight / 2 - this.game.state.mousePosition.gridY);
                if (dist < 20) {
                    hoveredTower = tower;
                    break;
                }
            }

            if (hoveredTower && hoveredTower.stats) {
                let info = `${hoveredTower.type} (Level ${hoveredTower.level})\n`;
                info += `Damage: ${Math.round(hoveredTower.stats.damage * this.game.state.stats.damageMultiplier * 10) / 10}\n`;
                info += `Attack Speed: ${Math.round(1000 / hoveredTower.stats.attackSpeed)} per sec\n`;
                info += `Range: ${hoveredTower.stats.range}\n`;
                info += `Crit Chance: ${Math.round(hoveredTower.stats.critChance * 100)}%\n`;
                if (hoveredTower.stats.leech > 0) {
                    info += `Life Leech: ${Math.round(hoveredTower.stats.leech * 100 * this.game.state.stats.healingMultiplier) / 100} HP per hit\n`;
                }
                if (hoveredTower.stats.piercing > 0) {
                    info += `Piercing: ${hoveredTower.stats.piercing} enemies\n`;
                }
                if (hoveredTower.stats.summonChance > 0) {
                    info += `Summon Chance: ${Math.round(hoveredTower.stats.summonChance * 100)}%\n`;
                }

                this.showTooltip(e.clientX, e.clientY, info);
                hoveredTower.showRange = true;
            } else {
                this.hideTooltip();
                this.game.state.towers.forEach(t => t.showRange = false);
            }
        });

        this.canvas.addEventListener('mouseout', () => {
            this.hideTooltip();
        });
        
        this.canvas.addEventListener('click', (e) => {
            if (!this.game.state.selectedTowerType) return;
            

            if (this.checkValidTowerPosition(this.game.state.mousePosition.gridX, this.game.state.mousePosition.gridY)) {
                // Create the tower
                let cost = this.game.getCollections().towers[this.game.state.selectedTowerType].cost;
                let populationCost = this.game.getCollections().towers[this.game.state.selectedTowerType].population || 0;
                
                const finalCost = Math.floor(cost * this.game.state.stats.towerCostMod);
                
                if (this.game.state.bloodShards >= finalCost && this.game.state.stats.population + populationCost <= this.game.state.stats.maxPopulation) {
                    let position = new THREE.Vector3(
                        this.game.state.mousePosition.gridX * this.gridSize + this.gridSize / 2, 
                        0,                        
                        this.game.state.mousePosition.gridY * this.gridSize + this.gridSize / 2
                    );
                    const tower = this.game.spawn("tower", { objectType: "towers", spawnType: this.game.state.selectedTowerType, setDirection: 1, position});
                    tower.placed = true;
                    tower.transform.position.y = this.game.gameEntity.getComponent('mapManager').getTerrainHeight(tower.transform.gridPosition);
                    this.game.state.tileMap[this.game.state.mousePosition.gridY][this.game.state.mousePosition.gridX].buildable = false;
                    this.game.state.tileMap[this.game.state.mousePosition.gridY][this.game.state.mousePosition.gridX].tower = tower;
                    this.game.state.bloodShards -= finalCost;
                    this.game.state.previewTower.destroy();
                    this.game.state.previewTower = null;
                    const gameEventData = this.game.getCollections().gameEvents['placeTower'];
                    const audioData = this.game.getCollections().sounds[gameEventData.sound].audio;
                    this.game.audioManager.playSynthSound('placeTower', audioData);
                    // Clear selection
                    this.game.state.selectedTowerType = null;
                    this.canvas.style.cursor = 'default';
                }
            }
        });
        
        // Cancel tower placement with right click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.game.state.selectedTowerType) {
                this.game.state.selectedTowerType = null;
                this.canvas.style.cursor = 'default';
            }
        });
    }

    setupTowerPlacement() {

        
        const towerButtons = document.querySelectorAll('.tower-option');
        towerButtons.forEach(button => {
            button.addEventListener('click', () => {

                if(this.game.state.isPaused) return;
                
                const type = button.getAttribute('data-type');
                let cost = this.game.getCollections().towers[type].cost;
                const finalCost = Math.floor(cost * this.game.state.stats.towerCostMod);
                
                let populationCost = this.game.getCollections().towers[type].population || 0;
                if (this.game.state.bloodShards >= finalCost && this.game.state.stats.population + populationCost <= this.game.state.stats.maxPopulation) {
                    this.game.state.selectedTowerType = type;
                    if(this.game.state.previewTower) {
                        this.game.state.previewTower.destroy();
                    }
                    this.game.state.previewTower = this.game.spawn('previewTower', { objectType: "towers", spawnType: this.game.state.selectedTowerType, position: new THREE.Vector3()});
                }
            });
            
            // Show tooltip with info
            button.addEventListener('mouseover', (e) => {
                const type = button.getAttribute('data-type');
                let info = this.game.getCollections().towers[type].info;
                
                this.showTooltip(e.clientX, e.clientY, info);
            });
            
            button.addEventListener('mouseout', () => {
                this.hideTooltip();
            });
        });
        
        
    }

    checkValidTowerPosition(posX, posY) {
        if(posX >= 0 && posY >= 0 && this.game.state.tileMap.length > posY && this.game.state.tileMap[posY].length > posX){
            return this.game.state.tileMap[posY][posX].buildable;            
        }
        return false;
    }

    reset() {
        this.gameOverMenu.style.display = 'none';
        this.victoryMenu.style.display = 'none';
        this.overlay.style.display = 'none';
        this.waveDisplay.textContent = '1';
        this.waveProgress.style.width = '0%';        


    }


    draw() {
        this.shardsDisplay.textContent = Math.floor(this.game.state.bloodShards);
        this.essenceDisplay.textContent = Math.floor(this.game.state.essence);
        this.essenceNeededDisplay.textContent = Math.floor(this.game.state.essenceToNextLevel);
        this.hpDisplay.textContent = Math.floor(this.game.state.bloodCoreHP);
        this.populationDisplay.textContent = Math.floor(this.game.state.stats.population);
        this.maxPopulationDisplay.textContent = Math.floor(this.game.state.stats.maxPopulation);  
        if (this.game.state.enemies.length === 0 && this.game.state.enemiesSpawned >= this.game.state.numEnemiesInWave && !this.game.state.victory) {
            const countdown = Math.ceil((this.game.state.waveDelay - this.game.state.waveTimer) / 60);
            this.ctx.fillStyle = 'white';
            this.ctx.font = '20px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`Next Wave in ${countdown}...`, this.canvas.width / 2, 50);
        }  
        if(!this.game.getCollections().configs.game.is3D) {
            this.renderCanvas();
        }
    }

    updateWaveDisplay(waveNumber) {
        this.waveDisplay.textContent = waveNumber;
    }


    showTooltip(x, y, text) {
        const tooltip = document.getElementById('tooltip');
        tooltip.style.display = 'block';
        tooltip.style.left = (x + 10) + 'px';
        tooltip.style.top = (y + 10) + 'px';
        tooltip.textContent = text;
    }

    hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        tooltip.style.display = 'none';
    }
}