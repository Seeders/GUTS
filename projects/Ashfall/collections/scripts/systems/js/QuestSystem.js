/**
 * QuestSystem - Act 1 quest chain: offered/turned in by NPCs, tracked in
 * game.state.quests (persists across zone loads for the session).
 *
 * Quest kinds:
 * - killBoss: completes when the zone boss with a matching zone dies
 * - destroyObjects: counts quest object destructions in the matching zone
 */
class QuestSystem extends GUTS.BaseSystem {
    static services = [
        'getQuestState',
        'getActiveQuest',
        'startQuest',
        'turnInQuest',
        'getQuestActionsForNpc'
    ];

    static serviceDependencies = [
        'getPlayerCharacter',
        'addGold',
        'generateItem',
        'giveItemToPlayer'
    ];

    constructor(game) {
        super(game);
        this.game.questSystem = this;
    }

    init() {}

    quests() {
        this.game.state.quests = this.game.state.quests || {};
        return this.game.state.quests;
    }

    questDefs() {
        return this.collections.quests || {};
    }

    getQuestState(questId) {
        return this.quests()[questId] || { state: 'notStarted', progress: 0 };
    }

    // First quest that is active (for the HUD tracker)
    getActiveQuest() {
        const defs = this.questDefs();
        const ordered = Object.keys(defs).sort((a, b) => (defs[a].order || 0) - (defs[b].order || 0));
        for (const id of ordered) {
            const s = this.getQuestState(id);
            if (s.state === 'active' || s.state === 'done') {
                return { id, def: defs[id], state: s };
            }
        }
        return null;
    }

    startQuest(questId) {
        const def = this.questDefs()[questId];
        if (!def) return false;
        const s = this.getQuestState(questId);
        if (s.state !== 'notStarted') return false;
        this.quests()[questId] = { state: 'active', progress: 0 };
        this.game.triggerEvent('onQuestStarted', { questId });
        this.notify(`Quest started: ${def.title}`);
        return true;
    }

    turnInQuest(questId) {
        const def = this.questDefs()[questId];
        if (!def) return false;
        const s = this.getQuestState(questId);
        if (s.state !== 'done') return false;

        s.state = 'turnedIn';

        // Rewards
        const rewards = def.rewards || {};
        if (rewards.gold) this.call.addGold(rewards.gold);
        if (rewards.xp) {
            const pid = this.call.getPlayerCharacter?.();
            if (pid != null) this.game.arpgStatsSystem?.awardExperience(pid, rewards.xp);
        }
        if (rewards.skillPoints) {
            const pid = this.call.getPlayerCharacter?.();
            const sheet = pid != null ? this.game.getComponent(pid, 'characterSheet') : null;
            if (sheet) {
                sheet.unspentSkillPoints += rewards.skillPoints;
                this.game.arpgStatsSystem?.persistSheet(pid);
            }
        }
        if (rewards.item) {
            const pid = this.call.getPlayerCharacter?.();
            const sheet = pid != null ? this.game.getComponent(pid, 'characterSheet') : null;
            const item = this.call.generateItem({
                itemLevel: Math.max(1, sheet?.level || 1),
                rarity: rewards.item.rarity
            });
            if (item) this.call.giveItemToPlayer(item);
        }

        this.game.triggerEvent('onQuestTurnedIn', { questId });
        this.notify(`Quest complete: ${def.title}`);

        // Turning in the final quest completes the act
        if (!def.next) {
            this.game.state.act1Complete = true;
            this.game.triggerEvent('onActCompleted', { act: 1 });
        }
        return true;
    }

    // ─── Progress events ──────────────────────────────────────────────────────

    onZoneBossKilled({ zoneId }) {
        for (const [questId, def] of Object.entries(this.questDefs())) {
            if (def.kind !== 'killBoss' || def.zone !== zoneId) continue;
            const s = this.getQuestState(questId);
            if (s.state !== 'active') continue;
            this.quests()[questId] = { state: 'done', progress: 1 };
            this.notify(`${def.title}: objective complete — return to Warlord Kael`);
        }
    }

    onQuestObjectDestroyed({ zoneId }) {
        for (const [questId, def] of Object.entries(this.questDefs())) {
            if (def.kind !== 'destroyObjects' || def.zone !== zoneId) continue;
            const s = this.getQuestState(questId);
            if (s.state !== 'active') continue;
            s.progress = (s.progress || 0) + 1;
            this.quests()[questId] = s;
            if (s.progress >= (def.count || 1)) {
                s.state = 'done';
                this.notify(`${def.title}: objective complete — return to Warlord Kael`);
            } else {
                this.notify(`${def.title}: ${s.progress}/${def.count}`);
            }
        }
    }

    // Dialogue actions for an NPC (quest giver = kael)
    getQuestActionsForNpc(npcId) {
        if (npcId !== 'kael') return [];
        const defs = this.questDefs();
        const ordered = Object.keys(defs).sort((a, b) => (defs[a].order || 0) - (defs[b].order || 0));
        const actions = [];

        for (const id of ordered) {
            const def = defs[id];
            const s = this.getQuestState(id);
            if (s.state === 'done') {
                actions.push({ kind: 'turnIn', questId: id, label: `✔ Complete: ${def.title}`, text: def.completeText });
                return actions;
            }
            if (s.state === 'active') {
                actions.push({ kind: 'reminder', questId: id, label: def.objectiveText, text: def.intro });
                return actions;
            }
            if (s.state === 'notStarted') {
                // Offer only if the previous quest is turned in (chain via next pointers)
                const prev = ordered[ordered.indexOf(id) - 1];
                if (!prev || this.getQuestState(prev).state === 'turnedIn') {
                    actions.push({ kind: 'offer', questId: id, label: `❗ ${def.title}`, text: def.intro });
                }
                return actions;
            }
        }
        return actions;
    }

    notify(message) {
        if (this.game.isServer) return;
        GUTS.NotificationSystem?.show?.(message, 'info');
        this.game.triggerEvent('onQuestNotification', { message });
    }
}
