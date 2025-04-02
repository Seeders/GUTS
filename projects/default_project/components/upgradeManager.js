
 init() {
this.game.state.activeUpgrades = {};
}
    update() {
       this.applyActiveUpgrades();
        // Level Up check
        if (this.game.state.essence >= this.game.state.essenceToNextLevel && !this.game.state.isLevelingUp) {
            this.showUpgradeMenu();
        }
    }

    applyActiveUpgrades() {
        engine.getFunction("calculateStats")(this.game.state.stats, this.game.state.activeUpgrades['global']);    
    }

    
    // Upgrade system
    showUpgradeMenu() {
        if (this.game.state.isLevelingUp) return; // Prevent re-triggering
        
        this.game.state.isLevelingUp = true;
        this.game.state.isPaused = true;
        
        this.game.uiManager.upgradeMenu.style.display = 'block';
        this.game.uiManager.overlay.style.display = 'block';
        this.game.uiManager.upgradeOptionsDiv.innerHTML = '';
        
        // Filter upgrades based on conditions
        const availableUpgrades = this.game.upgrades.filter(upgrade => upgrade.canApply(this.game.state));
        
        // Choose 3 random upgrades
        const options = [];
        while (options.length < 3 && availableUpgrades.length > 0) {
            const index = Math.floor(Math.random() * availableUpgrades.length);
            options.push(availableUpgrades[index]);
            availableUpgrades.splice(index, 1);
        }
        
        // Create upgrade options
        options.forEach(upgrade => {
            const div = document.createElement('div');
            div.className = 'upgrade-option';
            div.innerHTML = `
                <div class="upgrade-icon">${upgrade.icon}</div>
                <div class="upgrade-desc">
                    <div class="upgrade-title">${upgrade.title}</div>
                    ${upgrade.desc}
                </div>
            `;
            div.onclick = () => this.selectUpgrade(upgrade);
            this.game.uiManager.upgradeOptionsDiv.appendChild(div);
        });
    }

    selectUpgrade(upgrade) {       
        // Add to active upgrades list if not already
        if (!this.game.state.activeUpgrades[upgrade.appliesTo]) {
            this.game.state.activeUpgrades[upgrade.appliesTo] = [upgrade];
        } else {
            this.game.state.activeUpgrades[upgrade.appliesTo].push(upgrade);
        }

        this.applyActiveUpgrades();
        if(upgrade.onAcquire) {
            upgrade.onAcquire(this.game.state);
        }
        
        upgradeMenu.style.display = 'none';
        overlay.style.display = 'none';
        
        this.game.state.essence -= this.game.state.essenceToNextLevel;
        this.game.state.level++;
        this.game.state.essenceToNextLevel = Math.floor(this.game.state.essenceToNextLevel * 1.4);        
        
        this.game.state.isLevelingUp = false;
        this.game.state.isPaused = false;
    }