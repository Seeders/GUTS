/**
 * SkillTreeSystem - Class skill trees, skill point spending, granted abilities,
 * skill bar bindings, and ascension.
 *
 * - Trees live in collections/data/skillTrees/{classKey}.json: 3 branches per class
 *   (one per ascension theme), each a list of active/passive skills with level
 *   requirements and max ranks.
 * - Active skills are backed by existing GUTS ability classes; rank is passed as
 *   the ability's sourceItemLevel so damage scales +15%/rank for free.
 * - Passive skills contribute damageModifiers (via StatAggregationSystem override)
 *   and flat stats (via ArpgStatsSystem.recomputeDerivedStats).
 * - Ascension: at level 12 the player picks one of the class's three tier-2 forms;
 *   the character respawns as that unit type (visual + base stat upgrade).
 */
class SkillTreeSystem extends GUTS.BaseSystem {
    static services = [
        'learnSkill',
        'assignSkillToSlot',
        'getSkillTree',
        'getSkillDef',
        'getLearnedActives',
        'chooseAscension',
        'refreshGrantedAbilities'
    ];

    static serviceDependencies = [
        'getPlayerCharacter',
        'addAbilitiesToUnit',
        'recomputeDerivedStats'
    ];

    static ASCENSION_LEVEL = 12;
    static SKILL_BAR_SLOTS = ['rmb', 's1', 's2', 's3', 's4'];

    constructor(game) {
        super(game);
        this.game.skillTreeSystem = this;
    }

    init() {}

    // ─── Tree lookup ──────────────────────────────────────────────────────────

    getSkillTree(classId) {
        return this.collections.skillTrees?.[classId] || null;
    }

    getPlayerSheet() {
        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return { entityId: null, sheet: null };
        return { entityId, sheet: this.game.getComponent(entityId, 'characterSheet') };
    }

    getSkillDef(classId, skillId) {
        const tree = this.getSkillTree(classId);
        if (!tree) return null;
        for (const branch of tree.branches || []) {
            for (const skill of branch.skills || []) {
                if (skill.id === skillId) return { skill, branch };
            }
        }
        return null;
    }

    // ─── Learning skills ──────────────────────────────────────────────────────

    learnSkill(skillId) {
        const { entityId, sheet } = this.getPlayerSheet();
        if (!sheet) return { success: false, reason: 'no_sheet' };

        const found = this.getSkillDef(sheet.classId, skillId);
        if (!found) return { success: false, reason: 'unknown_skill' };
        const { skill } = found;

        if (sheet.unspentSkillPoints < 1) return { success: false, reason: 'no_points' };
        if (sheet.level < (skill.levelReq || 1)) return { success: false, reason: 'level_too_low' };

        const currentRank = sheet.allocatedSkills[skillId] || 0;
        if (currentRank >= (skill.maxRank || 5)) return { success: false, reason: 'max_rank' };

        sheet.allocatedSkills[skillId] = currentRank + 1;
        sheet.unspentSkillPoints -= 1;

        if (skill.type === 'active') {
            this.refreshGrantedAbilities(entityId);
            if (currentRank === 0) this.autoAssignSkill(sheet, skillId);
        }

        // Passives with flat stats need a derived-stat recompute
        this.call.recomputeDerivedStats(entityId);
        this.game.arpgStatsSystem?.persistSheet(entityId);
        this.game.triggerEvent('onSkillLearned', { entityId, skillId, rank: currentRank + 1 });
        return { success: true, rank: currentRank + 1 };
    }

