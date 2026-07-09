/**
 * PhalanxFormationAbility - link shields with nearby squadmates.
 * Applies the phalanx buff (armorMultiplier / damageTakenMultiplier from
 * data/buffTypes/phalanx.json — DamageSystem.getDefenderModifiers reads it)
 * to the caster and every SAME-UNIT-TYPE ally in range.
 *
 * Historical bug: the ally filter matched unitType.id === 'hoplite', but unit
 * ids are collection keys ('1_sd_soldier', '2_sd_hoplite') — it never matched
 * anything, so the ability never cast. Now it matches the caster's own unit
 * type, which works for both the soldier and hoplite tech grants.
 */
class PhalanxFormationAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies
    ];

    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.formationDuration = abilityData.formationDuration ?? 25.0;
        this.element           = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
    }

    canExecute(casterEntity) {
        // Check if caster already has a phalanx buff to prevent re-casting
        const enums = this.game.getEnums();
        if (this.hasBuff(casterEntity, enums.buffTypes.phalanx)) return false;

        // Must have at least one nearby same-type ally (not counting self)
        return this.getNearbySquadmates(casterEntity).length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        const squadmates = this.getNearbySquadmates(casterEntity);
        if (squadmates.length === 0) return null;

        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity,
            `Forms a phalanx with ${squadmates.length} allies!`);

        this.game.schedulingSystem.scheduleAction(() => {
            this.createPhalanxFormation(casterEntity, squadmates);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    createPhalanxFormation(casterEntity, squadmates) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        const casterTypeId = this._unitTypeId(casterEntity);
        if (!casterTypeId) return;

        // Formation effect at caster position
        this.playConfiguredEffects('burst', casterPos);

        // Apply the phalanx buff to caster + squadmates, deterministic order
        const members = [casterEntity, ...squadmates.slice().sort((a, b) => a - b)];
        const enums = this.game.getEnums();
        const now = this.game.state.now || 0;
        const endTime = now + this.formationDuration;

        members.forEach((memberId, index) => {
            // Validate member still exists and is still the same unit type
            const position = this.game.getComponent(memberId, "transform")?.position;
            if (!position || this._unitTypeId(memberId) !== casterTypeId) return;

            this.applyBuff(memberId, {
                buffType: enums.buffTypes.phalanx,
                endTime: endTime,
                appliedTime: now,
                stacks: 1,
                sourceEntity: casterEntity
            });

            this.playConfiguredEffects('buff', position);

            // Staggered link visual
            this.game.schedulingSystem.scheduleAction(() => {
                const pos = this.game.getComponent(memberId, "transform")?.position;
                if (pos) this.playConfiguredEffects('sustained', pos);
            }, index * 0.2, memberId);
        });

        // Expiration warning near the end of the formation
        this.game.schedulingSystem.scheduleAction(() => {
            this.warnFormationEnding(members);
        }, this.formationDuration - 2.0, casterEntity);
    }

    // Same-unit-type allies in range, excluding self, deterministic order
    getNearbySquadmates(casterEntity) {
        const casterTypeId = this._unitTypeId(casterEntity);
        if (!casterTypeId) return [];

        return this.getAlliesInRange(casterEntity)
            .filter(allyId => allyId !== casterEntity &&
                this._unitTypeId(allyId) === casterTypeId)
            .sort((a, b) => a - b);
    }

    _unitTypeId(entityId) {
        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        return this.game.getUnitTypeDef(unitTypeComp)?.id || null;
    }

    warnFormationEnding(memberIds) {
        const enums = this.game.getEnums();
        memberIds.forEach(memberId => {
            const position = this.game.getComponent(memberId, "transform")?.position;
            if (!position || !this.hasBuff(memberId, enums.buffTypes.phalanx)) return;
            this.playConfiguredEffects('expiration', position);
        });
    }
}
