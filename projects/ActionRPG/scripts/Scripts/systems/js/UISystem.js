class UISystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game.uiSystem = this;

        this.healthBar = null;
        this.manaBar = null;
        this.levelText = null;
        this.expText = null;
        this.goldText = null;
        this.skillButtons = [];
    }

    init() {
        // Register services
        this.game.gameManager.register('updateHealthBar', this.updateHealthBar.bind(this));
        this.game.gameManager.register('updateManaBar', this.updateManaBar.bind(this));
        this.game.gameManager.register('showDamageNumber', this.showDamageNumber.bind(this));
    }

    start() {
        this.setupUIElements();
    }

    setupUIElements() {
        this.healthBar = document.getElementById('healthBar');
        this.healthText = document.getElementById('healthText');
        this.manaBar = document.getElementById('manaBar');
        this.manaText = document.getElementById('manaText');
        this.levelText = document.getElementById('levelText');
        this.expText = document.getElementById('expText');
        this.goldText = document.getElementById('goldText');

        // Setup skill buttons
        for (let i = 1; i <= 8; i++) {
            const button = document.getElementById(`skill${i}`);
            if (button) {
                this.skillButtons.push(button);

                button.addEventListener('click', () => {
                    this.useSkill(i - 1);
                });
            }
        }
    }

    update(deltaTime, now) {
        const player = this.findPlayer();
        if (!player) return;

        this.updatePlayerStats(player);
        this.updateSkillCooldowns(player, now);
    }

    findPlayer() {
        const players = this.game.getEntitiesWith('PlayerController');
        return players.values().next().value;
    }

    updatePlayerStats(player) {
        // Update health
        const health = this.game.getComponent(player, 'Health');
        if (health && this.healthBar) {
            const healthPercent = (health.current / health.max) * 100;
            this.healthBar.style.width = healthPercent + '%';
            if (this.healthText) {
                this.healthText.textContent = `${Math.floor(health.current)} / ${health.max}`;
            }
        }

        // Update mana
        const mana = this.game.getComponent(player, 'Mana');
        if (mana && this.manaBar) {
            const manaPercent = (mana.current / mana.max) * 100;
            this.manaBar.style.width = manaPercent + '%';
            if (this.manaText) {
                this.manaText.textContent = `${Math.floor(mana.current)} / ${mana.max}`;
            }
        }

        // Update level and experience
        const stats = this.game.getComponent(player, 'Stats');
        if (stats) {
            if (this.levelText) {
                this.levelText.textContent = `Level ${stats.level}`;
            }
            if (this.expText) {
                this.expText.textContent = `XP: ${stats.experience} / ${stats.experienceToNextLevel}`;
            }
        }

        // Update gold
        const inventory = this.game.getComponent(player, 'Inventory');
        if (inventory && this.goldText) {
            this.goldText.textContent = `Gold: ${inventory.gold}`;
        }
    }

    updateSkillCooldowns(player, now) {
        const skills = this.game.getComponent(player, 'Skills');
        if (!skills) return;

        for (let i = 0; i < this.skillButtons.length; i++) {
            const button = this.skillButtons[i];
            if (!button) continue;

            const skillId = skills.skills[i];
            if (!skillId) {
                button.style.opacity = '0.3';
                button.disabled = true;
                continue;
            }

            const cooldownEnd = skills.cooldowns[skillId] || 0;
            const onCooldown = now < cooldownEnd;

            if (onCooldown) {
                const remaining = Math.ceil((cooldownEnd - now) / 1000);
                button.textContent = `${i + 1}: ${remaining}s`;
                button.style.opacity = '0.5';
                button.disabled = true;
            } else {
                button.textContent = `${i + 1}`;
                button.style.opacity = '1.0';
                button.disabled = false;
            }
        }
    }

    useSkill(skillIndex) {
        const player = this.findPlayer();
        if (!player) return;

        const skills = this.game.getComponent(player, 'Skills');
        const mana = this.game.getComponent(player, 'Mana');
        if (!skills || !mana) return;

        const skillId = skills.skills[skillIndex];
        if (!skillId) return;

        // Check cooldown
        const now = this.game.state.now;
        const cooldownEnd = skills.cooldowns[skillId] || 0;
        if (now < cooldownEnd) return;

        // Get skill data (would come from config in real implementation)
        const skillData = this.game.getCollections().skills?.[skillId];
        if (!skillData) return;

        // Check mana
        if (mana.current < skillData.manaCost) {
            this.showMessage('Not enough mana!');
            return;
        }

        // Use skill
        const controller = this.game.getComponent(player, 'PlayerController');
        controller.selectedSkill = skillIndex;

        console.log(`Using skill ${skillId}`);
    }

    updateHealthBar(current, max) {
        if (this.healthBar) {
            const percent = (current / max) * 100;
            this.healthBar.style.width = percent + '%';
        }
    }

    updateManaBar(current, max) {
        if (this.manaBar) {
            const percent = (current / max) * 100;
            this.manaBar.style.width = percent + '%';
        }
    }

    showDamageNumber(data) {
        // Create floating damage number
        const { entityId, damage, element } = data;
        const position = this.game.getComponent(entityId, 'Position');
        if (!position) return;

        // Would create a floating text element here
        console.log(`Damage: ${damage} (${element}) at`, position);
    }

    showMessage(message) {
        // Show temporary message to player
        console.log('[UI]', message);
        // Could create a toast notification here
    }
}
