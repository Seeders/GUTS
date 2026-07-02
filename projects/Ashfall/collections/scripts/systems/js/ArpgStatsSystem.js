/**
 * ArpgStatsSystem - Character attributes, experience, leveling, derived stats.
 *
 * D2-style progression:
 * - Attributes: Strength, Dexterity, Intelligence, Vitality
 * - 5 attribute points + 1 skill point per level
 * - XP from every enemy killed in the zone (single-player: all kills are yours)
 * - Derived stats recomputed from class definition + attributes
 *   (equipment and skill tree bonuses hook in via ItemSystem / SkillTreeSystem)
 *
 * Attribute effects:
 * - STR: +1% increased melee damage per point (via StatAggregationSystem)
 * - DEX: +1% increased ranged damage per point, +1 accuracy, +0.25 evasion per point
 * - INT: +1% increased spell damage per point, +max mana / regen per class formula
 * - VIT: +life per class formula, +0.05 life regen per point
 */
class ArpgStatsSystem extends GUTS.BaseSystem {
    static services = [
        'getCharacterSheet',
        'awardExperience',
        'allocateAttribute',
        'recomputeDerivedStats',
        'getEquipmentStatBonuses',
        'getEffectiveAttributes'
    ];

    static serviceDependencies = [
        'getPlayerCharacter'
    ];

    static XP_CURVE_BASE = 80;
    static XP_CURVE_EXP = 1.6;
    static ATTR_POINTS_PER_LEVEL = 5;
    static SKILL_POINTS_PER_LEVEL = 1;
    static MAX_LEVEL = 60;

    constructor(game) {
        super(game);
        this.game.arpgStatsSystem = this;
        this._regenAccumulator = 0;
    }

    init() {}

    // ─── Character sheet setup ────────────────────────────────────────────────

    onPlayerCharacterSpawned({ entityId, classId }) {
        // Map the unit id back to its class definition
        const classKey = this.findClassKeyByUnit(classId) || classId;
        const classDef = this.collections.classes?.[classKey];
        if (!classDef) {
            console.warn('[ArpgStatsSystem] No class definition for', classId);
            return;
        }

        // Preserve progression across respawns/zone changes via saved sheet
        const saved = this.game.state.savedCharacterSheet;
        const sheet = saved ? JSON.parse(JSON.stringify(saved)) : {
            classId: classKey,
            level: 1,
            experience: 0,
            experienceToNext: this.xpToNext(1),
            attributes: { ...classDef.baseAttributes },
            unspentAttributePoints: 0,
            unspentSkillPoints: 0,
            allocatedSkills: {},
            ascension: ''
        };

        this.game.addComponent(entityId, 'characterSheet', sheet);
        this.recomputeDerivedStats(entityId);

        // Full heal on spawn
        const health = this.game.getComponent(entityId, 'health');
        if (health) health.current = health.max;
        const pool = this.game.getComponent(entityId, 'resourcePool');
        if (pool) pool.mana = pool.maxMana;

        // Sync display component
        const exp = this.game.getComponent(entityId, 'experience');
        if (exp) {
            exp.level = sheet.level;
            exp.experience = sheet.experience;
            exp.experienceToNextLevel = sheet.experienceToNext;
        }
    }

    findClassKeyByUnit(unitId) {
        const classes = this.collections.classes || {};
        for (const key of Object.keys(classes)) {
            if (classes[key].unitType === unitId) return key;
            if (key === unitId) return key;
        }
        // Ascended: unit is one of a class's ascensions
        for (const key of Object.keys(classes)) {
            if ((classes[key].ascensions || []).includes(unitId)) return key;
        }
        return null;
    }

    getCharacterSheet(entityId) {
        const id = entityId ?? this.call.getPlayerCharacter?.();
        if (id == null) return null;
        return this.game.getComponent(id, 'characterSheet');
    }

    // ─── XP & leveling ────────────────────────────────────────────────────────

    xpToNext(level) {
        return Math.round(ArpgStatsSystem.XP_CURVE_BASE * Math.pow(level, ArpgStatsSystem.XP_CURVE_EXP));
    }

    // Every enemy death in the zone grants the player XP (single-player)
    onUnitKilled(deadEntityId) {
        if (!this.game.state.isAdventure) return;

        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null || deadEntityId === playerId) return;

        const playerHealth = this.game.getComponent(playerId, 'health');
        if (!playerHealth || playerHealth.current <= 0) return;

        const deadTeam = this.game.getComponent(deadEntityId, 'team')?.team;
        const myTeam = this.game.getComponent(playerId, 'team')?.team;
        if (deadTeam == null || deadTeam === myTeam) return;

        const unitTypeComp = this.game.getComponent(deadEntityId, 'unitType');
        const unitDef = this.game.getUnitTypeDef?.(unitTypeComp);
        let xp = unitDef?.xpValue ?? ((unitDef?.value > 0) ? unitDef.value : 10);

        // Monster level scaling (EnemyPackSystem sets monsterLevel on spawn)
        const mLevel = this.game.getComponent(deadEntityId, 'neutralMonster')?.monsterLevel;
        if (mLevel) xp = Math.round(xp * (1 + (mLevel - 1) * 0.25));

