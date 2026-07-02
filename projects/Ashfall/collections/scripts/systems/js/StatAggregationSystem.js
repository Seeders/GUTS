import BaseStatAggregationSystem from '../../../../../../global/collections/scripts/systems/js/StatAggregationSystem.js';

/**
 * StatAggregationSystem for Ashfall
 *
 * Adds the ARPG modifier sources on top of the base pipeline
 * (unit passives, player upgrades, buffs):
 * - Character attributes: STR → melee, DEX → ranged, INT → spell (1% increased per point)
 * - Equipment affixes (ItemSystem collects percent modifiers from equipped items)
 * - Skill tree passives (SkillTreeSystem)
 */
class StatAggregationSystem extends BaseStatAggregationSystem {
    collectAllModifiers(entityId) {
        const modifiers = super.collectAllModifiers(entityId);
        this.collectAttributeModifiers(entityId, modifiers);
        this.collectArpgEquipmentModifiers(entityId, modifiers);
        this.collectSkillTreeModifiers(entityId, modifiers);
        return modifiers;
    }

    collectAttributeModifiers(entityId, modifiers) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet?.attributes) return;

        const { strength, dexterity, intelligence } = sheet.attributes;
        if (strength > 0) {
            modifiers.increased.push({ tags: ['melee'], value: strength * 0.01 });
        }
        if (dexterity > 0) {
            modifiers.increased.push({ tags: ['ranged'], value: dexterity * 0.01 });
        }
        if (intelligence > 0) {
            modifiers.increased.push({ tags: ['spell'], value: intelligence * 0.01 });
        }
    }

    collectArpgEquipmentModifiers(entityId, modifiers) {
        // ItemSystem exposes percent damage modifiers from equipped item affixes
        const itemSystem = this.game.itemSystem;
        if (itemSystem?.collectDamageModifiers) {
            itemSystem.collectDamageModifiers(entityId, modifiers);
        }
    }

    collectSkillTreeModifiers(entityId, modifiers) {
        const skillTreeSystem = this.game.skillTreeSystem;
        if (skillTreeSystem?.collectDamageModifiers) {
            skillTreeSystem.collectDamageModifiers(entityId, modifiers);
        }
    }
}

export default StatAggregationSystem;
export { StatAggregationSystem };
