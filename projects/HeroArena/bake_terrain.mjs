// Bake a level's painted ground canvas to resources/levels/<level>.png so
// future loads blit it instantly instead of painting per-tile.
// Usage: node projects/HeroArena/bake_terrain.mjs [levelId]   (server on :3000)
import puppeteer from 'puppeteer';
import fs from 'fs';

const levelId = process.argv[2] || 'battleplain';

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--window-size=1280,800', '--enable-gpu', '--use-angle=default']
});
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#mainMenu_PlayGameBtn', { timeout: 60000 });
    await page.click('#mainMenu_PlayGameBtn');
    await page.waitForSelector('[data-mode="skirmish"]', { timeout: 15000 });
    await page.click('[data-mode="skirmish"]');
    await page.waitForSelector('#skirmishLevelSelect', { timeout: 15000 });
    await page.select('#skirmishLevelSelect', levelId);
    await page.click('#skirmishStartBtn');

    // Wait for the paint to finish (loading overlay removed)
    await page.waitForFunction(() => !document.querySelector('#sceneLoadingOverlay.visible') &&
        window.game?.worldSystem?.worldRenderer,
        { timeout: 300000, polling: 1000 });

    const dataUrl = await page.evaluate(() => {
        const wr = window.game.worldSystem.worldRenderer;
        const tex = wr.getGroundTexture?.();
        const canvas = tex?.image || tex?.source?.data;
        if (!canvas?.toDataURL) return null;
        return canvas.toDataURL('image/png');
    });
    if (!dataUrl) throw new Error('could not extract ground canvas');

    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const out = `projects/HeroArena/resources/levels/${levelId}.png`;
    fs.writeFileSync(out, buf);
    console.log(`baked ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
} finally {
    await browser.close();
}
