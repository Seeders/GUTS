class EnemyStrategy {
    constructor(rng = null) {
        this.current = null;
        this.history = [];
        this.playerCounters = new Map();
        this.rng = rng; // Seeded RNG for deterministic strategy selection
        
        // Strategy definitions with weights and preferences
        this.strategies = {
            balanced: {
                name: 'Balanced',
                weights: { 
                    hp: 0.3, 
                    damage: 0.4, 
                    range: 0.2, 
                    speed: 0.1,
                    armor: 0.0,
                    elemental: 0.0,
                    poison: 0.0
                },
                unitTypePreferences: {},
                description: 'Well-rounded army composition',
                maxUnitsMultiplier: 1.0,
                valueThreshold: null
            },
            counter: {
                name: 'Counter Strategy',
                weights: {},
                unitTypePreferences: {},
                description: 'Counters player\'s last strategy',
                maxUnitsMultiplier: 1.2,
                valueThreshold: null
            },
            starter: {
                name: 'Opening Gambit',
                weights: { 
                    hp: 0.2, 
                    damage: 0.3, 
                    range: 0.3, 
                    speed: 0.2,
                    armor: 0.0,
                    elemental: 0.0,
                    poison: 0.0
                },
                unitTypePreferences: {},
                maxUnitsToPlace: 2,
                description: 'Simple opening with 2 random units',
                maxUnitsMultiplier: 0.5,
                valueThreshold: 0.4
            },
            aggressive: {
                name: 'All-Out Attack',
                weights: {
                    hp: 0.1,
                    damage: 0.6,
                    range: 0.2,
                    speed: 0.1,
                    armor: 0.0,
                    elemental: 0.0,
                    poison: 0.0
                },
                unitTypePreferences: { archer: 1.5, mage: 1.3 },
                description: 'Focus on high damage output',
                maxUnitsMultiplier: 1.3,
                valueThreshold: null
            },
            defensive: {
                name: 'Fortress Defense',
                weights: {
                    hp: 0.5,
                    damage: 0.2,
                    range: 0.1,
                    speed: 0.0,
                    armor: 0.2,
                    elemental: 0.0,
                    poison: 0.0
                },
                unitTypePreferences: { tank: 2.0 },
                description: 'Focus on survivability and armor',
                maxUnitsMultiplier: 0.8,
                valueThreshold: null
            },
            elemental: {
                name: 'Elemental Mastery',
                weights: {
                    hp: 0.2,
                    damage: 0.3,
                    range: 0.2,
                    speed: 0.1,
                    armor: 0.0,
                    elemental: 0.2,
                    poison: 0.0
                },
                unitTypePreferences: { mage: 2.5 },
                description: 'Focus on elemental damage',
                maxUnitsMultiplier: 1.1,
                valueThreshold: null
            }
        };
        
        // Unit categorization patterns
        this.unitPatterns = {
            tank: {
                idPatterns: ['_s_'],
                statRequirements: { hp: 200, armor: 5 },
                tags: ['heavy', 'shield', 'guard', 'knight']
            },
            archer: {
                idPatterns: ['_d_'],
                statRequirements: { range: 50 },
                tags: ['bow', 'archer', 'ranger', 'marksman']
            },
            mage: {
                idPatterns: ['_i_'],
                statRequirements: {},
                elementalUnits: true,
                tags: ['mage', 'wizard', 'sorcerer', 'elemental']
            },
            fast: {
                idPatterns: [],
                statRequirements: { speed: 55 },
                tags: ['scout', 'cavalry', 'runner']
            },
            ranged: {
                idPatterns: [],
                statRequirements: { range: 50 },
                tags: ['ranged', 'projectile']
            }
        };
        
        // Strategy selection weights based on game state
        this.selectionWeights = {
            round1: { starter: 1.0 },
            earlyGame: { balanced: 0.4, aggressive: 0.3, counter: 0.3 },
            midGame: { counter: 0.5, balanced: 0.2, aggressive: 0.2, defensive: 0.1 },
            lateGame: { counter: 0.6, elemental: 0.2, aggressive: 0.1, defensive: 0.1 }
        };
    }
    
    /**
     * Select the best strategy for the current game state
     * @param {number} round - Current round number
     * @param {Array} playerPlacements - Player's unit placements
     * @param {Object} gameState - Additional game state information
     * @returns {string} Selected strategy key
     */
    selectStrategy(round, playerPlacements, gameState = {}) {
        // Always use starter strategy for round 1
        if (round === 1) {
            return 'starter';
        }
        
        // Try counter strategy if we have player data
        if (round > 1 && playerPlacements.length > 0) {
            const counterStrategy = this.getCounterStrategy(playerPlacements);
            if (counterStrategy) {
                return 'counter';
            }
        }
        
        // Select based on game phase and weighted probabilities
        const gamePhase = this.determineGamePhase(round, gameState);
        const weights = this.selectionWeights[gamePhase] || this.selectionWeights.midGame;
        
        return this.weightedRandomSelection(weights);
    }
    
    /**
     * Determine current game phase based on round and state
     * @param {number} round - Current round number
     * @param {Object} gameState - Game state information
     * @returns {string} Game phase identifier
     */
    determineGamePhase(round, gameState) {
        if (round <= 2) return 'earlyGame';
        if (round <= 5) return 'midGame';
        return 'lateGame';
    }
    
    /**
     * Select strategy using weighted random selection
     * @param {Object} weights - Strategy weights
     * @returns {string} Selected strategy key
     */
    /**
     * Set the RNG instance for deterministic selection
     * @param {SeededRandom} rng - Seeded random instance
     */
    setRNG(rng) {
        this.rng = rng;
    }

    weightedRandomSelection(weights) {
        // Sort entries for deterministic iteration order
        const entries = Object.entries(weights).sort((a, b) => a[0].localeCompare(b[0]));
        const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);

        // Use seeded RNG if available, otherwise fallback to Math.random
        let random = (this.rng ? this.rng.next() : Math.random()) * totalWeight;

        for (const [strategy, weight] of entries) {
            random -= weight;
            if (random <= 0) {
                return strategy;
            }
        }

        return 'balanced'; // Fallback
    }
    
    /**
     * Generate counter strategy based on player army analysis
     * @param {Array} playerPlacements - Player's unit placements
     * @returns {string|null} Counter strategy or null if no clear counter
     */
    getCounterStrategy(playerPlacements) {
        const playerStats = this.analyzePlayerArmy(playerPlacements);
        
        if (playerPlacements.length === 0) {
            return null;
        }
        
        // Store player analysis for learning
        this.playerCounters.set('lastAnalysis', playerStats);
        
        // Tank-heavy counter: Use mages and elemental damage
        if (playerStats.tankHeavy) {
            this.strategies.counter.unitTypePreferences = { mage: 2.5 };
            this.strategies.counter.weights = { 
                elemental: 0.4, 
                damage: 0.4,
                range: 0.2,
                hp: 0.0,
                speed: 0.0,
                armor: 0.0,
                poison: 0.0
            };
            this.strategies.counter.description = 'Countering player tanks with elemental mages';
            return 'counter';
        }
        
        // Archer-heavy counter: Use fast tanks and cavalry
        if (playerStats.archerHeavy) {
            this.strategies.counter.unitTypePreferences = { tank: 2.0, fast: 1.5 };
            this.strategies.counter.weights = { 
                hp: 0.4, 
                armor: 0.3,
                speed: 0.3,
                damage: 0.0,
                range: 0.0,
                elemental: 0.0,
                poison: 0.0
            };
            this.strategies.counter.description = 'Countering player archers with armored units';
            return 'counter';
        }
        
        // Mage-heavy counter: Use fast archers and anti-magic
        if (playerStats.mageHeavy) {
            this.strategies.counter.unitTypePreferences = { archer: 2.0, fast: 1.3 };
            this.strategies.counter.weights = { 
                damage: 0.4, 
                range: 0.3,
                speed: 0.3,
                hp: 0.0,
                armor: 0.0,
                elemental: 0.0,
                poison: 0.0
            };
            this.strategies.counter.description = 'Countering player mages with fast archers';
            return 'counter';
        }
        
        // Elemental-heavy counter: Use physical damage
        if (playerStats.elementalHeavy) {
            this.strategies.counter.unitTypePreferences = { tank: 1.5, archer: 1.5 };
            this.strategies.counter.weights = {
                hp: 0.3,
                damage: 0.4,
                armor: 0.2,
                speed: 0.1,
                range: 0.0,
                elemental: 0.0,
                poison: 0.0
            };
            this.strategies.counter.description = 'Countering elemental units with physical damage';
            return 'counter';
        }
        
        // Balanced army counter: Focus on superior positioning and damage
        this.strategies.counter.unitTypePreferences = { 
            mage: 1.4, 
            archer: 1.3,
            tank: 1.2
        };
        this.strategies.counter.weights = { 
            damage: 0.4,
            hp: 0.2, 
            range: 0.2, 
            speed: 0.1,
            armor: 0.1,
            elemental: 0.0,
            poison: 0.0
        };
        this.strategies.counter.description = 'Countering balanced army with damage focus';
        return 'counter';
    }
    
    /**
     * Analyze player army composition and characteristics
     * @param {Array} playerPlacements - Player's unit placements
     * @returns {Object} Analysis results
     */
    analyzePlayerArmy(playerPlacements) {
        const totalUnits = playerPlacements.reduce((sum, placement) => {
            return sum + (placement.isSquad ? placement.squadUnits.length : 1);
        }, 0);
        
        if (totalUnits === 0) return {};
        
        let tankCount = 0;
        let mageCount = 0;
        let archerCount = 0;
        let fastCount = 0;
        let elementalCount = 0;
        let totalValue = 0;
        let totalHP = 0;
        let totalDamage = 0;
        
        playerPlacements.forEach(placement => {
            // Get unitType from entity using squadUnits
            const unit = placement.squadUnits?.length > 0
                ? this.game.getComponent(placement.squadUnits[0], 'unitType')
                : null;
            if (!unit) return;

            const squadSize = placement.isSquad ? placement.squadUnits.length : 1;

            const category = this.categorizeUnit(unit);
            switch (category) {
                case 'tank': tankCount += squadSize; break;
                case 'archer': archerCount += squadSize; break;
                case 'mage': mageCount += squadSize; break;
                case 'fast': fastCount += squadSize; break;
            }

            if (this.isElementalUnit(unit)) {
                elementalCount += squadSize;
            }

            totalValue += (unit.value || 0) * squadSize;
            totalHP += (unit.hp || 0) * squadSize;
            totalDamage += (unit.damage || 0) * squadSize;
        });
        
        const analysis = {
            totalUnits,
            tankCount,
            mageCount,
            archerCount,
            fastCount,
            elementalCount,
            totalValue,
            averageValue: totalValue / totalUnits,
            averageHP: totalHP / totalUnits,
            averageDamage: totalDamage / totalUnits,
            
            // Composition flags
            tankHeavy: tankCount / totalUnits > 0.5,
            mageHeavy: mageCount / totalUnits > 0.5,
            archerHeavy: archerCount / totalUnits > 0.5,
            fastHeavy: fastCount / totalUnits > 0.4,
            elementalHeavy: elementalCount / totalUnits > 0.6,
            balanced: Math.max(tankCount, mageCount, archerCount) / totalUnits < 0.6,
            
            // Army characteristics
            highValue: totalValue / totalUnits > 100,
            tanky: totalHP / totalUnits > 150,
            glassCannon: totalDamage / totalHP > 0.5
        };
        
        return analysis;
    }
    
    /**
     * Categorize a unit based on its properties
     * @param {Object} unit - Unit definition
     * @returns {string} Unit category
     */
    categorizeUnit(unit) {
        const id = (unit.id || '').toLowerCase();
        const title = (unit.title || '').toLowerCase();
        
        // Check ID patterns first
        for (const [category, pattern] of Object.entries(this.unitPatterns)) {
            if (pattern.idPatterns.some(p => id.includes(p))) {
                return category;
            }
        }
        
        // Check stat requirements
        if (this.unitPatterns.tank.statRequirements.hp <= (unit.hp || 0) &&
            this.unitPatterns.tank.statRequirements.armor <= (unit.armor || 0)) {
            return 'tank';
        }
        
        if (this.unitPatterns.archer.statRequirements.range <= (unit.range || 0)) {
            return 'archer';
        }
        
        if (this.unitPatterns.fast.statRequirements.speed <= (unit.speed || 0)) {
            return 'fast';
        }
        
        // Check for elemental units (mages)
        if (this.isElementalUnit(unit)) {
            return 'mage';
        }
        
        // Check title/name tags
        for (const [category, pattern] of Object.entries(this.unitPatterns)) {
            if (pattern.tags && pattern.tags.some(tag => title.includes(tag))) {
                return category;
            }
        }
        
        // Default categorization based on primary stats
        if (unit.range > 30) return 'ranged';
        if (unit.speed > 50) return 'fast';
        if (unit.hp > 120) return 'tank';
        
        return 'melee';
    }
    
    /**
     * Check if a unit uses elemental damage
     * @param {Object} unit - Unit definition
     * @returns {boolean} True if unit is elemental
     */
    isElementalUnit(unit) {
        const element = (unit.element || 'physical').toLowerCase();
        return element !== 'physical' && element !== '';
    }
    
    /**
     * Calculate unit efficiency score based on strategy weights
     * @param {Object} unit - Unit definition
     * @param {Object} strategyConfig - Strategy configuration
     * @returns {number} Efficiency score
     */
    calculateUnitScore(unit, strategyConfig) {
        let score = this.calculateEfficiency(unit, strategyConfig.weights);
        
        // Apply unit type preferences
        if (strategyConfig.unitTypePreferences) {
            const unitCategory = this.categorizeUnit(unit);
            const multiplier = strategyConfig.unitTypePreferences[unitCategory] || 1.0;
            score *= multiplier;
        }
        
        // Apply strategy-specific bonuses
        score *= this.getStrategyBonus(unit, strategyConfig);
        
        return score;
    }
    
    /**
     * Calculate base unit efficiency using weighted stats
     * @param {Object} unit - Unit definition
     * @param {Object} weights - Stat weights
     * @returns {number} Base efficiency score
     */
    calculateEfficiency(unit, weights) {
        const hp = unit.hp || 100;
        const damage = unit.damage || 10;
        const range = unit.range || 1;
        const speed = unit.speed || 1;
        const armor = unit.armor || 0;
        const element = (unit.element || 'physical');        
        const poison = element === 'poison' ? 1 : 0;
        const physical = element === 'physical' ? 1 : 0;
        const elemental = (physical + poison === 0) ? 1 : 0;

        let combatValue = (hp * (weights.hp || 0)) + 
                         (damage * (weights.damage || 0)) + 
                         (range * (weights.range || 0)) + 
                         (speed * (weights.speed || 0)) + 
                         (armor * (weights.armor || 0)) + 
                         (elemental * (weights.elemental || 0)) + 
                         (poison * (weights.poison || 0));
        
        return combatValue / (unit.value || 1);
    }
    
    /**
     * Apply strategy-specific bonuses to unit score
     * @param {Object} unit - Unit definition
     * @param {Object} strategyConfig - Strategy configuration
     * @returns {number} Bonus multiplier
     */
    getStrategyBonus(unit, strategyConfig) {
        let bonus = 1.0;
        
        // Elemental strategy bonuses
        if (strategyConfig.name === 'Elemental Mastery' && this.isElementalUnit(unit)) {
            bonus *= 1.3;
        }
        
        // Defensive strategy bonuses
        if (strategyConfig.name === 'Fortress Defense' && (unit.hp || 0) > 150) {
            bonus *= 1.2;
        }
        
        // Aggressive strategy bonuses
        if (strategyConfig.name === 'All-Out Attack' && (unit.damage || 0) > 30) {
            bonus *= 1.2;
        }
        
        return bonus;
    }
    
    /**
     * Get current strategy information
     * @returns {Object} Strategy information
     */
    getCurrentStrategyInfo() {
        const strategy = this.strategies[this.current];
        return {
            current: this.current,
            name: strategy?.name || 'Unknown',
            description: strategy?.description || 'No description',
            weights: strategy?.weights || {},
            preferences: strategy?.unitTypePreferences || {},
            history: this.history.slice(-5)
        };
    }
    
    /**
     * Update strategy history
     * @param {number} round - Round number
     * @param {string} strategy - Strategy used
     * @param {Object} results - Battle results (optional)
     */
    updateHistory(round, strategy, results = {}) {
        this.current = strategy;
        this.history.push({
            round,
            strategy,
            timestamp: Date.now(),
            results
        });
        
        // Keep history manageable
        if (this.history.length > 10) {
            this.history.shift();
        }
    }
    
    /**
     * Reset strategy state
     */
    reset() {
        this.current = null;
        this.history = [];
        this.playerCounters.clear();
    }
    
    /**
     * Get strategy effectiveness analysis
     * @returns {Object} Effectiveness data
     */
    getEffectivenessAnalysis() {
        const strategyResults = new Map();
        
        this.history.forEach(entry => {
            if (!strategyResults.has(entry.strategy)) {
                strategyResults.set(entry.strategy, {
                    uses: 0,
                    wins: 0,
                    effectiveness: 0
                });
            }
            
            const data = strategyResults.get(entry.strategy);
            data.uses++;
            
            if (entry.results?.victory) {
                data.wins++;
            }
            
            data.effectiveness = data.wins / data.uses;
        });
        
        return Object.fromEntries(strategyResults);
    }
}