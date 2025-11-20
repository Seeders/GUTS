class ClassSelectionUI extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.classSelectionUI = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.uiContainer = null;
        this.isVisible = false;
        this.selectedClass = null;
    }

    init() {
        this.game.gameManager.register('showClassSelection', this.show.bind(this));
        this.game.gameManager.register('hideClassSelection', this.hide.bind(this));
        this.game.gameManager.register('isClassSelectionVisible', () => this.isVisible);

        this.createUI();
    }

    createUI() {
        this.uiContainer = document.createElement('div');
        this.uiContainer.id = 'class-selection-ui';
        this.uiContainer.innerHTML = `
            <style>
                #class-selection-ui {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.95);
                    display: none;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    font-family: 'Georgia', serif;
                }

                .class-selection-title {
                    color: #d4af37;
                    font-size: 48px;
                    margin-bottom: 10px;
                    text-shadow: 2px 2px 4px black;
                }

                .class-selection-subtitle {
                    color: #888;
                    font-size: 18px;
                    margin-bottom: 40px;
                }

                .class-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 20px;
                    max-width: 900px;
                    padding: 20px;
                }

                .class-card {
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 2px solid #333;
                    border-radius: 10px;
                    padding: 20px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    text-align: center;
                    min-width: 250px;
                }

                .class-card:hover {
                    border-color: #d4af37;
                    transform: translateY(-5px);
                    box-shadow: 0 10px 30px rgba(212, 175, 55, 0.3);
                }

                .class-card.selected {
                    border-color: #00ff88;
                    box-shadow: 0 0 20px rgba(0, 255, 136, 0.5);
                }

                .class-icon {
                    width: 64px;
                    height: 64px;
                    margin: 0 auto 15px;
                    background: #333;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 32px;
                }

                .class-name {
                    color: #fff;
                    font-size: 24px;
                    margin-bottom: 10px;
                }

                .class-description {
                    color: #aaa;
                    font-size: 14px;
                    margin-bottom: 15px;
                    min-height: 40px;
                }

                .class-stats {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 5px;
                    font-size: 12px;
                    text-align: left;
                }

                .class-stat {
                    color: #888;
                }

                .class-stat-value {
                    color: #4a9eff;
                    float: right;
                }

                .class-abilities {
                    margin-top: 10px;
                    padding-top: 10px;
                    border-top: 1px solid #333;
                }

                .class-abilities-title {
                    color: #d4af37;
                    font-size: 11px;
                    margin-bottom: 5px;
                }

                .class-ability {
                    color: #7cfc00;
                    font-size: 11px;
                }

                .start-button {
                    margin-top: 30px;
                    padding: 15px 60px;
                    font-size: 24px;
                    background: linear-gradient(135deg, #d4af37 0%, #aa8a2e 100%);
                    border: none;
                    border-radius: 5px;
                    color: #000;
                    cursor: pointer;
                    font-family: 'Georgia', serif;
                    transition: all 0.3s ease;
                }

                .start-button:hover {
                    transform: scale(1.05);
                    box-shadow: 0 5px 20px rgba(212, 175, 55, 0.5);
                }

                .start-button:disabled {
                    background: #444;
                    color: #666;
                    cursor: not-allowed;
                    transform: none;
                    box-shadow: none;
                }
            </style>

            <div class="class-selection-title">Choose Your Class</div>
            <div class="class-selection-subtitle">Select a hero to begin your adventure</div>

            <div class="class-grid" id="class-grid"></div>

            <button class="start-button" id="start-game-btn" disabled>Select a Class</button>
        `;

        document.body.appendChild(this.uiContainer);

        // Populate class cards
        this.populateClasses();

        // Set up start button
        document.getElementById('start-game-btn').addEventListener('click', () => {
            this.confirmSelection();
        });
    }

    populateClasses() {
        const grid = document.getElementById('class-grid');
        const classes = this.game.gameManager.call('getAvailableClasses');

        const classIcons = {
            warrior: '⚔️',
            ranger: '🏹',
            mage: '🔮',
            paladin: '✝️',
            assassin: '🗡️',
            necromancer: '💀'
        };

        for (const [classId, classData] of Object.entries(classes)) {
            const card = document.createElement('div');
            card.className = 'class-card';
            card.dataset.classId = classId;

            card.innerHTML = `
                <div class="class-icon">${classIcons[classId] || '?'}</div>
                <div class="class-name">${classData.name}</div>
                <div class="class-description">${classData.description}</div>
                <div class="class-stats">
                    <div class="class-stat">Health <span class="class-stat-value">${classData.baseStats.health}</span></div>
                    <div class="class-stat">Damage <span class="class-stat-value">${classData.baseStats.damage}</span></div>
                    <div class="class-stat">Armor <span class="class-stat-value">${classData.baseStats.armor}</span></div>
                    <div class="class-stat">Speed <span class="class-stat-value">${classData.baseStats.moveSpeed}</span></div>
                    <div class="class-stat">Mana <span class="class-stat-value">${classData.baseStats.mana}</span></div>
                    <div class="class-stat">Atk Spd <span class="class-stat-value">${classData.baseStats.attackSpeed}</span></div>
                </div>
                <div class="class-abilities">
                    <div class="class-abilities-title">Starting Abilities:</div>
                    ${classData.startingAbilities.map(a =>
                        `<div class="class-ability">• ${a.replace('Ability', '')}</div>`
                    ).join('')}
                </div>
            `;

            card.addEventListener('click', () => {
                this.selectClass(classId);
            });

            grid.appendChild(card);
        }
    }

    selectClass(classId) {
        this.selectedClass = classId;

        // Update visual selection
        document.querySelectorAll('.class-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelector(`[data-class-id="${classId}"]`).classList.add('selected');

        // Enable start button
        const btn = document.getElementById('start-game-btn');
        btn.disabled = false;
        btn.textContent = 'Start Game';
    }

    confirmSelection() {
        if (!this.selectedClass) return;

        // Set the class in CharacterClassSystem
        this.game.gameManager.call('selectClass', this.selectedClass);

        // Hide selection UI
        this.hide();

        // Show the multiplayer game room lobby
        // Get the arena mode configuration from GameModeManager
        if (this.game.gameModeManager) {
            const arenaMode = this.game.gameModeManager.getModeConfig('arena');
            if (arenaMode && this.game.uiSystem) {
                // Set the game mode in screen manager (required by initializeGame)
                if (this.game.screenManager) {
                    this.game.screenManager.setGameMode('arena');
                }
                // Trigger the multiplayer lobby flow
                this.game.uiSystem.handleMultiplayerModeSelection(arenaMode);
            } else {
                console.error('Cannot show lobby - missing gameModeManager or uiSystem');
            }
        } else {
            console.error('GameModeManager not found');
        }
    }

    show() {
        this.isVisible = true;
        this.uiContainer.style.display = 'flex';
    }

    hide() {
        this.isVisible = false;
        this.uiContainer.style.display = 'none';
    }

    update() {
        // No per-frame updates needed
    }
}
