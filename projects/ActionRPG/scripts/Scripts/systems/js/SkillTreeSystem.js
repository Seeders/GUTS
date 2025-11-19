class SkillTreeSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.skillTreeSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Entity skill data
        this.entitySkills = new Map();

        // Define skill trees for each class
        this.skillTrees = {
            warrior: {
                name: 'Warrior',
                tiers: [
                    // Tier 1 - Basic skills
                    {
                        skills: [
                            {
                                id: 'toughness',
                                name: 'Toughness',
                                type: 'passive',
                                description: '+50 Health per rank',
                                maxRank: 5,
                                effect: { health: 50 },
                                icon: 'health'
                            },
                            {
                                id: 'weapon_mastery',
                                name: 'Weapon Mastery',
                                type: 'passive',
                                description: '+5% Damage per rank',
                                maxRank: 5,
                                effect: { damagePercent: 5 },
                                icon: 'damage'
                            },
                            {
                                id: 'thick_skin',
                                name: 'Thick Skin',
                                type: 'passive',
                                description: '+3 Armor per rank',
                                maxRank: 5,
                                effect: { armor: 3 },
                                icon: 'armor'
                            }
                        ]
                    },
                    // Tier 2 - Intermediate (requires 5 points in tier 1)
                    {
                        requiredPoints: 5,
                        skills: [
                            {
                                id: 'charge',
                                name: 'Charge',
                                type: 'ability',
                                description: 'Rush to enemy, dealing damage',
                                maxRank: 1,
                                abilityId: 'ChargeAbility',
                                icon: 'charge'
                            },
                            {
                                id: 'battle_rage',
                                name: 'Battle Rage',
                                type: 'passive',
                                description: '+10% Attack Speed per rank',
                                maxRank: 3,
                                effect: { attackSpeedPercent: 10 },
                                icon: 'speed'
                            },
                            {
                                id: 'iron_will',
                                name: 'Iron Will',
                                type: 'passive',
                                description: '+10% All Resistances per rank',
                                maxRank: 3,
                                effect: { allResistPercent: 10 },
                                icon: 'resist'
                            }
                        ]
                    },
                    // Tier 3 - Advanced (requires 10 points)
                    {
                        requiredPoints: 10,
                        skills: [
                            {
                                id: 'whirlwind',
                                name: 'Whirlwind',
                                type: 'ability',
                                description: 'Spin attack hitting all nearby enemies',
                                maxRank: 1,
                                abilityId: 'BattleCryAbility',
                                icon: 'whirlwind'
                            },
                            {
                                id: 'bloodlust',
                                name: 'Bloodlust',
                                type: 'ability',
                                description: 'Gain life steal on attacks',
                                maxRank: 1,
                                abilityId: 'BloodlustAbility',
                                icon: 'lifesteal'
                            },
                            {
                                id: 'devastating_blows',
                                name: 'Devastating Blows',
                                type: 'passive',
                                description: '+15% Critical damage per rank',
                                maxRank: 3,
                                effect: { critDamagePercent: 15 },
                                icon: 'crit'
                            }
                        ]
                    },
                    // Tier 4 - Ultimate (requires 15 points)
                    {
                        requiredPoints: 15,
                        skills: [
                            {
                                id: 'berserker_rage',
                                name: 'Berserker Rage',
                                type: 'ability',
                                description: 'Massive damage and speed boost',
                                maxRank: 1,
                                abilityId: 'RageAbility',
                                icon: 'rage'
                            }
                        ]
                    }
                ]
            },

            ranger: {
                name: 'Ranger',
                tiers: [
                    {
                        skills: [
                            {
                                id: 'precision',
                                name: 'Precision',
                                type: 'passive',
                                description: '+3% Critical chance per rank',
                                maxRank: 5,
                                effect: { critChancePercent: 3 },
                                icon: 'crit'
                            },
                            {
                                id: 'quick_draw',
                                name: 'Quick Draw',
                                type: 'passive',
                                description: '+5% Attack Speed per rank',
                                maxRank: 5,
                                effect: { attackSpeedPercent: 5 },
                                icon: 'speed'
                            },
                            {
                                id: 'eagle_eye',
                                name: 'Eagle Eye',
                                type: 'passive',
                                description: '+10% Range per rank',
                                maxRank: 5,
                                effect: { rangePercent: 10 },
                                icon: 'range'
                            }
                        ]
                    },
                    {
                        requiredPoints: 5,
                        skills: [
                            {
                                id: 'multishot',
                                name: 'Multi-Shot',
                                type: 'ability',
                                description: 'Fire multiple arrows at once',
                                maxRank: 1,
                                abilityId: 'MultiShotAbility',
                                icon: 'multishot'
                            },
                            {
                                id: 'evasion',
                                name: 'Evasion',
                                type: 'passive',
                                description: '+5% Dodge chance per rank',
                                maxRank: 3,
                                effect: { dodgePercent: 5 },
                                icon: 'dodge'
                            },
                            {
                                id: 'fleet_footed',
                                name: 'Fleet Footed',
                                type: 'passive',
                                description: '+10% Movement Speed per rank',
                                maxRank: 3,
                                effect: { moveSpeedPercent: 10 },
                                icon: 'speed'
                            }
                        ]
                    },
                    {
                        requiredPoints: 10,
                        skills: [
                            {
                                id: 'piercing_shot',
                                name: 'Piercing Shot',
                                type: 'ability',
                                description: 'Arrow that penetrates multiple enemies',
                                maxRank: 1,
                                abilityId: 'PiercingShotAbility',
                                icon: 'pierce'
                            },
                            {
                                id: 'trap_mastery',
                                name: 'Trap Mastery',
                                type: 'ability',
                                description: 'Set explosive traps',
                                maxRank: 1,
                                abilityId: 'ExplosiveTrapAbility',
                                icon: 'trap'
                            },
                            {
                                id: 'deadly_aim',
                                name: 'Deadly Aim',
                                type: 'passive',
                                description: '+20% Damage to marked targets',
                                maxRank: 3,
                                effect: { markedDamagePercent: 20 },
                                icon: 'mark'
                            }
                        ]
                    },
                    {
                        requiredPoints: 15,
                        skills: [
                            {
                                id: 'rain_of_arrows',
                                name: 'Rain of Arrows',
                                type: 'ability',
                                description: 'Barrage of arrows in an area',
                                maxRank: 1,
                                abilityId: 'BlizzardAbility',
                                icon: 'rain'
                            }
                        ]
                    }
                ]
            },

            mage: {
                name: 'Mage',
                tiers: [
                    {
                        skills: [
                            {
                                id: 'arcane_power',
                                name: 'Arcane Power',
                                type: 'passive',
                                description: '+20 Mana per rank',
                                maxRank: 5,
                                effect: { mana: 20 },
                                icon: 'mana'
                            },
                            {
                                id: 'spell_damage',
                                name: 'Spell Damage',
                                type: 'passive',
                                description: '+8% Spell Damage per rank',
                                maxRank: 5,
                                effect: { spellDamagePercent: 8 },
                                icon: 'damage'
                            },
                            {
                                id: 'mana_regen',
                                name: 'Meditation',
                                type: 'passive',
                                description: '+2 Mana Regen per rank',
                                maxRank: 5,
                                effect: { manaRegen: 2 },
                                icon: 'regen'
                            }
                        ]
                    },
                    {
                        requiredPoints: 5,
                        skills: [
                            {
                                id: 'fireball',
                                name: 'Fireball',
                                type: 'ability',
                                description: 'Launch an explosive fireball',
                                maxRank: 1,
                                abilityId: 'FireBallAbility',
                                icon: 'fire'
                            },
                            {
                                id: 'lightning_bolt',
                                name: 'Lightning Bolt',
                                type: 'ability',
                                description: 'Strike with lightning',
                                maxRank: 1,
                                abilityId: 'LightningBoltAbility',
                                icon: 'lightning'
                            },
                            {
                                id: 'frost_armor',
                                name: 'Frost Armor',
                                type: 'passive',
                                description: '+5 Armor, slows attackers',
                                maxRank: 3,
                                effect: { armor: 5, slowAttackers: true },
                                icon: 'frost'
                            }
                        ]
                    },
                    {
                        requiredPoints: 10,
                        skills: [
                            {
                                id: 'chain_lightning',
                                name: 'Chain Lightning',
                                type: 'ability',
                                description: 'Lightning jumps between enemies',
                                maxRank: 1,
                                abilityId: 'ChainLightningAbility',
                                icon: 'chain'
                            },
                            {
                                id: 'blizzard',
                                name: 'Blizzard',
                                type: 'ability',
                                description: 'Ice storm in an area',
                                maxRank: 1,
                                abilityId: 'BlizzardAbility',
                                icon: 'blizzard'
                            },
                            {
                                id: 'elemental_mastery',
                                name: 'Elemental Mastery',
                                type: 'passive',
                                description: '-10% Spell cooldowns per rank',
                                maxRank: 3,
                                effect: { cooldownReductionPercent: 10 },
                                icon: 'cooldown'
                            }
                        ]
                    },
                    {
                        requiredPoints: 15,
                        skills: [
                            {
                                id: 'meteor',
                                name: 'Meteor Strike',
                                type: 'ability',
                                description: 'Call down a devastating meteor',
                                maxRank: 1,
                                abilityId: 'MeteorStrikeAbility',
                                icon: 'meteor'
                            }
                        ]
                    }
                ]
            },

            paladin: {
                name: 'Paladin',
                tiers: [
                    {
                        skills: [
                            {
                                id: 'divine_strength',
                                name: 'Divine Strength',
                                type: 'passive',
                                description: '+30 Health per rank',
                                maxRank: 5,
                                effect: { health: 30 },
                                icon: 'health'
                            },
                            {
                                id: 'holy_damage',
                                name: 'Holy Damage',
                                type: 'passive',
                                description: '+5 Divine damage per rank',
                                maxRank: 5,
                                effect: { divineDamage: 5 },
                                icon: 'divine'
                            },
                            {
                                id: 'devotion',
                                name: 'Devotion',
                                type: 'passive',
                                description: '+15 Mana per rank',
                                maxRank: 5,
                                effect: { mana: 15 },
                                icon: 'mana'
                            }
                        ]
                    },
                    {
                        requiredPoints: 5,
                        skills: [
                            {
                                id: 'heal',
                                name: 'Holy Light',
                                type: 'ability',
                                description: 'Heal yourself or ally',
                                maxRank: 1,
                                abilityId: 'HealAbility',
                                icon: 'heal'
                            },
                            {
                                id: 'smite',
                                name: 'Smite',
                                type: 'ability',
                                description: 'Divine damage attack',
                                maxRank: 1,
                                abilityId: 'SmiteAbility',
                                icon: 'smite'
                            },
                            {
                                id: 'blessed_armor',
                                name: 'Blessed Armor',
                                type: 'passive',
                                description: '+4 Armor per rank',
                                maxRank: 3,
                                effect: { armor: 4 },
                                icon: 'armor'
                            }
                        ]
                    },
                    {
                        requiredPoints: 10,
                        skills: [
                            {
                                id: 'consecration',
                                name: 'Consecration',
                                type: 'ability',
                                description: 'Create holy ground',
                                maxRank: 1,
                                abilityId: 'ConsecrationAbility',
                                icon: 'consecrate'
                            },
                            {
                                id: 'mass_heal',
                                name: 'Mass Heal',
                                type: 'ability',
                                description: 'Heal all nearby allies',
                                maxRank: 1,
                                abilityId: 'MassHealAbility',
                                icon: 'mass_heal'
                            },
                            {
                                id: 'righteous_fury',
                                name: 'Righteous Fury',
                                type: 'passive',
                                description: '+10% Damage when above 50% health',
                                maxRank: 3,
                                effect: { healthyDamagePercent: 10 },
                                icon: 'fury'
                            }
                        ]
                    },
                    {
                        requiredPoints: 15,
                        skills: [
                            {
                                id: 'divine_shield',
                                name: 'Divine Shield',
                                type: 'ability',
                                description: 'Become invulnerable briefly',
                                maxRank: 1,
                                abilityId: 'ShieldWallAbility',
                                icon: 'shield'
                            }
                        ]
                    }
                ]
            },

            assassin: {
                name: 'Assassin',
                tiers: [
                    {
                        skills: [
                            {
                                id: 'lethality',
                                name: 'Lethality',
                                type: 'passive',
                                description: '+4 Damage per rank',
                                maxRank: 5,
                                effect: { damage: 4 },
                                icon: 'damage'
                            },
                            {
                                id: 'agility',
                                name: 'Agility',
                                type: 'passive',
                                description: '+8% Attack Speed per rank',
                                maxRank: 5,
                                effect: { attackSpeedPercent: 8 },
                                icon: 'speed'
                            },
                            {
                                id: 'nimble',
                                name: 'Nimble',
                                type: 'passive',
                                description: '+8% Movement Speed per rank',
                                maxRank: 5,
                                effect: { moveSpeedPercent: 8 },
                                icon: 'move'
                            }
                        ]
                    },
                    {
                        requiredPoints: 5,
                        skills: [
                            {
                                id: 'shadow_strike',
                                name: 'Shadow Strike',
                                type: 'ability',
                                description: 'Teleport and backstab',
                                maxRank: 1,
                                abilityId: 'ShadowStrikeAbility',
                                icon: 'shadow'
                            },
                            {
                                id: 'poison_blade',
                                name: 'Poison Blade',
                                type: 'passive',
                                description: 'Attacks apply poison',
                                maxRank: 3,
                                effect: { poisonOnHit: true, poisonDamage: 5 },
                                icon: 'poison'
                            },
                            {
                                id: 'evasion',
                                name: 'Evasion',
                                type: 'passive',
                                description: '+5% Dodge per rank',
                                maxRank: 3,
                                effect: { dodgePercent: 5 },
                                icon: 'dodge'
                            }
                        ]
                    },
                    {
                        requiredPoints: 10,
                        skills: [
                            {
                                id: 'explosive_trap',
                                name: 'Explosive Trap',
                                type: 'ability',
                                description: 'Place an explosive trap',
                                maxRank: 1,
                                abilityId: 'ExplosiveTrapAbility',
                                icon: 'trap'
                            },
                            {
                                id: 'mirror_images',
                                name: 'Mirror Images',
                                type: 'ability',
                                description: 'Create decoy copies',
                                maxRank: 1,
                                abilityId: 'MirrorImagesAbility',
                                icon: 'mirror'
                            },
                            {
                                id: 'assassinate',
                                name: 'Assassinate',
                                type: 'passive',
                                description: '+50% Damage to low health targets',
                                maxRank: 3,
                                effect: { executeDamagePercent: 50 },
                                icon: 'execute'
                            }
                        ]
                    },
                    {
                        requiredPoints: 15,
                        skills: [
                            {
                                id: 'death_mark',
                                name: 'Death Mark',
                                type: 'ability',
                                description: 'Mark for death, huge damage',
                                maxRank: 1,
                                abilityId: 'CurseAbility',
                                icon: 'death'
                            }
                        ]
                    }
                ]
            },

            necromancer: {
                name: 'Necromancer',
                tiers: [
                    {
                        skills: [
                            {
                                id: 'dark_power',
                                name: 'Dark Power',
                                type: 'passive',
                                description: '+15 Mana per rank',
                                maxRank: 5,
                                effect: { mana: 15 },
                                icon: 'mana'
                            },
                            {
                                id: 'death_magic',
                                name: 'Death Magic',
                                type: 'passive',
                                description: '+6% Spell Damage per rank',
                                maxRank: 5,
                                effect: { spellDamagePercent: 6 },
                                icon: 'damage'
                            },
                            {
                                id: 'soul_harvest',
                                name: 'Soul Harvest',
                                type: 'passive',
                                description: 'Gain mana on kills',
                                maxRank: 5,
                                effect: { manaOnKill: 5 },
                                icon: 'soul'
                            }
                        ]
                    },
                    {
                        requiredPoints: 5,
                        skills: [
                            {
                                id: 'raise_dead',
                                name: 'Raise Dead',
                                type: 'ability',
                                description: 'Summon skeleton warriors',
                                maxRank: 1,
                                abilityId: 'RaiseDeadAbility',
                                icon: 'summon'
                            },
                            {
                                id: 'drain_life',
                                name: 'Drain Life',
                                type: 'ability',
                                description: 'Steal health from enemy',
                                maxRank: 1,
                                abilityId: 'DrainLifeAbility',
                                icon: 'drain'
                            },
                            {
                                id: 'bone_armor',
                                name: 'Bone Armor',
                                type: 'passive',
                                description: '+3 Armor per rank',
                                maxRank: 3,
                                effect: { armor: 3 },
                                icon: 'bone'
                            }
                        ]
                    },
                    {
                        requiredPoints: 10,
                        skills: [
                            {
                                id: 'curse',
                                name: 'Curse',
                                type: 'ability',
                                description: 'Weaken enemies',
                                maxRank: 1,
                                abilityId: 'CurseAbility',
                                icon: 'curse'
                            },
                            {
                                id: 'corpse_explosion',
                                name: 'Corpse Explosion',
                                type: 'ability',
                                description: 'Explode corpses for damage',
                                maxRank: 1,
                                abilityId: 'InfernoAbility',
                                icon: 'explode'
                            },
                            {
                                id: 'dark_pact',
                                name: 'Dark Pact',
                                type: 'passive',
                                description: 'Minions deal +15% damage',
                                maxRank: 3,
                                effect: { minionDamagePercent: 15 },
                                icon: 'pact'
                            }
                        ]
                    },
                    {
                        requiredPoints: 15,
                        skills: [
                            {
                                id: 'army_of_dead',
                                name: 'Army of the Dead',
                                type: 'ability',
                                description: 'Summon massive skeleton army',
                                maxRank: 1,
                                abilityId: 'RaiseDeadAbility',
                                icon: 'army'
                            }
                        ]
                    }
                ]
            }
        };
    }

    init() {
        this.game.gameManager.register('initializeSkillTree', this.initializeSkillTree.bind(this));
        this.game.gameManager.register('getSkillTree', this.getSkillTree.bind(this));
        this.game.gameManager.register('getEntitySkills', this.getEntitySkills.bind(this));
        this.game.gameManager.register('canLearnSkill', this.canLearnSkill.bind(this));
        this.game.gameManager.register('learnSkill', this.learnSkill.bind(this));
        this.game.gameManager.register('getSkillRank', this.getSkillRank.bind(this));
        this.game.gameManager.register('getTotalSkillPoints', this.getTotalSkillPoints.bind(this));
    }

    initializeSkillTree(entityId, treeId) {
        this.entitySkills.set(entityId, {
            treeId,
            skills: {},
            totalPointsSpent: 0
        });
    }

    getSkillTree(treeId) {
        return this.skillTrees[treeId];
    }

    getEntitySkills(entityId) {
        return this.entitySkills.get(entityId);
    }

    getSkillRank(entityId, skillId) {
        const data = this.entitySkills.get(entityId);
        return data?.skills[skillId] || 0;
    }

    getTotalSkillPoints(entityId) {
        const data = this.entitySkills.get(entityId);
        return data?.totalPointsSpent || 0;
    }

    canLearnSkill(entityId, skillId) {
        const data = this.entitySkills.get(entityId);
        if (!data) return { canLearn: false, reason: 'no_skill_data' };

        const tree = this.skillTrees[data.treeId];
        if (!tree) return { canLearn: false, reason: 'no_tree' };

        // Find skill in tree
        let skill = null;
        let tierIndex = -1;
        for (let i = 0; i < tree.tiers.length; i++) {
            const found = tree.tiers[i].skills.find(s => s.id === skillId);
            if (found) {
                skill = found;
                tierIndex = i;
                break;
            }
        }

        if (!skill) return { canLearn: false, reason: 'skill_not_found' };

        // Check max rank
        const currentRank = data.skills[skillId] || 0;
        if (currentRank >= skill.maxRank) {
            return { canLearn: false, reason: 'max_rank' };
        }

        // Check tier requirements
        const tier = tree.tiers[tierIndex];
        if (tier.requiredPoints && data.totalPointsSpent < tier.requiredPoints) {
            return {
                canLearn: false,
                reason: 'tier_locked',
                required: tier.requiredPoints,
                current: data.totalPointsSpent
            };
        }

        // Check skill points available
        const availablePoints = this.game.gameManager.call('getSkillPoints', entityId);
        if (availablePoints <= 0) {
            return { canLearn: false, reason: 'no_points' };
        }

        return { canLearn: true };
    }

    learnSkill(entityId, skillId) {
        const canLearn = this.canLearnSkill(entityId, skillId);
        if (!canLearn.canLearn) {
            this.game.triggerEvent('onSkillLearnFailed', {
                entityId,
                skillId,
                reason: canLearn.reason
            });
            return false;
        }

        const data = this.entitySkills.get(entityId);
        const tree = this.skillTrees[data.treeId];

        // Find skill
        let skill = null;
        for (const tier of tree.tiers) {
            skill = tier.skills.find(s => s.id === skillId);
            if (skill) break;
        }

        // Spend skill point
        const success = this.game.gameManager.call('spendSkillPoint', entityId, 'skill');
        if (!success) return false;

        // Update skill rank
        data.skills[skillId] = (data.skills[skillId] || 0) + 1;
        data.totalPointsSpent++;

        // Apply effects
        if (skill.type === 'passive') {
            this.applyPassiveEffect(entityId, skill);
        } else if (skill.type === 'ability' && skill.abilityId) {
            // Add ability to entity
            this.game.gameManager.call('addAbilityToEntity', entityId, skill.abilityId);
        }

        this.game.triggerEvent('onSkillLearned', {
            entityId,
            skillId,
            newRank: data.skills[skillId],
            skill
        });

        return true;
    }

    applyPassiveEffect(entityId, skill) {
        const CT = this.componentTypes;
        const effect = skill.effect;

        if (effect.health) {
            const health = this.game.getComponent(entityId, CT.HEALTH);
            if (health) {
                health.max += effect.health;
                health.current += effect.health;
            }
        }

        if (effect.mana) {
            const resources = this.game.getComponent(entityId, CT.RESOURCE_POOL);
            if (resources) {
                resources.maxMana += effect.mana;
                resources.mana += effect.mana;
            }
        }

        if (effect.manaRegen) {
            const resources = this.game.getComponent(entityId, CT.RESOURCE_POOL);
            if (resources) {
                resources.manaRegen += effect.manaRegen;
            }
        }

        if (effect.armor) {
            const combat = this.game.getComponent(entityId, CT.COMBAT);
            if (combat) {
                combat.armor += effect.armor;
            }
        }

        if (effect.damage) {
            const combat = this.game.getComponent(entityId, CT.COMBAT);
            if (combat) {
                combat.damage += effect.damage;
            }
        }

        if (effect.damagePercent) {
            const combat = this.game.getComponent(entityId, CT.COMBAT);
            if (combat) {
                combat.damage *= (1 + effect.damagePercent / 100);
            }
        }

        if (effect.attackSpeedPercent) {
            const combat = this.game.getComponent(entityId, CT.COMBAT);
            if (combat) {
                combat.attackSpeed *= (1 + effect.attackSpeedPercent / 100);
            }
        }

        if (effect.moveSpeedPercent) {
            const vel = this.game.getComponent(entityId, CT.VELOCITY);
            if (vel) {
                vel.maxSpeed *= (1 + effect.moveSpeedPercent / 100);
            }
        }
    }

    update() {
        // Clean up dead entities
        for (const [entityId] of this.entitySkills) {
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            if (!health) {
                this.entitySkills.delete(entityId);
            }
        }
    }
}
