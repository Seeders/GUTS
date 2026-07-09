// Deck-building runtime: a chosen deck restricts units, per-unit techs (= assigned
// abilities), and bans commanders. No deck ⇒ full global collections (fallback).
import '../../../../dist/client/game.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('ArmyShopSystem deck gating', () => {
    let game, shop;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.isLocalGame = true;
        game.register('getPlayerEntities', () => game._players || []);
        game.register('getLeaderDef', () => null);
        shop = game.createSystem(GUTS.ArmyShopSystem);
        game.getServiceDependencies(shop);
    });

    function addPlayer(extra = {}) {
        const eid = game.createEntityWith({
            playerStats: { playerId: 0, team: 0, gold: 0, heroRoster: [],
                ownedUpgrades: [], tierUnlocks: [], ...extra }
        });
        (game._players ||= []).push(eid);
        return game.getComponent(eid, 'playerStats');
    }

    it('no deck ⇒ _unitTechsFor falls back to the unit\'s authored techs', () => {
        const stats = addPlayer();
        const techs = shop._unitTechsFor(stats, '1_s_barbarian');
        // barbarian ships with RageAbility/LeapSlam/BattleCry techs
        expect(techs.length).toBeGreaterThan(0);
        expect(techs.every(t => typeof t.id === 'string')).toBe(true);
    });

    it('deck ⇒ _unitTechsFor emits the assigned pool techs (ability + special)', () => {
        const stats = addPlayer({ deck: { units: [
            { unitId: '1_s_barbarian', abilities: ['pool_ab_ChargeAbility'] }
        ], buildings: [], bannedCommanders: [] } });
        const techs = shop._unitTechsFor(stats, '1_s_barbarian');
        expect(techs).toHaveLength(1);
        expect(techs[0].unlockAbility).toBe('ChargeAbility');
        expect(techs[0].id).toBe('pool_ab_ChargeAbility');
    });

    it('special (non-ability) techs are in the pool — e.g. skeleton Bone Blast', () => {
        expect(shop.collections.abilityPool['pool_tech_sk_explode']?.tech?.onDeathExplode).toBeTruthy();
        const stats = addPlayer({ deck: { units: [
            { unitId: '0_skeleton', abilities: ['pool_tech_sk_explode'] }
        ], buildings: [], bannedCommanders: [] } });
        const techs = shop._unitTechsFor(stats, '0_skeleton');
        expect(techs[0].onDeathExplode).toBeTruthy();
        expect(techs[0].id).toBe('pool_tech_sk_explode');
    });

    it('all unlocked units stay available — a deck never restricts unit availability', () => {
        const stats = addPlayer({
            tierUnlocks: ['1_s_barbarian', '1_d_archer'],
            deck: { units: [{ unitId: '1_s_barbarian', abilities: [] }], buildings: [], bannedCommanders: [] }
        });
        const ids = shop._candidateUnitIds(stats);
        expect(ids).toContain('1_s_barbarian');
        expect(ids).toContain('1_d_archer');
    });

    it('a unit not customized by the deck keeps its default techs', () => {
        const stats = addPlayer({ deck: { units: [{ unitId: '1_s_barbarian', abilities: [] }], buildings: [], bannedCommanders: [] } });
        const techs = shop._unitTechsFor(stats, '1_d_archer');   // archer absent from deck.units
        expect(techs).toEqual(shop.collections.unitTechs['1_d_archer'].techs);
    });

    it('_treeFor filters a building tree to the deck\'s chosen upgrades', () => {
        const stats = addPlayer({ deck: { units: [], bannedCommanders: [],
            buildings: [{ buildingId: 'barracks', upgrades: ['heavyPlating'] }] } });
        const tree = shop._treeFor(stats, 'barracks');
        const nodes = (tree.branches || []).flatMap(b => b.nodes || []).map(n => n.upgrade);
        expect(nodes).toContain('heavyPlating');
        expect(nodes).not.toContain('giantsMight');
    });
});

describe('AutobattlerRoundSystem commander bans', () => {
    let game, round;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.isLocalGame = true;
        round = game.createSystem(GUTS.AutobattlerRoundSystem);
        game.getServiceDependencies(round);
    });

    it('_rollLeaderDraft omits banned commanders', () => {
        const rng = { next: () => 0 };   // deterministic: always take the first
        const stats = { deck: { units: [], buildings: [], bannedCommanders: ['giant', 'aerial'] } };
        const draft = round._rollLeaderDraft(rng, stats);
        const ids = draft.map(d => d.id);
        expect(ids).not.toContain('giant');
        expect(ids).not.toContain('aerial');
        expect(draft.length).toBeGreaterThan(0);
    });

    it('_rollLeaderDraft with no deck offers commanders normally', () => {
        const rng = { next: () => 0 };
        const draft = round._rollLeaderDraft(rng, null);
        expect(draft.length).toBe(4);
    });
});
