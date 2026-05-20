/**
 * BaseWarNetworkSystem - Shared logic for client and server networking
 *
 * Handles broadcastToRoom routing:
 * - Local game: triggers events directly on the game
 * - Multiplayer: routes through ServerNetworkManager (server) or no-op (client)
 */
class BaseWarNetworkSystem extends GUTS.BaseSystem {
    static services = [
        'broadcastToRoom'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
    }

    init() {}

    /**
     * Broadcast to all players in a room
     * Local: triggers game events directly
     * Multiplayer server: routes through ServerNetworkManager
     */
    broadcastToRoom(roomId, eventName, data) {
        const isLocal = this.game.state.isLocalGame;

        if (isLocal) {
            this.game.triggerEvent(eventName, data);
        } else {
            const actualRoomId = roomId || this.game.room?.id;
            this.engine?.serverNetworkManager?.broadcastToRoom(actualRoomId, eventName, data);
        }
    }
}
