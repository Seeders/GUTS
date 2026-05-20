import BaseWarNetworkSystem from './BaseWarNetworkSystem.js';

/**
 * ServerWarNetworkSystem - Server-side networking for War
 *
 * Coordinates multiplayer games using deterministic lockstep:
 * - Tracks in-game ready states for flip synchronization
 * - Broadcasts BOTH_READY when both players signal ready to flip
 */
class ServerWarNetworkSystem extends BaseWarNetworkSystem {
    static services = [
        ...BaseWarNetworkSystem.services,
        'handlePlayerReady'
    ];

    static serviceDependencies = [
        ...BaseWarNetworkSystem.serviceDependencies
    ];

    constructor(game) {
        super(game);
        this.game.serverWarNetworkSystem = this;
        this.player1Ready = false;
        this.player2Ready = false;
    }

    init() {
        super.init();
        this.player1Ready = false;
        this.player2Ready = false;

        // Subscribe to events only on actual server (not in local game mode on client)
        if (this.engine?.isServer && this.game.serverEventManager) {
            this.subscribeToEvents();
        }
    }

    subscribeToEvents() {
        this.game.serverEventManager.subscribe('PLAYER_READY', (eventData) => {
            this.handlePlayerReady(eventData);
        });
    }

    /**
     * Player signals ready to flip (in-game)
     */
    handlePlayerReady(eventData) {
        const { numericPlayerId } = eventData;

        if (numericPlayerId === 0) {
            this.player1Ready = true;
        } else {
            this.player2Ready = true;
        }

        if (this.player1Ready && this.player2Ready) {
            this.player1Ready = false;
            this.player2Ready = false;

            this.call.broadcastToRoom(null, 'BOTH_READY', {});
        }
    }
}
