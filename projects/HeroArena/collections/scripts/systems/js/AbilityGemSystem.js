// Applies Rune behavioral modifiers to ability instances at battle time.
// Runes are socketed inside Gems; each Gem sits in one of a hero's ability slots.
//
// Stat affixes on Gems and Runes are handled by HeroStatSystem (via the normal
// affixes[] pipeline). This system handles modifiers that change how abilities
// BEHAVE: cooldownReduction, rangeBonus, aoeRadius, chainCount, projectileCount.
//
// Modifications are applied once per (entity, ability.id) pair per battle and
// persist on the ability instance for the duration — safe because hero entities
// despawn at battle end and get fresh instances each round.
class AbilityGemSystem extends GUTS.BaseSystem {

    static services = [
        'applyGemBehavior'
    ];

    constructor(game) {
        super(game);
        this.game.abilityGemSystem = this;
        // Tracks (entityId + "_" + ability.id) pairs modified this battle
        this._appliedAbilities = new Set();
    }

    // Called by AbilitySystem just before ability.execute() on any entity that has
    // a heroEquipment component. Aggregates all rune modifiers across ALL of the
    // hero's ability slots and applies them to every ability instance (once each).
    applyGemBehavior(entityId, ability) {
        const key = `${entityId}_${ability.id}`;
        if (this._appliedAbilities.has(key)) return;
        this._appliedAbilities.add(key);

        const heroEquipment = this.game.getComponent(entityId, 'heroEquipment');
        if (!heroEquipment?.abilitySlots) return;

        // Aggregate modifiers from every rune socketed across all gems.
        // Multiple runes of the same kind stack additively (cooldownReduction multiplies).
        const combined = {};
        for (const gem of heroEquipment.abilitySlots) {
            if (!gem) continue;
            for (const rune of (gem.runes || [])) {
                if (!rune?.modifiers) continue;
                for (const [mod, value] of Object.entries(rune.modifiers)) {
                    switch (mod) {
                        case 'cooldownReduction':
                            // Multiplicative stacking: 0.75 × 0.75 = 0.5625
                            combined.cooldownReduction = (combined.cooldownReduction ?? 1) * value;
                            break;
                        case 'rangeBonus':
                            combined.rangeBonus = (combined.rangeBonus ?? 0) + value;
                            break;
                        case 'aoeRadius':
                            // Take the largest single aoeRadius modifier
                            combined.aoeRadius = Math.max(combined.aoeRadius ?? 0, value);
                            break;
                        case 'chainCount':
                            combined.chainCount = (combined.chainCount ?? 0) + value;
                            break;
                        case 'projectileCount':
                            // Each rune adds (value − 1) extra projectiles on top of base
                            combined.projectileCount = (combined.projectileCount ?? 1) + (value - 1);
                            break;
                    }
                }
            }
        }

        // Apply aggregated modifiers to the ability instance
        if (combined.cooldownReduction != null) {
            ability.cooldown = Math.round(ability.cooldown * combined.cooldownReduction);
        }
        if (combined.rangeBonus != null) {
            ability.range = (ability.range ?? 0) + combined.rangeBonus;
        }
        if (combined.aoeRadius != null) {
            ability.aoeRadius = combined.aoeRadius;
        }
        if (combined.chainCount != null) {
            ability.chainCount = (ability.chainCount ?? 0) + combined.chainCount;
        }
        if (combined.projectileCount != null) {
            ability.projectileCount = combined.projectileCount;
        }
    }

    // Clear per-battle tracking at the start of each battle so freshly spawned
    // hero entities get rune mods applied to their fresh ability instances.
    onBattlePhaseStart() {
        this._appliedAbilities.clear();
    }
}