        this.awardExperience(playerId, xp);
    }

    awardExperience(entityId, amount) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet || amount <= 0) return;
        if (sheet.level >= ArpgStatsSystem.MAX_LEVEL) return;

        sheet.experience += amount;

        let leveled = false;
        while (sheet.experience >= sheet.experienceToNext &&
               sheet.level < ArpgStatsSystem.MAX_LEVEL) {
            sheet.experience -= sheet.experienceToNext;
            sheet.level += 1;
            sheet.experienceToNext = this.xpToNext(sheet.level);
            sheet.unspentAttributePoints += ArpgStatsSystem.ATTR_POINTS_PER_LEVEL;
            sheet.unspentSkillPoints += ArpgStatsSystem.SKILL_POINTS_PER_LEVEL;
            leveled = true;
        }

        if (leveled) {
            this.recomputeDerivedStats(entityId);
            // Level up: full heal + restore
            const health = this.game.getComponent(entityId, 'health');
            if (health) health.current = health.max;
            const pool = this.game.getComponent(entityId, 'resourcePool');
            if (pool) pool.mana = pool.maxMana;

            this.playLevelUpEffect(entityId);
            this.game.triggerEvent('onPlayerLevelUp', { entityId, level: sheet.level });
        }

        // Mirror into display component
        const exp = this.game.getComponent(entityId, 'experience');
        if (exp) {
            exp.level = sheet.level;
            exp.experience = sheet.experience;
            exp.experienceToNextLevel = sheet.experienceToNext;
        }

        this.persistSheet(entityId);
    }

    playLevelUpEffect(entityId) {
        if (this.game.isServer) return;
        const transform = this.game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (pos && this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                pos.x, pos.y + 20, pos.z, 'magic',
                { count: 40, scaleMultiplier: 1.6, speedMultiplier: 1.2, color: '#f0cf70' }
            );
        }
    }

    allocateAttribute(attribute, points = 1) {
        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return false;
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet) return false;
        if (!['strength', 'dexterity', 'intelligence', 'vitality'].includes(attribute)) return false;
        if (sheet.unspentAttributePoints < points) return false;

        sheet.attributes[attribute] += points;
        sheet.unspentAttributePoints -= points;
        this.recomputeDerivedStats(entityId);
        this.persistSheet(entityId);
        return true;
    }

    persistSheet(entityId) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (sheet) {
            this.game.state.savedCharacterSheet = JSON.parse(JSON.stringify(sheet));
        }
    }

    // ─── Derived stats ────────────────────────────────────────────────────────

    /**
     * Recompute health/mana/combat values from class definition + attributes.
     * Flat bonuses from equipment come through getEquipmentStatBonuses (ItemSystem
     * overrides this via its own registration once items exist).
     */
    recomputeDerivedStats(entityId) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet) return;
        const classDef = this.collections.classes?.[sheet.classId];
        if (!classDef) return;

        // Ascended characters use their tier-2 unit's base stats
        const unitDef = this.collections.units?.[sheet.ascension || classDef.unitType]
            || this.collections.units?.[classDef.unitType] || {};
        const base = classDef.baseAttributes;

        // Flat bonuses: equipment affixes + skill tree passives
        const eq = this.getEquipmentStatBonuses(entityId);
        const tree = this.game.skillTreeSystem?.getSkillFlatBonuses?.(entityId) || {};
        for (const [stat, value] of Object.entries(tree)) {
            eq[stat] = (eq[stat] || 0) + value;
        }

        // Effective attributes = allocated + item/tree attribute bonuses
        const attrs = {
            strength: sheet.attributes.strength + (eq.strength || 0),
            dexterity: sheet.attributes.dexterity + (eq.dexterity || 0),
            intelligence: sheet.attributes.intelligence + (eq.intelligence || 0),
            vitality: sheet.attributes.vitality + (eq.vitality || 0)
        };
        this._effectiveAttrsCache = this._effectiveAttrsCache || new Map();
        this._effectiveAttrsCache.set(entityId, attrs);

        // Life
        const maxLife = Math.round(
            (classDef.baseLife ?? unitDef.hp ?? 100) +
            (classDef.lifePerLevel ?? 10) * (sheet.level - 1) +
            (classDef.lifePerVitality ?? 3) * (attrs.vitality - base.vitality) +
            (eq.maxLife || 0)
        );
        const health = this.game.getComponent(entityId, 'health');
        if (health) {
            const ratio = health.max > 0 ? health.current / health.max : 1;
            health.max = maxLife;
            health.current = Math.min(health.max, Math.round(maxLife * ratio));
        }

        // Mana
        const maxMana = Math.round(
            (classDef.baseMana ?? 20) +
            (classDef.manaPerLevel ?? 2) * (sheet.level - 1) +
            (classDef.manaPerIntelligence ?? 1.5) * (attrs.intelligence - base.intelligence) +
            (eq.maxMana || 0)
        );
        const pool = this.game.getComponent(entityId, 'resourcePool');
        if (pool) {
            pool.maxMana = maxMana;
            pool.mana = Math.min(pool.mana, maxMana);
            pool.manaRegen = 1 + attrs.intelligence * 0.04 + (eq.manaRegen || 0);
        }

        // Combat — weapon replaces unarmed fundamentals when equipped
        const combat = this.game.getComponent(entityId, 'combat');
        if (combat) {
            const baseDamage = eq.weaponDamage != null ? eq.weaponDamage : (unitDef.damage ?? 10);
            combat.damage = Math.round(
                baseDamage +
                (classDef.damagePerLevel ?? 1) * (sheet.level - 1) +
                (eq.flatDamage || 0)
            );
            if (eq.weaponRange != null) {
                combat.range = eq.weaponRange;
            } else {
                combat.range = unitDef.range ?? combat.range;
            }
            if (eq.weaponProjectile !== undefined) {
                combat.projectile = eq.weaponProjectile
                    ? (this.enums.projectiles?.[eq.weaponProjectile] ?? null)
                    : null;
            } else if (unitDef.projectile !== undefined) {
                combat.projectile = unitDef.projectile != null
                    ? (this.enums.projectiles?.[unitDef.projectile] ?? unitDef.projectile)
                    : null;
            }
            const baseAttackSpeed = eq.weaponAttackSpeed != null ? eq.weaponAttackSpeed : (unitDef.attackSpeed ?? 1);
            combat.attackSpeed = baseAttackSpeed * (1 + (eq.attackSpeed || 0));

            combat.accuracy = (unitDef.accuracy ?? 90) + attrs.dexterity + (eq.accuracy || 0);
            combat.evasion = (unitDef.evasion ?? 0) + Math.floor(attrs.dexterity * 0.25) + (eq.evasion || 0);
            combat.criticalChance = (unitDef.criticalChance ?? 0.05) + attrs.dexterity * 0.001 + (eq.criticalChance || 0);
            combat.criticalMultiplier = (unitDef.criticalMultiplier ?? 1.5) + (eq.criticalMultiplier || 0);
            combat.armor = (unitDef.armor ?? 0) + (eq.armor || 0);
            combat.blockChance = eq.blockChance || 0;
            combat.fireResistance = (unitDef.fireResistance ?? 0) + (eq.fireResistance || 0);
            combat.coldResistance = (unitDef.coldResistance ?? 0) + (eq.coldResistance || 0);
            combat.lightningResistance = (unitDef.lightningResistance ?? 0) + (eq.lightningResistance || 0);
            combat.poisonResistance = (eq.poisonResistance || 0);
            combat.lifeLeech = (unitDef.lifeLeech ?? 0) + (eq.lifeLeech || 0);
        }

        // Bonus life regen from items (added to vitality regen in update())
        this._bonusLifeRegen = this._bonusLifeRegen || new Map();
        this._bonusLifeRegen.set(entityId, eq.lifeRegen || 0);

        // Movement speed bonuses
        const vel = this.game.getComponent(entityId, 'velocity');
        if (vel && unitDef.speed) {
            const speedMod = this.game.unitCreationSystem?.SPEED_MODIFIER ?? 1;
            vel.maxSpeed = unitDef.speed * speedMod * (1 + (eq.moveSpeed || 0));
        }

        this.game.triggerEvent('onDerivedStatsChanged', { entityId });
    }

    /**
     * Flat stat bonuses from equipment (delegates to ItemSystem when present).
     */
    getEquipmentStatBonuses(entityId) {
        if (this.game.itemSystem?.getEquipmentStatBonuses) {
            return this.game.itemSystem.getEquipmentStatBonuses(entityId);
        }
        return {};
    }

    /**
     * Attributes including item/tree bonuses (cached by recomputeDerivedStats).
     */
    getEffectiveAttributes(entityId) {
        const cached = this._effectiveAttrsCache?.get(entityId);
        if (cached) return cached;
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        return sheet?.attributes || { strength: 0, dexterity: 0, intelligence: 0, vitality: 0 };
    }

    // ─── Regen tick ───────────────────────────────────────────────────────────

    update() {
        if (!this.game.state.isAdventure) return;
        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return;

        const dt = this.game.state.deltaTime || 0;

        const deathState = this.game.getComponent(entityId, 'deathState');
        if (deathState && deathState.state !== this.enums.deathState.alive) return;

        // Mana regen
        const pool = this.game.getComponent(entityId, 'resourcePool');
        if (pool && pool.mana < pool.maxMana) {
            pool.mana = Math.min(pool.maxMana, pool.mana + (pool.manaRegen || 1) * dt);
        }

        // Life regen from vitality (+ item lifeRegen affixes)
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        const health = this.game.getComponent(entityId, 'health');
        if (sheet && health && health.current > 0 && health.current < health.max) {
            const attrs = this.getEffectiveAttributes(entityId);
            const regen = attrs.vitality * 0.05 + (this._bonusLifeRegen?.get(entityId) || 0);
            health.current = Math.min(health.max, health.current + regen * dt);
        }
    }

    onSceneUnload() {
        this._regenAccumulator = 0;
    }
}
