// E2E for the Mechabellum-style HeroArena loop (local skirmish vs AI).
// Usage: node projects/HeroArena/test_mechabellum.mjs   (server on :3000)
import puppeteer from 'puppeteer';

const results = [];
const errors = [];
function check(name, ok, detail = '') {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function waitSim(page, simSeconds, maxWallMs = 120000) {
    const start = await page.evaluate(() => window.game.state.now);
    await page.waitForFunction((s, d) => window.game.state.now >= s + d,
        { timeout: maxWallMs, polling: 250 }, start, simSeconds);
}

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--window-size=1280,800', '--enable-gpu', '--use-angle=default']
});

try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#mainMenu_PlayGameBtn', { timeout: 60000 });
    await page.click('#mainMenu_PlayGameBtn');
    await page.waitForSelector('[data-mode="skirmish"]', { timeout: 15000 });
    await page.click('[data-mode="skirmish"]');
    await page.waitForSelector('#skirmishStartBtn', { timeout: 15000 });

    const levelDefault = await page.$eval('#skirmishLevelSelect', el => el.value);
    check('battleplain is the default map', levelDefault === 'battleplain', levelDefault);

    await page.click('#skirmishStartBtn');

    // ── Leader select, then straight to prep (no building pick) ────────────
    await page.waitForFunction(() =>
        document.querySelector('#leaderSelectOverlay:not(.hidden) #leaderOptions')?.children?.length > 0,
        { timeout: 120000, polling: 400 });
    check('leader select appears', true);

    // Wait for the scene load (terrain painting) to fully finish — the loading
    // overlay eats pointer input until then, exactly as it does for a player.
    await page.waitForFunction(() => !document.querySelector('#sceneLoadingOverlay.visible'),
        { timeout: 180000, polling: 500 });
    await page.evaluate(() => {
        document.querySelector('#leaderOptions').children[0].click();
    });

    await page.waitForFunction(() =>
        window.game?.state?.phase === window.game?.getEnums?.()?.gamePhase?.placement,
        { timeout: 60000, polling: 300 });
    const afterLeader = await page.evaluate(() => ({
        buildingOverlay: !document.getElementById('heroSelectOverlay')?.classList?.contains('hidden'),
        round: window.game.state.round
    }));
    check('leader pick goes straight to prep (no building select)',
        afterLeader.buildingOverlay === false, `round ${afterLeader.round}`);

    await waitSim(page, 1);

    // ── Prep round 1: commander HP, roster shop, no offers ────────────────
    const prep1 = await page.evaluate(() => {
        const game = window.game;
        let my = null, op = null;
        for (const eid of game.getEntitiesWith('playerStats')) {
            const s = game.getComponent(eid, 'playerStats');
            if (s.playerId === 0) my = s; else op = s;
        }
        return {
            myHP: my?.commanderHP, opHP: op?.commanderHP, gold: my?.gold,
            offers: (my?.currentOffers || []).length,
            shopPanelHidden: document.getElementById('shopPanel')?.classList?.contains('hidden'),
            unitCards: document.querySelectorAll('#unlockedUnitsCards [data-unit-id]').length,
            hpLabel: document.querySelector('#playerHPSection .hud-label')?.textContent,
            townHalls: game.getEntitiesWith('buildingOwner').length,
            mines: game.getEntitiesWith('goldMine').length
        };
    });
    check('commander HP initialized at 1000 for both', prep1.myHP === 1000 && prep1.opHP === 1000);
    check('no buildings or mines on the field', prep1.townHalls === 0 && prep1.mines === 0,
        `buildings ${prep1.townHalls}, mines ${prep1.mines}`);
    check('random offers gone, shop panel hidden', prep1.offers === 0 && prep1.shopPanelHidden === true);
    check('all 6 tier-1 units buyable from round 1', prep1.unitCards === 6, `${prep1.unitCards} cards`);
    check('HUD shows commander label', /Commander/.test(prep1.hpLabel || ''), prep1.hpLabel);

    // Buy two units via service and confirm they spawn
    const buy = await page.evaluate(() => {
        const game = window.game;
        const r1 = game.getService('buyUnlockedUnit')(0, '1_s_barbarian');
        const r2 = game.getService('buyUnlockedUnit')(0, '1_d_archer');
        let my = null;
        for (const eid of game.getEntitiesWith('playerStats')) {
            const s = game.getComponent(eid, 'playerStats');
            if (s.playerId === 0) my = s;
        }
        return { ok1: r1?.success, ok2: r2?.success, roster: my?.heroRoster?.length, gold: my?.gold };
    });
    check('buying units works', buy.ok1 && buy.ok2 && buy.roster === 2,
        `roster ${buy.roster}, ${buy.gold}g left`);

    // New units are draggable: move one and confirm the position changes
    const dragNew = await page.evaluate(() => {
        const game = window.game;
        const mine = game.getEntitiesWith('heroRosterInfo').filter(id =>
            game.getComponent(id, 'heroRosterInfo')?.playerId === 0);
        const uid = mine[0];
        const before = { ...game.getComponent(uid, 'transform').position };
        const res = game.placementSystem.moveHero(uid, before.x + 100, before.z + 60);
        const after = game.getComponent(uid, 'transform').position;
        const locked = game.heroRosterSystem.isUnitLocked(uid);
        return { moved: Math.hypot(after.x - before.x, after.z - before.z) > 50, locked, res: res?.success };
    });
    check('fresh units are placeable (not locked)', dragNew.moved && dragNew.locked === false);

    // ── Battle round 1 ─────────────────────────────────────────────────────
    await page.click('#placementReadyBtn');
    await page.waitForFunction(() =>
        window.game.state.phase === window.game.getEnums().gamePhase.battle,
        { timeout: 30000, polling: 300 });
    check('battle starts on ready', true);

    // Wait for round 2 prep (battle resolves + intermission)
    await page.waitForFunction(() =>
        window.game.state.round === 2 &&
        window.game.state.phase === window.game.getEnums().gamePhase.placement,
        { timeout: 180000, polling: 500 });

    const resolve1 = await page.evaluate(() => {
        const game = window.game;
        let my = null, op = null;
        for (const eid of game.getEntitiesWith('playerStats')) {
            const s = game.getComponent(eid, 'playerStats');
            if (s.playerId === 0) my = s; else op = s;
        }
        return { myHP: my?.commanderHP, opHP: op?.commanderHP,
                 myRoster: my?.heroRoster?.length,
                 lockedEntries: (my?.heroRoster || []).filter(e => e.lastPosition).length };
    });
    check('battle resolves into commander damage', resolve1.myHP < 1000 || resolve1.opHP < 1000,
        `me ${resolve1.myHP}, enemy ${resolve1.opHP}`);
    check('army persists into round 2 with locked positions',
        resolve1.myRoster === 2 && resolve1.lockedEntries === 2,
        `${resolve1.myRoster} roster entries, ${resolve1.lockedEntries} locked`);

    await waitSim(page, 1);

    // ── Round 2: veterans are locked ───────────────────────────────────────
    const lockTest = await page.evaluate(() => {
        const game = window.game;
        const mine = game.getEntitiesWith('heroRosterInfo').filter(id =>
            game.getComponent(id, 'heroRosterInfo')?.playerId === 0);
        const uid = mine[0];
        const locked = game.heroRosterSystem.isUnitLocked(uid);
        const uiLocked = game.placementUISystem._isDeploymentLocked(uid);
        // Server-side move gate (call the authoritative handler directly)
        const before = { ...game.getComponent(uid, 'transform').position };
        let serverResult = null;
        game.serverNetworkSystem?.handleHeroMoved?.(
            { playerId: 0, numericPlayerId: 0,
              data: { entityId: uid, x: before.x + 200, z: before.z + 200 } },
            (res) => { serverResult = res; });
        const sell = game.getService('sellUnit')(0, 0);
        return { locked, uiLocked, serverResult, sellReason: sell?.reason, sellOk: sell?.success };
    });
    check('veterans are deployment-locked', lockTest.locked === true && lockTest.uiLocked === true);
    check('server rejects moving a locked veteran',
        lockTest.serverResult?.success === false && lockTest.serverResult?.reason === 'deployment_locked',
        JSON.stringify(lockTest.serverResult));
    check('selling a fought unit is blocked',
        lockTest.sellOk === false && lockTest.sellReason === 'deployment_locked', lockTest.sellReason);

    // ── Unit techs ─────────────────────────────────────────────────────────
    const techTest = await page.evaluate(() => {
        const game = window.game;
        let my = null;
        for (const eid of game.getEntitiesWith('playerStats')) {
            const s = game.getComponent(eid, 'playerStats');
            if (s.playerId === 0) my = s;
        }
        my.gold = 500; // test budget

        const buyTech = game.getService('buyUnitTech');

        // Barbarian unit on the field (bought in round 1)
        const barb = game.getEntitiesWith('heroRosterInfo').find(id => {
            const info = game.getComponent(id, 'heroRosterInfo');
            if (info?.playerId !== 0) return false;
            const entry = my.heroRoster[info.rosterIndex];
            return entry?.spawnType === '1_s_barbarian';
        });
        const hpBefore = game.getComponent(barb, 'health').max;
        const abilitiesBefore = game.abilitySystem.getEntityAbilities(barb).map(a => a.id);

        const statRes = buyTech(0, '1_s_barbarian', 'bar_plating');
        const hpAfter = game.getComponent(barb, 'health').max;

        const abilityRes = buyTech(0, '1_s_barbarian', 'bar_rage');
        const abilitiesAfter = game.abilitySystem.getEntityAbilities(barb).map(a => a.id);

        const unlockRes = buyTech(0, '1_s_barbarian', 'bar_berserker');
        const unlocked = game.getService('getShopStateForPlayer')(0).unlocked.map(u => u.id);

        // Tech gating: can't tech a type you don't field
        const gateRes = buyTech(0, '1_i_apprentice', 'app_focus');

        return {
            statOk: statRes?.success, hpBefore, hpAfter,
            abilityOk: abilityRes?.success, abilitiesBefore, abilitiesAfter,
            unlockOk: unlockRes?.success, hasBerserker: unlocked.includes('2_s_berserker'),
            gateReason: gateRes?.reason
        };
    });
    check('stat tech boosts live units', techTest.statOk && techTest.hpAfter > techTest.hpBefore,
        `hp ${techTest.hpBefore} -> ${techTest.hpAfter}`);
    check('abilities require investment (none before tech)', techTest.abilitiesBefore.length === 0,
        `before: [${techTest.abilitiesBefore.join(',')}]`);
    check('ability tech activates the ability', techTest.abilityOk && techTest.abilitiesAfter.includes('RageAbility'),
        `after: [${techTest.abilitiesAfter.join(',')}]`);
    check('unlock tech adds tier-2 unit to roster', techTest.unlockOk && techTest.hasBerserker);
    check('cannot tech an unfielded type', techTest.gateReason === 'no_unit_of_type', techTest.gateReason);

    // Tech panel UI: ⚙ button on fielded unit card opens the panel
    const uiTest = await page.evaluate(() => {
        const btn = document.querySelector('[data-tech-unit="1_s_barbarian"]');
        if (btn) btn.click();
        const overlay = document.getElementById('techTreeOverlay');
        return {
            btnExists: !!btn,
            panelOpen: overlay && !overlay.classList.contains('hidden'),
            rows: document.querySelectorAll('.unit-tech-row').length,
            ownedRows: document.querySelectorAll('.unit-tech-row.owned').length
        };
    });
    check('tech panel opens from unit card with full tech list',
        uiTest.btnExists && uiTest.panelOpen && uiTest.rows === 7 && uiTest.ownedRows === 3,
        `${uiTest.rows} techs, ${uiTest.ownedRows} owned`);
    await page.screenshot({ path: 'projects/HeroArena/test_techs.png' });
    await page.evaluate(() => document.getElementById('techTreeCloseBtn')?.click());

    await page.screenshot({ path: 'projects/HeroArena/test_mechabellum.png' });
    console.log('screenshot: projects/HeroArena/test_mechabellum.png');

} catch (e) {
    check('test run completed', false, e.message);
} finally {
    await browser.close();
}

const failed = results.filter(r => !r.ok);
const relevant = errors.filter(e => !e.includes('favicon') && !e.includes('404'));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (relevant.length) {
    console.log('Console errors (first 10):');
    relevant.slice(0, 10).forEach(e => console.log('  ', e.slice(0, 250)));
}
process.exit(failed.length ? 1 : 0);
