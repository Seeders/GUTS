// Targeted balance matchups: spawn two exact armies, force one battle,
// report survivors. Verifies COUNTER MECHANICS cheaply instead of full games.
//
//   node projects/HeroArena/balance_matchups.mjs
//
// Each matchup is cost-equal. `expect` encodes the intended counter:
//   'left' / 'right' = that side should clearly win; 'even' = should trade.
import { createHeadlessRunner } from './headless.js';

const MATCHUPS = [
    { name: 'mirror sanity: 4 barbarian vs 4 barbarian', left: ['1_s_barbarian', 4], right: ['1_s_barbarian', 4], expect: 'even' },
    { name: 'armor vs swarm: treant vs 4 archer squads', left: ['4_ancientTreant', 1], right: ['1_d_archer', 4], expect: 'left' },
    { name: 'armor vs swarm: treant vs 4 skeleton hordes', left: ['4_ancientTreant', 1], right: ['0_skeleton', 4], expect: 'left' },
    { name: 'alpha vs giant: ballista+archer vs treant', left: ['ballista', 1, '1_d_archer', 1], right: ['4_ancientTreant', 1], expect: 'left' },
    { name: 'splash vs swarm: 4 apprentice vs 4 skeleton hordes', left: ['1_i_apprentice', 4], right: ['0_skeleton', 4], expect: 'left' },
    { name: 'air vs melee: 2 fairy squads vs 4 barbarian', left: ['fairy', 2], right: ['1_s_barbarian', 4], expect: 'left' },
    { name: 'anti-air vs air: 4 archer vs 2 fairy squads (cost-fair trade)', left: ['1_d_archer', 4], right: ['fairy', 2], expect: 'even' },
    { name: 'poison vs armor: 2 oathbreaker vs 2 hoplite', left: ['2_is_oathBreaker', 2], right: ['2_sd_hoplite', 2], expect: 'left' },
    { name: 'dive vs sniper: 2 assassin vs 2 crossbowman', left: ['2_di_shadowAssassin', 2], right: ['2_sd_crossbowman', 2], expect: 'left' },
    { name: 'armor vs phys chaff: golem vs 3 soldier squads', left: ['0_golemStone', 1], right: ['1_sd_soldier', 3], expect: 'left' },
    { name: 'armor vs fast hits: 2 gladiator vs 2 berserker', left: ['2_s_gladiator', 2], right: ['2_s_berserker', 2], expect: 'left' }
];

function parseArmy(spec) {
    const out = [];
    for (let i = 0; i < spec.length; i += 2) out.push({ unit: spec[i], count: spec[i + 1] });
    return out;
}

