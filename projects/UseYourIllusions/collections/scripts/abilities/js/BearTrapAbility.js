// Bear trap placement ability for Scout units
class BearTrapAbility extends GUTS.BaseTrapPlacementAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Bear Trap',
            description: 'Place a hidden trap that snares enemies',
            maxTraps: 2,
            trapComponentName: 'trap',
            placementMessage: 'Scout sets a bear trap!',
            ...abilityData
        });
    }
}
