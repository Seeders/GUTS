/**
 * PartySystem - players grouping up (where the game's rules run).
 *
 * Players are ids (entity ids, actor ids: whatever the game uses for a player). A party has a
 * leader and up to partySize members (configs/social.json "partySize", default 5; "inviteLife"
 * seconds an invitation stands, default 120, 0 for ever); only the leader
 * invites and kicks; a party of one breaks up; when the leader leaves, the next member leads.
 *
 * Every call returns { ok, reason } (reason: 'self', 'inParty', 'notLeader', 'full', 'noInvite',
 * 'expired', 'notInParty'), and the game hears what happened as events to tell its players:
 *   onPartyInvite { from, to }           onPartyDeclined { from, to }
 *   onPartyChanged { party, joined | left | kicked, disbanded, members }   (members: who to tell)
 * Rules that share (kill credit, XP) ask partyMembers(id) and sameParty(a, b).
 * When a player leaves the game, call partyMemberGone(id).
 */
class PartySystem extends GUTS.BaseSystem {
    static services = ['partyInvite', 'partyRespond', 'partyLeave', 'partyKick', 'partyMemberGone', 'partyIdOf', 'partyOf', 'partyMembers', 'sameParty', 'partyList'];

    constructor(game) {
        super(game);
        this.game.partySystem = this;
        this.parties = new Map();     // party id -> { id, leader, members: [ids] }
        this.partyOfId = new Map();   // member id -> party id
        this.invites = new Map();     // invited id -> { from, at }
        this._nextPartyId = 1;
    }

    get partySize() { return this.collections.configs?.social?.partySize ?? 5; }
    get inviteLife() { return this.collections.configs?.social?.inviteLife ?? 120; }
    now() { return this.game.state?.now || 0; }

    // ==================== QUERIES ====================

    partyIdOf(id) { return this.partyOfId.get(id) ?? null; }
    partyOf(id) { return this.parties.get(this.partyOfId.get(id)) || null; }
    /** The ids sharing with this one: its party's members, or just itself. */
    partyMembers(id) { const p = this.partyOf(id); return p ? [...p.members] : [id]; }
    sameParty(a, b) { const p = this.partyIdOf(a); return p != null && p === this.partyIdOf(b); }
    partyList() { return [...this.parties.values()]; }

    // ==================== CHANGES ====================

    partyInvite(from, to) {
        if (from === to) return { ok: false, reason: 'self' };
        if (this.partyIdOf(to) != null) return { ok: false, reason: 'inParty' };
        const p = this.partyOf(from);
        if (p && p.leader !== from) return { ok: false, reason: 'notLeader' };
        if (p && p.members.length >= this.partySize) return { ok: false, reason: 'full' };
        this.invites.set(to, { from, at: this.now() });
        this.game.triggerEvent('onPartyInvite', { from, to });
        return { ok: true };
    }

    partyRespond(to, accept) {
        const inv = this.invites.get(to);
        this.invites.delete(to);
        if (!inv) return { ok: false, reason: 'noInvite' };
        if (this.inviteLife > 0 && this.now() - inv.at > this.inviteLife) return { ok: false, reason: 'expired' };     // (inviteLife 0: they stand)
        const from = inv.from;
        if (!accept) { this.game.triggerEvent('onPartyDeclined', { from, to }); return { ok: true, declined: true }; }
        if (this.partyIdOf(to) != null) return { ok: false, reason: 'inParty' };
        let p = this.partyOf(from);
        if (p && p.leader !== from) return { ok: false, reason: 'notLeader' };
        if (!p) {
            p = { id: this._nextPartyId++, leader: from, members: [from] };
            this.parties.set(p.id, p);
            this.partyOfId.set(from, p.id);
        }
        if (p.members.length >= this.partySize) return { ok: false, reason: 'full' };
        p.members.push(to);
        this.partyOfId.set(to, p.id);
        this.game.triggerEvent('onPartyChanged', { party: p, joined: to, members: [...p.members] });
        return { ok: true, party: p };
    }

    partyLeave(id, kicked = false) {
        const p = this.partyOf(id);
        if (!p) return { ok: false, reason: 'notInParty' };
        const members = [...p.members];
        p.members = p.members.filter(m => m !== id);
        this.partyOfId.delete(id);
        if (p.members.length <= 1) {
            for (const m of p.members) this.partyOfId.delete(m);
            this.parties.delete(p.id);
            this.game.triggerEvent('onPartyChanged', { party: p, [kicked ? 'kicked' : 'left']: id, disbanded: true, members });
            return { ok: true, disbanded: true };
        }
        if (p.leader === id) p.leader = p.members[0];
        this.game.triggerEvent('onPartyChanged', { party: p, [kicked ? 'kicked' : 'left']: id, members });
        return { ok: true };
    }

    partyKick(leader, id) {
        const p = this.partyOf(leader);
        if (!p || p.leader !== leader) return { ok: false, reason: 'notLeader' };
        if (id === leader || this.partyIdOf(id) !== p.id) return { ok: false, reason: 'notInParty' };
        return this.partyLeave(id, true);
    }

    /** A player left the game: out of their party, and no invitations to or from them stand (ids get reused). */
    partyMemberGone(id) {
        if (this.partyIdOf(id) != null) this.partyLeave(id);
        this.invites.delete(id);
        for (const [k, v] of this.invites) if (v.from === id) this.invites.delete(k);
    }

    onSceneUnload() {
        this.parties.clear(); this.partyOfId.clear(); this.invites.clear();
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.PartySystem = PartySystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.PartySystem = PartySystem; }
export default PartySystem;
export { PartySystem };
