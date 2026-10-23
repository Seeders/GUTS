// Runs a probe once the world room is up. MultiplayerHost calls global.__gutsProbe(ctx) after
// onReady; games on older hosts call global.__profileHook(game) from their own onReady.
export function whenWorldReady(fn) {
    let ran = false;
    const run = (game) => { if (ran || !game) return; ran = true; return fn(game); };
    global.__gutsProbe = (ctx) => run(ctx.game);
    global.__profileHook = (game) => run(game);
}
