class QuestSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.questSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.activeQuests = [];
        this.completedQuests = [];
        this.questLog = null;
        this.isVisible = false;

        // Quest definitions
        this.quests = {
            kill_10_enemies: {
                id: 'kill_10_enemies',
                name: 'First Blood',
                description: 'Defeat 10 enemies',
                type: 'kill',
                target: 10,
                rewards: { gold: 100, xp: 200 }
            },
            kill_50_enemies: {
                id: 'kill_50_enemies',
                name: 'Warrior\'s Path',
                description: 'Defeat 50 enemies',
                type: 'kill',
                target: 50,
                requires: 'kill_10_enemies',
                rewards: { gold: 500, xp: 1000 }
            },
            reach_level_5: {
                id: 'reach_level_5',
                name: 'Rising Hero',
                description: 'Reach level 5',
                type: 'level',
                target: 5,
                rewards: { gold: 200, xp: 500 }
            },
            reach_level_10: {
                id: 'reach_level_10',
                name: 'Proven Champion',
                description: 'Reach level 10',
                type: 'level',
                target: 10,
                requires: 'reach_level_5',
                rewards: { gold: 1000, xp: 2000 }
            },
            clear_floor_5: {
                id: 'clear_floor_5',
                name: 'Dungeon Delver',
                description: 'Reach dungeon floor 5',
                type: 'floor',
                target: 5,
                rewards: { gold: 500, xp: 1500 }
            },
            defeat_first_boss: {
                id: 'defeat_first_boss',
                name: 'Boss Slayer',
                description: 'Defeat your first boss',
                type: 'boss',
                target: 1,
                rewards: { gold: 1000, xp: 3000 }
            },
            collect_1000_gold: {
                id: 'collect_1000_gold',
                name: 'Treasure Hunter',
                description: 'Collect 1000 gold total',
                type: 'gold',
                target: 1000,
                rewards: { gold: 500, xp: 500 }
            }
        };

        // Tracking
        this.stats = {
            kills: 0,
            bossKills: 0,
            goldCollected: 0,
            highestFloor: 1
        };
    }

    init() {
        this.game.gameManager.register('getActiveQuests', () => this.activeQuests);
        this.game.gameManager.register('startQuest', this.startQuest.bind(this));
        this.game.gameManager.register('showQuestLog', this.show.bind(this));
        this.game.gameManager.register('hideQuestLog', this.hide.bind(this));
        this.game.gameManager.register('toggleQuestLog', this.toggle.bind(this));
        this.game.gameManager.register('trackQuestKill', () => this.trackKill());
        this.game.gameManager.register('trackQuestBossKill', () => this.trackBossKill());

        this.createUI();

        // Auto-start initial quests
        this.startQuest('kill_10_enemies');
        this.startQuest('reach_level_5');
        this.startQuest('collect_1000_gold');
    }

    createUI() {
        this.questLog = document.createElement('div');
        this.questLog.id = 'quest-log';
        this.questLog.innerHTML = `
            <style>
                #quest-log {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 450px;
                    max-height: 70vh;
                    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
                    border: 2px solid #d4af37;
                    border-radius: 10px;
                    display: none;
                    flex-direction: column;
                    z-index: 9000;
                    font-family: 'Georgia', serif;
                }

                .quest-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 20px;
                    border-bottom: 1px solid #333;
                }

                .quest-title { color: #d4af37; font-size: 24px; }
                .quest-close { background: none; border: none; color: #888; font-size: 24px; cursor: pointer; }
                .quest-close:hover { color: #ff4444; }

                .quest-content { padding: 20px; overflow-y: auto; flex: 1; }

                .quest-item {
                    background: #222;
                    border: 1px solid #444;
                    border-radius: 5px;
                    padding: 15px;
                    margin-bottom: 10px;
                }

                .quest-item.completed { border-color: #7cfc00; background: rgba(124, 252, 0, 0.1); }

                .quest-name { color: #fff; font-size: 16px; margin-bottom: 5px; }
                .quest-desc { color: #888; font-size: 12px; margin-bottom: 10px; }

                .quest-progress-bar {
                    height: 8px;
                    background: #333;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 5px;
                }

                .quest-progress-fill {
                    height: 100%;
                    background: linear-gradient(to right, #d4af37, #aa8a2e);
                    transition: width 0.3s;
                }

                .quest-progress-text { color: #d4af37; font-size: 11px; }

                .quest-rewards {
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid #333;
                    font-size: 11px;
                }

                .quest-reward { color: #7cfc00; }

                .quest-tracker {
                    position: fixed;
                    top: 100px;
                    right: 20px;
                    width: 200px;
                    background: rgba(0, 0, 0, 0.7);
                    border-radius: 5px;
                    padding: 10px;
                    font-family: 'Georgia', serif;
                    font-size: 11px;
                }

                .tracker-quest { margin-bottom: 8px; }
                .tracker-name { color: #d4af37; margin-bottom: 3px; }
                .tracker-progress { color: #888; }
            </style>

            <div class="quest-header">
                <div class="quest-title">Quest Log</div>
                <button class="quest-close" id="quest-close">&times;</button>
            </div>
            <div class="quest-content" id="quest-content"></div>
        `;

        document.body.appendChild(this.questLog);

        // Quest tracker on screen
        this.tracker = document.createElement('div');
        this.tracker.id = 'quest-tracker';
        this.tracker.className = 'quest-tracker';
        document.body.appendChild(this.tracker);

        document.getElementById('quest-close').addEventListener('click', () => this.hide());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) this.hide();
            if (e.key === 'j' || e.key === 'J') this.toggle();
        });
    }

    startQuest(questId) {
        const quest = this.quests[questId];
        if (!quest) return false;
        if (this.completedQuests.includes(questId)) return false;
        if (this.activeQuests.find(q => q.id === questId)) return false;

        if (quest.requires && !this.completedQuests.includes(quest.requires)) return false;

        this.activeQuests.push({ ...quest, progress: 0 });
        this.game.gameManager.call('showMessage', `Quest started: ${quest.name}`);
        this.updateTracker();
        return true;
    }

    trackKill() {
        this.stats.kills++;
        this.checkQuestProgress('kill', this.stats.kills);
    }

    trackBossKill() {
        this.stats.bossKills++;
        this.checkQuestProgress('boss', this.stats.bossKills);
    }

    checkQuestProgress(type, value) {
        this.activeQuests.forEach(quest => {
            if (quest.type !== type) return;

            quest.progress = value;
            if (quest.progress >= quest.target) {
                this.completeQuest(quest.id);
            }
        });

        this.updateTracker();
    }

    completeQuest(questId) {
        const index = this.activeQuests.findIndex(q => q.id === questId);
        if (index === -1) return;

        const quest = this.activeQuests[index];
        this.activeQuests.splice(index, 1);
        this.completedQuests.push(questId);

        // Give rewards
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (quest.rewards.gold) {
            this.game.gameManager.call('addPlayerGold', quest.rewards.gold);
        }
        if (quest.rewards.xp) {
            this.game.gameManager.call('awardExperience', playerEntityId, quest.rewards.xp);
        }

        this.game.gameManager.call('showMessage', `Quest complete: ${quest.name}!`);
        this.game.triggerEvent('onQuestComplete', { questId, quest });

        // Start follow-up quests
        Object.values(this.quests).forEach(q => {
            if (q.requires === questId) this.startQuest(q.id);
        });

        this.updateTracker();
    }

    updateTracker() {
        this.tracker.innerHTML = this.activeQuests.slice(0, 3).map(quest => `
            <div class="tracker-quest">
                <div class="tracker-name">${quest.name}</div>
                <div class="tracker-progress">${quest.progress || 0}/${quest.target}</div>
            </div>
        `).join('');
    }

    refreshQuestLog() {
        const content = document.getElementById('quest-content');
        content.innerHTML = this.activeQuests.map(quest => {
            const percent = ((quest.progress || 0) / quest.target) * 100;
            return `
                <div class="quest-item">
                    <div class="quest-name">${quest.name}</div>
                    <div class="quest-desc">${quest.description}</div>
                    <div class="quest-progress-bar">
                        <div class="quest-progress-fill" style="width: ${percent}%"></div>
                    </div>
                    <div class="quest-progress-text">${quest.progress || 0} / ${quest.target}</div>
                    <div class="quest-rewards">
                        Rewards:
                        ${quest.rewards.gold ? `<span class="quest-reward">${quest.rewards.gold}g</span>` : ''}
                        ${quest.rewards.xp ? `<span class="quest-reward">${quest.rewards.xp} XP</span>` : ''}
                    </div>
                </div>
            `;
        }).join('') || '<div style="color: #888; text-align: center;">No active quests</div>';
    }

    show() { this.isVisible = true; this.questLog.style.display = 'flex'; this.refreshQuestLog(); }
    hide() { this.isVisible = false; this.questLog.style.display = 'none'; }
    toggle() { if (this.isVisible) this.hide(); else this.show(); }

    update() {
        // Check level/floor progress
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (playerEntityId) {
            const level = this.game.gameManager.call('getEntityLevel', playerEntityId);
            this.checkQuestProgress('level', level);
        }

        const floor = this.game.gameManager.call('getCurrentFloor') || 1;
        if (floor > this.stats.highestFloor) {
            this.stats.highestFloor = floor;
            this.checkQuestProgress('floor', floor);
        }

        const gold = this.game.gameManager.call('getPlayerGold') || 0;
        if (gold > this.stats.goldCollected) {
            this.stats.goldCollected = gold;
            this.checkQuestProgress('gold', gold);
        }
    }
}
