// Load HeroArena's own bundle first so GUTS.* systems and HeroArena's collections
// (the new economy upgrades) are in scope — setup.js loads the TurnBasedWarfare bundle.
import '../../../../dist/client/game.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('Leaders', () => {
    let game, system;

    beforeEach(() => {
        game = new TestGameContext();
        game.register('getPlayerEntities', () => game._players || []);
        system = game.createSystem(GUTS.LeaderSystem);
        game.getServiceDependencies(system);
    });

    function addPlayer(leaderId, playerId = 0) {
        const eid = game.createEntityWith({ playerStats: { playerId, team: 0, leaderId } });
        (game._players ||= []).push(eid);
        return eid;
    }
    function addHero(def, { playerId = 0, rosterIndex = 0, damage = 10, evasion = 5, hp = 100 } = {}) {
        const eid = game.createEntityWith({
            heroRosterInfo: { playerId, rosterIndex },
            combat: { damage, evasion },
            health: { current: hp, max: hp },
            unitType: {}
        });
        game.getUnitTypeDef = () => def;   // archetype resolves from this def
        return eid;
    }

    it('Commander grants +10% HP to STR heroes', () => {
        addPlayer('commander');
        const hero = addHero({ strength: 3, dexterity: 0, intelligence: 0 }, { hp: 200 });
        system.applyLeaderBonuses(hero);
        const h = game.getComponent(hero, 'health');
        expect(h.max).toBe(220);
        expect(h.current).toBe(220);
    });

    it('Scholar grants +15% damage to INT heroes', () => {
        addPlayer('scholar');
        const hero = addHero({ strength: 0, dexterity: 0, intelligence: 3 }, { damage: 20 });
        system.applyLeaderBonuses(hero);
        expect(game.getComponent(hero, 'combat').damage).toBeCloseTo(23);
    });

    it('does not buff a hero outside the leader archetype', () => {
        addPlayer('scholar'); // INT leader
        const hero = addHero({ strength: 3, dexterity: 0, intelligence: 0 }, { damage: 20 }); // STR hero
        system.applyLeaderBonuses(hero);
        expect(game.getComponent(hero, 'combat').damage).toBe(20);
    });

    it('gold leaders (alchemist/warlord) apply no hero stat change', () => {
        addPlayer('alchemist');
        const hero = addHero({ strength: 3 }, { damage: 20, hp: 100 });
        system.applyLeaderBonuses(hero);
        expect(game.getComponent(hero, 'combat').damage).toBe(20);
        expect(game.getComponent(hero, 'health').max).toBe(100);
    });
});

describe('Economy effects', () => {
    let game, shop;

    beforeEach(() => {
        game = new TestGameContext();
        shop = game.createSystem(GUTS.ArmyShopSystem);
    });

    it('aggregates owned economy upgrades', () => {
        const eff = shop.getEconomyEffects({
            ownedUpgrades: ['eco_interest1', 'eco_interest2', 'eco_winStreak1', 'eco_trade1']
        });
        expect(eff.interestPer).toBe(10);
        expect(eff.interestCap).toBe(3);          // 2 + 1
        expect(eff.winStreakGold).toBe(1);
        expect(eff.rerollDiscount).toBe(1);
        expect(eff.sellRefundPct).toBeCloseTo(0.15);
    });

    it('gates an economy upgrade behind its tree prereq', () => {
        expect(shop._treeUnlocked({ ownedUpgrades: [] }, 'eco_interest2')).toBe(false);
        expect(shop._treeUnlocked({ ownedUpgrades: ['eco_interest1'] }, 'eco_interest2')).toBe(true);
        expect(shop._treeUnlocked({ ownedUpgrades: [] }, 'eco_interest1')).toBe(true); // no prereq
    });

    it('applies a reroll discount', () => {
        const stats = { rerollCount: 0, ownedUpgrades: ['eco_trade1'] };
        expect(shop.getRerollCost(stats)).toBe(Math.max(1, GUTS.ArmyShopSystem.REROLL_BASE_COST - 1));
    });
});

