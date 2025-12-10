class PhalanxFormationAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'phalanx_formation',
            name: 'Phalanx Formation',
            description: 'Link with nearby Hoplites - more Hoplites = stronger formation bonus',
            cooldown: 2.0,
            range: 80,
            manaCost: 0,
            targetType: 'allies',
            animation: 'cast',
            priority: 7,
            castTime: 1.2,
            ...params
        });
        
        this.formationDuration = 25.0;
        this.baseArmorMultiplier = 1.15; // 15% base armor bonus
        this.perHopliteBonus = 0.15;     // Additional 15% per hoplite
        this.maxArmorMultiplier = 2.0;   // Cap at 200%
        this.baseCounterChance = 0.2;    // 20% base counter attack chance
        this.perHopliteCounterBonus = 0.05; // +5% per hoplite
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x4169E1,
                    colorRange: { start: 0x4169E1, end: 0xB0C4DE },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            formation: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x6495ED,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.8
                }
            },
            phalanx: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x87CEEB,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.2
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if caster already has a phalanx buff to prevent re-casting
        const existingBuff = this.game.getComponent(casterEntity, "buff");
        if (existingBuff && existingBuff.buffType === 'phalanx') return false;
        
        // Must have at least one nearby hoplite ally (not counting self)
        const nearbyHoplites = this.getNearbyHoplites(casterEntity);
        return nearbyHoplites.length > 0;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        const casterUnitType = this.game.getComponent(casterEntity, "unitType");
        
        if (!casterPos || !casterUnitType) return null;
        
        const nearbyHoplites = this.getNearbyHoplites(casterEntity);
        if (nearbyHoplites.length === 0) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, 
            `Hoplite begins forming phalanx with ${nearbyHoplites.length} allies...`);
        
        // Schedule the formation creation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createPhalanxFormation(casterEntity, nearbyHoplites);
        }, this.castTime, casterEntity);
    }
    
    createPhalanxFormation(casterEntity, nearbyHoplites) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // Sort hoplites deterministically for consistent processing
        const sortedHoplites = nearbyHoplites.slice().sort((a, b) => a - b);
        
        const phalanxSize = sortedHoplites.length + 1; // Include caster
        const armorMultiplier = Math.min(
            this.baseArmorMultiplier + (phalanxSize * this.perHopliteBonus), 
            this.maxArmorMultiplier
        );
        const counterAttackChance = this.baseCounterChance + (phalanxSize * this.perHopliteCounterBonus);
        
        // Create formation effect at caster position
        this.createVisualEffect(casterPos, 'formation');
        
        // Apply formation buff to all Hoplites in range (including caster)
        const allHoplites = [casterEntity, ...sortedHoplites];
        let formationSuccess = 0;
        
        // Process hoplites in deterministic order
        allHoplites.forEach((hopliteId, index) => {
            // Validate hoplite still exists and is a hoplite
            const unitType = this.game.getComponent(hopliteId, "unitType");
            const transform = this.game.getComponent(hopliteId, "transform");
            const position = transform?.position;
            
            if (!unitType || !position || unitType.id !== 'hoplite') return;
            
            // Apply phalanx buff
            const currentTime = this.game.state.now || this.game.state.now || 0;
            const endTime = currentTime + this.formationDuration;

            this.game.addComponent(hopliteId, "buff", {
                buffType: 'phalanx',
                modifiers: {
                    armorMultiplier: armorMultiplier,
                    counterAttackChance: counterAttackChance,
                    formationSize: phalanxSize,
                    formationLeader: casterEntity,
                    formationRole: (hopliteId === casterEntity) ? 'leader' : 'member'
                },
                endTime: endTime,
                stackable: false,
                stacks: 1,
                appliedTime: currentTime,
                isActive: true
            });
            
            // Create phalanx effect on each member
            this.createVisualEffect(position, 'phalanx');
            
            // Schedule a delayed formation link effect for visual appeal
            this.game.schedulingSystem.scheduleAction(() => {
                const transform = this.game.getComponent(hopliteId, "transform");
                const pos = transform?.position;
                if (pos) {
                    this.createVisualEffect(pos, 'formation', { 
                        count: 3, 
                        scaleMultiplier: 1.0 
                    });
                }
            }, index * 0.2, hopliteId); // Staggered visual effects
            
            formationSuccess++;
        });
        
        // Screen effects for dramatic formation
        if (this.game.effectsSystem && formationSuccess > 0) {
            this.game.effectsSystem.playScreenFlash('#4169E1', 0.4);
        }
    
      
        
        // Schedule formation expiration warning
        this.game.schedulingSystem.scheduleAction(() => {
            this.warnFormationEnding(allHoplites);
        }, this.formationDuration - 2.0, casterEntity);
    }
    
    // FIXED: Deterministic nearby hoplite detection
    getNearbyHoplites(casterEntity) {
        const allAllies = this.getAlliesInRange(casterEntity);
        
        // Filter and sort hoplites deterministically
        const hoplites = allAllies.filter(allyId => {
            if (allyId === casterEntity) return false; // Exclude self
            
            const unitType = this.game.getComponent(allyId, "unitType");
            return unitType && unitType.id === 'hoplite';
        });
        
        // Sort deterministically for consistent processing
        return hoplites.sort((a, b) => a - b);
    }
    
    // FIXED: Formation ending warning
    warnFormationEnding(hopliteIds) {
        let activeFormationMembers = 0;
        
        hopliteIds.forEach(hopliteId => {
            // Check if hoplite still exists and has the phalanx buff
            const buff = this.game.getComponent(hopliteId, "buff");
            const transform = this.game.getComponent(hopliteId, "transform");
            const position = transform?.position;
            
            if (!buff || buff.buffType !== 'phalanx' || !position) return;
            
            // Create warning effect
            this.createVisualEffect(position, 'cast', { 
                count: 3, 
                color: 0x4169E1,
                scaleMultiplier: 0.8 
            });
            
            activeFormationMembers++;
        });
       
    }
}