// Explosive trap trigger - activates when enemy steps on explosiveTrap building
// Deals AoE fire damage with falloff
class ExplosiveTrapTrigger extends GUTS.BaseTrapTriggerAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Explosive Trap Trigger',
            description: 'Explodes when enemies approach, dealing AoE fire damage',
            trapDamage: 80,
            stunDuration: 0,
            isExplosive: true,
            explosionRadius: 100,
            element: 'fire',
            trapMessage: 'Explosive trap detonates!',
            ...abilityData
        });
    }
}
