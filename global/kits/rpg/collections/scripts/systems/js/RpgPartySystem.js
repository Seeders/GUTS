/**
 * RpgPartySystem - groups and chat (server only).
 *
 * Parties of up to 5 share kill credit, quest kills and XP (MmoMobSystem /
 * MmoQuestSystem ask membersOf/partyIdOf), see each other in party frames and
 * talk on the party channel.
 *
 * Chat channels: say (nearby), yell (whole zone), party, whisper.
 *
 * Built on the GUTS social kit: the parties are PartySystem's (players are actor ids) and chat is
 * routed by ChatSystem; this keeps the game's network messages, words and party frames, and gives
 * the kit what it asks of a game (socialName, socialPlayers, socialNearby, socialFindPlayer).
 * actor.partyId mirrors the kit's membership for the systems that read it.
 *
 * The GUTS rpg kit. A game extends it (`class MmoPartySystem extends GUTS.RpgPartySystem`) and overrides
 * what it does differently. It registers under the game's old names.
 */
class RpgPartySystem extends GUTS.PartySystem {
    static services = [...GUTS.PartySystem.services, 'socialName', 'socialPlayers', 'socialNearby', 'socialFindPlayer'];

    static serviceDependencies = [
        'mmoConfig',
        'mmoActor',
        'mmoSend',
        'mmoToast',
        'mmoSessionByName',
        'mmoSessions',
        'mmoNearbyActors',
        'sendChat'
    ];

    constructor(game) {
        super(game);
        this.game.mmoPartySystem = this;
    }

