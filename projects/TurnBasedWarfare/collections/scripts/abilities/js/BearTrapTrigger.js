// Bear trap trigger - activates when enemy steps on bearTrap building
// Deals single target damage + stun
class BearTrapTrigger extends GUTS.BaseTrapTriggerAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Bear Trap Trigger',
            description: 'Snaps shut on nearby enemies, dealing damage and stunning them',
            trapDamage: 50,
            stunDuration: 3.0,
            isExplosive: false,
            element: 'physical',
            trapMessage: 'Bear trap snaps shut!',
            ...abilityData
        });
    }
}
