/**
 * WarLobbySystem - Main menu with Single Player / Multiplayer
 * Multiplayer: enter name, connect to server, transition to onlineLobby scene
 */
class WarLobbySystem extends GUTS.BaseSystem {
    static services = [];
    static serviceDependencies = ['connectToServer'];

    init() {
        const config = this.game.getConfig?.() || {};
        this._isHeadless = config.isHeadless || false;
        this.currentScreen = 'menu';
    }

    postAllInit() {
        if (this._isHeadless) return;

        // Menu buttons
        document.getElementById('singlePlayerBtn')?.addEventListener('click', () => this.onSinglePlayer());
        document.getElementById('multiplayerBtn')?.addEventListener('click', () => this.onMultiplayer());

        // Name screen
        document.getElementById('connectBtn')?.addEventListener('click', () => this.onConnect());
        document.getElementById('nameBackBtn')?.addEventListener('click', () => this.showScreen('menu'));

        // Enter key on name input
        document.getElementById('playerNameInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.onConnect();
        });
    }

    // ==================== SCREEN MANAGEMENT ====================

    showScreen(screen) {
        this.currentScreen = screen;
        const screens = ['lobbyMenu', 'nameScreen'];
        screens.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const targetId = {
            menu: 'lobbyMenu',
            name: 'nameScreen'
        }[screen];

        const target = document.getElementById(targetId);
        if (target) target.style.display = 'flex';

        this.setStatus('');
    }

    setStatus(msg, isError) {
        const el = document.getElementById('lobbyStatus');
        if (el) {
            el.textContent = msg;
            el.style.color = isError ? '#e94560' : '#aaa';
        }
    }

    // ==================== HANDLERS ====================

    onSinglePlayer() {
        this.game.switchScene('game', { isLocalGame: true });
    }

    onMultiplayer() {
        this.showScreen('name');
        document.getElementById('playerNameInput')?.focus();
    }

    async onConnect() {
        const nameInput = document.getElementById('playerNameInput');
        const playerName = nameInput?.value?.trim();
        if (!playerName) {
            this.setStatus('Enter a name', true);
            return;
        }

        this.game.state.playerName = playerName;
        this.setStatus('Connecting...');

        const connectBtn = document.getElementById('connectBtn');
        if (connectBtn) connectBtn.disabled = true;

        try {
            await this.call.connectToServer();
            // Connected — switch to the online lobby scene
            this.game.switchScene('onlineLobby');
        } catch (err) {
            this.setStatus('Connection failed: ' + (err.message || err), true);
        } finally {
            if (connectBtn) connectBtn.disabled = false;
        }
    }

    update() {}
}
