class ARPGUISystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.arpgUISystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // UI element references
        this.uiContainer = null;
        this.healthBar = null;
        this.manaBar = null;
        this.xpBar = null;
        this.abilitySlots = [];
        this.potionSlots = [];
        this.levelDisplay = null;
        this.goldDisplay = null;
        this.killsDisplay = null;

        // UI update throttle
        this.lastUIUpdate = 0;
        this.UI_UPDATE_INTERVAL = 0.05; // 20 updates per second
    }

    init() {
        this.game.gameManager.register('createARPGUI', this.createUI.bind(this));
        this.game.gameManager.register('updateARPGUI', this.updateUI.bind(this));
        this.game.gameManager.register('showDamageNumber', this.showDamageNumber.bind(this));
        this.game.gameManager.register('showMessage', this.showMessage.bind(this));

        // Create UI on init
        this.createUI();
    }

    createUI() {
        // Create main container
        this.uiContainer = document.createElement('div');
        this.uiContainer.id = 'arpg-ui';
        this.uiContainer.innerHTML = `
            <style>
                #arpg-ui {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    pointer-events: none;
                    font-family: 'Arial', sans-serif;
                    z-index: 1000;
                }

                #arpg-ui * {
                    pointer-events: auto;
                }

                .arpg-hud-bar {
                    position: absolute;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(0, 0, 0, 0.8);
                    padding: 15px 20px;
                    border-radius: 10px;
                    border: 2px solid #333;
                }

                .arpg-orb {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    position: relative;
                    overflow: hidden;
                    border: 3px solid #222;
                }

                .arpg-orb-fill {
                    position: absolute;
                    bottom: 0;
                    width: 100%;
                    transition: height 0.3s ease;
                }

                .arpg-health-orb {
                    background: radial-gradient(circle at 30% 30%, #ff6666, #cc0000);
                    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
                }

                .arpg-health-fill {
                    background: linear-gradient(to top, #ff0000, #ff4444);
                }

                .arpg-mana-orb {
                    background: radial-gradient(circle at 30% 30%, #6666ff, #0000cc);
                    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
                }

                .arpg-mana-fill {
                    background: linear-gradient(to top, #0000ff, #4444ff);
                }

                .arpg-orb-text {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-size: 12px;
                    font-weight: bold;
                    text-shadow: 1px 1px 2px black;
                }

                .arpg-center-panel {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                }

                .arpg-ability-bar {
                    display: flex;
                    gap: 5px;
                }

                .arpg-ability-slot {
                    width: 50px;
                    height: 50px;
                    background: rgba(50, 50, 50, 0.9);
                    border: 2px solid #666;
                    border-radius: 8px;
                    position: relative;
                    cursor: pointer;
                }

                .arpg-ability-slot:hover {
                    border-color: #ffaa00;
                }

                .arpg-ability-key {
                    position: absolute;
                    bottom: 2px;
                    right: 2px;
                    font-size: 10px;
                    color: #ccc;
                    font-weight: bold;
                }

                .arpg-ability-cooldown {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 14px;
                    font-weight: bold;
                    border-radius: 6px;
                }

                .arpg-xp-bar-container {
                    width: 300px;
                    height: 12px;
                    background: #222;
                    border-radius: 6px;
                    overflow: hidden;
                    border: 1px solid #444;
                }

                .arpg-xp-bar-fill {
                    height: 100%;
                    background: linear-gradient(to right, #aa00ff, #ff00ff);
                    transition: width 0.3s ease;
                }

                .arpg-potion-bar {
                    display: flex;
                    gap: 5px;
                }

                .arpg-potion-slot {
                    width: 40px;
                    height: 40px;
                    background: rgba(50, 50, 50, 0.9);
                    border: 2px solid #666;
                    border-radius: 8px;
                    position: relative;
                    cursor: pointer;
                }

                .arpg-potion-count {
                    position: absolute;
                    bottom: 2px;
                    right: 2px;
                    font-size: 10px;
                    color: white;
                    font-weight: bold;
                }

                .arpg-stats-panel {
                    position: absolute;
                    top: 20px;
                    left: 20px;
                    background: rgba(0, 0, 0, 0.7);
                    padding: 10px 15px;
                    border-radius: 8px;
                    color: white;
                    font-size: 14px;
                }

                .arpg-stats-panel div {
                    margin: 5px 0;
                }

                .arpg-level-display {
                    color: #ffaa00;
                    font-weight: bold;
                }

                .arpg-gold-display {
                    color: #ffdd00;
                }

                .arpg-kills-display {
                    color: #ff6666;
                }

                .arpg-message {
                    position: fixed;
                    top: 30%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.8);
                    color: white;
                    padding: 15px 30px;
                    border-radius: 8px;
                    font-size: 18px;
                    animation: arpg-message-fade 3s ease forwards;
                    z-index: 2000;
                }

                @keyframes arpg-message-fade {
                    0% { opacity: 0; transform: translate(-50%, 20px); }
                    20% { opacity: 1; transform: translate(-50%, 0); }
                    80% { opacity: 1; transform: translate(-50%, 0); }
                    100% { opacity: 0; transform: translate(-50%, -20px); }
                }

                .arpg-damage-number {
                    position: absolute;
                    color: #ff4444;
                    font-size: 16px;
                    font-weight: bold;
                    text-shadow: 1px 1px 2px black;
                    animation: arpg-damage-float 1s ease forwards;
                    pointer-events: none;
                    z-index: 1500;
                }

                @keyframes arpg-damage-float {
                    0% { opacity: 1; transform: translateY(0); }
                    100% { opacity: 0; transform: translateY(-50px); }
                }
            </style>

            <div class="arpg-stats-panel">
                <div class="arpg-level-display">Level: <span id="arpg-level">1</span></div>
                <div class="arpg-gold-display">Gold: <span id="arpg-gold">0</span></div>
                <div class="arpg-kills-display">Kills: <span id="arpg-kills">0</span></div>
            </div>

            <div class="arpg-hud-bar">
                <div class="arpg-orb arpg-health-orb">
                    <div class="arpg-orb-fill arpg-health-fill" id="arpg-health-fill" style="height: 100%"></div>
                    <div class="arpg-orb-text" id="arpg-health-text">100/100</div>
                </div>

                <div class="arpg-center-panel">
                    <div class="arpg-ability-bar" id="arpg-ability-bar">
                        <div class="arpg-ability-slot" data-slot="1">
                            <span class="arpg-ability-key">1</span>
                            <div class="arpg-ability-cooldown" style="display: none"></div>
                        </div>
                        <div class="arpg-ability-slot" data-slot="2">
                            <span class="arpg-ability-key">2</span>
                            <div class="arpg-ability-cooldown" style="display: none"></div>
                        </div>
                        <div class="arpg-ability-slot" data-slot="3">
                            <span class="arpg-ability-key">3</span>
                            <div class="arpg-ability-cooldown" style="display: none"></div>
                        </div>
                        <div class="arpg-ability-slot" data-slot="4">
                            <span class="arpg-ability-key">4</span>
                            <div class="arpg-ability-cooldown" style="display: none"></div>
                        </div>
                    </div>

                    <div class="arpg-xp-bar-container">
                        <div class="arpg-xp-bar-fill" id="arpg-xp-fill" style="width: 0%"></div>
                    </div>

                    <div class="arpg-potion-bar">
                        <div class="arpg-potion-slot" data-potion="health" style="background: linear-gradient(to bottom, #ff6666, #cc0000);">
                            <span class="arpg-potion-count" id="arpg-health-potions">3</span>
                        </div>
                        <div class="arpg-potion-slot" data-potion="mana" style="background: linear-gradient(to bottom, #6666ff, #0000cc);">
                            <span class="arpg-potion-count" id="arpg-mana-potions">3</span>
                        </div>
                    </div>
                </div>

                <div class="arpg-orb arpg-mana-orb">
                    <div class="arpg-orb-fill arpg-mana-fill" id="arpg-mana-fill" style="height: 100%"></div>
                    <div class="arpg-orb-text" id="arpg-mana-text">100/100</div>
                </div>
            </div>
        `;

        document.body.appendChild(this.uiContainer);

        // Cache element references
        this.healthFill = document.getElementById('arpg-health-fill');
        this.healthText = document.getElementById('arpg-health-text');
        this.manaFill = document.getElementById('arpg-mana-fill');
        this.manaText = document.getElementById('arpg-mana-text');
        this.xpFill = document.getElementById('arpg-xp-fill');
        this.levelDisplay = document.getElementById('arpg-level');
        this.goldDisplay = document.getElementById('arpg-gold');
        this.killsDisplay = document.getElementById('arpg-kills');
        this.healthPotionsDisplay = document.getElementById('arpg-health-potions');
        this.manaPotionsDisplay = document.getElementById('arpg-mana-potions');

        // Set up potion click handlers
        const potionSlots = this.uiContainer.querySelectorAll('.arpg-potion-slot');
        potionSlots.forEach(slot => {
            slot.addEventListener('click', () => {
                const potionType = slot.dataset.potion;
                const playerEntityId = this.game.gameManager.call('getPlayerEntity');
                if (playerEntityId) {
                    this.game.gameManager.call('usePotion', playerEntityId, potionType);
                }
            });
        });

        // Set up ability click handlers
        const abilitySlots = this.uiContainer.querySelectorAll('.arpg-ability-slot');
        abilitySlots.forEach(slot => {
            slot.addEventListener('click', () => {
                const slotNum = parseInt(slot.dataset.slot);
                this.game.gameManager.call('useAbilitySlot', slotNum);
            });
        });
    }

    showDamageNumber(x, y, damage, color = '#ff4444') {
        const damageEl = document.createElement('div');
        damageEl.className = 'arpg-damage-number';
        damageEl.textContent = Math.floor(damage);
        damageEl.style.left = `${x}px`;
        damageEl.style.top = `${y}px`;
        damageEl.style.color = color;

        document.body.appendChild(damageEl);

        setTimeout(() => {
            damageEl.remove();
        }, 1000);
    }

    showMessage(text, duration = 3000) {
        const messageEl = document.createElement('div');
        messageEl.className = 'arpg-message';
        messageEl.textContent = text;

        document.body.appendChild(messageEl);

        setTimeout(() => {
            messageEl.remove();
        }, duration);
    }

    updateUI() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const CT = this.componentTypes;

        // Update health
        const health = this.game.getComponent(playerEntityId, CT.HEALTH);
        if (health && this.healthFill && this.healthText) {
            const healthPercent = (health.current / health.max) * 100;
            this.healthFill.style.height = `${healthPercent}%`;
            this.healthText.textContent = `${Math.floor(health.current)}/${health.max}`;
        }

        // Update mana
        const resources = this.game.getComponent(playerEntityId, CT.RESOURCE_POOL);
        if (resources && this.manaFill && this.manaText) {
            const manaPercent = (resources.mana / resources.maxMana) * 100;
            this.manaFill.style.height = `${manaPercent}%`;
            this.manaText.textContent = `${Math.floor(resources.mana)}/${resources.maxMana}`;
        }

        // Update XP
        if (this.game.experienceSystem) {
            const xpProgress = this.game.gameManager.call('getXPProgress', playerEntityId);
            if (xpProgress && this.xpFill) {
                this.xpFill.style.width = `${xpProgress.percent}%`;
            }

            const level = this.game.gameManager.call('getEntityLevel', playerEntityId);
            if (this.levelDisplay) {
                this.levelDisplay.textContent = level;
            }
        }

        // Update gold
        if (this.game.arpgGameSystem && this.goldDisplay) {
            const gold = this.game.gameManager.call('getPlayerGold');
            this.goldDisplay.textContent = gold;
        }

        // Update kills
        if (this.game.arpgGameSystem && this.killsDisplay) {
            const kills = this.game.gameManager.call('getPlayerKills');
            this.killsDisplay.textContent = kills;
        }

        // Update potions
        if (this.game.potionSystem) {
            const healthPotions = this.game.gameManager.call('getPotionCount', playerEntityId, 'health');
            const manaPotions = this.game.gameManager.call('getPotionCount', playerEntityId, 'mana');

            if (this.healthPotionsDisplay) {
                this.healthPotionsDisplay.textContent = healthPotions;
            }
            if (this.manaPotionsDisplay) {
                this.manaPotionsDisplay.textContent = manaPotions;
            }
        }
    }

    update() {
        const now = this.game.state.now;

        // Throttle UI updates
        if (now - this.lastUIUpdate >= this.UI_UPDATE_INTERVAL) {
            this.updateUI();
            this.lastUIUpdate = now;
        }
    }
}
