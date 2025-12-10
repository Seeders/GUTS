/**
 * QuestSystem - Manages quests and objectives
 *
 * Handles:
 * - Quest tracking
 * - Quest progress
 * - Quest rewards
 * - Quest UI
 */
class QuestSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.questSystem = this;

        // Active quests
        this.activeQuests = new Map(); // questId -> quest data
        this.completedQuests = new Set();
        this.maxActiveQuests = 5;
    }

    init(params) {
        this.params = params || {};
        console.log('[QuestSystem] Initializing...');
        this.registerServices();
    }

    registerServices() {
        this.game.register('acceptQuest', this.acceptQuest.bind(this));
        this.game.register('abandonQuest', this.abandonQuest.bind(this));
        this.game.register('completeQuest', this.completeQuest.bind(this));
        this.game.register('updateQuestProgress', this.updateQuestProgress.bind(this));
        this.game.register('getActiveQuests', () => Array.from(this.activeQuests.values()));
        this.game.register('hasQuest', (questId) => this.activeQuests.has(questId));
        this.game.register('isQuestComplete', (questId) => this.completedQuests.has(questId));
    }

    acceptQuest(questId) {
        if (this.activeQuests.size >= this.maxActiveQuests) {
            this.game.call('showNotification', 'Quest log full!', 'error');
            return false;
        }

        if (this.activeQuests.has(questId)) {
            this.game.call('showNotification', 'Quest already active', 'warning');
            return false;
        }

        const quests = this.game.getCollections().quests;
        const questDef = quests?.[questId];

        if (!questDef) {
            console.error('[QuestSystem] Quest not found:', questId);
            return false;
        }

        // Check requirements
        if (questDef.requiredLevel && (this.game.state.playerLevel || 1) < questDef.requiredLevel) {
            this.game.call('showNotification', `Requires level ${questDef.requiredLevel}`, 'warning');
            return false;
        }

        if (questDef.prerequisiteQuest && !this.completedQuests.has(questDef.prerequisiteQuest)) {
            this.game.call('showNotification', 'Complete prerequisite quest first', 'warning');
            return false;
        }

        // Initialize quest progress
        const questData = {
            id: questId,
            name: questDef.name,
            description: questDef.description,
            objectives: questDef.objectives.map(obj => ({
                ...obj,
                current: 0,
                completed: false
            })),
            rewards: questDef.rewards,
            acceptedTime: Date.now()
        };

        this.activeQuests.set(questId, questData);
        this.game.call('showNotification', `Quest accepted: ${questDef.name}`, 'success');
        this.updateQuestUI();

        return true;
    }

    abandonQuest(questId) {
        if (!this.activeQuests.has(questId)) return false;

        const quest = this.activeQuests.get(questId);
        this.activeQuests.delete(questId);

        this.game.call('showNotification', `Quest abandoned: ${quest.name}`, 'warning');
        this.updateQuestUI();

        return true;
    }

    updateQuestProgress(type, target, amount = 1) {
        // type: 'kill', 'collect', 'visit', 'interact'
        // target: monster type, item id, location id, etc.

        for (const [questId, quest] of this.activeQuests) {
            let questUpdated = false;

            for (const objective of quest.objectives) {
                if (objective.completed) continue;
                if (objective.type !== type) continue;
                if (objective.target !== target) continue;

                objective.current = Math.min(objective.required, objective.current + amount);

                if (objective.current >= objective.required) {
                    objective.completed = true;
                    this.game.call('showNotification', `Objective complete: ${objective.description}`, 'success');
                }

                questUpdated = true;
            }

            if (questUpdated) {
                // Check if all objectives are complete
                if (quest.objectives.every(obj => obj.completed)) {
                    this.markQuestReadyToTurnIn(questId);
                }
                this.updateQuestUI();
            }
        }
    }

    markQuestReadyToTurnIn(questId) {
        const quest = this.activeQuests.get(questId);
        if (!quest) return;

        quest.readyToTurnIn = true;
        this.game.call('showNotification', `Quest ready to turn in: ${quest.name}`, 'success');
    }

    completeQuest(questId) {
        const quest = this.activeQuests.get(questId);
        if (!quest) return false;

        if (!quest.readyToTurnIn && !quest.objectives.every(obj => obj.completed)) {
            this.game.call('showNotification', 'Quest objectives not complete', 'warning');
            return false;
        }

        // Award rewards
        if (quest.rewards) {
            if (quest.rewards.experience) {
                this.game.call('awardExperience', quest.rewards.experience);
            }
            if (quest.rewards.gold) {
                this.game.call('awardGold', quest.rewards.gold);
            }
            if (quest.rewards.items) {
                for (const item of quest.rewards.items) {
                    this.game.call('addToInventory', item.itemId, item.quantity || 1);
                }
            }
        }

        // Mark as completed
        this.activeQuests.delete(questId);
        this.completedQuests.add(questId);

        this.game.call('showNotification', `Quest completed: ${quest.name}!`, 'success');
        this.updateQuestUI();

        return true;
    }

    updateQuestUI() {
        const questLog = document.getElementById('quest-log');
        if (!questLog) return;

        if (this.activeQuests.size === 0) {
            questLog.style.display = 'none';
            return;
        }

        questLog.style.display = 'block';
        let html = '<div class="quest-log-header" style="color: #4a9eff; font-weight: bold; margin-bottom: 10px;">Quests</div>';

        for (const [questId, quest] of this.activeQuests) {
            const isComplete = quest.readyToTurnIn || quest.objectives.every(obj => obj.completed);

            html += `
                <div class="quest-entry" style="margin-bottom: 10px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px;">
                    <div style="color: ${isComplete ? '#4aff7f' : 'white'}; font-weight: bold;">
                        ${isComplete ? '&#10003; ' : ''}${quest.name}
                    </div>
                    ${quest.objectives.map(obj => `
                        <div style="color: ${obj.completed ? '#4aff7f' : '#888'}; font-size: 12px; margin-left: 10px;">
                            ${obj.completed ? '&#10003; ' : '&#9675; '}${obj.description}: ${obj.current}/${obj.required}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        questLog.innerHTML = html;
    }

    // Hook into combat system
    onMonsterKilled(monsterType) {
        this.updateQuestProgress('kill', monsterType, 1);
    }

    // Hook into inventory system
    onItemCollected(itemId, quantity) {
        this.updateQuestProgress('collect', itemId, quantity);
    }

    // Hook into zone system
    onLocationVisited(locationId) {
        this.updateQuestProgress('visit', locationId, 1);
    }

    update() {
        // Nothing to update each frame
    }
}
