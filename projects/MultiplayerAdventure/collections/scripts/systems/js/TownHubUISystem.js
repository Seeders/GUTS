/**
 * TownHubUISystem - Manages UI for the adventure game
 *
 * Handles:
 * - Main menu and lobby screens
 * - Town hub UI (party frame, player list, portals)
 * - HUD elements (health, abilities, minimap)
 * - Notifications and dialogs
 */
class TownHubUISystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.uiSystem = this;
        this.game.townHubUISystem = this;

        this.elements = {};
        this.notifications = [];
        this.maxNotifications = 5;
    }

    init(params) {
        this.params = params || {};
        console.log('[TownHubUISystem] Initializing...');
        this.registerServices();
        this.setupUI();
    }

    registerServices() {
        this.game.register('showNotification', this.showNotification.bind(this));
        this.game.register('showMainMenu', this.showMainMenu.bind(this));
        this.game.register('showTownHub', this.showTownHub.bind(this));
        this.game.register('showLoadingScreen', this.showLoadingScreen.bind(this));
        this.game.register('hideLoadingScreen', this.hideLoadingScreen.bind(this));
        this.game.register('updatePlayerHUD', this.updatePlayerHUD.bind(this));
        this.game.register('showPartyFrame', this.showPartyFrame.bind(this));
        this.game.register('hidePartyFrame', this.hidePartyFrame.bind(this));
    }

    setupUI() {
        // Create main UI container
        this.createUIContainer();
        this.createMainMenu();
        this.createHUD();
        this.createNotificationContainer();
        this.createLoadingScreen();
    }

    createUIContainer() {
        let container = document.getElementById('game-ui');
        if (!container) {
            container = document.createElement('div');
            container.id = 'game-ui';
            container.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 100;
            `;
            document.body.appendChild(container);
        }
        this.elements.container = container;
    }

    createMainMenu() {
        const menu = document.createElement('div');
        menu.id = 'main-menu';
        menu.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            z-index: 200;
        `;

        menu.innerHTML = `
            <h1 style="color: #4a9eff; font-size: 48px; margin-bottom: 40px; text-shadow: 0 0 20px rgba(74, 158, 255, 0.5);">
                Multiplayer Adventure
            </h1>
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <input type="text" id="player-name-input" placeholder="Enter your name" style="
                    padding: 15px 30px;
                    font-size: 18px;
                    border: 2px solid #4a9eff;
                    border-radius: 8px;
                    background: rgba(0, 0, 0, 0.5);
                    color: white;
                    text-align: center;
                    width: 300px;
                ">
                <button id="enter-town-btn" style="
                    padding: 15px 30px;
                    font-size: 20px;
                    background: linear-gradient(135deg, #4a9eff, #2d7dd2);
                    border: none;
                    border-radius: 8px;
                    color: white;
                    cursor: pointer;
                    transition: transform 0.2s, box-shadow 0.2s;
                ">Enter Town</button>
            </div>
            <p style="color: #888; margin-top: 30px; font-size: 14px;">
                Join other adventurers in the town hub and embark on adventures together!
            </p>
        `;

        this.elements.container.appendChild(menu);
        this.elements.mainMenu = menu;

        // Event listeners
        const enterBtn = document.getElementById('enter-town-btn');
        enterBtn.addEventListener('click', () => this.handleEnterTown());
        enterBtn.addEventListener('mouseenter', () => {
            enterBtn.style.transform = 'scale(1.05)';
            enterBtn.style.boxShadow = '0 0 20px rgba(74, 158, 255, 0.5)';
        });
        enterBtn.addEventListener('mouseleave', () => {
            enterBtn.style.transform = 'scale(1)';
            enterBtn.style.boxShadow = 'none';
        });

        // Enter key to submit
        const nameInput = document.getElementById('player-name-input');
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleEnterTown();
        });
    }

    createHUD() {
        const hud = document.createElement('div');
        hud.id = 'game-hud';
        hud.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: none;
            pointer-events: none;
        `;

        hud.innerHTML = `
            <!-- Player Stats (top left) -->
            <div id="player-stats" style="
                position: absolute;
                top: 20px;
                left: 20px;
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #4a9eff;
                border-radius: 8px;
                padding: 15px;
                pointer-events: auto;
                min-width: 200px;
            ">
                <div id="player-name-display" style="color: #4a9eff; font-weight: bold; margin-bottom: 10px;"></div>
                <div style="margin-bottom: 8px;">
                    <div style="color: #888; font-size: 12px;">Health</div>
                    <div class="health-bar" style="background: #333; border-radius: 4px; height: 20px; overflow: hidden;">
                        <div id="player-health-fill" style="background: linear-gradient(90deg, #ff4444, #ff6666); height: 100%; width: 100%; transition: width 0.3s;"></div>
                    </div>
                    <div id="player-health-text" style="color: white; font-size: 12px; text-align: center; margin-top: 2px;">100/100</div>
                </div>
                <div style="display: flex; justify-content: space-between; color: #888; font-size: 12px;">
                    <span>Level: <span id="player-level" style="color: #4a9eff;">1</span></span>
                    <span>Gold: <span id="player-gold" style="color: #ffd700;">100</span></span>
                </div>
            </div>

            <!-- Target Frame (top center) -->
            <div id="target-frame" style="
                position: absolute;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #ff4444;
                border-radius: 8px;
                padding: 10px 20px;
                display: none;
                min-width: 200px;
                text-align: center;
            "></div>

            <!-- Party Frame (left side) -->
            <div id="party-frame" style="
                position: absolute;
                top: 180px;
                left: 20px;
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #4a9eff;
                border-radius: 8px;
                padding: 10px;
                display: none;
                min-width: 180px;
                pointer-events: auto;
            "></div>

            <!-- Objectives Panel (right side) -->
            <div id="objectives-panel" style="
                position: absolute;
                top: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #4a9eff;
                border-radius: 8px;
                padding: 15px;
                display: none;
                min-width: 250px;
            "></div>

            <!-- Action Bar (bottom center) -->
            <div id="action-bar" style="
                position: absolute;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #4a9eff;
                border-radius: 8px;
                padding: 10px;
                display: flex;
                gap: 5px;
                pointer-events: auto;
            ">
                ${[1,2,3,4,5,6].map(i => `
                    <div id="ability-slot-${i}" class="ability-slot" style="
                        width: 50px;
                        height: 50px;
                        background: #333;
                        border: 2px solid #555;
                        border-radius: 4px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        position: relative;
                        cursor: pointer;
                    ">
                        <span style="position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: #888;">${i}</span>
                        <div class="cooldown-overlay" style="
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            background: rgba(0, 0, 0, 0.7);
                            display: none;
                            align-items: center;
                            justify-content: center;
                            color: white;
                            font-weight: bold;
                        "></div>
                    </div>
                `).join('')}
            </div>

            <!-- Mini Map (bottom right) -->
            <div id="mini-map" style="
                position: absolute;
                bottom: 20px;
                right: 20px;
                width: 200px;
                height: 200px;
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #4a9eff;
                border-radius: 8px;
                overflow: hidden;
            ">
                <canvas id="mini-map-canvas" width="200" height="200"></canvas>
            </div>
        `;

        this.elements.container.appendChild(hud);
        this.elements.hud = hud;
    }

    createNotificationContainer() {
        const container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: absolute;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 300;
            pointer-events: none;
        `;
        this.elements.container.appendChild(container);
        this.elements.notificationContainer = container;
    }

    createLoadingScreen() {
        const loading = document.createElement('div');
        loading.id = 'loading-screen';
        loading.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #0f0f1a;
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 400;
        `;

        loading.innerHTML = `
            <div class="loading-spinner" style="
                width: 50px;
                height: 50px;
                border: 4px solid #333;
                border-top-color: #4a9eff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
            <p style="color: #4a9eff; margin-top: 20px; font-size: 18px;">Loading...</p>
            <style>
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
        `;

        this.elements.container.appendChild(loading);
        this.elements.loadingScreen = loading;
    }

    handleEnterTown() {
        const nameInput = document.getElementById('player-name-input');
        const playerName = nameInput.value.trim() || 'Adventurer';

        localStorage.setItem('playerName', playerName);

        this.showLoadingScreen();

        // Connect to server and enter town
        this.game.call('enterTown', playerName, (success, data) => {
            if (success) {
                this.hideLoadingScreen();
                this.showTownHub();

                // Switch to town hub scene
                this.game.switchScene('town_hub');
            } else {
                this.hideLoadingScreen();
                this.showNotification('Failed to connect to server', 'error');
            }
        });
    }

    showMainMenu() {
        if (this.elements.mainMenu) this.elements.mainMenu.style.display = 'flex';
        if (this.elements.hud) this.elements.hud.style.display = 'none';
    }

    showTownHub() {
        if (this.elements.mainMenu) this.elements.mainMenu.style.display = 'none';
        if (this.elements.hud) this.elements.hud.style.display = 'block';
    }

    showLoadingScreen() {
        if (this.elements.loadingScreen) {
            this.elements.loadingScreen.style.display = 'flex';
        }
    }

    hideLoadingScreen() {
        if (this.elements.loadingScreen) {
            this.elements.loadingScreen.style.display = 'none';
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        const colors = {
            info: '#4a9eff',
            success: '#4aff7f',
            warning: '#ffb84a',
            error: '#ff4a4a'
        };

        notification.style.cssText = `
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid ${colors[type] || colors.info};
            border-radius: 8px;
            padding: 12px 24px;
            color: white;
            font-size: 14px;
            animation: fadeIn 0.3s ease;
            text-align: center;
        `;

        notification.textContent = message;
        this.elements.notificationContainer.appendChild(notification);

        // Limit notifications
        while (this.elements.notificationContainer.children.length > this.maxNotifications) {
            this.elements.notificationContainer.firstChild.remove();
        }

        // Auto-remove
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    updatePlayerHUD() {
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return;

        const playerChar = this.game.getComponent(localPlayer, 'playerCharacter');
        const health = this.game.getComponent(localPlayer, 'health');

        // Update name
        const nameDisplay = document.getElementById('player-name-display');
        if (nameDisplay && playerChar) {
            nameDisplay.textContent = `${playerChar.playerName} (Lv.${playerChar.level})`;
        }

        // Update health
        if (health) {
            const healthFill = document.getElementById('player-health-fill');
            const healthText = document.getElementById('player-health-text');
            const percent = (health.current / health.max) * 100;

            if (healthFill) healthFill.style.width = `${percent}%`;
            if (healthText) healthText.textContent = `${Math.floor(health.current)}/${health.max}`;
        }

        // Update level and gold
        const levelDisplay = document.getElementById('player-level');
        const goldDisplay = document.getElementById('player-gold');

        if (levelDisplay) levelDisplay.textContent = this.game.state.playerLevel || 1;
        if (goldDisplay) goldDisplay.textContent = this.game.state.playerGold || 0;
    }

    showPartyFrame() {
        const partyFrame = document.getElementById('party-frame');
        if (partyFrame) partyFrame.style.display = 'block';
    }

    hidePartyFrame() {
        const partyFrame = document.getElementById('party-frame');
        if (partyFrame) partyFrame.style.display = 'none';
    }

    update() {
        // Update HUD every frame
        this.updatePlayerHUD();
    }

    onSceneUnload() {
        // Clean up notifications
        if (this.elements.notificationContainer) {
            this.elements.notificationContainer.innerHTML = '';
        }
    }
}
