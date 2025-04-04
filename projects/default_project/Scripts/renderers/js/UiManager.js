class UiManager extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init() {
        this.canvas = this.game.canvas;
        this.ctx = this.game.ctx;
        this.gridSize = this.game.config.configs.game.gridSize;
        this.game.uiManager = this;
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
        for(let type in this.game.config.towers) {
            if(this.game.config.towers[type].cost > 0){
                towerMenuOptions += `<div class="tower-option" data-type="${type}">${this.game.config.towers[type].title} (${this.game.config.towers[type].cost})</div>`;
            }
        }
        this.towerMenu.innerHTML = towerMenuOptions;
       this.setupTowerPlacement();
       this.setupEventListeners();
       
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
this.game.canvas.addEventListener('mousemove', (e) => {
            if (!this.game.state.selectedTowerType && !this.game.state.towers.length) return;

            if (this.game.state.selectedTowerType && this.game.state.previewTower) {
                this.game.state.previewTower.position.x = this.game.state.mousePosition.gridX * this.gridSize + this.gridSize / 2;
                this.game.state.previewTower.position.y = this.game.state.mousePosition.gridY * this.gridSize + this.gridSize / 2;
                const isValidPosition = this.checkValidTowerPosition(this.game.state.mousePosition.gridX, this.game.state.mousePosition.gridY);
                this.game.canvas.style.cursor = isValidPosition ? 'pointer' : 'not-allowed';
            }

            let hoveredTower = null;
            for (const tower of this.game.state.towers) {
                const dist = Math.hypot(tower.gridPosition.x - this.game.state.mousePosition.gridX, tower.gridPosition.y + this.game.translator.tileHeight / 2 - this.game.state.mousePosition.gridY);
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

        this.game.canvas.addEventListener('mouseout', () => {
            this.hideTooltip();
        });
        
        this.game.canvas.addEventListener('click', (e) => {
            if (!this.game.state.selectedTowerType) return;
            

            if (this.checkValidTowerPosition(this.game.state.mousePosition.gridX, this.game.state.mousePosition.gridY)) {
                // Create the tower
                let cost = this.game.config.towers[this.game.state.selectedTowerType].cost;
                let populationCost = this.game.config.towers[this.game.state.selectedTowerType].population || 0;
                
                const finalCost = Math.floor(cost * this.game.state.stats.towerCostMod);
                
                if (this.game.state.bloodShards >= finalCost && this.game.state.stats.population + populationCost <= this.game.state.stats.maxPopulation) {
          
                    const tower = this.game.spawn(this.game.state.mousePosition.gridX * this.gridSize + this.gridSize / 2, 
                                                 this.game.state.mousePosition.gridY * this.gridSize + this.gridSize / 2, "tower", { objectType: "towers", spawnType: this.game.state.selectedTowerType, setDirection: 1});
                    tower.placed = true;
                    this.game.state.tileMap[this.game.state.mousePosition.gridY][this.game.state.mousePosition.gridX].buildable = false;
                    this.game.state.tileMap[this.game.state.mousePosition.gridY][this.game.state.mousePosition.gridX].tower = tower;
                    this.game.state.bloodShards -= finalCost;
                    this.game.state.previewTower.destroy();
                    this.game.state.previewTower = null;
                    // Clear selection
                    this.game.state.selectedTowerType = null;
                    this.game.canvas.style.cursor = 'default';
                }
            }
        });
        
        // Cancel tower placement with right click
        this.game.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.game.state.selectedTowerType) {
                this.game.state.selectedTowerType = null;
                this.game.canvas.style.cursor = 'default';
            }
        });
}

  setupTowerPlacement() {

        
        const towerButtons = document.querySelectorAll('.tower-option');
        towerButtons.forEach(button => {
            button.addEventListener('click', () => {

                if(this.game.state.isPaused) return;
                
                const type = button.getAttribute('data-type');
                let cost = this.game.config.towers[type].cost;
                const finalCost = Math.floor(cost * this.game.state.stats.towerCostMod);
                
                let populationCost = this.game.config.towers[type].population || 0;
                if (this.game.state.bloodShards >= finalCost && this.game.state.stats.population + populationCost <= this.game.state.stats.maxPopulation) {
                    this.game.state.selectedTowerType = type;
                    if(this.game.state.previewTower) {
                        this.game.state.previewTower.destroy();
                    }
                    this.game.state.previewTower = this.game.spawn(-100, -100, 'previewTower', { objectType: "towers", spawnType: this.game.state.selectedTowerType});
                }
            });
            
            // Show tooltip with info
            button.addEventListener('mouseover', (e) => {
                const type = button.getAttribute('data-type');
                let info = this.game.config.towers[type].info;
                
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