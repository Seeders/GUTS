/**
 * VolitionHeadlessRunner - High-level API for running headless Volition simulations
 *
 * This runner uses the SAME AI system (VolitionAIPlayerSystem) as the visual game.
 * No duplicate logic - it just runs the game loop without graphics.
 */
class VolitionHeadlessRunner {
    constructor(engine) {
        this.engine = engine;
        this.game = null;
        this.aiSystem = null;
        this.kingdomSystem = null;
        this.seed = null;
        this.verbose = false;
    }

    /**
     * Set up a new game
     * @param {Object} config
     * @param {number} config.seed - Random seed for reproducible shuffles
     * @param {boolean} config.verbose - Log moves to console
     */
    async setup(config = {}) {
        this.seed = config.seed || Math.floor(Math.random() * 2147483647);
        this.verbose = config.verbose || false;

        // Get game instance
        this.game = this.engine.gameInstance;

        // Get system references
        const deckSystem = this.game.systemsByName.get('DeckSystem');
        const handSystem = this.game.systemsByName.get('HandSystem');
        const fieldSystem = this.game.systemsByName.get('FieldSystem');

        this.aiSystem = this.game.systemsByName.get('VolitionAIPlayerSystem');
        if (!this.aiSystem) {
            throw new Error('VolitionAIPlayerSystem not found');
        }

        this.kingdomSystem = this.game.systemsByName.get('KingdomSystem');
        if (!this.kingdomSystem) {
            throw new Error('KingdomSystem not found');
        }

        // Reset game state: return all cards to deck
        const allCards = this.game.getEntitiesWith('card', 'cardLocation');
        for (const eid of allCards) {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const card = this.game.getComponent(eid, 'card');
            loc.location = 0; // deck
            loc.index = 0;
            loc.columnIndex = -1;
            card.faceUp = 0;
        }

        // Rebuild deck order array
        if (deckSystem) {
            deckSystem.deckOrder = [...allCards];
            // Set seed and reshuffle
            deckSystem.setSeed(this.seed);
            deckSystem.shuffleDeck(this.seed);
        }

        // Re-deal initial hand
        if (handSystem && handSystem.dealInitialHand) {
            handSystem.dealInitialHand();
        }

        if (this.verbose) {
            console.log(`[Runner] Game setup with seed: ${this.seed}`);
        }
    }

    /**
     * Run the game with the AI system
     * @param {Object} options
     * @param {number} options.maxMoves - Maximum moves before stopping (default: 1000)
     * @returns {Object} Simulation results
     */
    async run(options = {}) {
        const maxMoves = options.maxMoves || 1000;

        // Start the AI
        this.aiSystem.startAISimulation();

        // Run game loop until done
        let iterations = 0;
        const maxIterations = maxMoves * 10; // Safety limit

        while (this.aiSystem.isActive() && iterations < maxIterations) {
            // Run one update cycle of all systems (must await - update is async!)
            await this.game.update();
            iterations++;

            // Check if game is complete (won or AI stopped)
            if (this.kingdomSystem.isGameOver()) {
                break;
            }

            // Check move limit
            if (this.aiSystem.getMoveCount() >= maxMoves) {
                break;
            }
        }

        const results = this.getResults();
        if (this.verbose) {
            console.log(`[Runner] Game ${results.won ? 'WON' : 'LOST'} - ${results.kingdomCards}/52 cards, ${results.moveCount} moves`);
        }

        return results;
    }

    /**
     * Get simulation results using real game systems
     */
    getResults() {
        const kingdomCards = this.kingdomSystem.getTotalKingdomCards();
        const won = this.kingdomSystem.isWon();

        return {
            won,
            kingdomCards,
            moveCount: this.aiSystem.getMoveCount(),
            seed: this.seed
        };
    }
}

// Export for GUTS
if (typeof GUTS !== 'undefined') {
    GUTS.VolitionHeadlessRunner = VolitionHeadlessRunner;
}
