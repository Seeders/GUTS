// Spire March campaign end-to-end smoke test (headless).
//   node projects/HeroArena/campaign_smoke.mjs
import { createHeadlessRunner } from './headless.js';

let passCount = 0, failCount = 0;
function check(name, cond, detail = '') {
    const ok = !!cond;
    ok ? passCount++ : failCount++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const { runner, engine } = await createHeadlessRunner();
// Campaign flags ride the setup config — leader select completes DURING setup,
// so post-setup mutation is too late.
await runner.setup({
    level: 'battleplain', seed: 1234, heroes: ['barbarian', 'archer'],
    campaignMode: true, selectedLevel: 'battleplain',
    leaders: { 0: 'heavyArmor', 1: 'supply' }
});
const game = engine.gameInstance;
const enums = game.getEnums();

const step = (n) => {
    for (let i = 0; i < n; i++) {
        game.tickCount++;
        game.currentTime = Math.round(game.tickCount * engine.tickRate * 100) / 100;
        game.state.now = game.currentTime;
        game.state.deltaTime = engine.tickRate;
        game.deltaTime = engine.tickRate;
        for (const s of game.systems) { if (s.enabled && s.update) s.update(); }
        game.postUpdate();
    }
};

// 1. Kick the match flow (the sim driver normally does this), let both AI
// pids confirm leaders → campaign branch → map.
game.autobattlerRoundSystem.startLeaderSelect();
for (let i = 0; i < 400 && game.state.phase !== enums.gamePhase.campaignMap; i++) step(1);
check('run starts at the campaign map', game.state.phase === enums.gamePhase.campaignMap);

const crs = game.campaignRunSystem;
const state0 = game.getService('getCampaignState')();
check('map has 12 layers with a single boss at the end',
    state0.map?.layers?.length === 12 && state0.map.layers[11].length === 1
    && state0.map.layers[11][0].type === 'boss');
check('layer 1 nodes are reachable', (state0.reachable || []).length >= 2,
    `reachable: ${state0.reachable?.join(',')}`);
check('collections.encounters registered',
    Object.keys(game.getCollections().encounters || {}).length >= 6);

const stats = (() => {
    for (const eid of game.getEntitiesWith('playerStats')) {
        const s = game.getComponent(eid, 'playerStats');
        if (s.playerId === 0) return s;
    }
})();
const enemyStats = (() => {
    for (const eid of game.getEntitiesWith('playerStats')) {
        const s = game.getComponent(eid, 'playerStats');
        if (s.playerId !== 0) return s;
    }
})();

// 2. Enter node 1 — enemy army budget-built, income granted once
const firstNode = state0.reachable[0];
const enter = game.getService('enterCampaignNode')(0, firstNode);
check('entering node 1 starts prep', enter?.success && game.state.phase === enums.gamePhase.placement);
check('enemy army was built for the node', (enemyStats.heroRoster || []).length > 0,
    `${enemyStats.heroRoster.length} squads, gold ${enemyStats.gold}`);
check('node income granted to player once', stats.gold === 14, `gold ${stats.gold}`);
const goldAfterIncome = stats.gold;

// 3. Overwhelm the node: strong forced player army
stats.gold = 300;
if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
if (!stats.tierUnlocks.includes('0_golemStone')) stats.tierUnlocks.push('0_golemStone');
for (let i = 0; i < 4; i++) game.getService('buyUnlockedUnit')(0, '0_golemStone');
stats.gold = 0;
// Deploy at the frontier so slow golems can wipe the node inside the timer.
for (let idx = 0; idx < stats.heroRoster.length; idx++) {
    const members = game.getService('getHeroEntityIds')(0, idx);
    members.forEach((eid, mi) => game.placementSystem.moveHero(eid, -220, idx * 90 - 130 + mi * 30));
}
game.serverNetworkSystem.handleReadyForBattle({ playerId: 0, numericPlayerId: 0 }, () => {});
game.serverNetworkSystem.handleReadyForBattle({ playerId: 1, numericPlayerId: 1 }, () => {});
for (let i = 0; i < 120 && game.state.phase !== enums.gamePhase.battle; i++) step(1);
check('battle starts', game.state.phase === enums.gamePhase.battle);
const hpBefore = stats.commanderHP;
for (let i = 0; i < 2200 && game.state.phase === enums.gamePhase.battle; i++) step(1);
for (let i = 0; i < 400 && game.state.phase !== enums.gamePhase.campaignMap
    && game.state.phase !== enums.gamePhase.ended; i++) step(1);

const state1 = game.getService('getCampaignState')();
check('victory returns to the map with the node cleared',
    game.state.phase === enums.gamePhase.campaignMap && state1.depth === 1,
    `phase ${game.state.phase}, depth ${state1.depth}`);
check('clean win costs no commander HP', stats.commanderHP === hpBefore,
    `${hpBefore} -> ${stats.commanderHP}`);
check('roster persists across nodes', (stats.heroRoster || []).length === 4);

// 4. Node 2: pending reward becomes a 1-of-3 at prep
const node2 = state1.reachable[0];
game.getService('enterCampaignNode')(0, node2);
check('reward offered at next prep', stats.pendingReinforcement?.options?.length === 3,
    (stats.pendingReinforcement?.options || []).map(o => o.title).join(' | '));
const rosterBefore = stats.heroRoster.length;
const goldBefore = stats.gold;
const pick = game.getService('pickReinforcement')(0, 0);
check('reward applies', pick?.success
    && (stats.heroRoster.length > rosterBefore || stats.gold > goldBefore
        || JSON.stringify(stats.unitTechs) !== '{}'));

// 5. Lose on purpose: sell the army, ready up with nothing
for (let i = stats.heroRoster.length - 1; i >= 0; i--) game.getService('sellUnit')(0, i);
stats.gold = 0;
const hpBeforeLoss = stats.commanderHP;
game.serverNetworkSystem.handleReadyForBattle({ playerId: 0, numericPlayerId: 0 }, () => {});
game.serverNetworkSystem.handleReadyForBattle({ playerId: 1, numericPlayerId: 1 }, () => {});
for (let i = 0; i < 120 && game.state.phase !== enums.gamePhase.battle; i++) step(1);
for (let i = 0; i < 2200 && game.state.phase === enums.gamePhase.battle; i++) step(1);
for (let i = 0; i < 400 && game.state.phase !== enums.gamePhase.campaignMap
    && game.state.phase !== enums.gamePhase.ended; i++) step(1);

const state2 = game.getService('getCampaignState')();
check('loss costs commander HP and the run survives',
    stats.commanderHP < hpBeforeLoss && stats.commanderHP > 0
    && game.state.phase === enums.gamePhase.campaignMap,
    `${hpBeforeLoss} -> ${stats.commanderHP}`);
check('lost node stays uncleared (replayable)', state2.depth === 1
    && (state2.reachable || []).includes(node2),
    `depth ${state2.depth}, reachable ${state2.reachable?.join(',')}`);

// 6. Save/load round-trip
game.getService('saveCampaignRun')();
const saved = game.getService('loadCampaignRun')();
check('save round-trips map, HP, and roster',
    saved?.version === 1 && saved.commanderHP === stats.commanderHP
    && saved.map?.layers?.length === 12 && Array.isArray(saved.roster));

console.log(`\n${passCount}/${passCount + failCount} campaign checks passed`);
process.exit(failCount ? 1 : 0);
