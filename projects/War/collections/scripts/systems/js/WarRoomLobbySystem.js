/**
 * WarRoomLobbySystem - Manages the game room lobby UI
 * Shows player cards, room chat, and start button
 */
class WarRoomLobbySystem extends GUTS.BaseSystem {
    static services = [
        'showLobby',
        'updateLobby'
    ];

    static serviceDependencies = [
        'leaveRoom',
        'toggleLobbyReady',
        'showChatView',
        'showOnlineLobby'
    ];

    constructor(game) {
        super(game);
        this.roomId = null;
        this.boundHandlers = {};
        this.roomChatManager = null;
        this.isReady = false;
    }

    init() {}

    showLobby(gameState, roomId) {
        this.roomId = roomId;
        this.isReady = false;

        // Hide all screens, show game room
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const roomScreen = document.getElementById('gameRoomScreen');
        if (roomScreen) roomScreen.classList.add('active');

        this.setupRoomChat();
        this.setupEventListeners();
        this.updateLobby(gameState);
    }

    setupRoomChat() {
        if (this.roomChatManager) {
            this.roomChatManager.dispose();
            this.roomChatManager = null;
        }

        if (GUTS.ChatManager) {
            this.roomChatManager = new GUTS.ChatManager(this.game, {
                messagesContainerId: 'roomChatMessages',
                inputId: 'roomChatInput',
                sendButtonId: 'roomChatSendBtn',
                context: 'game'
            });
            this.roomChatManager.init();
            this.roomChatManager.clearMessages();
        }
    }

    setupEventListeners() {
        const leaveBtn = document.getElementById('leaveRoomBtn');
        const readyBtn = document.getElementById('readyBtn');

        if (!this.boundHandlers.leave) {
            this.boundHandlers.leave = () => this.leaveRoom();
            this.boundHandlers.ready = () => this.toggleReady();
        }

        leaveBtn?.removeEventListener('click', this.boundHandlers.leave);
        leaveBtn?.addEventListener('click', this.boundHandlers.leave);

        readyBtn?.removeEventListener('click', this.boundHandlers.ready);
        readyBtn?.addEventListener('click', this.boundHandlers.ready);
    }

    updateLobby(gameState) {
        if (!gameState) return;

        const myPlayerId = this.game.clientNetworkManager?.playerId;

        if (gameState.players) {
            const myPlayer = gameState.players.find(p => p.id === myPlayerId);
            const opponent = gameState.players.find(p => p.id !== myPlayerId);

            // Update player 1 (you)
            if (myPlayer) {
                const card = document.getElementById('player1Card');
                const name = document.getElementById('player1Name');
                const status = document.getElementById('player1Status');
                const readyBtn = document.getElementById('readyBtn');

                if (card) card.className = `player-card ${myPlayer.ready ? 'ready' : 'waiting'}`;
                if (name) name.textContent = myPlayer.isHost ? `${myPlayer.name} (Host)` : myPlayer.name;
                if (status) {
                    status.textContent = myPlayer.ready ? 'Ready' : 'Not Ready';
                    status.className = `player-status ${myPlayer.ready ? 'ready' : 'waiting'}`;
                }
                if (readyBtn) {
                    readyBtn.disabled = false;
                    readyBtn.textContent = myPlayer.ready ? 'CANCEL READY' : 'READY';
                    readyBtn.className = myPlayer.ready ? 'ready-btn-large ready-state' : 'ready-btn-large';
                }
            }

            // Update player 2 (opponent)
            if (opponent) {
                const card = document.getElementById('player2Card');
                const name = document.getElementById('player2Name');
                const status = document.getElementById('player2Status');

                if (card) card.className = `player-card ${opponent.ready ? 'ready' : 'waiting'}`;
                if (name) name.textContent = opponent.isHost ? `${opponent.name} (Host)` : opponent.name;
                if (status) {
                    status.textContent = opponent.ready ? 'Ready' : 'Not Ready';
                    status.className = `player-status ${opponent.ready ? 'ready' : 'waiting'}`;
                }
            } else {
                const card = document.getElementById('player2Card');
                const name = document.getElementById('player2Name');
                const status = document.getElementById('player2Status');

                if (card) card.className = 'player-card empty';
                if (name) name.textContent = 'Waiting...';
                if (status) {
                    status.textContent = 'Waiting';
                    status.className = 'player-status empty';
                }
            }

            // Status message
            const statusMsg = document.getElementById('roomStatusMessage');
            if (statusMsg) {
                if (!opponent) {
                    statusMsg.textContent = 'Waiting for opponent...';
                } else if (myPlayer?.ready && opponent?.ready) {
                    statusMsg.textContent = 'Both players ready! Starting game...';
                } else if (myPlayer?.ready) {
                    statusMsg.textContent = 'Waiting for opponent to ready up...';
                } else if (opponent?.ready) {
                    statusMsg.textContent = 'Opponent is ready! Click Ready to start.';
                } else {
                    statusMsg.textContent = 'Both players must ready up to start.';
                }
            }

            // Show ready button when room is full
            const readyBtn = document.getElementById('readyBtn');
            if (readyBtn) {
                readyBtn.style.display = opponent ? 'block' : 'none';
            }
        }
    }

    toggleReady() {
        this.call.toggleLobbyReady?.();
    }

    leaveRoom() {
        this.call.leaveRoom?.();
        this.returnToOnlineLobby();
    }

    returnToOnlineLobby() {
        this.roomId = null;

        if (this.roomChatManager) {
            this.roomChatManager.dispose();
            this.roomChatManager = null;
        }

        // Hide game room
        const roomScreen = document.getElementById('gameRoomScreen');
        if (roomScreen) roomScreen.classList.remove('active');

        // Show online lobby
        this.call.showOnlineLobby?.();
    }

    dispose() {
        if (this.roomChatManager) {
            this.roomChatManager.dispose();
            this.roomChatManager = null;
        }

        const leaveBtn = document.getElementById('leaveRoomBtn');
        const readyBtn = document.getElementById('readyBtn');
        if (this.boundHandlers.leave) leaveBtn?.removeEventListener('click', this.boundHandlers.leave);
        if (this.boundHandlers.ready) readyBtn?.removeEventListener('click', this.boundHandlers.ready);
        this.boundHandlers = {};
    }

    onSceneUnload() {
        this.dispose();
    }
}
