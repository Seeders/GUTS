class WaveManager extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
init() {   
        
        this.resetWaveState();
    }

    resetWaveState() {
        this.game.state.waveSets = this.game.config.levels[this.game.state.level].wavesets;
        this.game.state.currentWaveIds = [];
        this.game.state.currentWaveEnemies = [];
        this.game.state.enemiesSpawned = [];
        this.game.state.spawnTimers = []; // Array for individual spawn timers
        this.game.state.spawnRate = 1;    // Base spawn rate (can be modified per waveset if needed)
        this.game.state.waveTimer = 0;
        this.game.state.startDelayTimer = 0;
        this.game.state.round = 0;
    }

    update() {
        // Skip wave updates if game is over or in certain states
        if (this.game.state.gameOver || this.game.state.victory || this.game.state.isLevelingUp) return;

        this.game.state.startDelayTimer += this.game.deltaTime;

        // Process all wavesets in parallel
        for (let i = 0; i < this.game.state.currentWaveIds.length; i++) {
            let waveSet = this.game.config.wavesets[this.game.state.waveSets[i]];
            
            // Skip if still in start delay
            if (waveSet.startDelay && this.game.state.startDelayTimer < waveSet.startDelay) continue;
            
            // Update individual spawn timer for this waveset
            this.game.state.spawnTimers[i] += this.game.deltaTime;

            // If this waveset still has enemies to spawn
            if (this.game.state.enemiesSpawned[i] < this.game.state.currentWaveEnemies[i].length) {
                if (this.game.state.spawnTimers[i] >= this.game.state.spawnRate) {
                    // Create enemy from the appropriate waveset using the enemy type and start point index
                    const enemyType = this.game.state.currentWaveEnemies[i][this.game.state.enemiesSpawned[i]];
                    const startPointIndex = i;
                    
                    
        					  this.game.spawn(0, 0, 'enemy', { objectType: "enemies", spawnType: enemyType, pathIndex: startPointIndex, frictin: 1000, density: 1000});
                    this.game.state.enemiesSpawned[i]++;
                    this.game.state.spawnTimers[i] = 0; // Reset this waveset's timer
                    
                    // Calculate total progress across all wavesets
                    const totalEnemies = this.game.state.currentWaveEnemies.reduce((sum, wave) => sum + wave.length, 0);
                    const totalSpawned = this.game.state.enemiesSpawned.reduce((sum, count) => sum + count, 0);
                    
                    // Update wave progress bar
                    document.getElementById('waveProgress').style.width = (totalSpawned / totalEnemies * 100) + '%';
                }
            }
        }
        
        // Check if all wavesets have completed spawning
        const allWavesetsComplete = this.game.state.enemiesSpawned.every((spawned, index) => 
            spawned >= this.game.state.currentWaveEnemies[index].length
        );
        
        // Move to next wave if all enemies defeated and all wavesets have completed spawning
        if (this.game.state.enemies.length === 0 && allWavesetsComplete) {
            this.game.state.waveTimer++;
            
            if (this.game.state.waveTimer >= this.game.state.waveDelay) {
                this.startNextWave();
            }
        }
    }

    startNextWave() {
        document.getElementById('waveDisplay').textContent = this.game.state.round + 1;
        
        this.game.state.currentWaveIds = [];
        this.game.state.currentWaveEnemies = [];
        this.game.state.enemiesSpawned = [];
        this.game.state.spawnTimers = [];
        
        let totalWaves = 0;
        for (let i = 0; i < this.game.state.waveSets.length; i++) {
            const waveSetId = this.game.state.waveSets[i];
            const waveSet = this.game.config.wavesets[waveSetId];
            
            // Check if this waveset has enough waves for the current round
            if (this.game.state.round < waveSet.waves.length) {
                const currentWaveId = waveSet.waves[this.game.state.round];
                
                // Add this wave to the current active waves
                this.game.state.currentWaveIds.push(currentWaveId);
                this.game.state.currentWaveEnemies.push(this.game.config.waves[currentWaveId].enemies);
                this.game.state.enemiesSpawned.push(0);
                this.game.state.spawnTimers.push(0); // Initialize spawn timer for this waveset
            }
            
            totalWaves = Math.max(totalWaves, waveSet.waves.length);
        }
        
        // If all wavesets are exhausted, end the game
        if (this.game.state.currentWaveIds.length === 0) {
            this.game.state.victory = true;
            this.game.state.isPaused = true;
            document.getElementById('victoryMenu').style.display = 'block';
            document.getElementById('overlay').style.display = 'block';
            return;
        }
        
        this.game.state.maxWaves = totalWaves;
        this.game.state.spawnRate = 5;
        this.game.state.waveTimer = 0;
        this.game.state.startDelayTimer = 0;
        
        // Reset wave progress bar
        document.getElementById('waveProgress').style.width = '0%';
        this.game.state.round++;
    }
}