class BattleLogSystem {
    constructor(app) {
        this.game = app;  
        this.game.battleLogSystem = this;
        this.entries = [];
        this.maxEntries = 100;
    }
    
    add(message, className = '') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = {
            message,
            className,
            timestamp,
            category: this.categorizeMessage(className)
        };

        this.entries.push(entry);
        
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-50);
        }
        
    }
    
    categorizeMessage(className) {
        if (className.includes('victory')) return 'victory';
        if (className.includes('death') || className.includes('damage')) return 'combat';
        if (className.includes('gold') || className.includes('cost')) return 'economy';
        return 'general';
    }
    
    update(deltaTime) {
        const battleLog = document.getElementById('battleLog');
        if (!battleLog) return;

        const recentEntries = this.entries.slice(-20);
        battleLog.innerHTML = recentEntries.map(entry => 
            `<div class="log-entry ${entry.className}">
                [${entry.timestamp}] ${entry.message}
            </div>`
        ).join('');

        battleLog.scrollTop = battleLog.scrollHeight;
    }
    
    addWelcomeMessages() {
        this.add('Welcome to Auto Battle Arena!');
        this.add('Build your army during placement phase, then watch them fight!');
        this.add('Each victory grants gold and increases difficulty.');
        this.add('Click units in the shop, then click the battlefield to place them.');
        
        this.addModeSpecificTip();
    }
    
    addModeSpecificTip() {
        const gameMode = this.game.state?.gameMode;
        const tips = {
            survival: 'Survival Mode: Focus on cost-effective units!',
            challenge: 'Challenge Mode: Study enemy composition carefully!',
            endless: 'Endless Mode: Plan for long-term sustainability!',
            campaign: 'Campaign Mode: Experiment with different strategies!',
            arena: 'Arena Mode: Perfect for testing unit combinations!',
            tournament: 'Tournament Mode: Each opponent has unique AI behavior!'
        };
        
        if (tips[gameMode]) {
            setTimeout(() => {
                this.add(tips[gameMode], 'log-victory');
            }, 2000);
        }
    }
    
    clear() {
        this.entries = [];
        this.updateDisplay();
    }
}