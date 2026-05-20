/**
 * WarGameSystem - Core game logic for War card game
 * Handles game state, flip resolution, and war scenarios
 *
 * Round flow:
 *   playRound() → flips cards to table → triggers onCardsFlipped
 *   (delay handled by WarRenderSystem)
 *   resolveCurrentRound() → compares cards → awards to winner OR triggers war
 *
 * War flow:
 *   triggerWar() → places 3 face-down per player → triggers onWarTriggered
 *   (delay handled by WarRenderSystem)
 *   flipWarCards() → flips the deciding war cards → triggers onCardsFlipped
 *   (delay handled by WarRenderSystem)
 *   resolveCurrentRound() → compares → awards or another war
 */
class WarGameSystem extends GUTS.BaseSystem {
    static services = [
        'startGame', 'playRound', 'resolveCurrentRound', 'resolveFlip',
        'triggerWar', 'flipWarCards', 'awardCards', 'collectCards', 'checkWin',
        'getGameState', 'isGameOver', 'getWinner',
        'getPlayer1Count', 'getPlayer2Count'
    ];
    static serviceDependencies = [
        'dealToPlayers', 'getPlayerPile', 'addToPlayerPile',
        'flipTopCard', 'getTableCards', 'clearTable', 'getCardRankValue',
        'setSeed', 'updateDisplay'
    ];

    constructor(game) {
        super(game);
        this.gameStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.currentPhase = 'waiting'; // waiting, flipping, war, warFlip, resolved, collecting
        this.warDepth = 0;
        this.pendingP1Card = null;
        this.pendingP2Card = null;
        this.pendingWinner = null;
        this.rng = null;
        this.gameSeed = null;
    }

    init() {
        this.gameStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.currentPhase = 'waiting';
        this.warDepth = 0;
        this.pendingP1Card = null;
        this.pendingP2Card = null;
        this.pendingWinner = null;
    }

    onSceneLoad(sceneData, params) {
        // Use seed from scene params (multiplayer) or generate one (local)
        const seed = params?.seed || Math.floor(Math.random() * 2147483647);
        this.gameSeed = seed;
        this.rng = new GUTS.SeededRandom(seed);
    }

    /**
     * Start a new game
     */
    startGame() {
        // Set seed for deterministic deck shuffle (multiplayer sync)
        if (this.gameSeed !== null) {
            this.call.setSeed?.(this.gameSeed);
        }
        const result = this.call.dealToPlayers();
        this.gameStarted = true;
        this.gameOver = false;
        this.winner = null;
        this.currentPhase = 'waiting';
        this.warDepth = 0;
        this.pendingP1Card = null;
        this.pendingP2Card = null;
        this.pendingWinner = null;

        this.game.triggerEvent('onGameStart', {
            player1Count: result.player1Count,
            player2Count: result.player2Count
        });

        this.call.updateDisplay?.();

        return result;
    }

    /**
     * Play a round - both players flip their top card onto the table
     * Does NOT resolve yet - waits for resolveCurrentRound() to be called
     */
    playRound() {
        if (this.gameOver) return { error: 'Game is over' };
        if (this.currentPhase !== 'waiting') return { error: 'Round in progress' };

        this.currentPhase = 'flipping';

        const p1Card = this.call.flipTopCard(1);
        const p2Card = this.call.flipTopCard(2);

        if (p1Card === null) {
            return this.endGame(2, 'Player 1 ran out of cards');
        }
        if (p2Card === null) {
            return this.endGame(1, 'Player 2 ran out of cards');
        }

        // Store pending cards - don't resolve yet
        this.pendingP1Card = p1Card;
        this.pendingP2Card = p2Card;

        const p1Value = this.call.getCardRankValue(p1Card);
        const p2Value = this.call.getCardRankValue(p2Card);

        this.call.updateDisplay?.();

        this.game.triggerEvent('onCardsFlipped', {
            player1Card: p1Card,
            player2Card: p2Card,
            player1Value: p1Value,
            player2Value: p2Value
        });

        return { phase: 'flipping', p1Card, p2Card, p1Value, p2Value };
    }

    /**
     * Resolve the current round after cards have been displayed
     * Called by WarRenderSystem after the flip animation delay
     */
    resolveCurrentRound() {
        if (this.pendingP1Card === null || this.pendingP2Card === null) return;

        const p1Card = this.pendingP1Card;
        const p2Card = this.pendingP2Card;
        this.pendingP1Card = null;
        this.pendingP2Card = null;

        return this.resolveFlip(p1Card, p2Card);
    }

    /**
     * Resolve a flip between two cards
     */
    resolveFlip(p1Card, p2Card) {
        const p1Value = this.call.getCardRankValue(p1Card);
        const p2Value = this.call.getCardRankValue(p2Card);

        if (p1Value > p2Value) {
            return this.awardCards(1);
        } else if (p2Value > p1Value) {
            return this.awardCards(2);
        } else {
            // Tie - WAR! Place 3 face-down cards, then wait for flipWarCards()
            return this.triggerWar();
        }
    }

