/**
 * ServerPartySystem - Server-side management of parties
 *
 * Handles:
 * - Party creation and management
 * - Invites and join requests
 * - Party state synchronization
 */
class ServerPartySystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.serverPartySystem = this;
        this.engine = this.game.app;

        // Active parties
        this.parties = new Map(); // partyId -> party data

        // Player to party mapping
        this.playerParties = new Map(); // playerId -> partyId

        // Pending invites
        this.pendingInvites = new Map(); // inviteId -> invite data

        // Party counter
        this.partyCounter = 0;
    }

    init(params) {
        this.params = params || {};
        console.log('[ServerPartySystem] Initializing...');

        this.serverNetworkManager = this.engine.serverNetworkManager;
        this.registerHandlers();
    }

    registerHandlers() {
        const snm = this.serverNetworkManager;
        if (!snm) return;

        snm.registerHandler('CREATE_PARTY', this.handleCreateParty.bind(this));
        snm.registerHandler('INVITE_TO_PARTY', this.handleInviteToParty.bind(this));
        snm.registerHandler('JOIN_PARTY', this.handleJoinParty.bind(this));
        snm.registerHandler('LEAVE_PARTY', this.handleLeaveParty.bind(this));
        snm.registerHandler('GET_PARTY_MEMBERS', this.handleGetPartyMembers.bind(this));
        snm.registerHandler('KICK_PARTY_MEMBER', this.handleKickMember.bind(this));
        snm.registerHandler('PROMOTE_PARTY_LEADER', this.handlePromoteLeader.bind(this));
    }

    handleCreateParty(socket, data, callback) {
        const playerId = socket.playerId;
        const playerName = socket.playerName || 'Adventurer';

        // Check if already in a party
        if (this.playerParties.has(playerId)) {
            callback({ success: false, error: 'Already in a party' });
            return;
        }

        // Create party
        const partyId = `party_${++this.partyCounter}_${Date.now()}`;
        const party = {
            id: partyId,
            leaderId: playerId,
            members: new Map(),
            maxSize: 4,
            createdAt: Date.now()
        };

        // Add leader as first member
        party.members.set(playerId, {
            playerId,
            name: playerName,
            socketId: socket.id,
            isLeader: true
        });

        this.parties.set(partyId, party);
        this.playerParties.set(playerId, partyId);

        // Join socket room for party
        socket.join(`party_${partyId}`);

        callback({
            success: true,
            partyId,
            members: Array.from(party.members.values())
        });

        console.log(`[ServerPartySystem] Created party ${partyId} with leader ${playerName}`);
    }

    handleInviteToParty(socket, data, callback) {
        const playerId = socket.playerId;
        const targetPlayerId = data.targetPlayerId;

        // Check if in a party
        const partyId = this.playerParties.get(playerId);
        if (!partyId) {
            callback({ success: false, error: 'Not in a party' });
            return;
        }

        const party = this.parties.get(partyId);
        if (!party) {
            callback({ success: false, error: 'Party not found' });
            return;
        }

        // Check if leader
        if (party.leaderId !== playerId) {
            callback({ success: false, error: 'Only party leader can invite' });
            return;
        }

        // Check party size
        if (party.members.size >= party.maxSize) {
            callback({ success: false, error: 'Party is full' });
            return;
        }

        // Check if target is already in a party
        if (this.playerParties.has(targetPlayerId)) {
            callback({ success: false, error: 'Player is already in a party' });
            return;
        }

        // Create invite
        const inviteId = `invite_${Date.now()}`;
        const invite = {
            inviteId,
            partyId,
            fromPlayerId: playerId,
            fromPlayerName: socket.playerName || 'Unknown',
            targetPlayerId,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60000 // 1 minute expiry
        };

        this.pendingInvites.set(inviteId, invite);

        // Send invite to target player
        const targetSocket = this.serverNetworkManager.getSocketByPlayerId(targetPlayerId);
        if (targetSocket) {
            targetSocket.emit('PARTY_INVITE', {
                inviteId,
                partyId,
                fromPlayerName: invite.fromPlayerName
            });
        }

        callback({ success: true, inviteId });

        console.log(`[ServerPartySystem] Invite sent from ${invite.fromPlayerName} to ${targetPlayerId}`);
    }

    handleJoinParty(socket, data, callback) {
        const playerId = socket.playerId;
        const playerName = socket.playerName || 'Adventurer';
        const partyId = data.partyId;

        // Check if already in a party
        if (this.playerParties.has(playerId)) {
            callback({ success: false, error: 'Already in a party' });
            return;
        }

        // Find the party
        const party = this.parties.get(partyId);
        if (!party) {
            callback({ success: false, error: 'Party not found' });
            return;
        }

        // Check party size
        if (party.members.size >= party.maxSize) {
            callback({ success: false, error: 'Party is full' });
            return;
        }

        // Verify invite exists (optional - could allow open join)
        let validInvite = false;
        for (const [inviteId, invite] of this.pendingInvites) {
            if (invite.partyId === partyId && invite.targetPlayerId === playerId) {
                if (Date.now() < invite.expiresAt) {
                    validInvite = true;
                    this.pendingInvites.delete(inviteId);
                }
                break;
            }
        }

        // For now, allow join without invite (for testing)
        // In production, you might want to require an invite

        // Add member
        party.members.set(playerId, {
            playerId,
            name: playerName,
            socketId: socket.id,
            isLeader: false
        });

        this.playerParties.set(playerId, partyId);

        // Join socket room
        socket.join(`party_${partyId}`);

        // Notify other party members
        socket.to(`party_${partyId}`).emit('PARTY_MEMBER_JOINED', {
            playerId,
            playerName
        });

        callback({
            success: true,
            partyId,
            members: Array.from(party.members.values())
        });

        console.log(`[ServerPartySystem] ${playerName} joined party ${partyId}`);
    }

    handleLeaveParty(socket, data, callback) {
        const playerId = socket.playerId;

        const partyId = this.playerParties.get(playerId);
        if (!partyId) {
            callback?.({ success: false, error: 'Not in a party' });
            return;
        }

        const party = this.parties.get(partyId);
        if (!party) {
            this.playerParties.delete(playerId);
            callback?.({ success: true });
            return;
        }

        const wasLeader = party.leaderId === playerId;
        const memberData = party.members.get(playerId);

        // Remove from party
        party.members.delete(playerId);
        this.playerParties.delete(playerId);
        socket.leave(`party_${partyId}`);

        // Notify other members
        socket.to(`party_${partyId}`).emit('PARTY_MEMBER_LEFT', {
            playerId,
            playerName: memberData?.name || 'Unknown'
        });

        // Handle empty party or leader leaving
        if (party.members.size === 0) {
            this.disbandParty(partyId);
        } else if (wasLeader) {
            // Promote new leader
            const newLeader = party.members.values().next().value;
            if (newLeader) {
                party.leaderId = newLeader.playerId;
                newLeader.isLeader = true;

                this.serverNetworkManager.broadcastToRoom(`party_${partyId}`, 'PARTY_LEADER_CHANGED', {
                    newLeaderId: newLeader.playerId,
                    newLeaderName: newLeader.name
                });
            }
        }

        callback?.({ success: true });

        console.log(`[ServerPartySystem] ${memberData?.name || playerId} left party ${partyId}`);
    }

    handleGetPartyMembers(socket, data, callback) {
        const playerId = socket.playerId;

        const partyId = this.playerParties.get(playerId);
        if (!partyId) {
            callback({ success: false, error: 'Not in a party' });
            return;
        }

        const party = this.parties.get(partyId);
        if (!party) {
            callback({ success: false, error: 'Party not found' });
            return;
        }

        callback({
            success: true,
            members: Array.from(party.members.values())
        });
    }

    handleKickMember(socket, data, callback) {
        const playerId = socket.playerId;
        const targetPlayerId = data.targetPlayerId;

        const partyId = this.playerParties.get(playerId);
        if (!partyId) {
            callback({ success: false, error: 'Not in a party' });
            return;
        }

        const party = this.parties.get(partyId);
        if (!party || party.leaderId !== playerId) {
            callback({ success: false, error: 'Not party leader' });
            return;
        }

        if (targetPlayerId === playerId) {
            callback({ success: false, error: 'Cannot kick yourself' });
            return;
        }

        const targetMember = party.members.get(targetPlayerId);
        if (!targetMember) {
            callback({ success: false, error: 'Player not in party' });
            return;
        }

        // Remove member
        party.members.delete(targetPlayerId);
        this.playerParties.delete(targetPlayerId);

        // Get target socket and remove from room
        const targetSocket = this.serverNetworkManager.getSocketByPlayerId(targetPlayerId);
        if (targetSocket) {
            targetSocket.leave(`party_${partyId}`);
            targetSocket.emit('PARTY_KICKED', { reason: 'Kicked by leader' });
        }

        // Notify other members
        this.serverNetworkManager.broadcastToRoom(`party_${partyId}`, 'PARTY_MEMBER_LEFT', {
            playerId: targetPlayerId,
            playerName: targetMember.name,
            kicked: true
        });

        callback({ success: true });
    }

    handlePromoteLeader(socket, data, callback) {
        const playerId = socket.playerId;
        const newLeaderId = data.newLeaderId;

        const partyId = this.playerParties.get(playerId);
        if (!partyId) {
            callback({ success: false, error: 'Not in a party' });
            return;
        }

        const party = this.parties.get(partyId);
        if (!party || party.leaderId !== playerId) {
            callback({ success: false, error: 'Not party leader' });
            return;
        }

        const newLeader = party.members.get(newLeaderId);
        if (!newLeader) {
            callback({ success: false, error: 'Player not in party' });
            return;
        }

        // Update leader
        const oldLeader = party.members.get(playerId);
        if (oldLeader) oldLeader.isLeader = false;
        newLeader.isLeader = true;
        party.leaderId = newLeaderId;

        // Notify party
        this.serverNetworkManager.broadcastToRoom(`party_${partyId}`, 'PARTY_LEADER_CHANGED', {
            newLeaderId,
            newLeaderName: newLeader.name
        });

        callback({ success: true });
    }

    disbandParty(partyId) {
        const party = this.parties.get(partyId);
        if (!party) return;

        // Notify all members
        this.serverNetworkManager.broadcastToRoom(`party_${partyId}`, 'PARTY_DISBANDED', {
            partyId
        });

        // Clean up members
        for (const [memberId] of party.members) {
            this.playerParties.delete(memberId);
            const memberSocket = this.serverNetworkManager.getSocketByPlayerId(memberId);
            if (memberSocket) {
                memberSocket.leave(`party_${partyId}`);
            }
        }

        this.parties.delete(partyId);

        console.log(`[ServerPartySystem] Disbanded party ${partyId}`);
    }

    getPlayerParty(playerId) {
        return this.playerParties.get(playerId);
    }

    getParty(partyId) {
        return this.parties.get(partyId);
    }

    handleDisconnect(socket) {
        const playerId = socket.playerId;
        if (this.playerParties.has(playerId)) {
            this.handleLeaveParty(socket, {}, () => {});
        }
    }

    update() {
        // Clean up expired invites
        const now = Date.now();
        for (const [inviteId, invite] of this.pendingInvites) {
            if (now > invite.expiresAt) {
                this.pendingInvites.delete(inviteId);
            }
        }
    }
}
