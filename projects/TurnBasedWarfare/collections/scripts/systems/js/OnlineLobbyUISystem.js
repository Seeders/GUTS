/**
 * OnlineLobbyUISystem - Manages the online multiplayer lobby UI
 * Shows chat lobby as main view with Create/Join game options
 */
class OnlineLobbyUISystem extends GUTS.BaseSystem {
    static services = [
        'refreshGamesList',
        'showOnlineLobby',
        'hideOnlineLobby',
        'showChatView',
        'showGamesListView'
    ];

    static serviceDependencies = [
        'createRoom',
        'joinRoom'
    ];

    constructor(game) {
        super(game);
        this.refreshInterval = null;
        this.container = null;
        this.currentView = 'chat'; // 'chat' or 'gamesList'
        this.boundHandlers = {};
        this.chatManager = null;
    }

    init(params) {
        this.params = params || {};
        this.container = document.getElementById('onlineLobbyScreen');
        this.showOnlineLobby();
        this.setupEventListeners();
        this.setupChat();
        this.sendPlayerName();
        this.updateLobbyStats();
        this.statsInterval = setInterval(() => this.updateLobbyStats(), 5000);
    }

    sendPlayerName() {
        // Send player name to server for chat display
        const nm = this.game.clientNetworkManager;
        const playerName = this.game.state.playerName || 'Player';
        if (nm?.socket) {
            nm.socket.emit('SET_PLAYER_NAME', { playerName });
        }
    }

    setupChat() {
        // Use ChatManager for lobby chat
        if (GUTS.ChatManager) {
            this.chatManager = new GUTS.ChatManager(this.game, {
                messagesContainerId: 'lobbyChatMessages',
                inputId: 'lobbyChatInput',
                sendButtonId: 'lobbyChatSendBtn',
                context: 'lobby'
            });
            this.chatManager.init();
        }
    }

    setupEventListeners() {
        const backBtn = document.getElementById('onlineLobbyBackBtn');
        const createBtn = document.getElementById('createGameBtn');
        const joinBtn = document.getElementById('joinGameBtn');
        const refreshBtn = document.getElementById('refreshGamesBtn');
        const gamesListBackBtn = document.getElementById('gamesListBackBtn');

        // Store bound handlers for cleanup
        this.boundHandlers.back = () => this.goBackToMenu();
        this.boundHandlers.create = () => this.createGame();
        this.boundHandlers.join = () => this.showGamesListView();
        this.boundHandlers.refresh = () => this.refreshGamesList();
        this.boundHandlers.gamesListBack = () => this.showChatView();

        backBtn?.addEventListener('click', this.boundHandlers.back);
        createBtn?.addEventListener('click', this.boundHandlers.create);
        joinBtn?.addEventListener('click', this.boundHandlers.join);
        refreshBtn?.addEventListener('click', this.boundHandlers.refresh);
        gamesListBackBtn?.addEventListener('click', this.boundHandlers.gamesListBack);
    }

    async updateLobbyStats() {
        try {
            // Fetch player count
            const statsResponse = await fetch('/api/stats');
            if (statsResponse.ok) {
                const stats = await statsResponse.json();
                const countEl = document.getElementById('onlinePlayersCount');
                if (countEl) {
                    countEl.textContent = stats.connectedPlayers || 0;
                }
            }

            // Fetch room counts
            const roomsResponse = await fetch('/api/rooms');
            if (roomsResponse.ok) {
                const rooms = await roomsResponse.json();

                // Available games: has players, not full, not active
                const availableGames = rooms.filter(room =>
                    room.playerCount > 0 &&
                    room.playerCount < room.maxPlayers &&
                    !room.isActive
                );

                // Active games: currently in battle
                const activeGames = rooms.filter(room => room.isActive);

                const availableEl = document.getElementById('availableGamesCount');
                const activeEl = document.getElementById('activeGamesCount');

                if (availableEl) {
                    availableEl.textContent = availableGames.length;
                }
                if (activeEl) {
                    activeEl.textContent = activeGames.length;
                }
            }
        } catch (error) {
            // Silently fail - not critical
        }
    }

    cleanupEventListeners() {
        const backBtn = document.getElementById('onlineLobbyBackBtn');
        const createBtn = document.getElementById('createGameBtn');
        const joinBtn = document.getElementById('joinGameBtn');
        const refreshBtn = document.getElementById('refreshGamesBtn');
        const gamesListBackBtn = document.getElementById('gamesListBackBtn');

        backBtn?.removeEventListener('click', this.boundHandlers.back);
        createBtn?.removeEventListener('click', this.boundHandlers.create);
        joinBtn?.removeEventListener('click', this.boundHandlers.join);
        refreshBtn?.removeEventListener('click', this.boundHandlers.refresh);
        gamesListBackBtn?.removeEventListener('click', this.boundHandlers.gamesListBack);

        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }

        this.boundHandlers = {};
    }

    showChatView() {
        this.currentView = 'chat';
        this.stopAutoRefresh();

        const chatView = document.getElementById('chatLobbyView');
        const gamesView = document.getElementById('gamesListView');

        if (chatView) chatView.classList.add('active');
        if (gamesView) gamesView.classList.remove('active');
    }

    showGamesListView() {
        this.currentView = 'gamesList';

        const chatView = document.getElementById('chatLobbyView');
        const gamesView = document.getElementById('gamesListView');

        if (chatView) chatView.classList.remove('active');
        if (gamesView) gamesView.classList.add('active');

        this.refreshGamesList();
        this.startAutoRefresh();
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
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
                    const roomId = e.target.dataset.roomId;
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
        this.call.createRoom( playerName, 2);
    }

    joinGame(roomId) {
        const playerName = this.game.state.playerName || 'Player';
        this.call.joinRoom( roomId, playerName);
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
        // Always start with chat view
        this.showChatView();
    }

    hideOnlineLobby() {
        if (this.container) {
            this.container.classList.remove('active');
        }
    }

    dispose() {
        this.stopAutoRefresh();
        this.cleanupEventListeners();
        if (this.chatManager) {
            this.chatManager.dispose();
            this.chatManager = null;
        }
    }

    onSceneUnload() {
        this.dispose();
    }
}