    getLearnedActives(entityId) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet) return [];
        const out = [];
        for (const [skillId, rank] of Object.entries(sheet.allocatedSkills || {})) {
            if (rank <= 0) continue;
            const found = this.getSkillDef(sheet.classId, skillId);
            if (found?.skill?.type === 'active') {
                out.push({ skillId, rank, skill: found.skill });
            }
        }
        return out;
    }

    /**
     * Regrant the entity's full ability list from learned actives
     * (+ gem-granted skills once ItemSystem provides them).
     */
    refreshGrantedAbilities(entityId) {
        const actives = this.getLearnedActives(entityId);
        const grants = actives.map(a => ({ id: a.skill.ability, itemLevel: a.rank }));

        // Gem-granted skills from equipped items
        const gemGrants = this.game.itemSystem?.getGemGrantedSkills?.(entityId) || [];
        for (const g of gemGrants) grants.push(g);

        this.call.addAbilitiesToUnit(entityId, grants);
    }

    // ─── Skill bar ────────────────────────────────────────────────────────────

    ensureSkillBar(sheet) {
        if (!sheet.skillBar) {
            sheet.skillBar = { rmb: null, s1: null, s2: null, s3: null, s4: null };
        }
        return sheet.skillBar;
    }

    autoAssignSkill(sheet, skillId) {
        const bar = this.ensureSkillBar(sheet);
        for (const slot of SkillTreeSystem.SKILL_BAR_SLOTS) {
            if (!bar[slot]) {
                bar[slot] = skillId;
                return slot;
            }
        }
        return null;
    }

    assignSkillToSlot(skillId, slot) {
        const { entityId, sheet } = this.getPlayerSheet();
        if (!sheet) return false;
        if (!SkillTreeSystem.SKILL_BAR_SLOTS.includes(slot)) return false;
        if (skillId != null) {
            const rank = sheet.allocatedSkills[skillId] || 0;
            const found = this.getSkillDef(sheet.classId, skillId);
            if (rank <= 0 || found?.skill?.type !== 'active') return false;
        }
        const bar = this.ensureSkillBar(sheet);
        // Remove from any other slot first
        for (const s of SkillTreeSystem.SKILL_BAR_SLOTS) {
            if (bar[s] === skillId) bar[s] = null;
        }
        bar[slot] = skillId;
        this.game.arpgStatsSystem?.persistSheet(entityId);
        return true;
    }

    // ─── Passive contributions ────────────────────────────────────────────────

    // Called by Ashfall's StatAggregationSystem for percent damage modifiers
    collectDamageModifiers(entityId, modifiers) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet?.allocatedSkills) return;

        for (const [skillId, rank] of Object.entries(sheet.allocatedSkills)) {
            if (rank <= 0) continue;
            const found = this.getSkillDef(sheet.classId, skillId);
            const skill = found?.skill;
            if (!skill?.damageModifiers) continue;
            for (const mod of skill.damageModifiers) {
                if (mod.type === 'increased') {
                    modifiers.increased.push({ tags: mod.tags || [], value: mod.value * rank });
                } else if (mod.type === 'more') {
                    modifiers.more.push({ tags: mod.tags || [], value: mod.value * rank });
                }
            }
        }
    }

    // Called by ArpgStatsSystem for flat stat bonuses (maxLife, armor, etc.)
    getSkillFlatBonuses(entityId) {
        const totals = {};
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet?.allocatedSkills) return totals;

        for (const [skillId, rank] of Object.entries(sheet.allocatedSkills)) {
            if (rank <= 0) continue;
            const found = this.getSkillDef(sheet.classId, skillId);
            const stats = found?.skill?.stats;
            if (!stats) continue;
            for (const [stat, value] of Object.entries(stats)) {
                totals[stat] = (totals[stat] || 0) + value * rank;
            }
        }
        return totals;
    }

    // ─── Ascension ────────────────────────────────────────────────────────────

    chooseAscension(ascensionUnitId) {
        const { entityId, sheet } = this.getPlayerSheet();
        if (!sheet) return { success: false, reason: 'no_sheet' };
        if (sheet.ascension) return { success: false, reason: 'already_ascended' };
        if (sheet.level < SkillTreeSystem.ASCENSION_LEVEL) {
            return { success: false, reason: 'level_too_low' };
        }

        const classDef = this.collections.classes?.[sheet.classId];
        if (!classDef?.ascensions?.includes(ascensionUnitId)) {
            return { success: false, reason: 'invalid_ascension' };
        }

        sheet.ascension = ascensionUnitId;
        this.game.arpgStatsSystem?.persistSheet(entityId);

        // Respawn the character as its ascended form (new model + base stats)
        const arpg = this.game.arpgGameSystem;
        if (arpg) {
            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position ? { ...transform.position } : null;
            this.game.destroyEntity(entityId);
            const newId = arpg.spawnPlayerCharacter(ascensionUnitId);
            if (newId != null && pos) {
                const nt = this.game.getComponent(newId, 'transform');
                if (nt?.position) {
                    nt.position.x = pos.x;
                    nt.position.y = pos.y;
                    nt.position.z = pos.z;
                }
            }
        }

        this.game.triggerEvent('onPlayerAscended', { ascension: ascensionUnitId });
        return { success: true };
    }

    // Regrant abilities when the character (re)spawns
    onPlayerCharacterSpawned({ entityId }) {
        // Sheet is added by ArpgStatsSystem in its own handler; defer a tick
        // ordering-safe: check directly (systems' handlers run in system order,
        // ArpgStatsSystem registers before SkillTreeSystem in game.json)
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (sheet) {
            this.ensureSkillBar(sheet);
            this.refreshGrantedAbilities(entityId);
        }
    }
}