describe('grantRoundIncome', () => {
    let game, eco;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.isLocalGame = true;
        game.register('getPlayerEntities', () => game._players || []);
        eco = game.createSystem(GUTS.AutobattlerEconomySystem);
        game.getServiceDependencies(eco);
    });

    function addPlayer(stats) {
        const eid = game.createEntityWith({ playerStats: { playerId: 0, team: 0, ...stats } });
        (game._players ||= []).push(eid);
        return eid;
    }

    it('adds interest, streak gold and leader gold on round 2+', () => {
        game.state.round = 2;
        addPlayer({ gold: 30, winStreak: 2, lossStreak: 0, leaderId: 'alchemist',
                    ownedUpgrades: ['eco_interest1', 'eco_winStreak1'] });
        game.register('getEconomyEffects', () => ({ interestPer: 10, interestCap: 2, winStreakGold: 1, lossStreakGold: 0, flatIncome: 0 }));
        game.register('getLeaderDef', (id) => ({ id }));

        eco.grantRoundIncome();

        // 30 +10 income =40; interest min(4,2)=2 ->42; winStreak 2*1=2 ->44; alchemist +5 ->49
        expect(game.getComponent(game._players[0], 'playerStats').gold).toBe(49);
    });

    it('round 1 sets the starting purse with no bonuses', () => {
        game.state.round = 1;
        addPlayer({ gold: 999, winStreak: 5, leaderId: 'alchemist', ownedUpgrades: ['eco_interest1'] });
        game.register('getEconomyEffects', () => ({}));
        game.register('getLeaderDef', (id) => ({ id }));
        eco.grantRoundIncome();
        expect(game.getComponent(game._players[0], 'playerStats').gold)
            .toBe(GUTS.AutobattlerEconomySystem.STARTING_GOLD);
    });
});

describe('sellUnit', () => {
    let game, shop;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.isLocalGame = true;
        game.state.phase = game.getEnums().gamePhase.placement;
        game.register('getPlayerEntities', () => game._players || []);
        // Mock the roster removal (HeroRosterSystem) — splice the entry to mimic it.
        game.register('removeRosterEntry', (pid, idx) => {
            const stats = game.getComponent(game._players[0], 'playerStats');
            stats.heroRoster.splice(idx, 1);
            return { success: true };
        });
        shop = game.createSystem(GUTS.ArmyShopSystem);
        game.getServiceDependencies(shop);
    });

    it('refunds half the unit cost and removes the roster entry', () => {
        const eid = game.createEntityWith({
            playerStats: { playerId: 0, team: 0, gold: 0,
                heroRoster: [{ heroClass: 'barbarian', spawnType: '1_s_barbarian' }], ownedUpgrades: [] }
        });
        (game._players ||= []).push(eid);

        const res = shop.sellUnit(0, 0);
        const stats = game.getComponent(eid, 'playerStats');
        // barbarian value 35 -> shopCost ceil(35/5)=7 -> refund floor(7*0.5)=3
        expect(res.success).toBe(true);
        expect(res.refund).toBe(3);
        expect(stats.gold).toBe(3);
        expect(stats.heroRoster.length).toBe(0);
    });
});

describe('Shop sells no units; Your Units lists buyable units', () => {
    let game, shop;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.isLocalGame = true;
        game.rng = { strand: () => ({ next: () => 0.5, reseed() {} }) };
        game.register('getPlayerEntities', () => game._players || []);
        game.register('getOwnedBuildingIds', () => []);
        game.register('getOwnedBuildingArchetypes', () => new Set(['str']));
        game.register('townhallLevel', () => 1);
        shop = game.createSystem(GUTS.ArmyShopSystem);
        game.getServiceDependencies(shop);
    });

    function addPlayer() {
        const eid = game.createEntityWith({
            playerStats: { playerId: 0, team: 0, gold: 100, heroRoster: [], ownedUpgrades: [], unlockedUnits: [] }
        });
        (game._players ||= []).push(eid);
        return game.getComponent(eid, 'playerStats');
    }

    it('candidate units include tier-1 units for an owned archetype', () => {
        const ids = shop._candidateUnitIds(addPlayer());
        expect(ids).toContain('1_s_barbarian');
    });

    it('the shop never offers units', () => {
        const offers = shop._buildOffers(addPlayer());
        expect(offers.every(o => o.kind !== 'unit')).toBe(true);
    });

    it('Your Units (shop state.unlocked) lists buyable units', () => {
        addPlayer();
        const state = shop.getShopStateForPlayer(0);
        expect(state.unlocked.some(u => u.id === '1_s_barbarian')).toBe(true);
    });

    it('buyUnlockedUnit accepts any currently-buyable unit (not just previously bought)', () => {
        game.state.phase = game.getEnums().gamePhase.placement;
        game.register('spawnPurchasedUnit', () => ({ success: true }));
        const stats = addPlayer();
        const res = shop.buyUnlockedUnit(0, '1_s_barbarian');
        expect(res.success).toBe(true);
        expect(stats.heroRoster.length).toBe(1);
    });
});
