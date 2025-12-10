/**
 * ServerTownHubSystem - Server-side management of the town hub
 *
 * Handles:
 * - Player presence tracking in town
 * - Position broadcasting
 * - NPC interactions
 */
class ServerTownHubSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.serverTownHubSystem = this;
        this.engine = this.game.app;

        // Players in town
        this.playersInTown = new Map(); // playerId -> { name, position, socketId }
    }

    init(params) {
        this.params = params || {};
        console.log('[ServerTownHubSystem] Initializing...');

        this.serverNetworkManager = this.engine.serverNetworkManager;
        this.registerHandlers();
    }

    registerHandlers() {
        const snm = this.serverNetworkManager;
        if (!snm) return;

        snm.registerHandler('ENTER_TOWN', this.handleEnterTown.bind(this));
        snm.registerHandler('LEAVE_TOWN', this.handleLeaveTown.bind(this));
        snm.registerHandler('PLAYER_POSITION', this.handlePlayerPosition.bind(this));
    }

    handleEnterTown(socket, data, callback) {
        const playerId = socket.playerId;
        const playerName = data.playerName || 'Adventurer';

        // Add player to town
        const playerData = {
            playerId,
            name: playerName,
            position: { x: 0, y: 0, z: 0 },
            socketId: socket.id
        };

        this.playersInTown.set(playerId, playerData);

        // Notify other players
        socket.broadcast.emit('PLAYER_ENTERED_TOWN', {
            playerId,
            playerName,
            position: playerData.position
        });

        // Send current players to joining player
        const playersArray = [];
        for (const [pid, pdata] of this.playersInTown) {
            if (pid !== playerId) {
                playersArray.push({
                    playerId: pid,
                    playerName: pdata.name,
                    position: pdata.position
                });
            }
        }

        callback({
            success: true,
            players: playersArray
        });

        // Also send full player list
        socket.emit('PLAYERS_IN_TOWN', { players: playersArray });

        console.log(`[ServerTownHubSystem] ${playerName} entered town. Players in town: ${this.playersInTown.size}`);
    }

    handleLeaveTown(socket, data, callback) {
        const playerId = socket.playerId;
        const playerData = this.playersInTown.get(playerId);

        if (playerData) {
            this.playersInTown.delete(playerId);

            // Notify other players
            socket.broadcast.emit('PLAYER_LEFT_TOWN', { playerId });

            console.log(`[ServerTownHubSystem] ${playerData.name} left town. Players in town: ${this.playersInTown.size}`);
        }

        callback?.({ success: true });
    }

    handlePlayerPosition(socket, data) {
        const playerId = socket.playerId;
        const playerData = this.playersInTown.get(playerId);

        if (!playerData) return;

        // Update position
        playerData.position = data.position;

        // Broadcast to other players in town
        socket.broadcast.emit('PLAYER_POSITION_UPDATE', {
            playerId,
            position: data.position,
            velocity: data.velocity,
            timestamp: data.timestamp
        });
    }

    handleDisconnect(socket) {
        const playerId = socket.playerId;
        if (this.playersInTown.has(playerId)) {
            this.handleLeaveTown(socket, {}, () => {});
        }
    }

    getPlayersInTown() {
        return Array.from(this.playersInTown.values());
    }

    update() {
        // Server-side town updates if needed
    }
}
