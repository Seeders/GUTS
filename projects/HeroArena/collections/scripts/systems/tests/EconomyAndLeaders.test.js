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

        // Mechabellum supply scale: income = 200 x round. 30 +400 income =430;
        // interest floor(min(floor(430/10)*F, cap 2)) =2 ->432; winStreak 2*1=2 ->434.
        expect(game.getComponent(game._players[0], 'playerStats').gold).toBe(434);
    });

    it('round 1 sets the starting purse to one round of income, no bonuses', () => {
        game.state.round = 1;
        addPlayer({ gold: 999, winStreak: 5, leaderId: 'alchemist', ownedUpgrades: ['eco_interest1'] });
        game.register('getEconomyEffects', () => ({}));
        game.register('getLeaderDef', (id) => ({ id }));
        eco.grantRoundIncome();
        // Round 1 SETS the purse to income = 200 x 1 = 200 supply (no interest/streak).
        expect(game.getComponent(game._players[0], 'playerStats').gold)
            .toBe(GUTS.AutobattlerEconomySystem.INCOME_PER_ROUND_STEP);
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
        // barbarian is tier-1 -> unitPrice = TIER_PRICE[1] = 100 -> refund floor(100*0.5)=50
        expect(res.success).toBe(true);
        expect(res.refund).toBe(50);
        expect(stats.gold).toBe(50);
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
        game.register('getLeaderDef', () => null);
        shop = game.createSystem(GUTS.ArmyShopSystem);
        game.getServiceDependencies(shop);
    });

    function addPlayer(extra = {}) {
        const eid = game.createEntityWith({
            playerStats: { playerId: 0, team: 0, gold: 100, heroRoster: [],
                ownedUpgrades: [], unlockedUnits: [], tierUnlocks: [], ...extra }
        });
        (game._players ||= []).push(eid);
        return game.getComponent(eid, 'playerStats');
    }

    it('nothing is buyable until unlocked — even tier-1 units', () => {
        expect(shop._candidateUnitIds(addPlayer())).toEqual([]);
    });

    it('candidate units are exactly the unlocked ones', () => {
        const ids = shop._candidateUnitIds(addPlayer({ tierUnlocks: ['1_s_barbarian'] }));
        expect(ids).toContain('1_s_barbarian');
    });

    it('the shop never offers units', () => {
        const offers = shop._buildOffers(addPlayer());
        expect(offers.every(o => o.kind !== 'unit')).toBe(true);
    });

    it('Your Units (shop state.unlocked) lists the unlocked units', () => {
        addPlayer({ tierUnlocks: ['1_s_barbarian'] });
        const state = shop.getShopStateForPlayer(0);
        expect(state.unlocked.some(u => u.id === '1_s_barbarian')).toBe(true);
    });

    it('buyUnlockedUnit accepts an unlocked unit', () => {
        game.state.phase = game.getEnums().gamePhase.placement;
        game.register('spawnPurchasedUnit', () => ({ success: true }));
        const stats = addPlayer({ tierUnlocks: ['1_s_barbarian'] });
        const res = shop.buyUnlockedUnit(0, '1_s_barbarian');
        expect(res.success).toBe(true);
        expect(stats.heroRoster.length).toBe(1);
    });

    it('buyUnlockedUnit refuses a not-yet-unlocked unit', () => {
        game.state.phase = game.getEnums().gamePhase.placement;
        addPlayer();   // no unlocks
        const res = shop.buyUnlockedUnit(0, '1_s_barbarian');
        expect(res.success).toBe(false);
        expect(res.reason).toBe('not_available');
    });

    it('tier-1 unlock is free and limited to one unlock per round', () => {
        game.state.phase = game.getEnums().gamePhase.placement;
        const stats = addPlayer({ gold: 100 });
        const res = shop.buyTierUnlock(0, '1_s_barbarian');    // T1 -> free unlock
        expect(res.success).toBe(true);
        expect(stats.gold).toBe(100);                           // no unlock cost
        expect(stats.tierUnlocks).toContain('1_s_barbarian');
        expect(stats.unlockedThisRound).toBe(true);

        // A second unlock the same round is refused.
        const again = shop.buyTierUnlock(0, '1_d_archer');
        expect(again.success).toBe(false);
        expect(again.reason).toBe('unlock_used');
        expect(stats.tierUnlocks).not.toContain('1_d_archer');
    });
});

describe('Reinforcement skip and Elite Recruitment', () => {
    let game, shop;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.isLocalGame = true;
        game.state.phase = game.getEnums().gamePhase.placement;
        game.register('getPlayerEntities', () => game._players || []);
        shop = game.createSystem(GUTS.ArmyShopSystem);
        game.getServiceDependencies(shop);
    });

    function addPlayer(extra = {}) {
        const eid = game.createEntityWith({
            playerStats: { playerId: 0, team: 0, gold: 0, heroRoster: [], ownedUpgrades: [], ...extra }
        });
        (game._players ||= []).push(eid);
        return game.getComponent(eid, 'playerStats');
    }

    it('skipReinforcement grants +50 supply and marks the pick done', () => {
        const stats = addPlayer({ gold: 100,
            pendingReinforcement: { options: [{ id: 'a' }], defs: [{}], picked: false } });
        const res = shop.skipReinforcement(0);
        expect(res.success).toBe(true);
        expect(res.gold).toBe(GUTS.ArmyShopSystem.SKIP_REINFORCEMENT_GOLD);   // 50
        expect(stats.gold).toBe(150);
        expect(stats.pendingReinforcement.picked).toBe(true);
    });

    it('skipReinforcement rejects when there is no pending card', () => {
        addPlayer({ gold: 100, pendingReinforcement: { options: [{ id: 'a' }], picked: true } });
        const res = shop.skipReinforcement(0);
        expect(res.success).toBe(false);
        expect(res.reason).toBe('no_pending');
    });

    it('buyEliteRecruit is a one-time purchase (100 supply), not a toggle', () => {
        const stats = addPlayer({ gold: 250 });
        const res = shop.buyEliteRecruit(0);
        expect(res.success).toBe(true);
        expect(stats.eliteRecruit).toBe(true);
        expect(stats.gold).toBe(250 - GUTS.ArmyShopSystem.ELITE_RECRUIT_COST);   // 150

        // Buying again is refused — it stays active, cannot be toggled off.
        const again = shop.buyEliteRecruit(0);
        expect(again.success).toBe(false);
        expect(again.reason).toBe('already_owned');
        expect(stats.eliteRecruit).toBe(true);
    });

    it('elite-adjusted recruit price is base + one rank-up (50% of base)', () => {
        expect(shop.eliteAdjustedCost(100, false)).toBe(100);   // T1 base
        expect(shop.eliteAdjustedCost(100, true)).toBe(150);    // arrives Lv2
        expect(shop.eliteAdjustedCost(300, true)).toBe(450);    // pricier tier -> bigger bump
    });
});
