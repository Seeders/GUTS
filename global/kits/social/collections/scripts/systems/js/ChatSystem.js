/**
 * ChatSystem - who hears what (where the game's rules run).
 *
 * sendChat(from, { ch, text, to }) cleans the text (no markup, at most maxLength) and works out who
 * hears it on its channel; the game hears onChatMessage { to: [ids], msg: { ch, from, fromId, text, to? } }
 * and delivers it. Channels:
 *   say      players within sayRadius of the speaker (socialNearby)
 *   yell     every player (socialPlayers)
 *   party    the speaker's party (PartySystem)
 *   whisper  one player by name (socialFindPlayer); the speaker gets a copy as 'whisperTo'
 * registerChatChannel(name, (from, msg) => [ids]) adds more. Text starting with commandPrefix
 * (default '/') is first offered as onChatCommand { from, text, handled }: a system that handles it
 * sets handled, and the text goes no further.
 *
 * The game provides: socialName(id), socialPlayers() -> [ids], socialNearby(id, radius) -> [ids],
 * socialFindPlayer(name) -> id. Settings: configs/social.json { sayRadius, maxLength, commandPrefix }.
 * Returns { ok, reason } (reason: 'empty', 'notInParty', 'noSuchPlayer', 'noChannel').
 */
class ChatSystem extends GUTS.BaseSystem {
    static services = ['sendChat', 'registerChatChannel'];
    static serviceDependencies = ['socialName', 'socialPlayers', 'socialNearby', 'socialFindPlayer', 'partyMembers', 'partyIdOf'];

    constructor(game) {
        super(game);
        this.game.chatSystem = this;
        this.channels = new Map();
        this.registerChatChannel('say', (from) => this.call.socialNearby(from, this.cfg.sayRadius ?? 600) || []);
        this.registerChatChannel('yell', () => this.call.socialPlayers() || []);
        this.registerChatChannel('party', (from) => this.game.hasService('partyIdOf') && this.call.partyIdOf(from) != null ? this.call.partyMembers(from) : null);
    }

    get cfg() { return this.collections.configs?.social || {}; }

    registerChatChannel(name, fn) { this.channels.set(name, fn); }

    clean(text) {
        return String(text ?? '').replace(/<[^>]*>/g, '').trim().slice(0, this.cfg.maxLength ?? 240);
    }

    sendChat(from, d = {}) {
        const text = this.clean(d.text);
        if (!text) return { ok: false, reason: 'empty' };
        const prefix = this.cfg.commandPrefix ?? '/';
        if (prefix && text.startsWith(prefix)) {
            const ev = { from, text, handled: false };
            this.game.triggerEvent('onChatCommand', ev);
            if (ev.handled) return { ok: true, command: true };
        }
        const ch = d.ch || 'say';
        const msg = { ch, from: this.call.socialName(from) ?? String(from), fromId: from, text };
        if (ch === 'whisper') {
            const to = this.call.socialFindPlayer(d.to);
            if (to == null) return { ok: false, reason: 'noSuchPlayer' };
            this.game.triggerEvent('onChatMessage', { to: [to], msg });
            this.game.triggerEvent('onChatMessage', { to: [from], msg: { ...msg, ch: 'whisperTo', to: this.call.socialName(to) ?? d.to } });
            return { ok: true };
        }
        const route = this.channels.get(ch);
        if (!route) return { ok: false, reason: 'noChannel' };
        const to = route(from, msg);
        if (!to) return { ok: false, reason: ch === 'party' ? 'notInParty' : 'noChannel' };
        this.game.triggerEvent('onChatMessage', { to, msg });
        return { ok: true };
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.ChatSystem = ChatSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.ChatSystem = ChatSystem; }
export default ChatSystem;
export { ChatSystem };
