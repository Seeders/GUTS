import BaseWarNetworkSystem from './BaseWarNetworkSystem.js';

/**
 * ClientWarNetworkSystem - Client-side networking for War
 *
 * Local game: directly calls game logic (simulates both players ready)
 * Multiplayer: uses Socket.IO via ClientNetworkManager
 *
 * Multiplayer uses deterministic lockstep:
 * - Server generates a seed and coordinates ready signals
 * - Both clients run identical game logic with the same seed
 * - No game state is sent over the network, only timing signals
 */
class ClientWarNetworkSystem extends BaseWarNetworkSystem {
    static services = [
        ...BaseWarNetworkSystem.services,
        'connectToServer',
        'createRoom',
        'joinRoom',
        'leaveRoom',
        'toggleLobbyReady',
        'sendReady',
        'getLocalPlayerId',
        'getConnectionState'
    ];

    static serviceDependencies = [
        ...BaseWarNetworkSystem.serviceDependencies,
        'showLobby',
        'updateLobby',
        'playRound',
        'startGame'
    ];

    constructor(game) {
        super(game);
        this.localPlayerId = 1;
        this.roomId = null;
        this.isHost = false;
        this.networkUnsubscribers = [];
    }

    init() {
        super.init();
        this.setupLobbyListeners();
    }

    onSceneLoad(sceneData, params) {
        if (params) {
            this.game.state.isLocalGame = params.isLocalGame !== false;
        }

        if (!this.game.state.isLocalGame) {
            this.setupGameListeners();
        }
    }

    onSceneUnload() {
        this.cleanupNetworkListeners();
    }

    // ==================== CONNECTION ====================

    async connectToServer() {
        const nm = this.game.clientNetworkManager;
        if (!nm) throw new Error('ClientNetworkManager not available');

        // Set up CONNECTED listener before connecting to avoid race condition.
        // Server auto-sends CONNECTED immediately on socket connection.
        return new Promise((resolve, reject) => {
            const unsub = nm.listen('CONNECTED', (data) => {
                unsub();
                if (data?.playerId) {
                    nm.playerId = data.playerId;
                    this.game.state.playerId = data.playerId;
                    resolve(data);
                } else {
                    reject(new Error('Server did not provide player ID'));
                }
            });

            nm.connect().catch((err) => {
                unsub();
                reject(err);
            });
        });
    }

    getConnectionState() {
        const nm = this.game.clientNetworkManager;
        return {
            isConnected: nm?.isConnected || false,
            playerId: nm?.playerId || null
        };
    }

    // ==================== ROOM MANAGEMENT ====================

    createRoom(playerName) {
        const nm = this.game.clientNetworkManager;
        nm.call('CREATE_ROOM', { playerName, maxPlayers: 2 }, 'ROOM_CREATED', (data, error) => {
            if (error) {
                console.error('[ClientWarNetworkSystem] Failed to create room:', error);
            } else if (data) {
                this.roomId = data.roomId;
                this.isHost = data.isHost;
                this.game.state.roomId = data.roomId;
                this.game.state.isHost = data.isHost;
                nm.numericPlayerId = data.numericPlayerId;
                this.call.showLobby?.(data.gameState, data.roomId);
            }
        });
    }

    joinRoom(roomId, playerName) {
        const nm = this.game.clientNetworkManager;
        nm.call('JOIN_ROOM', { roomId, playerName }, 'ROOM_JOINED', (data, error) => {
            if (error) {
                console.error('[ClientWarNetworkSystem] Failed to join room:', error);
            } else if (data) {
                this.roomId = data.roomId;
                this.isHost = data.isHost;
                this.game.state.roomId = data.roomId;
                this.game.state.isHost = data.isHost;
                nm.numericPlayerId = data.numericPlayerId;
                this.call.showLobby?.(data.gameState, data.roomId);
            }
        });
    }

    leaveRoom() {
        const nm = this.game.clientNetworkManager;
        if (nm?.isConnected) {
            nm.call('LEAVE_ROOM');
        }
        this.roomId = null;
        this.isHost = false;
    }

    // ==================== LOBBY READY ====================

    toggleLobbyReady() {
        const nm = this.game.clientNetworkManager;
        if (nm?.isConnected) {
            nm.call('TOGGLE_READY');
        }
    }

    // ==================== GAMEPLAY ====================

    getLocalPlayerId() {
        return this.localPlayerId;
    }

    /**
     * Signal ready to flip
     * Local: triggers flip immediately
     * Multiplayer: sends PLAYER_READY, waits for BOTH_READY broadcast
     */
    sendReady() {
        if (this.game.state.isLocalGame) {
            this.call.playRound?.();
        } else {
            const nm = this.game.clientNetworkManager;
            nm.call('PLAYER_READY');
        }
    }

    // ==================== NETWORK LISTENERS ====================

    /**
     * Lobby listeners - active during online lobby scene
     * These handle room events (player joined/left) and game start
     */
    setupLobbyListeners() {
        const nm = this.game.clientNetworkManager;
        if (!nm) return;

        this.networkUnsubscribers.push(
            nm.listen('PLAYER_JOINED', (data) => {
                this.call.updateLobby?.(data.gameState);
            }),

            nm.listen('PLAYER_LEFT', (data) => {
                this.call.updateLobby?.(data.gameState);
            }),

            nm.listen('PLAYER_READY_UPDATE', (data) => {
                this.call.updateLobby?.(data.gameState);
            }),

            nm.listen('GAME_STARTED', (data) => {
                const seed = data.seed || data.gameState?.gameSeed;
                this.game.switchScene('game', {
                    seed: seed,
                    isLocalGame: false,
                    playerId: nm.numericPlayerId
                });
            })
        );
    }

    /**
     * Game listeners - active during the game scene
     * These handle gameplay sync events
     */
    setupGameListeners() {
        const nm = this.game.clientNetworkManager;
        if (!nm) return;

        this.networkUnsubscribers.push(
            nm.listen('BOTH_READY', () => {
                this.call.playRound?.();
            }),

            nm.listen('OPPONENT_DISCONNECTED', () => {
                this.game.triggerEvent('onGameEnd', {
                    winner: this.localPlayerId,
                    reason: 'Opponent disconnected'
                });
            })
        );
    }

    cleanupNetworkListeners() {
        this.networkUnsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        this.networkUnsubscribers = [];
    }

    dispose() {
        this.cleanupNetworkListeners();
    }
}
