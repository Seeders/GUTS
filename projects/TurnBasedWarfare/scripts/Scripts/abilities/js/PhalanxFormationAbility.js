class PhalanxFormationAbility extends engine.app.appClasses['BaseAbility'] {
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
                    count: 8,
                    color: 0x4169E1,
                    colorRange: { start: 0x4169E1, end: 0xB0C4DE },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            formation: {
                type: 'magic',
                options: {
                    count: 12,
                    color: 0x6495ED,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.8
                }
            },
            phalanx: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0x87CEEB,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.2
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if caster already has a phalanx buff to prevent re-casting
        const existingBuff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
        if (existingBuff && existingBuff.buffType === 'phalanx') return false;
        
        // Must have at least one nearby hoplite ally (not counting self)
        const nearbyHoplites = this.getNearbyHoplites(casterEntity);
        return nearbyHoplites.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterUnitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
        
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
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Sort hoplites deterministically for consistent processing
        const sortedHoplites = nearbyHoplites.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
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
            const unitType = this.game.getComponent(hopliteId, this.componentTypes.UNIT_TYPE);
            const position = this.game.getComponent(hopliteId, this.componentTypes.POSITION);
            
            if (!unitType || !position || unitType.id !== 'hoplite') return;
            
            // Apply phalanx buff
            const Components = this.game.componentManager.getComponents();
            const currentTime = this.game.state?.simTime || this.game.currentTime || 0;
            const endTime = currentTime + this.formationDuration;
            
            this.game.addComponent(hopliteId, this.componentTypes.BUFF, 
                Components.Buff(
                    'phalanx', 
                    { 
                        armorMultiplier: armorMultiplier,
                        counterAttackChance: counterAttackChance,
                        formationSize: phalanxSize,
                        formationLeader: casterEntity,
                        formationRole: (hopliteId === casterEntity) ? 'leader' : 'member'
                    }, 
                    endTime,     // Proper end time
                    false,       // Not stackable
                    1,           // Single stack  
                    currentTime  // Applied time
                )
            );
            
            // Create phalanx effect on each member
            this.createVisualEffect(position, 'phalanx');
            
            // Schedule a delayed formation link effect for visual appeal
            this.game.schedulingSystem.scheduleAction(() => {
                const pos = this.game.getComponent(hopliteId, this.componentTypes.POSITION);
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
            this.game.effectsSystem.playScreenFlash('#4169E1', 400);
        }
        
        // Enhanced logging
        this.logAbilityUsage(casterEntity, 
            `Phalanx formation complete! ${formationSuccess} Hoplites gain ${Math.round((armorMultiplier - 1) * 100)}% armor bonus!`);
            
        // Battle log integration
        if (this.game.battleLogSystem && formationSuccess > 0) {
            const casterUnitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (casterUnitType && casterTeam) {
                this.game.battleLogSystem.add(
                    `${casterTeam.team} Hoplites form a mighty phalanx formation! (${formationSuccess} warriors)`,
                    'log-formation'
                );
            }
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
            
            const unitType = this.game.getComponent(allyId, this.componentTypes.UNIT_TYPE);
            return unitType && unitType.id === 'hoplite';
        });
        
        // Sort deterministically for consistent processing
        return hoplites.sort((a, b) => String(a).localeCompare(String(b)));
    }
    
    // FIXED: Formation ending warning
    warnFormationEnding(hopliteIds) {
        let activeFormationMembers = 0;
        
        hopliteIds.forEach(hopliteId => {
            // Check if hoplite still exists and has the phalanx buff
            const buff = this.game.getComponent(hopliteId, this.componentTypes.BUFF);
            const position = this.game.getComponent(hopliteId, this.componentTypes.POSITION);
            
            if (!buff || buff.buffType !== 'phalanx' || !position) return;
            
            // Create warning effect
            this.createVisualEffect(position, 'cast', { 
                count: 3, 
                color: 0x4169E1,
                scaleMultiplier: 0.8 
            });
            
            activeFormationMembers++;
        });
        
        if (this.game.battleLogSystem && activeFormationMembers > 0) {
            this.game.battleLogSystem.add(
                `The phalanx formation begins to weaken...`,
                'log-formation'
            );
        }
    }
}