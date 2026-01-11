/**
 * OnlineLobbyUISystem - Manages the online multiplayer lobby UI
 * Shows available games list and allows creating/joining games
 */
class OnlineLobbyUISystem extends GUTS.BaseSystem {
    static services = [
        'refreshGamesList',
        'showOnlineLobby',
        'hideOnlineLobby'
    ];

    constructor(game) {
        super(game);
        this.refreshInterval = null;
        this.container = null;
    }

    init(params) {
        this.params = params || {};
        this.container = document.getElementById('onlineLobbyScreen');
        this.showOnlineLobby();
        this.setupEventListeners();
        this.startAutoRefresh();
        this.refreshGamesList();
    }

    setupEventListeners() {
        const backBtn = document.getElementById('onlineLobbyBackBtn');
        const createBtn = document.getElementById('createGameBtn');
        const refreshBtn = document.getElementById('refreshGamesBtn');

        // Store bound handlers for cleanup
        this._backHandler = () => this.goBackToMenu();
        this._createHandler = () => this.createGame();
        this._refreshHandler = () => this.refreshGamesList();

        backBtn?.addEventListener('click', this._backHandler);
        createBtn?.addEventListener('click', this._createHandler);
        refreshBtn?.addEventListener('click', this._refreshHandler);
    }

    cleanupEventListeners() {
        const backBtn = document.getElementById('onlineLobbyBackBtn');
        const createBtn = document.getElementById('createGameBtn');
        const refreshBtn = document.getElementById('refreshGamesBtn');

        if (this._backHandler) {
            backBtn?.removeEventListener('click', this._backHandler);
        }
        if (this._createHandler) {
            createBtn?.removeEventListener('click', this._createHandler);
        }
        if (this._refreshHandler) {
            refreshBtn?.removeEventListener('click', this._refreshHandler);
        }

        this._backHandler = null;
        this._createHandler = null;
        this._refreshHandler = null;
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.refreshGamesList();
        }, 5000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    async refreshGamesList() {
        const container = document.getElementById('gamesListContainer');
        if (!container) return;

        try {
            const response = await fetch('/api/rooms');
            if (!response.ok) {
                throw new Error('Failed to fetch rooms');
            }

            const rooms = await response.json();

            // Filter to only show joinable rooms
            const availableRooms = rooms.filter(room =>
                room.playerCount > 0 &&
                room.playerCount < room.maxPlayers &&
                !room.isActive
            );

            if (availableRooms.length === 0) {
                container.innerHTML = '<div class="no-games">No games available. Create one!</div>';
                return;
            }

            container.innerHTML = availableRooms.map(room => `
                <div class="game-item" data-room-id="${room.id}">
                    <div class="game-info">
                        <span class="game-id">Room: ${room.id}</span>
                        <span class="game-players">${room.playerCount}/${room.maxPlayers} players</span>
                    </div>
                    ${room.playerCount < room.maxPlayers ?
                        `<button class="join-btn" data-room-id="${room.id}">Join</button>` :
                        '<span class="game-full">Full</span>'}
                </div>
            `).join('');

            container.querySelectorAll('.join-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    // Prevent multiple clicks
                    if (this.isJoining) return;
                    this.isJoining = true;

                    const roomId = e.target.dataset.roomId;

                    // Disable all join buttons
                    container.querySelectorAll('.join-btn').forEach(b => {
                        b.disabled = true;
                        b.textContent = 'Joining...';
                    });

                    this.joinGame(roomId);
                });
            });
        } catch (error) {
            console.error('[OnlineLobbyUISystem] Failed to refresh games:', error);
            container.innerHTML = '<div class="no-games">Failed to load games</div>';
        }
    }

    createGame() {
        const playerName = this.game.state.playerName || 'Player';
        this.game.call('createRoom', playerName, 2);
    }

    joinGame(roomId) {
        const playerName = this.game.state.playerName || 'Player';
        this.game.call('joinRoom', roomId, playerName);
    }

    goBackToMenu() {
        this.stopAutoRefresh();
        if (this.game.clientNetworkManager?.isConnected) {
            this.game.clientNetworkManager.disconnect();
        }
        this.game.switchScene('lobby');
    }

    showOnlineLobby() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        if (this.container) {
            this.container.classList.add('active');
        }
    }

    hideOnlineLobby() {
        if (this.container) {
            this.container.classList.remove('active');
        }
    }

    dispose() {
        this.stopAutoRefresh();
        this.cleanupEventListeners();
    }

    onSceneUnload() {
        this.dispose();
    }
}
