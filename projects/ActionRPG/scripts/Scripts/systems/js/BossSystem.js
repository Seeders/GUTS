class BossSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.bossSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.activeBosses = new Map();
        this.bossHealthBar = null;
    }

    init() {
        this.game.gameManager.register('spawnBoss', this.spawnBoss.bind(this));
        this.game.gameManager.register('getActiveBosses', () => this.activeBosses);

        this.createBossHealthBar();
    }

    createBossHealthBar() {
        this.bossHealthBar = document.createElement('div');
        this.bossHealthBar.id = 'boss-health-bar';
        this.bossHealthBar.innerHTML = `
            <style>
                #boss-health-bar {
                    position: fixed;
                    top: 50px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 400px;
                    display: none;
                    flex-direction: column;
                    align-items: center;
                    z-index: 1000;
                    font-family: 'Georgia', serif;
                }

                .boss-name {
                    color: #ff4444;
                    font-size: 20px;
                    text-shadow: 2px 2px 4px black;
                    margin-bottom: 5px;
                }

                .boss-bar-container {
                    width: 100%;
                    height: 20px;
                    background: #222;
                    border: 2px solid #8b0000;
                    border-radius: 3px;
                    overflow: hidden;
                }

                .boss-bar-fill {
                    height: 100%;
                    background: linear-gradient(to bottom, #ff4444, #8b0000);
                    transition: width 0.3s ease;
                }

                .boss-health-text {
                    color: #fff;
                    font-size: 12px;
                    margin-top: 3px;
                }
            </style>

            <div class="boss-name" id="boss-name">Boss Name</div>
            <div class="boss-bar-container">
                <div class="boss-bar-fill" id="boss-bar-fill" style="width: 100%"></div>
            </div>
            <div class="boss-health-text" id="boss-health-text">100%</div>
        `;

        document.body.appendChild(this.bossHealthBar);
    }

    spawnBoss(unitType, x, z, bossName, scale = 1.5) {
        const CT = this.componentTypes;
        const Components = this.game.componentManager.getComponents();
        const collections = this.game.getCollections();

        const unitData = collections.units[unitType];
        if (!unitData) return null;

        const entityId = this.game.createEntity();
        const difficulty = this.game.gameManager.call('getDifficultyMultiplier') || 1.0;

        // Boss stats are much higher
        const bossHP = Math.floor((unitData.hp || 500) * 5 * difficulty);
        const bossDamage = Math.floor((unitData.damage || 20) * 2 * difficulty);

        this.game.addComponent(entityId, CT.POSITION, Components.Position(x, 0, z));
        this.game.addComponent(entityId, CT.VELOCITY, Components.Velocity(0, 0, 0, (unitData.speed || 40) * 0.8, false, false));
        this.game.addComponent(entityId, CT.FACING, Components.Facing(0));
        this.game.addComponent(entityId, CT.COLLISION, Components.Collision((unitData.size || 25) * scale, 50 * scale));
        this.game.addComponent(entityId, CT.HEALTH, Components.Health(bossHP));
        this.game.addComponent(entityId, CT.COMBAT, Components.Combat(
            bossDamage,
            unitData.range || 40,
            unitData.attackSpeed || 0.8,
            unitData.projectile,
            0,
            unitData.element || 'physical',
            (unitData.armor || 10) * 2,
            0.3, 0.3, 0.3, 0.3,
            600
        ));

        this.game.addComponent(entityId, CT.TEAM, Components.Team('enemy'));
        this.game.addComponent(entityId, CT.UNIT_TYPE, Components.UnitType({
            id: unitType,
            ...unitData,
            isBoss: true,
            bossName,
            xpValue: 500 * difficulty,
            goldValue: 200 * difficulty,
            lootTable: 'elite'
        }));

        this.game.addComponent(entityId, CT.AI_STATE, Components.AIState('idle', null, null, null, {
            initialized: true,
            isBoss: true,
            spawnPosition: { x, z },
            leashRange: 1000
        }));

        this.game.addComponent(entityId, CT.ABILITY_COOLDOWNS, Components.AbilityCooldowns({}));

        if (unitData.render) {
            this.game.addComponent(entityId, CT.RENDERABLE, Components.Renderable('units', unitType, 128));
        }

        // Add boss abilities
        if (unitData.abilities) {
            for (const abilityId of unitData.abilities) {
                this.game.gameManager.call('addAbilityToEntity', entityId, abilityId);
            }
        }

        this.activeBosses.set(entityId, {
            name: bossName,
            maxHealth: bossHP
        });

        this.game.triggerEvent('onBossSpawned', { entityId, name: bossName });
        this.game.gameManager.call('showMessage', `${bossName} has appeared!`);

        return entityId;
    }

    updateBossHealthBar() {
        if (this.activeBosses.size === 0) {
            this.bossHealthBar.style.display = 'none';
            return;
        }

        // Show health of first active boss
        const [entityId, bossData] = this.activeBosses.entries().next().value;
        const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);

        if (!health || health.current <= 0) {
            this.activeBosses.delete(entityId);
            this.bossHealthBar.style.display = 'none';

            this.game.triggerEvent('onBossDefeated', { entityId, name: bossData.name });
            this.game.gameManager.call('showMessage', `${bossData.name} defeated!`);
            return;
        }

        this.bossHealthBar.style.display = 'flex';
        document.getElementById('boss-name').textContent = bossData.name;

        const percent = (health.current / bossData.maxHealth) * 100;
        document.getElementById('boss-bar-fill').style.width = `${percent}%`;
        document.getElementById('boss-health-text').textContent =
            `${Math.floor(health.current)} / ${bossData.maxHealth}`;
    }

    update() {
        this.updateBossHealthBar();
    }
}
