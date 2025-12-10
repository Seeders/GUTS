/**
 * PartySystem - Manages party/group functionality
 *
 * Handles:
 * - Party creation and management
 * - Member tracking
 * - Party chat (if implemented)
 * - Shared experience/loot settings
 * - Party UI updates
 */
class PartySystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.partySystem = this;

        // Party state
        this.partyId = null;
        this.isLeader = false;
        this.members = new Map(); // playerId -> { name, level, health, class, isLeader }
        this.pendingInvites = new Map(); // inviteId -> { fromPlayerId, fromPlayerName, timestamp }
        this.maxPartySize = 4;

        // Party settings
        this.lootMode = 'free_for_all'; // 'free_for_all', 'round_robin', 'need_greed'
        this.experienceShare = true;
    }

    init(params) {
        this.params = params || {};
        console.log('[PartySystem] Initializing...');
        this.registerServices();
        this.setupEventListeners();
    }

    registerServices() {
        // Party info
        this.game.register('getPartyId', () => this.partyId);
        this.game.register('isPartyLeader', () => this.isLeader);
        this.game.register('getPartyMembers', () => Array.from(this.members.values()));
        this.game.register('getPartySize', () => this.members.size);
        this.game.register('getMaxPartySize', () => this.maxPartySize);
        this.game.register('isPartyFull', () => this.members.size >= this.maxPartySize);

        // Party actions
        this.game.register('createPartyLocal', this.createPartyLocal.bind(this));
        this.game.register('addPartyMember', this.addPartyMember.bind(this));
        this.game.register('removePartyMember', this.removePartyMember.bind(this));
        this.game.register('setPartyLeader', this.setPartyLeader.bind(this));
        this.game.register('disbandParty', this.disbandParty.bind(this));

        // Invites
        this.game.register('showPartyInvite', this.showPartyInvite.bind(this));
        this.game.register('acceptPartyInvite', this.acceptPartyInvite.bind(this));
        this.game.register('declinePartyInvite', this.declinePartyInvite.bind(this));
        this.game.register('getPendingInvites', () => Array.from(this.pendingInvites.values()));

        // Settings
        this.game.register('setLootMode', this.setLootMode.bind(this));
        this.game.register('getLootMode', () => this.lootMode);
        this.game.register('toggleExperienceShare', () => { this.experienceShare = !this.experienceShare; });
        this.game.register('isExperienceShared', () => this.experienceShare);
    }

    setupEventListeners() {
        // Listen for party events from network system
        this.game.on('onPartyCreated', (data) => this.handlePartyCreated(data));
        this.game.on('onPartyMemberJoined', (data) => this.handleMemberJoined(data));
        this.game.on('onPartyMemberLeft', (data) => this.handleMemberLeft(data));
        this.game.on('onPartyDisbanded', (data) => this.handlePartyDisbanded(data));
    }

    createPartyLocal(partyId) {
        this.partyId = partyId;
        this.isLeader = true;
        this.members.clear();

        // Add self as first member
        const playerId = this.game.call('getPlayerId');
        const playerName = this.game.call('getPlayerName');
        const localPlayer = this.game.call('getLocalPlayerEntity');

        let level = 1;
        let health = { current: 100, max: 100 };

        if (localPlayer) {
            const playerChar = this.game.getComponent(localPlayer, 'playerCharacter');
            const healthComp = this.game.getComponent(localPlayer, 'health');
            if (playerChar) level = playerChar.level;
            if (healthComp) health = { current: healthComp.current, max: healthComp.max };
        }

        this.members.set(playerId, {
            playerId,
            name: playerName,
            level,
            health,
            characterClass: 'warrior',
            isLeader: true,
            isLocal: true
        });

        this.updatePartyUI();
        console.log('[PartySystem] Created party:', partyId);
    }

    addPartyMember(memberData) {
        if (this.members.size >= this.maxPartySize) {
            console.warn('[PartySystem] Party is full');
            return false;
        }

        this.members.set(memberData.playerId, {
            playerId: memberData.playerId,
            name: memberData.name || memberData.playerName,
            level: memberData.level || 1,
            health: memberData.health || { current: 100, max: 100 },
            characterClass: memberData.characterClass || 'warrior',
            isLeader: memberData.isLeader || false,
            isLocal: false
        });

        this.updatePartyUI();
        console.log('[PartySystem] Added member:', memberData.name);
        return true;
    }

    removePartyMember(playerId) {
        const member = this.members.get(playerId);
        if (!member) return false;

        this.members.delete(playerId);

        // If leader left, assign new leader
        if (member.isLeader && this.members.size > 0) {
            const newLeader = this.members.values().next().value;
            if (newLeader) {
                newLeader.isLeader = true;
                const localPlayerId = this.game.call('getPlayerId');
                if (newLeader.playerId === localPlayerId) {
                    this.isLeader = true;
                }
            }
        }

        // If party is empty, clear party
        if (this.members.size === 0) {
            this.partyId = null;
            this.isLeader = false;
        }

        this.updatePartyUI();
        console.log('[PartySystem] Removed member:', member.name);
        return true;
    }

    setPartyLeader(playerId) {
        // Remove leader status from current leader
        for (const member of this.members.values()) {
            member.isLeader = false;
        }

        // Set new leader
        const newLeader = this.members.get(playerId);
        if (newLeader) {
            newLeader.isLeader = true;
            const localPlayerId = this.game.call('getPlayerId');
            this.isLeader = (playerId === localPlayerId);
        }

        this.updatePartyUI();
    }

    disbandParty() {
        this.partyId = null;
        this.isLeader = false;
        this.members.clear();
        this.pendingInvites.clear();

        this.updatePartyUI();
        console.log('[PartySystem] Party disbanded');
    }

    showPartyInvite(fromPlayerName, partyId) {
        const inviteId = `invite_${Date.now()}`;
        this.pendingInvites.set(inviteId, {
            inviteId,
            fromPlayerName,
            partyId,
            timestamp: Date.now()
        });

        // Show invite UI
        this.showInviteNotification(fromPlayerName, inviteId);
    }

    showInviteNotification(fromPlayerName, inviteId) {
        // Create invite notification element
        const notification = document.createElement('div');
        notification.id = `party-invite-${inviteId}`;
        notification.className = 'party-invite-notification';
        notification.innerHTML = `
            <div class="invite-content">
                <span class="invite-text">${fromPlayerName} invited you to their party</span>
                <div class="invite-buttons">
                    <button class="accept-btn" data-invite-id="${inviteId}">Accept</button>
                    <button class="decline-btn" data-invite-id="${inviteId}">Decline</button>
                </div>
            </div>
        `;

        // Style the notification
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid #4a9eff;
            border-radius: 8px;
            padding: 15px;
            color: white;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Add event listeners
        notification.querySelector('.accept-btn').addEventListener('click', () => {
            this.acceptPartyInvite(inviteId);
            notification.remove();
        });

        notification.querySelector('.decline-btn').addEventListener('click', () => {
            this.declinePartyInvite(inviteId);
            notification.remove();
        });

        // Auto-remove after 30 seconds
        setTimeout(() => {
            if (document.getElementById(`party-invite-${inviteId}`)) {
                notification.remove();
                this.pendingInvites.delete(inviteId);
            }
        }, 30000);
    }

    acceptPartyInvite(inviteId) {
        const invite = this.pendingInvites.get(inviteId);
        if (!invite) return;

        this.game.call('joinParty', invite.partyId, (success, data) => {
            if (success) {
                this.partyId = invite.partyId;
                this.isLeader = false;
                this.game.call('showNotification', `Joined ${invite.fromPlayerName}'s party!`, 'success');
            } else {
                this.game.call('showNotification', 'Failed to join party', 'error');
            }
        });

        this.pendingInvites.delete(inviteId);
    }

    declinePartyInvite(inviteId) {
        this.pendingInvites.delete(inviteId);
        this.game.call('showNotification', 'Party invite declined', 'info');
    }

    setLootMode(mode) {
        if (['free_for_all', 'round_robin', 'need_greed'].includes(mode)) {
            this.lootMode = mode;
        }
    }

    handlePartyCreated(data) {
        this.createPartyLocal(data.partyId);
    }

    handleMemberJoined(data) {
        this.addPartyMember(data);
    }

    handleMemberLeft(data) {
        this.removePartyMember(data.playerId);
    }

    handlePartyDisbanded(data) {
        this.disbandParty();
    }

    updatePartyUI() {
        // Update party frame in UI
        const partyFrame = document.getElementById('party-frame');
        if (!partyFrame) return;

        if (!this.partyId || this.members.size === 0) {
            partyFrame.style.display = 'none';
            return;
        }

        partyFrame.style.display = 'block';

        let membersHtml = '';
        for (const member of this.members.values()) {
            const healthPercent = member.health ? (member.health.current / member.health.max * 100) : 100;
            const leaderIcon = member.isLeader ? '<span class="leader-icon">&#9733;</span>' : '';

            membersHtml += `
                <div class="party-member ${member.isLocal ? 'local' : ''}" data-player-id="${member.playerId}">
                    <div class="member-info">
                        ${leaderIcon}
                        <span class="member-name">${member.name}</span>
                        <span class="member-level">Lv.${member.level}</span>
                    </div>
                    <div class="member-health-bar">
                        <div class="health-fill" style="width: ${healthPercent}%"></div>
                    </div>
                </div>
            `;
        }

        partyFrame.innerHTML = `
            <div class="party-header">
                <span>Party (${this.members.size}/${this.maxPartySize})</span>
                ${this.isLeader ? '<button class="disband-btn" onclick="game.call(\'leaveParty\')">Disband</button>' : '<button class="leave-btn" onclick="game.call(\'leaveParty\')">Leave</button>'}
            </div>
            <div class="party-members">
                ${membersHtml}
            </div>
        `;
    }

    updateMemberHealth(playerId, health) {
        const member = this.members.get(playerId);
        if (member) {
            member.health = health;
            this.updatePartyUI();
        }
    }

    update() {
        // Update local player's health in party display
        if (this.partyId) {
            const localPlayerId = this.game.call('getPlayerId');
            const localPlayer = this.game.call('getLocalPlayerEntity');

            if (localPlayer && localPlayerId) {
                const health = this.game.getComponent(localPlayer, 'health');
                if (health) {
                    const member = this.members.get(localPlayerId);
                    if (member && (member.health.current !== health.current || member.health.max !== health.max)) {
                        member.health = { current: health.current, max: health.max };
                        this.updatePartyUI();
                    }
                }
            }
        }

        // Clean up expired invites
        const now = Date.now();
        for (const [inviteId, invite] of this.pendingInvites) {
            if (now - invite.timestamp > 30000) {
                this.pendingInvites.delete(inviteId);
                const notificationEl = document.getElementById(`party-invite-${inviteId}`);
                if (notificationEl) notificationEl.remove();
            }
        }
    }

    onSceneUnload() {
        // Clear pending invites UI
        for (const [inviteId] of this.pendingInvites) {
            const notificationEl = document.getElementById(`party-invite-${inviteId}`);
            if (notificationEl) notificationEl.remove();
        }
        this.pendingInvites.clear();
    }
}
