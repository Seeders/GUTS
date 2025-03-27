
/**
 * Example usage:
 * 
 * // Define an attack
 * const fireballAttack = {
 *   baseDamage: 50,
 *   damageType: "fire",
 *   isCritical: false
 * };
 * 
 * // Define a target
 * const enemyUnit = {
 *   armor: 25,
 *   shield: 30,
 *   evasion: 15,
 *   resistances: {
 *     fire: 20,
 *     ice: -10,
 *     physical: 0
 *   }
 * };
 * 
 * // Calculate damage
 * const damageResult = calculateDamage(fireballAttack, enemyUnit);

 */

function calculateDamage(attack, target) {
    // Set default values if not provided
    
    attack.speed = attack.speed || 5;     
    attack.piercing = attack.piercing || 0,
    attack.splashRadius = attack.splashRadius || 0;
    attack.critChance = attack.critChance || .05;
    attack.critMultiplier = attack.critMultiplier || 2;
    attack.penetration = {
      "fire": attack.firePenetration || 0,
      "electric": attack.electricPenetration || 0,
      "cold": attack.coldPenetration || 0,
      "physical": attack.physicalPenetration || 0,
      "toxic": attack.toxicPenetration || 0,
    }
    target.resistances = {
      "fire": target.fireResistance || 0,
      "electric": target.electricResistance || 0,
      "cold": target.coldResistance || 0,
      "physical": target.physicalResistance || 0,
      "toxic": target.toxicResistance || 0,
    }
    
    // Initialize result object
    const result = {
      damageBlocked: 0,
      damageAbsorbed: 0,
      damageDealt: 0,
      energyShieldRemaining: target.energyShield || 0,
      wasEvaded: false,
      wasCritical: Math.random() <= attack.critChance,
      hitDetails: {}
    };
    
    // Check for evasion
    if (target.evasion && target.evasion > 0) {
      const evasionRoll = Math.random() * 100;
      if (evasionRoll < target.evasion) {
        result.wasEvaded = true;
        result.hitDetails.evasion = "Attack evaded";
        return result;
      }
    }
    
    // Calculate initial damage
    let damage = attack.baseDamage;
    
    // Apply critical hit
    if (result.wasCritical) {
      damage *= attack.critMultiplier;
      result.hitDetails.critical = `Critical hit (${attack.critMultiplier}x damage)`;
    }
    
    // Apply resistances based on damage type
  
    if(attack.damageType != "physical") {
      const resistance = target.resistances[attack.damageType] || 0;
      const penetration = attack.penetration[attack.damageType] || 0;
      const finalResist = resistance - penetration;
      let resistanceMultiplier = 1 - (finalResist / 100);
      damage *= resistanceMultiplier;
  
      
      if (finalResist !== 0) {
        if (finalResist > 0) {
          result.hitDetails.resistance = `${attack.damageType} resisted (${finalResist}%)`;
        } else {
          result.hitDetails.resistance = `${attack.damageType} vulnerability (${-finalResist}%)`;
        }
      }  
    }
    
    // Apply armor (only affects physical damage)
    if (attack.damageType === "physical" && target.armor > 0) {
      let effectiveArmor = target.armor;
      if (attack.penetration.physical > 0 ) {
        // Piercing ignores 75% of armor
        effectiveArmor = target.armor * (1 - attack.penetration.physical);
      }
      // Armor formula: damage reduction percentage = armor / (armor + 100)
      const armorReduction = effectiveArmor / (effectiveArmor + 100);
      const blockedDamage = damage * armorReduction;
      
      damage -= blockedDamage;
      result.damageBlocked = blockedDamage;
      result.hitDetails.armor = `Armor blocked ${blockedDamage.toFixed(1)} damage`;
    }
    
    // Round damage to 1 decimal place for cleaner numbers
    damage = Math.round(damage * 10) / 10;
    
    // Apply shield absorption
    if (target.energyShield > 0) {
      if (damage <= target.energyShield) {
        // Shield absorbs all damage
        result.damageAbsorbed = damage;
        result.energyShieldRemaining = target.energyShield - damage;
        result.hitDetails.energyShield = `Shield absorbed all damage, ${result.energyShieldRemaining.toFixed(1)} shield remaining`;
        damage = 0;
      } else {
        // Shield is depleted, remaining damage goes through
        result.damageAbsorbed = target.energyShield;
        result.damageDealt = damage - target.energyShield;
        result.energyShieldRemaining = 0;
        result.hitDetails.energyShield = `Shield depleted, ${result.damageDealt.toFixed(1)} damage dealt to health`;
        damage -= target.energyShield;
      }
    } else {
      // No shield, all damage goes to health
      result.damageDealt = damage;
    }
    
    // Make sure we don't return negative damage
    result.damageDealt = Math.max(0, result.damageDealt);
    
    return result;
  }

  export { calculateDamage };