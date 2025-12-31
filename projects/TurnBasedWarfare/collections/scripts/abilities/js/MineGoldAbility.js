class MineGoldAbility extends GUTS.BaseAbility {
    constructor(game, abilityData) {
        super(game, abilityData);
        this.name = 'Mine Gold';
        this.description = 'Automatically mines gold from gold mines';
        this.isPassive = true;
        this.autocast = true;
        this.enabled = true;
        this.castTime = 0;
        this.cooldown = 0;
        this.priority = 0;
        
        this.goldPerTrip = 10;
        this.miningRange = 25;
        this.depositRange = 25;
        this.miningDuration = 2;
        this.depositDuration = 1;
        this.waitingDistance = 30; // Distance to wait from mine when queued
    }

}
