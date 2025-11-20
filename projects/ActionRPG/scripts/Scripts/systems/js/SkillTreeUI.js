class SkillTreeUI extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.skillTreeUI = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.uiContainer = null;
        this.isVisible = false;
    }

    init() {
        this.game.gameManager.register('showSkillTree', this.show.bind(this));
        this.game.gameManager.register('hideSkillTree', this.hide.bind(this));
        this.game.gameManager.register('toggleSkillTree', this.toggle.bind(this));

        this.createUI();
    }

    createUI() {
        this.uiContainer = document.createElement('div');
        this.uiContainer.id = 'skill-tree-ui';
        this.uiContainer.innerHTML = `
            <style>
                #skill-tree-ui {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 800px;
                    max-height: 90vh;
                    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
                    border: 2px solid #d4af37;
                    border-radius: 10px;
                    display: none;
                    flex-direction: column;
                    z-index: 9000;
                    font-family: 'Georgia', serif;
                    box-shadow: 0 0 50px rgba(0, 0, 0, 0.8);
                }

                .skill-tree-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 20px;
                    border-bottom: 1px solid #333;
                }

                .skill-tree-title {
                    color: #d4af37;
                    font-size: 24px;
                }

                .skill-points-display {
                    color: #7cfc00;
                    font-size: 16px;
                }

                .skill-tree-close {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                    padding: 5px 10px;
                }

                .skill-tree-close:hover {
                    color: #ff4444;
                }

                .skill-tree-content {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }

                .skill-tier {
                    margin-bottom: 30px;
                }

                .tier-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid #333;
                }

                .tier-name {
                    color: #fff;
                    font-size: 18px;
                }

                .tier-requirement {
                    color: #888;
                    font-size: 12px;
                }

                .tier-locked .tier-requirement {
                    color: #ff4444;
                }

                .skills-row {
                    display: flex;
                    gap: 15px;
                    flex-wrap: wrap;
                }

                .skill-node {
                    background: #222;
                    border: 2px solid #444;
                    border-radius: 8px;
                    padding: 15px;
                    width: 220px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .skill-node:hover {
                    border-color: #d4af37;
                }

                .skill-node.learned {
                    border-color: #7cfc00;
                    background: rgba(124, 252, 0, 0.1);
                }

                .skill-node.max-rank {
                    border-color: #4a9eff;
                }

                .skill-node.locked {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .skill-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }

                .skill-name {
                    color: #fff;
                    font-size: 14px;
                    font-weight: bold;
                }

                .skill-rank {
                    color: #d4af37;
                    font-size: 12px;
                }

                .skill-type {
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 3px;
                    margin-bottom: 8px;
                    display: inline-block;
                }

                .skill-type.passive {
                    background: #2a4a7a;
                    color: #6af;
                }

                .skill-type.ability {
                    background: #4a2a7a;
                    color: #a6f;
                }

                .skill-description {
                    color: #aaa;
                    font-size: 11px;
                    line-height: 1.4;
                }

                .skill-tooltip {
                    position: absolute;
                    background: #000;
                    border: 1px solid #d4af37;
                    padding: 10px;
                    border-radius: 5px;
                    z-index: 10000;
                    max-width: 250px;
                    display: none;
                }
            </style>

            <div class="skill-tree-header">
                <div class="skill-tree-title">Skill Tree</div>
                <div class="skill-points-display" id="skill-points-display">Skill Points: 0</div>
                <button class="skill-tree-close" id="skill-tree-close">&times;</button>
            </div>

            <div class="skill-tree-content" id="skill-tree-content">
                <!-- Tiers will be populated here -->
            </div>
        `;

        document.body.appendChild(this.uiContainer);

        // Close button
        document.getElementById('skill-tree-close').addEventListener('click', () => {
            this.hide();
        });

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
            if (e.key === 'k' || e.key === 'K') {
                this.toggle();
            }
        });
    }

    populateSkillTree() {
        const content = document.getElementById('skill-tree-content');
        content.innerHTML = '';

        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const entitySkills = this.game.gameManager.call('getEntitySkills', playerEntityId);
        if (!entitySkills) return;

        const tree = this.game.gameManager.call('getSkillTree', entitySkills.treeId);
        if (!tree) return;

        const totalPoints = entitySkills.totalPointsSpent;
        const availablePoints = this.game.gameManager.call('getSkillPoints', playerEntityId);

        // Update points display
        document.getElementById('skill-points-display').textContent = `Skill Points: ${availablePoints}`;

        // Create tiers
        tree.tiers.forEach((tier, tierIndex) => {
            const tierDiv = document.createElement('div');
            tierDiv.className = 'skill-tier';

            const requiredPoints = tier.requiredPoints || 0;
            const isLocked = totalPoints < requiredPoints;

            if (isLocked) {
                tierDiv.classList.add('tier-locked');
            }

            tierDiv.innerHTML = `
                <div class="tier-header">
                    <div class="tier-name">Tier ${tierIndex + 1}</div>
                    <div class="tier-requirement">
                        ${requiredPoints > 0 ? `Requires ${requiredPoints} points spent (${totalPoints}/${requiredPoints})` : 'No requirements'}
                    </div>
                </div>
                <div class="skills-row" id="tier-${tierIndex}-skills"></div>
            `;

            content.appendChild(tierDiv);

            const skillsRow = document.getElementById(`tier-${tierIndex}-skills`);

            // Add skills
            tier.skills.forEach(skill => {
                const currentRank = entitySkills.skills[skill.id] || 0;
                const isMaxRank = currentRank >= skill.maxRank;
                const canLearn = this.game.gameManager.call('canLearnSkill', playerEntityId, skill.id);

                const skillNode = document.createElement('div');
                skillNode.className = 'skill-node';

                if (currentRank > 0) skillNode.classList.add('learned');
                if (isMaxRank) skillNode.classList.add('max-rank');
                if (isLocked || (!canLearn.canLearn && currentRank === 0)) skillNode.classList.add('locked');

                skillNode.innerHTML = `
                    <div class="skill-header">
                        <div class="skill-name">${skill.name}</div>
                        <div class="skill-rank">${currentRank}/${skill.maxRank}</div>
                    </div>
                    <div class="skill-type ${skill.type}">${skill.type.toUpperCase()}</div>
                    <div class="skill-description">${skill.description}</div>
                `;

                skillNode.addEventListener('click', () => {
                    if (!isLocked && canLearn.canLearn) {
                        this.learnSkill(playerEntityId, skill.id);
                    }
                });

                skillsRow.appendChild(skillNode);
            });
        });
    }

    learnSkill(entityId, skillId) {
        const success = this.game.gameManager.call('learnSkill', entityId, skillId);
        if (success) {
            this.populateSkillTree(); // Refresh UI
            this.game.gameManager.call('showMessage', 'Skill learned!');
        }
    }

    show() {
        this.isVisible = true;
        this.uiContainer.style.display = 'flex';
        this.populateSkillTree();
    }

    hide() {
        this.isVisible = false;
        this.uiContainer.style.display = 'none';
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    update() {
        // Could update skill points display in real-time if visible
    }
}