    get cfg() { return this.call.mmoConfig(); }
    get partySize() { return this.cfg.partySize; }
    get inviteLife() { return 0; }                    // (an invitation stands until answered)

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_PARTY_INVITE', (e) => { const a = actorOf(e); if (a) this.invite(a, e.data || {}); });
        bus.subscribe('MMO_PARTY_RESPOND', (e) => { const a = actorOf(e); if (a) this.respond(a, !!e.data?.accept); });
        bus.subscribe('MMO_PARTY_LEAVE', (e) => { const a = actorOf(e); if (a) this.leave(a); });
        bus.subscribe('MMO_PARTY_KICK', (e) => { const a = actorOf(e); if (a) this.kick(a, e.data?.id); });
        bus.subscribe('MMO_CHAT', (e) => { const a = actorOf(e); if (a) this.chat(a, e.data || {}); });
    }

    // ==================== QUERIES (an actor or its id) ====================

    static idOf(x) { return x != null && typeof x === 'object' ? x.id : x; }
    partyIdOf(x) { return super.partyIdOf(RpgPartySystem.idOf(x)); }
    sameParty(a, b) { return a != null && b != null && super.sameParty(RpgPartySystem.idOf(a), RpgPartySystem.idOf(b)); }

    heroName(a) { return a?.name || 'Someone'; }

    membersOf(actor) {
        if (!actor) return [actor];
        return this.partyMembers(actor.id).map(id => this.call.mmoActor(id)).filter(Boolean);
    }

    partyView(actor) {
        const p = this.partyOf(actor.id);
        if (!p) return null;
        return {
            leader: p.leader,
            members: p.members.filter(id => id !== actor.id).map(id => {
                const m = this.call.mmoActor(id);
                if (!m) return null;
                return {
                    id, n: m.name, c: m.classId, l: m.level, hp: Math.round(m.hp), mhp: m.maxHp,
                    res: Math.round(m.res), rmax: m.resMax, rt: m.resType, dead: m.dead ? 1 : 0,
                    x: Math.round(m.x), z: Math.round(m.z)
                };
            }).filter(Boolean)
        };
    }

    // ==================== WHAT THE SOCIAL KIT ASKS OF THE GAME ====================

    socialName(id) { return this.heroName(this.call.mmoActor(id)); }
    socialPlayers() { return [...this.call.mmoSessions().values()].map(s => s.actorId).filter(id => id != null); }
    socialNearby(id, radius) { const a = this.call.mmoActor(id); return a ? this.call.mmoNearbyActors(a.x, a.z, this.cfg.sayRadius, x => x.kind === 'player').map(o => o.id) : []; }
    socialFindPlayer(name) { return this.call.mmoSessionByName(name)?.actorId ?? null; }

    // ==================== PARTY MANAGEMENT ====================

    invite(a, d) {
        const target = d.id != null ? this.call.mmoActor(d.id) : this.call.mmoActor(this.call.mmoSessionByName(d.name)?.actorId);
        if (!target || target.kind !== 'player') return this.call.mmoToast(a, 'Player not found.', 'error');
        const r = this.partyInvite(a.id, target.id);
        if (r.reason === 'inParty') return this.call.mmoToast(a, `${target.name} is already in a group.`, 'error');
        if (r.reason === 'notLeader') return this.call.mmoToast(a, 'Only the party leader can invite.', 'error');
        if (r.reason === 'full') return this.call.mmoToast(a, 'Your party is full.', 'error');
        if (r.ok) this.call.mmoToast(a, `You invite ${target.name} to join your group.`, 'info');
    }

    onPartyInvite({ from, to }) {
        const a = this.call.mmoActor(from), t = this.call.mmoActor(to);
        if (t) this.call.mmoSend(t.socketId, 'MMO_PARTY_INVITE', { from: this.heroName(a), fromId: from });
    }

    respond(target, accept) {
        const r = this.partyRespond(target.id, accept);
        if (r.reason === 'full') this.call.mmoToast(target, 'That party is full.', 'error');
    }

    onPartyDeclined({ from, to }) {
        const leader = this.call.mmoActor(from);
        if (leader) this.call.mmoToast(leader, `${this.heroName(this.call.mmoActor(to))} declines your group invitation.`, 'info');
    }

    leave(a) { this.partyLeave(a.id); }

    kick(a, id) { this.partyKick(a.id, id); }

    /** Membership changed: actors' partyId follows, and everyone concerned is told. */
    onPartyChanged({ party, joined, left, kicked, disbanded, members }) {
        for (const id of members) { const m = this.call.mmoActor(id); if (m) m.partyId = this.partyIdOf(id); }
        if (joined != null) return this.partyMessage(party, `${this.heroName(this.call.mmoActor(joined))} joins the party.`);
        const gone = left ?? kicked, a = this.call.mmoActor(gone);
        if (a) this.call.mmoToast(a, 'You leave the group.', 'info');
        if (disbanded) {
            for (const id of party.members) { const m = this.call.mmoActor(id); if (m) this.call.mmoToast(m, 'Your group has been disbanded.', 'info'); }
            return;
        }
        this.partyMessage(party, `${this.heroName(a)} leaves the party.`);
    }

    onMmoPlayerLeave({ actor }) {
        // (their id goes to someone else later: entity id reuse)
        if (actor) this.partyMemberGone(actor.id);
    }

    partyMessage(p, text) {
        for (const id of p.members) {
            const m = this.call.mmoActor(id);
            if (m) this.call.mmoSend(m.socketId, 'MMO_CHAT', { ch: 'system', text });
        }
    }

    // ==================== CHAT (routed by the kit's ChatSystem) ====================

    chat(a, d) {
        const r = this.call.sendChat(a.id, d);
        if (r?.reason === 'notInParty') this.call.mmoToast(a, 'You aren\'t in a party.', 'error');
        else if (r?.reason === 'noSuchPlayer') this.call.mmoToast(a, `No player named '${d.to}' is currently playing.`, 'error');
    }

    /** GM commands (REALM_DEV): chat starting with '.' (configs/social.json commandPrefix). */
    onChatCommand(ev) {
        const a = this.call.mmoActor(ev.from);
        if (a && this.game.mmoWorldSystem?.gmCommand(a, ev.text)) ev.handled = true;
    }

    onChatMessage({ to, msg }) {
        for (const id of to) { const m = this.call.mmoActor(id); if (m?.socketId) this.call.mmoSend(m.socketId, 'MMO_CHAT', msg); }
        if (msg.ch === 'say') { const a = this.call.mmoActor(msg.fromId); if (a) this.game.mmoWorldSystem?.mmoEmit({ t: 'say', id: a.id, text: msg.text }, a.x, a.z); }
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.RpgPartySystem = RpgPartySystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.RpgPartySystem = RpgPartySystem; }
export default RpgPartySystem;
export { RpgPartySystem };
