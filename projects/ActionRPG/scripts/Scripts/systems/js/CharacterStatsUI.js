class CharacterStatsUI extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.characterStatsUI = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.uiContainer = null;
        this.isVisible = false;
    }

    init() {
        this.game.gameManager.register('showCharacterStats', this.show.bind(this));
        this.game.gameManager.register('hideCharacterStats', this.hide.bind(this));
        this.game.gameManager.register('toggleCharacterStats', this.toggle.bind(this));

        this.createUI();
    }

    createUI() {
        this.uiContainer = document.createElement('div');
        this.uiContainer.id = 'character-stats-ui';
        this.uiContainer.innerHTML = `
            <style>
                #character-stats-ui {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 400px;
                    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
                    border: 2px solid #d4af37;
                    border-radius: 10px;
                    display: none;
                    z-index: 9000;
                    font-family: 'Georgia', serif;
                    box-shadow: 0 0 50px rgba(0, 0, 0, 0.8);
                }

                .stats-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 20px;
                    border-bottom: 1px solid #333;
                }

                .stats-title {
                    color: #d4af37;
                    font-size: 24px;
                }

                .stats-close {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                }

                .stats-close:hover {
                    color: #ff4444;
                }

                .stats-content {
                    padding: 20px;
                }

                .stats-section {
                    margin-bottom: 20px;
                }

                .stats-section-title {
                    color: #d4af37;
                    font-size: 14px;
                    margin-bottom: 10px;
                    padding-bottom: 5px;
                    border-bottom: 1px solid #333;
                }

                .stat-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 5px 0;
                    font-size: 13px;
                }

                .stat-name {
                    color: #888;
                }

                .stat-value {
                    color: #fff;
                }

                .stat-value.health { color: #ff4444; }
                .stat-value.mana { color: #4444ff; }
                .stat-value.damage { color: #ff8800; }
                .stat-value.armor { color: #888888; }
                .stat-value.resist { color: #00ff88; }
                .stat-value.speed { color: #ffff00; }

                .character-info {
                    text-align: center;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #333;
                    margin-bottom: 15px;
                }

                .character-class {
                    color: #d4af37;
                    font-size: 20px;
                    margin-bottom: 5px;
                }

                .character-level {
                    color: #fff;
                    font-size: 16px;
                }
            </style>

            <div class="stats-header">
                <div class="stats-title">Character Stats</div>
                <button class="stats-close" id="stats-close">&times;</button>
            </div>

            <div class="stats-content" id="stats-content">
                <!-- Stats will be populated here -->
            </div>
        `;

        document.body.appendChild(this.uiContainer);

        document.getElementById('stats-close').addEventListener('click', () => this.hide());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) this.hide();
            if (e.key === 'c' || e.key === 'C') this.toggle();
        });
    }

    refreshStats() {
        const content = document.getElementById('stats-content');
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const CT = this.componentTypes;
        const health = this.game.getComponent(playerEntityId, CT.HEALTH);
        const combat = this.game.getComponent(playerEntityId, CT.COMBAT);
        const resources = this.game.getComponent(playerEntityId, CT.RESOURCE_POOL);
        const velocity = this.game.getComponent(playerEntityId, CT.VELOCITY);
        const unitType = this.game.getComponent(playerEntityId, CT.UNIT_TYPE);

        const level = this.game.gameManager.call('getEntityLevel', playerEntityId) || 1;
        const className = unitType?.className || 'Warrior';

        content.innerHTML = `
            <div class="character-info">
                <div class="character-class">${className.charAt(0).toUpperCase() + className.slice(1)}</div>
                <div class="character-level">Level ${level}</div>
            </div>

            <div class="stats-section">
                <div class="stats-section-title">Core Stats</div>
                <div class="stat-row">
                    <span class="stat-name">Health</span>
                    <span class="stat-value health">${Math.floor(health?.current || 0)} / ${health?.max || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Mana</span>
                    <span class="stat-value mana">${Math.floor(resources?.mana || 0)} / ${resources?.maxMana || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Stamina</span>
                    <span class="stat-value">${Math.floor(resources?.stamina || 0)} / ${resources?.maxStamina || 0}</span>
                </div>
            </div>

            <div class="stats-section">
                <div class="stats-section-title">Offense</div>
                <div class="stat-row">
                    <span class="stat-name">Damage</span>
                    <span class="stat-value damage">${Math.floor(combat?.damage || 0)}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Attack Speed</span>
                    <span class="stat-value speed">${(combat?.attackSpeed || 1).toFixed(2)}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Attack Range</span>
                    <span class="stat-value">${combat?.range || 0}</span>
                </div>
            </div>

            <div class="stats-section">
                <div class="stats-section-title">Defense</div>
                <div class="stat-row">
                    <span class="stat-name">Armor</span>
                    <span class="stat-value armor">${combat?.armor || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Fire Resistance</span>
                    <span class="stat-value resist">${Math.floor((combat?.fireResistance || 0) * 100)}%</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Cold Resistance</span>
                    <span class="stat-value resist">${Math.floor((combat?.coldResistance || 0) * 100)}%</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Lightning Resistance</span>
                    <span class="stat-value resist">${Math.floor((combat?.lightningResistance || 0) * 100)}%</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Poison Resistance</span>
                    <span class="stat-value resist">${Math.floor((combat?.poisonResistance || 0) * 100)}%</span>
                </div>
            </div>

            <div class="stats-section">
                <div class="stats-section-title">Other</div>
                <div class="stat-row">
                    <span class="stat-name">Movement Speed</span>
                    <span class="stat-value speed">${velocity?.maxSpeed || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-name">Mana Regen</span>
                    <span class="stat-value mana">${resources?.manaRegen || 0}/sec</span>
                </div>
            </div>
        `;
    }

    show() {
        this.isVisible = true;
        this.uiContainer.style.display = 'block';
        this.refreshStats();
    }

    hide() {
        this.isVisible = false;
        this.uiContainer.style.display = 'none';
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    update() {}
}