async function runMatchup(m) {
    const { runner, engine } = await createHeadlessRunner();
    await runner.setup({ level: 'battleplain', seed: 99, heroes: ['barbarian', 'archer'] });
    const game = engine.gameInstance;

    const step = (n) => {
        for (let i = 0; i < n; i++) {
            game.tickCount++;
            game.currentTime = Math.round(game.tickCount * engine.tickRate * 100) / 100;
            game.state.now = game.currentTime;
            game.state.deltaTime = engine.tickRate;
            game.deltaTime = engine.tickRate;
            for (const system of game.systems) {
                if (!system.enabled || !system.update) continue;
                system.update();
            }
            game.postUpdate();
        }
    };

    // Drive through leader select into prep round 1.
    for (let i = 0; i < 600 && game.state.phase !== game.getEnums().gamePhase.placement; i++) step(1);
    const enums = game.getEnums();
    if (game.state.phase !== enums.gamePhase.placement) throw new Error('never reached prep');

    // Strip whatever the setup flow bought, then grant the test armies.
    const statsByPlayer = {};
    for (const eid of game.getEntitiesWith('playerStats')) {
        const s = game.getComponent(eid, 'playerStats');
        statsByPlayer[s.playerId] = s;
    }
    for (const pid of [0, 1]) {
        const s = statsByPlayer[pid];
        // Sell everything (fresh units are sellable in round 1)
        for (let i = (s.heroRoster || []).length - 1; i >= 0; i--) {
            game.getService('sellUnit')(pid, i);
        }
        s.gold = 1000;
        if (!Array.isArray(s.tierUnlocks)) s.tierUnlocks = [];
    }

    const armies = { 0: parseArmy(m.left), 1: parseArmy(m.right) };
    for (const pid of [0, 1]) {
        const s = statsByPlayer[pid];
        for (const { unit, count } of armies[pid]) {
            if (!s.tierUnlocks.includes(unit)) s.tierUnlocks.push(unit);
            for (let i = 0; i < count; i++) {
                const r = game.getService('buyUnlockedUnit')(pid, unit);
                if (!r?.success) throw new Error(`buy failed ${unit}: ${r?.reason}`);
            }
        }
        // Line the army up near the centerline on its own side.
        const sign = s.team === enums.team.left ? -1 : 1;
        let slot = 0;
        for (let idx = 0; idx < s.heroRoster.length; idx++) {
            const members = game.getService('getHeroEntityIds')(pid, idx);
            for (const eid of members) {
                const row = Math.floor(slot / 8), col = slot % 8;
                game.placementSystem.moveHero(eid,
                    sign * (260 + row * 45), (col - 3.5) * 45);
                slot++;
            }
        }
    }

    // Zero the purses so the NEXT round's AI can't buy anything — otherwise
    // the post-battle prep floods the field and corrupts the tally.
    for (const pid of [0, 1]) statsByPlayer[pid].gold = 0;

    // Remove command buildings: march orders target the nearest enemy
    // BUILDING, so tower races + morale breaks pollute a pure unit-vs-unit
    // test. With no buildings, squads hunt enemy units directly.
    for (const eid of [...game.getEntitiesWith('buildingOwner')]) {
        try { game.destroyEntity(eid); } catch (_) {}
    }

    // Force the battle.
    game.serverNetworkSystem.handleReadyForBattle({ playerId: 0, numericPlayerId: 0 }, () => {});
    game.serverNetworkSystem.handleReadyForBattle({ playerId: 1, numericPlayerId: 1 }, () => {});
    for (let i = 0; i < 100 && game.state.phase !== enums.gamePhase.battle; i++) step(1);
    if (game.state.phase !== enums.gamePhase.battle) throw new Error('battle never started');

    // Run until the battle resolves (or 90s of sim time), snapshotting the
    // survivor tally EVERY battle tick — the tick that ends the battle also
    // respawns the roster for next prep, which would corrupt a post-hoc count.
    const snapshot = () => {
        const t = { 0: { alive: 0, total: 0, hp: 0 }, 1: { alive: 0, total: 0, hp: 0 } };
        for (const eid of game.getEntitiesWith('heroRosterInfo')) {
            const info = game.getComponent(eid, 'heroRosterInfo');
            const side = t[info.playerId];
            if (!side) continue;
            side.total++;
            const hp = game.getComponent(eid, 'health');
            const ds = game.getComponent(eid, 'deathState');
            const alive = hp && hp.current > 0 && (!ds || ds.state === enums.deathState.alive);
            if (alive) { side.alive++; side.hp += hp.current / hp.max; }
        }
        return t;
    };
    // Baseline army sizes at battle start — corpses DECAY during long fights,
    // so scoring against the live totals under-counts the dead side.
    const baseline = snapshot();
    let tally = baseline;
    for (let i = 0; i < 1800 && game.state.phase === enums.gamePhase.battle; i++) {
        step(1);
        if (game.state.phase === enums.gamePhase.battle) tally = snapshot();
    }
    await engine.shutdown?.();

    const L = { alive: tally[0].alive, total: baseline[0].total, hp: tally[0].hp };
    const R = { alive: tally[1].alive, total: baseline[1].total, hp: tally[1].hp };
    const lScore = L.total ? L.alive / L.total : 0;
    const rScore = R.total ? R.alive / R.total : 0;
    let winner = 'even';
    if (lScore > rScore + 0.2) winner = 'left';
    else if (rScore > lScore + 0.2) winner = 'right';
    const pass = m.expect === winner
        || (m.expect === 'even' && Math.abs(lScore - rScore) <= 0.35);
    return { winner, lScore, rScore, L, R, pass };
}

let passCount = 0;
for (const m of MATCHUPS) {
    try {
        const r = await runMatchup(m);
        if (r.pass) passCount++;
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${m.name}`);
        console.log(`      left ${r.L.alive}/${r.L.total} alive (${(r.lScore * 100).toFixed(0)}%)  right ${r.R.alive}/${r.R.total} (${(r.rScore * 100).toFixed(0)}%)  → ${r.winner}, expected ${m.expect}`);
    } catch (err) {
        console.log(`ERROR ${m.name}: ${err.message}`); console.log(err.stack?.split(String.fromCharCode(10)).slice(0,6).join(String.fromCharCode(10)));
    }
}
console.log(`\n${passCount}/${MATCHUPS.length} matchups matched expectations`);
process.exit(0);
