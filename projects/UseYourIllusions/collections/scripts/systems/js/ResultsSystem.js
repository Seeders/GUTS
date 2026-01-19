class ResultsSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.resultsSystem = this;
    }

    showVictory(stats) {
        this.populateStats('victoryStats', stats, 'victory');
        this.updateButtonForCampaign('victory_MainMenuBtn');
        this.game.call('showVictoryScreen');
    }

    showDefeat(stats) {
        this.populateStats('defeatStats', stats, 'defeat');
        this.updateButtonForCampaign('defeat_MainMenuBtn');
        this.game.call('showDefeatScreen');
    }

    /**
     * Update the results screen button text for campaign missions
     */
    updateButtonForCampaign(buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const isCampaignMission = this.game.state.skirmishConfig?.isCampaignMission;
        if (isCampaignMission) {
            btn.textContent = 'RETURN TO CAMPAIGN';
        } else {
            btn.textContent = 'RETURN TO MAIN MENU';
        }
    }

    populateStats(containerId, stats, type) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        const statItems = type === 'victory' 
            ? this.getVictoryStats(stats)
            : this.getDefeatStats(stats);

        statItems.forEach(item => {
            const card = this.createStatCard(item.label, item.value);
            container.appendChild(card);
        });
    }

    getVictoryStats(stats) {
        return [
            { label: 'Round Reached', value: stats.round || 1 },
            { label: 'Gold Earned', value: stats.goldEarned || 0 },
            { label: 'Units Deployed', value: stats.unitsDeployed || 0 },
            { label: 'Time Played', value: this.formatTime(stats.totalPlayTime || 0) }
        ];
    }

    getDefeatStats(stats) {
        return [
            { label: 'Final Round', value: stats.round || 1 },
            { label: 'Total Gold', value: stats.goldEarned || 0 },
            { label: 'Units Lost', value: stats.unitsLost || 0 },
            { label: 'Survival Time', value: this.formatTime(stats.totalPlayTime || 0) }
        ];
    }

    createStatCard(label, value) {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <div class="stat-label">${label}</div>
            <div class="stat-value">${value}</div>
        `;
        return card;
    }

    formatTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    onSceneUnload() {
    }
}
