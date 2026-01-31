/**
 * Volition Win Rate Simulator
 * Run with: node simulate.js [numGames]
 *
 * This uses a greedy AI strategy that achieves ~0.1% win rate.
 * Human players who can plan ahead will likely win much more often.
 *
 * Key game mechanics modeled:
 * - 5-card hand, oldest card pushed to tableau when drawing with full hand
 * - Discards go to empty columns first, then round-robin (ignoring stacking rules!)
 * - Valid sequences can be moved between tableau columns
 * - Only Kings can start empty columns
 */

class Card {
    constructor(suit, rank) {
        this.suit = suit; // 0-3 (hearts, diamonds, clubs, spades)
        this.rank = rank; // 1-13 (A, 2-10, J, Q, K)
    }

    isRed() {
        return this.suit === 0 || this.suit === 1;
    }

    toString() {
        const suits = ['♥', '♦', '♣', '♠'];
        const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        return ranks[this.rank] + suits[this.suit];
    }
}

class SolitaireSimulator {
    constructor() {
        this.reset();
    }

    reset() {
        // Create and shuffle deck
        this.deck = [];
        for (let suit = 0; suit < 4; suit++) {
            for (let rank = 1; rank <= 13; rank++) {
                this.deck.push(new Card(suit, rank));
            }
        }
        this.shuffle(this.deck);

        // Game state
        this.hand = [];
        this.tableau = [[], [], [], []]; // 4 columns
        this.foundation = [0, 0, 0, 0]; // Top rank for each suit (0 = empty)
        this.handCapacity = 5;
        this.gameOver = false;
        this.won = false;
        this.nextDumpColumn = 0; // Round-robin for dumping

        // Deal initial hand
        for (let i = 0; i < this.handCapacity; i++) {
            if (this.deck.length > 0) {
                this.hand.push(this.deck.pop());
            }
        }
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    canPlayToFoundation(card) {
        return card.rank === this.foundation[card.suit] + 1;
    }

    playToFoundation(card, fromHand = true, handIndex = -1, tableauCol = -1, tableauIdx = -1) {
        if (!this.canPlayToFoundation(card)) return false;

        this.foundation[card.suit] = card.rank;

        if (fromHand && handIndex >= 0) {
            this.hand.splice(handIndex, 1);
        } else if (tableauCol >= 0 && tableauIdx >= 0) {
            this.tableau[tableauCol].splice(tableauIdx, 1);
        }

        // Check win
        if (this.foundation.every(r => r === 13)) {
            this.won = true;
            this.gameOver = true;
        }

        return true;
    }

    canPlayToTableau(card, columnIndex) {
        const column = this.tableau[columnIndex];

        if (column.length === 0) {
            return card.rank === 13; // Only Kings on empty
        }

        const topCard = column[column.length - 1];
        const alternatingColors = card.isRed() !== topCard.isRed();
        const descendingOrder = card.rank === topCard.rank - 1;

        return alternatingColors && descendingOrder;
    }

    /**
     * Check if cards from startIdx to end of column form a valid sequence
     */
    isValidSequence(col, startIdx) {
        const column = this.tableau[col];
        if (startIdx >= column.length) return false;
        if (startIdx === column.length - 1) return true; // Single card is valid

        for (let i = startIdx; i < column.length - 1; i++) {
            const upper = column[i];
            const lower = column[i + 1];

            // Must be alternating colors
            if (upper.isRed() === lower.isRed()) return false;

            // Must be descending
            if (upper.rank !== lower.rank + 1) return false;
        }

        return true;
    }

    /**
     * Find the first index in a column where a valid sequence starts
     * Returns the index of the topmost card that starts a valid sequence to bottom
     */
    findValidSequenceStart(col) {
        const column = this.tableau[col];
        if (column.length === 0) return -1;

        // Start from top and find where valid sequence begins
        for (let i = 0; i < column.length; i++) {
            if (this.isValidSequence(col, i)) {
                return i;
            }
        }
        return column.length - 1; // At minimum, bottom card is valid
    }

    playToTableau(card, columnIndex, fromHand = true, handIndex = -1, fromTableauCol = -1, fromTableauIdx = -1) {
        if (!this.canPlayToTableau(card, columnIndex)) return false;

        this.tableau[columnIndex].push(card);

        if (fromHand && handIndex >= 0) {
            this.hand.splice(handIndex, 1);
        } else if (fromTableauCol >= 0 && fromTableauIdx >= 0) {
            this.tableau[fromTableauCol].splice(fromTableauIdx, 1);
        }

        return true;
    }

    /**
     * Move a stack of cards from one tableau column to another
     */
    moveStack(fromCol, startIdx, toCol) {
        if (!this.isValidSequence(fromCol, startIdx)) return false;

        const topCard = this.tableau[fromCol][startIdx];
        if (!this.canPlayToTableau(topCard, toCol)) return false;

        // Move the entire stack
        const cardsToMove = this.tableau[fromCol].splice(startIdx);
        this.tableau[toCol].push(...cardsToMove);

        return true;
    }

    findEmptyColumn() {
        for (let i = 0; i < 4; i++) {
            if (this.tableau[i].length === 0) return i;
        }
        return -1;
    }

    drawCard() {
        if (this.deck.length === 0) return false;

        // If hand is full, dump oldest to tableau (IGNORING stacking rules)
        if (this.hand.length >= this.handCapacity) {
            const discarded = this.hand.shift();

            // Find column to dump (empty first, then round-robin)
            const emptyCol = this.findEmptyColumn();
            if (emptyCol >= 0) {
                this.tableau[emptyCol].push(discarded);
                this.nextDumpColumn = (emptyCol + 1) % 4;
            } else {
                // Round-robin - just dump it (no stacking rules!)
                this.tableau[this.nextDumpColumn].push(discarded);
                this.nextDumpColumn = (this.nextDumpColumn + 1) % 4;
            }
        }

        this.hand.push(this.deck.pop());
        return true;
    }

    // Try to make any valid move
    tryMakeMove() {
        // Priority 1: Play to foundation from hand
        for (let i = 0; i < this.hand.length; i++) {
            if (this.canPlayToFoundation(this.hand[i])) {
                const card = this.hand[i];
                this.playToFoundation(card, true, i);
                return true;
            }
        }

        // Priority 2: Play to foundation from tableau (bottom cards only)
        for (let col = 0; col < 4; col++) {
            if (this.tableau[col].length > 0) {
                const idx = this.tableau[col].length - 1;
                const card = this.tableau[col][idx];
                if (this.canPlayToFoundation(card)) {
                    this.playToFoundation(card, false, -1, col, idx);
                    return true;
                }
            }
        }

        // Priority 3: Move stacks to free up foundation-playable cards
        for (let fromCol = 0; fromCol < 4; fromCol++) {
            const seqStart = this.findValidSequenceStart(fromCol);
            if (seqStart < 0) continue;

            // Check if moving this stack would expose a foundation-playable card
            if (seqStart > 0) {
                const exposedCard = this.tableau[fromCol][seqStart - 1];
                if (this.canPlayToFoundation(exposedCard)) {
                    // Try to move the stack somewhere
                    const topCard = this.tableau[fromCol][seqStart];
                    for (let toCol = 0; toCol < 4; toCol++) {
                        if (toCol === fromCol) continue;
                        if (this.canPlayToTableau(topCard, toCol)) {
                            this.moveStack(fromCol, seqStart, toCol);
                            return true;
                        }
                    }
                }
            }
        }

        // Priority 4: Move stacks to build longer sequences
        let bestMove = null;
        let bestNewLen = 0;

        for (let fromCol = 0; fromCol < 4; fromCol++) {
            const seqStart = this.findValidSequenceStart(fromCol);
            if (seqStart < 0) continue;

            const fromSeqLen = this.tableau[fromCol].length - seqStart;
            const topCard = this.tableau[fromCol][seqStart];

            for (let toCol = 0; toCol < 4; toCol++) {
                if (toCol === fromCol) continue;
                if (!this.canPlayToTableau(topCard, toCol)) continue;

                const toSeqStart = this.findValidSequenceStart(toCol);
                const toSeqLen = toSeqStart >= 0 ? this.tableau[toCol].length - toSeqStart : 0;
                const newLen = fromSeqLen + toSeqLen + 1; // Combined sequence length

                // Only move if it creates a longer sequence than we had
                if (newLen > Math.max(fromSeqLen, toSeqLen) && newLen > bestNewLen) {
                    bestNewLen = newLen;
                    bestMove = { fromCol, seqStart, toCol };
                }
            }
        }

        if (bestMove) {
            this.moveStack(bestMove.fromCol, bestMove.seqStart, bestMove.toCol);
            return true;
        }

        // Priority 5: Play Kings to empty columns if available
        for (let i = 0; i < this.hand.length; i++) {
            if (this.hand[i].rank === 13) {
                const emptyCol = this.findEmptyColumn();
                if (emptyCol >= 0) {
                    this.playToTableau(this.hand[i], emptyCol, true, i);
                    return true;
                }
            }
        }

        // Priority 6: Play hand cards to tableau - prefer extending longest sequences
        const sortedIndices = this.hand
            .map((c, i) => ({ card: c, index: i }))
            .sort((a, b) => b.card.rank - a.card.rank);

        for (const { card, index } of sortedIndices) {
            // Find all valid columns and pick the one with longest valid sequence
            let bestCol = -1;
            let bestSeqLen = -1;

            for (let col = 0; col < 4; col++) {
                if (this.canPlayToTableau(card, col)) {
                    const seqStart = this.findValidSequenceStart(col);
                    const seqLen = seqStart >= 0 ? this.tableau[col].length - seqStart : 0;
                    if (seqLen > bestSeqLen) {
                        bestSeqLen = seqLen;
                        bestCol = col;
                    }
                }
            }

            if (bestCol >= 0) {
                this.playToTableau(card, bestCol, true, index);
                return true;
            }
        }

        return false;
    }

    playGame(verbose = false) {
        let moves = 0;
        const maxMoves = 1000; // Prevent infinite loops

        while (!this.gameOver && moves < maxMoves) {
            // Keep making moves until stuck
            let madeMove = true;
            while (madeMove && !this.gameOver) {
                madeMove = this.tryMakeMove();
                if (madeMove) moves++;
            }

            if (this.gameOver) break;

            // Draw a card if possible
            if (this.deck.length > 0) {
                this.drawCard();
                moves++;
            } else {
                // No more cards to draw, try one more round of moves
                madeMove = true;
                while (madeMove && !this.gameOver) {
                    madeMove = this.tryMakeMove();
                    if (madeMove) moves++;
                }

                if (!this.gameOver) {
                    this.gameOver = true;
                    this.won = false;
                }
            }
        }

        if (verbose) {
            console.log(`Game ended after ${moves} moves`);
            console.log(`Foundation: ${this.foundation.map(r => r).join(', ')}`);
            console.log(`Won: ${this.won}`);
        }

        return {
            won: this.won,
            moves,
            foundationTotal: this.foundation.reduce((a, b) => a + b, 0)
        };
    }
}

// Run simulation
const numGames = parseInt(process.argv[2]) || 10000;
console.log(`Running ${numGames} simulations...\n`);

let wins = 0;
let totalFoundation = 0;
let minFoundation = 52;
let maxFoundation = 0;

for (let i = 0; i < numGames; i++) {
    const sim = new SolitaireSimulator();
    const result = sim.playGame();

    if (result.won) wins++;
    totalFoundation += result.foundationTotal;
    minFoundation = Math.min(minFoundation, result.foundationTotal);
    maxFoundation = Math.max(maxFoundation, result.foundationTotal);

    if ((i + 1) % 1000 === 0) {
        process.stdout.write(`\rProgress: ${i + 1}/${numGames}`);
    }
}

console.log('\n');
console.log('=== RESULTS ===');
console.log(`Games played: ${numGames}`);
console.log(`Wins: ${wins} (${(wins / numGames * 100).toFixed(2)}%)`);
console.log(`Average cards to foundation: ${(totalFoundation / numGames).toFixed(1)} / 52`);
console.log(`Min cards to foundation: ${minFoundation}`);
console.log(`Max cards to foundation: ${maxFoundation}`);
console.log('');
if (wins > 0) {
    console.log('The game IS winnable - this greedy AI achieved ~' + (wins / numGames * 100).toFixed(1) + '% win rate.');
    console.log('Human players with better planning should achieve much higher win rates.');
} else {
    console.log('No wins with this strategy, but max ' + maxFoundation + '/52 suggests wins are possible with better play.');
}