    /**
     * Trigger a war (tie scenario)
     * Places 3 face-down cards per player, then waits for flipWarCards()
     */
    triggerWar() {
        this.currentPhase = 'war';
        this.warDepth++;

        // Each player places 3 face-down cards
        for (let i = 0; i < 3; i++) {
            const p1Card = this.call.flipTopCard(1);
            const p2Card = this.call.flipTopCard(2);

            if (p1Card === null) {
                return this.endGame(2, 'Player 1 ran out during war');
            }
            if (p2Card === null) {
                return this.endGame(1, 'Player 2 ran out during war');
            }

            // Set these cards face down
            const card1 = this.game.getComponent(p1Card, 'card');
            const card2 = this.game.getComponent(p2Card, 'card');
            if (card1) card1.faceUp = 0;
            if (card2) card2.faceUp = 0;
        }

        this.call.updateDisplay?.();

        // Fire event - WarRenderSystem will show WAR overlay, then call flipWarCards after delay
        this.game.triggerEvent('onWarTriggered', { depth: this.warDepth });

        return { phase: 'war', depth: this.warDepth };
    }

    /**
     * Flip the deciding war cards after face-down cards have been shown
     * Called by WarRenderSystem after the war animation delay
     */
    flipWarCards() {
        if (this.currentPhase !== 'war') return;

        this.currentPhase = 'warFlip';

        const p1WarCard = this.call.flipTopCard(1);
        const p2WarCard = this.call.flipTopCard(2);

        if (p1WarCard === null) {
            return this.endGame(2, 'Player 1 ran out during war flip');
        }
        if (p2WarCard === null) {
            return this.endGame(1, 'Player 2 ran out during war flip');
        }

        // Store as pending - same pattern as playRound
        this.pendingP1Card = p1WarCard;
        this.pendingP2Card = p2WarCard;

        const p1Value = this.call.getCardRankValue(p1WarCard);
        const p2Value = this.call.getCardRankValue(p2WarCard);

        this.call.updateDisplay?.();

        // Fires onCardsFlipped which WarRenderSystem handles with a delay before resolving
        this.game.triggerEvent('onCardsFlipped', {
            player1Card: p1WarCard,
            player2Card: p2WarCard,
            player1Value: p1Value,
            player2Value: p2Value
        });

        return { phase: 'warFlip', p1WarCard, p2WarCard };
    }

    /**
     * Award all table cards to winner - fires event but keeps cards on table
     * WarRenderSystem will call collectCards() after showing the result
     */
    awardCards(winnerId) {
        this.currentPhase = 'resolved';
        this.pendingWinner = winnerId;

        const tableCards = this.call.getTableCards?.() || [];

        this.game.triggerEvent('onRoundWon', {
            winner: winnerId,
            cardsWon: tableCards.length,
            player1Count: this.call.getPlayerPile(1).length,
            player2Count: this.call.getPlayerPile(2).length,
            warDepth: this.warDepth
        });

        return { winner: winnerId, cardsWon: tableCards.length };
    }

    /**
     * Collect table cards into winner's pile
     * Called by WarRenderSystem after the result has been displayed
     */
    collectCards() {
        if (this.pendingWinner === null) return;

        const winnerId = this.pendingWinner;
        this.pendingWinner = null;

        const tableCards = this.call.clearTable();
        this.shuffleArray(tableCards);
        this.call.addToPlayerPile(winnerId, tableCards);

        this.warDepth = 0;
        this.currentPhase = 'waiting';

        const gameResult = this.checkWin();

        this.call.updateDisplay?.();

        return {
            winner: winnerId,
            cardsWon: tableCards.length,
            player1Count: this.call.getPlayerPile(1).length,
            player2Count: this.call.getPlayerPile(2).length,
            gameOver: gameResult.gameOver
        };
    }

    checkWin() {
        const p1Count = this.call.getPlayerPile(1).length;
        const p2Count = this.call.getPlayerPile(2).length;

        if (p1Count === 0) {
            return this.endGame(2, 'Player 2 collected all cards');
        }
        if (p2Count === 0) {
            return this.endGame(1, 'Player 1 collected all cards');
        }

        return { gameOver: false };
    }

    endGame(winnerId, reason) {
        this.gameOver = true;
        this.winner = winnerId;
        this.currentPhase = 'ended';

        this.game.triggerEvent('onGameEnd', {
            winner: winnerId,
            reason: reason
        });

        this.call.updateDisplay?.();

        return {
            gameOver: true,
            winner: winnerId,
            reason: reason
        };
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const rand = this.rng ? this.rng.next() : Math.random();
            const j = Math.floor(rand * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    getGameState() {
        return {
            gameStarted: this.gameStarted,
            gameOver: this.gameOver,
            winner: this.winner,
            phase: this.currentPhase,
            warDepth: this.warDepth,
            player1Count: this.call.getPlayerPile?.(1)?.length || 0,
            player2Count: this.call.getPlayerPile?.(2)?.length || 0,
            tableCards: this.call.getTableCards?.() || []
        };
    }

    isGameOver() { return this.gameOver; }
    getWinner() { return this.winner; }
    getPlayer1Count() { return this.call.getPlayerPile?.(1)?.length || 0; }
    getPlayer2Count() { return this.call.getPlayerPile?.(2)?.length || 0; }
    update() {}
}
