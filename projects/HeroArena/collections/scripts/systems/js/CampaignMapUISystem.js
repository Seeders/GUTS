// Campaign run map overlay (client). Renders the branching node map between
// battles: click a reachable node to enter it. Builds its own DOM appended to
// document.body (same pattern as GameModeSystem's programmatic dialogs) so
// the shared game.html stays untouched. Self-disables outside campaign mode.
class CampaignMapUISystem extends GUTS.BaseSystem {

    static services = [];

    static serviceDependencies = [
        'submitEnterCampaignNode'
    ];

    constructor(game) {
        super(game);
        this.game.campaignMapUISystem = this;
        this._root = null;
    }

    // ─── Events ─────────────────────────────────────────────────────────────────

    onCampaignMapShow(state) {
        this._render(state);
        this._ensureRoot().style.display = 'flex';
        // No enemy commander in campaign — hide the opponent HP HUD.
        const opp = document.getElementById('opponentHPSection');
        if (opp) opp.style.display = 'none';
    }

    onPlacementPhaseStart() {
        if (this._root) this._root.style.display = 'none';
    }

    // ─── DOM ────────────────────────────────────────────────────────────────────

    _ensureRoot() {
        if (this._root) return this._root;
        const root = document.createElement('div');
        root.id = 'campaignMapOverlay';
        root.style.cssText = `
            position: fixed; inset: 0; z-index: 2500; display: none;
            flex-direction: column; align-items: center;
            background: radial-gradient(ellipse at center, rgba(18,22,32,0.96), rgba(8,10,16,0.99));
            color: #e8e2d0; font-family: inherit; overflow: hidden;`;
        root.innerHTML = `
            <div id="campHeader" style="display:flex; gap:28px; align-items:center; padding:18px 0 6px;
                 font-size:1.05rem; letter-spacing:1px;">
                <span style="font-size:1.35rem; font-weight:bold;">⚔ THE MARCH</span>
                <span id="campHP"></span>
                <span id="campGold"></span>
                <span id="campDepth"></span>
                <button id="campAbandon" style="margin-left:24px; padding:4px 14px; background:#5a2222;
                    border:1px solid #a33; color:#fdd; border-radius:4px; cursor:pointer;">Abandon Run</button>
            </div>
            <div id="campScroll" style="flex:1; width:100%; overflow:auto; position:relative;">
                <div id="campCanvas" style="position:relative; margin:0 auto;"></div>
            </div>
            <div style="padding:10px; opacity:0.7; font-size:0.85rem;">
                Pick a glowing node to march on. Losses cost commander HP — the run ends at 0.
            </div>`;
        document.body.appendChild(root);
        root.querySelector('#campAbandon').addEventListener('click', () => {
            if (!confirm('Abandon this run? The save will be deleted.')) return;
            this.game.campaignRunSystem?.clearCampaignRun?.();
            window.location.reload();
        });
        this._root = root;
        return root;
    }

    _render(state) {
        const root = this._ensureRoot();
        const layers = state?.map?.layers || [];
        const reachable = new Set(state?.reachable || []);

        root.querySelector('#campHP').textContent = `❤️ ${state.commanderHP}/${state.maxHP || 210}`;
        root.querySelector('#campGold').textContent = `💰 ${state.gold}`;
        root.querySelector('#campDepth').textContent =
            `📍 Node ${Math.min((state.depth || 0) + 1, state.layers)} / ${state.layers}`;

        const COL_W = 150, ROW_H = 110, PAD = 60;
        const maxWide = Math.max(1, ...layers.map(l => l.length));
        const width = PAD * 2 + (layers.length - 1) * COL_W + 80;
        const height = PAD * 2 + (maxWide - 1) * ROW_H + 80;

        const posOf = (node, layer) => {
            const x = PAD + node.layer * COL_W;
            const spread = (layer.length - 1) * ROW_H;
            const y = PAD + (height - PAD * 2 - spread) / 2 + node.index * ROW_H - 40;
            return { x, y };
        };

        const canvas = root.querySelector('#campCanvas');
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        // Edges (SVG underlay)
        let edges = '';
        const nodePos = {};
        for (const layer of layers) for (const n of layer) nodePos[n.id] = posOf(n, layer);
        for (const layer of layers) {
            for (const n of layer) {
                for (const to of n.edges || []) {
                    const a = nodePos[n.id], b = nodePos[to];
                    if (!a || !b) continue;
                    const lit = n.cleared && reachable.has(to);
                    edges += `<line x1="${a.x + 32}" y1="${a.y + 32}" x2="${b.x + 32}" y2="${b.y + 32}"
                        stroke="${lit ? '#d8b45a' : '#3a4152'}" stroke-width="${lit ? 3 : 2}"
                        ${lit ? '' : 'stroke-dasharray="6,5"'} />`;
                }
            }
        }

        const ICONS = { battle: '⚔️', elite: '💀', shop: '🛒', boss: '👑' };
        let nodes = '';
        for (const layer of layers) {
            for (const n of layer) {
                const p = nodePos[n.id];
                const canGo = reachable.has(n.id);
                const style = n.cleared
                    ? 'opacity:0.35; border-color:#4a5;'
                    : canGo
                        ? 'border-color:#d8b45a; box-shadow:0 0 18px rgba(216,180,90,0.55); cursor:pointer; animation:campPulse 1.4s infinite;'
                        : 'opacity:0.55; border-color:#3a4152;';
                nodes += `<div class="camp-node" data-node="${canGo ? n.id : ''}"
                    style="position:absolute; left:${p.x}px; top:${p.y}px; width:64px; height:64px;
                    border-radius:50%; border:2px solid; background:#141a26; display:flex;
                    align-items:center; justify-content:center; font-size:1.7rem; ${style}"
                    title="${n.type}${n.cleared ? ' (cleared)' : ''}">${ICONS[n.type] || '⚔️'}</div>`;
            }
        }

        canvas.innerHTML = `
            <style>@keyframes campPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.09); } }</style>
            <svg width="${width}" height="${height}" style="position:absolute; inset:0;">${edges}</svg>
            ${nodes}`;

        canvas.querySelectorAll('[data-node]').forEach(el => {
            const id = el.dataset.node;
            if (!id) return;
            el.addEventListener('click', () => {
                this.call.submitEnterCampaignNode(id, () => {});
            });
        });

        // Auto-scroll toward the frontier.
        const scroll = root.querySelector('#campScroll');
        scroll.scrollLeft = Math.max(0, (state.depth || 0) * COL_W - scroll.clientWidth / 3);
    }
}
