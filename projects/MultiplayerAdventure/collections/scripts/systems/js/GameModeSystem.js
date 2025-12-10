class GameModeSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.gameModeSystem = this;        
        this.modes = this.initializeGameModes();
        this.setupUI();
    }

    initializeGameModes() {
        return {
            arena: {
                id: 'arena',
                title: 'Arena',
                icon: '⚔️',
                interfaceId: 'createOrJoinRoom',
                description: 'Battle against another player in real-time strategic combat',
                difficulty: 'Player vs Player',
                difficultyClass: 'pvp',
                isMultiplayer: true,
                maxPlayers: 2,
                startingGold: 100,
                onStart: (mode) => {
                    this.game.uiSystem.handleMultiplayerModeSelection(mode);
                }
            }
            // ,
            // campaign: {
            //     id: 'campaign',
            //     title: 'Campaign',
            //     icon: '🏆',
            //     description: 'Progress through increasingly difficult battles and unlock new units',
            //     startingGold: 100
            // },
            // survival: {
            //     id: 'survival',
            //     title: 'Survival',
            //     icon: '⚡',
            //     description: 'See how many waves you can survive with limited resources',
            //     startingGold: 150
            // },
            // arena: {
            //     id: 'arena',
            //     title: 'Arena',
            //     icon: '⚔️',
            //     description: 'Quick battles with balanced armies for testing strategies',
            //     startingGold: 200
            // },
            // challenge: {
            //     id: 'challenge',
            //     title: 'Challenge',
            //     icon: '💀',
            //     description: 'Face pre-built enemy compositions with specific constraints',
            //     startingGold: 100
            // },
            // endless: {
            //     id: 'endless',
            //     title: 'Endless',
            //     icon: '♾️',
            //     description: 'Battle continues until defeat with exponentially scaling enemies',
            //     startingGold: 100
            // },
            // tournament: {
            //     id: 'tournament',
            //     title: 'Tournament',
            //     icon: '🏅',
            //     description: 'Bracket-style competition against AI opponents',
            //     startingGold: 120
            // }
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
            this.game.screenSystem.setGameMode(modeId);
            const modeConfig = this.getModeConfig(modeId);
            modeConfig.onStart(modeConfig);
        }
    }

    getSelectedMode() {
        return this.modes[this.game.screenSystem.selectedGameMode];
    }

    getModeConfig(modeId) {
        return this.modes[modeId];
    }

    onSceneUnload() {
        const modeGrid = document.getElementById('modeGrid');
        if (modeGrid) {
            modeGrid.innerHTML = '';
        }
        this.modes = null;
    }
}