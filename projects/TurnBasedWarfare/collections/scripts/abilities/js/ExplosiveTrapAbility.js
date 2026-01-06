// Explosive trap placement ability for Trapper units
class ExplosiveTrapAbility extends GUTS.BaseTrapPlacementAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Explosive Trap',
            description: 'Place a hidden trap that explodes when enemies approach (max 2)',
            maxTraps: 2,
            trapComponentName: 'explosiveTrap',
            placementMessage: 'Trapper sets an explosive trap!',
            ...abilityData
        });
    }
}
