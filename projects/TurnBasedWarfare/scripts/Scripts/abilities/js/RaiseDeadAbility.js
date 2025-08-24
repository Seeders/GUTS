class RaiseDeadAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'raise_dead',
            name: 'Raise Dead',
            description: 'Convert corpses into skeleton warriors',
            cooldown: 1.0,
            range: 150,
            manaCost: 0,
            targetType: 'auto',
            animation: 'cast',
            priority: 1,
            castTime: 1.0,
            autoTrigger: 'corpses_available',
            ...params
        });
        
        this.maxCorpsesToRaise = 4;
        this.raisedUnitType = '0_skeleton';
    }
    
    canExecute(casterEntity) {
        if (!this.game.deathSystem) return false;
        
        const casterPos = this.game.getComponent(casterEntity, this.game.componentManager.getComponentTypes().POSITION);
        if (!casterPos) return false;
        
        const nearbyCorpses = this.game.deathSystem.getCorpsesInRange(casterPos, this.range);
        // Filter out corpses that are already the raised unit type (prevent re-raising skeletons)
        const validCorpses = nearbyCorpses.filter(corpseData => {
            return corpseData.corpse.originalUnitType.id !== this.raisedUnitType;
        });
        
        return validCorpses.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.game.componentManager.getComponentTypes().POSITION);
        const casterTeam = this.game.getComponent(casterEntity, this.game.componentManager.getComponentTypes().TEAM);
        
        if (!this.game.deathSystem || !casterPos || !casterTeam) return;
        
        const nearbyCorpses = this.game.deathSystem.getCorpsesInRange(casterPos, this.range);
        if (nearbyCorpses.length === 0) return;
        
        // Filter out corpses that are already the raised unit type (prevent re-raising skeletons)
        const validCorpses = nearbyCorpses.filter(corpseData => {
            return corpseData.corpse.originalUnitType.id !== this.raisedUnitType;
        });
        
        if (validCorpses.length === 0) return;
        
        const collections = this.game.getCollections();
        if (!collections?.units?.[this.raisedUnitType]) {
            console.warn(`${this.raisedUnitType} unit type not found`);
            return;
        }
        
        const skeletonDef = collections.units[this.raisedUnitType];
        const corpsesToRaise = validCorpses.slice(0, this.maxCorpsesToRaise);
        let raisedCount = 0;
        
        corpsesToRaise.forEach(corpseData => {
            const consumedCorpse = this.game.deathSystem.consumeCorpse(corpseData.entityId);
            if (!consumedCorpse) return;
            
            const skeletonId = this.createSkeletonFromCorpse(corpseData.position, skeletonDef, casterTeam.team);
            if (skeletonId) {
                raisedCount++;
                this.createVisualEffect(corpseData.position, 'raise_dead');
                this.logCorpseRaising(consumedCorpse, casterTeam.team);
            }
        });
        
        if (raisedCount > 0) {
            this.logAbilityUsage(casterEntity, 
                `Necromancy raises ${raisedCount} skeleton${raisedCount > 1 ? 's' : ''} from the dead!`);
        }
    }
    
    createSkeletonFromCorpse(corpsePos, skeletonDef, team) {
        const skeletonId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        const componentTypes = this.game.componentManager.getComponentTypes();
        
        const initialFacing = team === 'player' ? 0 : Math.PI;
        
        this.game.addComponent(skeletonId, componentTypes.POSITION, 
            components.Position(corpsePos.x, corpsePos.y, corpsePos.z));
        this.game.addComponent(skeletonId, componentTypes.VELOCITY, 
            components.Velocity(0, 0, 0, (skeletonDef.speed || 1) * 20));
        this.game.addComponent(skeletonId, componentTypes.RENDERABLE, 
            components.Renderable("units", this.raisedUnitType));
        this.game.addComponent(skeletonId, componentTypes.COLLISION, 
            components.Collision(skeletonDef.size || 25));
        this.game.addComponent(skeletonId, componentTypes.HEALTH, 
            components.Health(skeletonDef.hp || 50));
        this.game.addComponent(skeletonId, componentTypes.COMBAT, 
            components.Combat(
                skeletonDef.damage || 15, skeletonDef.range || 25, skeletonDef.attackSpeed || 1.0,
                skeletonDef.projectile || null, 0, skeletonDef.element || 'physical',
                skeletonDef.armor || 0, skeletonDef.fireResistance || 0,
                skeletonDef.coldResistance || 0, skeletonDef.lightningResistance || 0
            ));
        this.game.addComponent(skeletonId, componentTypes.TEAM, components.Team(team));
        this.game.addComponent(skeletonId, componentTypes.UNIT_TYPE, 
            components.UnitType(this.raisedUnitType, skeletonDef.title || "Skeleton", skeletonDef.value || 25));
        this.game.addComponent(skeletonId, componentTypes.AI_STATE, components.AIState('idle'));
        this.game.addComponent(skeletonId, componentTypes.ANIMATION, components.Animation());
        this.game.addComponent(skeletonId, componentTypes.FACING, components.Facing(initialFacing));
        this.game.addComponent(skeletonId, componentTypes.EQUIPMENT, components.Equipment());
        
        return skeletonId;
    }
    
    logCorpseRaising(corpse, team) {
        if (this.game.battleLogSystem) {
            const originalTeam = corpse.teamAtDeath || 'unknown';
            this.game.battleLogSystem.add(
                `A ${originalTeam} corpse rises as a ${team} skeleton!`,
                'log-ability'
            );
        }
    }
}