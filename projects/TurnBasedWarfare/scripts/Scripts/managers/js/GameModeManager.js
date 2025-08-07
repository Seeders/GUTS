class GameModeManager {
    constructor(app) {
        this.game = app;
        this.game.gameModeManager = this;        
        this.modes = this.initializeGameModes();
        this.setupUI();
    }

    initializeGameModes() {
        return {
            campaign: {
                id: 'campaign',
                title: 'Campaign',
                icon: '🏆',
                description: 'Progress through increasingly difficult battles and unlock new units',
                difficulty: 'Progressive',
                difficultyClass: 'easy',
                startingGold: 100,
                maxRounds: 10,
                goldMultiplier: 1.0,
                difficultyScaling: 'linear'
            },
            survival: {
                id: 'survival',
                title: 'Survival',
                icon: '⚡',
                description: 'See how many waves you can survive with limited resources',
                difficulty: 'Medium',
                difficultyClass: 'medium',
                startingGold: 150,
                maxRounds: Infinity,
                goldMultiplier: 0.8,
                difficultyScaling: 'exponential'
            },
            arena: {
                id: 'arena',
                title: 'Arena',
                icon: '⚔️',
                description: 'Quick battles with balanced armies for testing strategies',
                difficulty: 'Easy',
                difficultyClass: 'easy',
                startingGold: 200,
                maxRounds: 1,
                goldMultiplier: 1.2,
                difficultyScaling: 'none'
            },
            challenge: {
                id: 'challenge',
                title: 'Challenge',
                icon: '💀',
                description: 'Face pre-built enemy compositions with specific constraints',
                difficulty: 'Hard',
                difficultyClass: 'hard',
                startingGold: 100,
                maxRounds: 1,
                goldMultiplier: 1.0,
                difficultyScaling: 'preset'
            },
            endless: {
                id: 'endless',
                title: 'Endless',
                icon: '♾️',
                description: 'Battle continues until defeat with exponentially scaling enemies',
                difficulty: 'Expert',
                difficultyClass: 'expert',
                startingGold: 100,
                maxRounds: Infinity,
                goldMultiplier: 1.0,
                difficultyScaling: 'exponential'
            },
            tournament: {
                id: 'tournament',
                title: 'Tournament',
                icon: '🏅',
                description: 'Bracket-style competition against AI opponents',
                difficulty: 'Medium',
                difficultyClass: 'medium',
                startingGold: 120,
                maxRounds: 8,
                goldMultiplier: 1.1,
                difficultyScaling: 'tournament'
            }
        };
    }

    setupUI() {
        const modeGrid = document.getElementById('modeGrid');
        if (!modeGrid) return;

        modeGrid.innerHTML = '';
        
        Object.values(this.modes).forEach(mode => {
            const card = this.createModeCard(mode);
            modeGrid.appendChild(card);
        });
    }

    createModeCard(mode) {
        const card = document.createElement('div');
        card.className = 'mode-card';
        card.dataset.mode = mode.id;
        
        card.innerHTML = `
            <div class="mode-icon">${mode.icon}</div>
            <div class="mode-title">${mode.title}</div>
            <div class="mode-description">${mode.description}</div>
            <div class="mode-difficulty ${mode.difficultyClass}">${mode.difficulty}</div>
        `;

        card.addEventListener('click', () => this.selectMode(mode.id));
        
        return card;
    }

    selectMode(modeId) {
        // Remove previous selection
        document.querySelectorAll('.mode-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        // Add selection to clicked card
        const selectedCard = document.querySelector(`[data-mode="${modeId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
            this.game.eventManager.setGameMode(modeId);
        }
    }

    getSelectedMode() {
        return this.modes[this.game.eventManager.selectedGameMode];
    }

    getModeConfig(modeId) {
        return this.modes[modeId];
    }

    shouldEndCampaign(currentRound) {
        const mode = this.getSelectedMode();
        if (!mode) return false;

        switch (mode.id) {
            case 'campaign':
                return currentRound >= mode.maxRounds;
            case 'arena':
            case 'challenge':
                return true;
            case 'survival':
            case 'endless':
            case 'tournament':
            default:
                return false;
        }
    }
}