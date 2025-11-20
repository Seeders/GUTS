class RespawnSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.respawnSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Respawn configuration
        this.RESPAWN_DELAY = 3; // seconds
        this.GOLD_LOSS_PERCENT = 10;
        this.XP_LOSS_PERCENT = 5;
        this.RESPAWN_INVULNERABILITY = 3; // seconds

        // Death screen UI
        this.deathScreen = null;
        this.respawnTimer = 0;
        this.isPlayerDead = false;

        // Spawn point
        this.spawnPoint = { x: 0, y: 0, z: 0 };
    }

    init() {
        this.game.gameManager.register('setSpawnPoint', this.setSpawnPoint.bind(this));
        this.game.gameManager.register('getSpawnPoint', () => this.spawnPoint);
        this.game.gameManager.register('respawnPlayer', this.respawnPlayer.bind(this));
        this.game.gameManager.register('isPlayerDead', () => this.isPlayerDead);

        // Only create UI on client (not server)
        if (typeof document !== 'undefined') {
            this.createDeathScreen();
        }
    }

    setSpawnPoint(x, y, z) {
        this.spawnPoint = { x, y, z };
    }

    createDeathScreen() {
        this.deathScreen = document.createElement('div');
        this.deathScreen.id = 'death-screen';
        this.deathScreen.innerHTML = `
            <style>
                #death-screen {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(139, 0, 0, 0.8);
                    display: none;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    font-family: 'Georgia', serif;
                }

                .death-title {
                    color: #ff0000;
                    font-size: 72px;
                    text-shadow: 4px 4px 8px black;
                    margin-bottom: 20px;
                    animation: death-pulse 2s ease-in-out infinite;
                }

                @keyframes death-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.7; transform: scale(1.05); }
                }

                .death-stats {
                    color: #fff;
                    font-size: 18px;
                    margin-bottom: 30px;
                    text-align: center;
                }

                .death-stat {
                    margin: 10px 0;
                }

                .death-penalty {
                    color: #ff6666;
                }

                .respawn-timer {
                    color: #d4af37;
                    font-size: 24px;
                    margin-bottom: 20px;
                }

                .respawn-button {
                    padding: 15px 40px;
                    font-size: 20px;
                    background: linear-gradient(135deg, #8b0000 0%, #5a0000 100%);
                    border: 2px solid #ff4444;
                    border-radius: 5px;
                    color: #fff;
                    cursor: pointer;
                    font-family: 'Georgia', serif;
                    transition: all 0.3s ease;
                }

                .respawn-button:hover {
                    background: linear-gradient(135deg, #aa0000 0%, #7a0000 100%);
                    transform: scale(1.05);
                }

                .respawn-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    transform: none;
                }
            </style>

            <div class="death-title">YOU DIED</div>
            <div class="death-stats">
                <div class="death-stat">Kills this run: <span id="death-kills">0</span></div>
                <div class="death-stat death-penalty">Gold lost: <span id="death-gold-loss">0</span></div>
                <div class="death-stat death-penalty">XP lost: <span id="death-xp-loss">0</span></div>
            </div>
            <div class="respawn-timer" id="respawn-timer">Respawning in 3...</div>
            <button class="respawn-button" id="respawn-button" disabled>Respawn</button>
        `;

        document.body.appendChild(this.deathScreen);

        document.getElementById('respawn-button').addEventListener('click', () => {
            this.respawnPlayer();
        });
    }

    onPlayerDeath() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId || this.isPlayerDead) return;

        this.isPlayerDead = true;

        // Calculate penalties
        const currentGold = this.game.gameManager.call('getPlayerGold');
        const goldLoss = Math.floor(currentGold * (this.GOLD_LOSS_PERCENT / 100));

        // Apply penalties
        if (goldLoss > 0) {
            this.game.gameManager.call('addPlayerGold', -goldLoss);
        }

        // Get stats
        const kills = this.game.gameManager.call('getPlayerKills');

        // Update and show death screen (client only)
        if (this.deathScreen) {
            document.getElementById('death-kills').textContent = kills;
            document.getElementById('death-gold-loss').textContent = goldLoss;
            document.getElementById('death-xp-loss').textContent = '0'; // Could implement XP loss

            // Show death screen
            this.deathScreen.style.display = 'flex';

            // Start respawn timer
            this.respawnTimer = this.RESPAWN_DELAY;
            this.updateRespawnTimer();
        }
    }

    updateRespawnTimer() {
        if (typeof document === 'undefined') return;

        const timerEl = document.getElementById('respawn-timer');
        const buttonEl = document.getElementById('respawn-button');
        if (!timerEl || !buttonEl) return;

        if (this.respawnTimer > 0) {
            timerEl.textContent = `Respawning in ${Math.ceil(this.respawnTimer)}...`;
            buttonEl.disabled = true;

            setTimeout(() => {
                this.respawnTimer -= 0.1;
                this.updateRespawnTimer();
            }, 100);
        } else {
            timerEl.textContent = 'Ready to respawn';
            buttonEl.disabled = false;
        }
    }

    respawnPlayer() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const CT = this.componentTypes;

        // Restore health
        const health = this.game.getComponent(playerEntityId, CT.HEALTH);
        if (health) {
            health.current = health.max;
        }

        // Restore mana
        const resources = this.game.getComponent(playerEntityId, CT.RESOURCE_POOL);
        if (resources) {
            resources.mana = resources.maxMana;
            resources.stamina = resources.maxStamina;
        }

        // Move to spawn point
        const pos = this.game.getComponent(playerEntityId, CT.POSITION);
        if (pos) {
            pos.x = this.spawnPoint.x;
            pos.y = this.spawnPoint.y;
            pos.z = this.spawnPoint.z;
        }

        // Clear death state
        const deathState = this.game.getComponent(playerEntityId, CT.DEATH_STATE);
        if (deathState) {
            deathState.isDying = false;
        }

        // Reset AI state
        const aiState = this.game.getComponent(playerEntityId, CT.AI_STATE);
        if (aiState) {
            aiState.state = 'idle';
            aiState.target = null;
        }

        // Add temporary invulnerability
        // (Would need a buff system integration)

        this.isPlayerDead = false;
        if (this.deathScreen) {
            this.deathScreen.style.display = 'none';
        }

        this.game.triggerEvent('onPlayerRespawn', {
            entityId: playerEntityId,
            position: this.spawnPoint
        });

        this.game.gameManager.call('showMessage', 'Respawned!');
    }

    update() {
        if (this.isPlayerDead) return;

        // Check for player death
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const health = this.game.getComponent(playerEntityId, this.componentTypes.HEALTH);
        if (health && health.current <= 0) {
            this.onPlayerDeath();
        }
    }
}
