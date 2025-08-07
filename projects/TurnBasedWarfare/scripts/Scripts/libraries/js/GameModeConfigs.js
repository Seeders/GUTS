class GameModeConfigs {
    static getDefaultConfigs() {
        return {
            campaign: {
                name: 'Campaign',
                rounds: 10,
                goldProgression: (round) => 100 + (round * 50),
                enemyScaling: (round) => Math.floor(1 + round * 0.5),
                specialRules: ['story_mode', 'progressive_unlock']
            },
            
            survival: {
                name: 'Survival',
                rounds: Infinity,
                goldProgression: (round) => Math.max(50, 150 - (round * 5)),
                enemyScaling: (round) => Math.floor(1 + Math.pow(round, 1.2)),
                specialRules: ['limited_gold', 'exponential_enemies']
            },
            
            arena: {
                name: 'Arena',
                rounds: 1,
                goldProgression: () => 200,
                enemyScaling: () => 3,
                specialRules: ['balanced_armies', 'quick_battle']
            },
            
            challenge: {
                name: 'Challenge',
                rounds: 1,
                goldProgression: (challenge) => challenge.startingGold || 100,
                enemyScaling: (challenge) => challenge.enemyCount || 3,
                specialRules: ['preset_enemies', 'special_constraints']
            },
            
            endless: {
                name: 'Endless',
                rounds: Infinity,
                goldProgression: (round) => 100 + (round * 25),
                enemyScaling: (round) => Math.floor(1 + Math.pow(round, 1.5)),
                specialRules: ['infinite_scaling', 'leaderboards']
            },
            
            tournament: {
                name: 'Tournament',
                rounds: 8,
                goldProgression: (round) => 120 + (round * 30),
                enemyScaling: (round) => 2 + Math.floor(round / 2),
                specialRules: ['bracket_progression', 'ai_personalities']
            }
        };
    }

    static applyModeRules(gameInstance, mode, round) {
        const config = this.getDefaultConfigs()[mode];
        if (!config) return;

        // Apply gold progression
        if (gameInstance.state) {
            gameInstance.state.playerGold = config.goldProgression(round);
        }

        // Apply special rules
        config.specialRules.forEach(rule => {
            this.applySpecialRule(gameInstance, rule, round);
        });
    }

    static applySpecialRule(gameInstance, rule, round) {
        switch (rule) {
            case 'limited_gold':
                // Reduce gold income over time in survival
                break;
                
            case 'exponential_enemies':
                // Increase enemy difficulty exponentially
                break;
                
            case 'balanced_armies':
                // Ensure fair army compositions
                break;
                
            case 'infinite_scaling':
                // Allow unlimited round progression
                break;
                
            default:
                console.log(`Applying special rule: ${rule}`);
        }
    }
}