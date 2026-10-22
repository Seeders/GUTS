/**
 * AttachmentEditor - what a unit holds or wears on its bones, fitted by eye, in the GUTS editor.
 *
 * Opened on a unit (the attachmentModule, "render"). Beside the panel the unit stands in a pose of
 * your choosing (rest, or any of its animations at any frame) with its equipment on: the entries of
 * render.equipment { slot, item, attachmentData: { bone, offset, rotation (degrees), scale } }, each
 * item's model (collections.items[item].render.model) on its bone through BoneAttachment, as the
 * Graphics Editor and a game's runtime put them.
 *
 * Pick an entry and fit it: drag in the view (Move, Turn, Size: W E R; Q the camera), or type and
 * nudge the numbers; change its bone; add and remove entries. Save writes render.equipment back
 * through the editor (the module's saveHook), leaving the rest of render as it was.
 *
 * The preview is its own three.js scene on the pane's canvas; it runs no game systems. Models are
 * built as the Graphics Editor builds them (a ShapeFactory at glTF scale 32), so an attachment looks
 * here as it does there; the unit's animation clips come from a ModelManager of its own.
 */
class AttachmentEditor {
    constructor(controller, moduleConfig, GUTS) {
        if (window.attachmentEditor) return window.attachmentEditor;     // (the editor makes its modules more than once: one listens)
        window.attachmentEditor = this;
        this.controller = controller;
        this.config = moduleConfig;
        this.orbit = { yaw: 20, pitch: 10, dist: 1.6, at: 0.6 };
        this.tool = 'camera';
        this.selected = -1;
        this.uniform = true;
        document.body.addEventListener(moduleConfig.loadHook, (e) => this.load(e.detail || {}));
        document.body.addEventListener(moduleConfig.unloadHook, () => this.unload());
    }

    cols() { return this.controller.getCollections(); }
    $(id) { return document.getElementById(id); }
    status(t) { const el = this.$('ae-status'); if (el) el.textContent = t || ''; }
    get A() { return GUTS.BoneAttachment; }

    // ==================== LOADING ====================

    load(detail) {
        const type = this.controller.getSelectedType?.() || 'units';
        const id = this.controller.getSelectedObject?.();
        const def = detail.objectData || this.cols()[type]?.[id];
        if (!def?.render?.model) return;
        this.type = type; this.id = id; this.def = def;
        this.equipment = JSON.parse(JSON.stringify(def.render.equipment || [])).map(e => ({ ...e, attachmentData: this.A.normalize(e.attachmentData) }));
        this.savedJSON = this.storedJSON();
        this.selected = this.equipment.length ? 0 : -1;
        this.bind();
        this.$('ae-unit').textContent = `${def.title || id}  (${id})`;
        this.renderList();
        this.renderEdit();
        this.dirty();
        this.boot();
    }

    unload() {
        this.stop();
    }

    storedJSON() {
        return JSON.stringify(this.equipment.map(e => ({ ...e, attachmentData: this.A.stored(e.attachmentData) })));
    }

    /** The panel's controls (the pane's DOM is new each time its tab opens). */
    bind() {
        const root = this.$('attachment-editor-container');
        if (!root || root === this._root) return;
        this._root = root;
        for (const k of ['yaw', 'pitch', 'dist', 'at']) {
            const el = this.$('ae-' + k);
            el.value = this.orbit[k];
            el.oninput = () => { this.orbit[k] = +el.value; };
        }
        root.querySelectorAll('[data-yaw]').forEach(b => b.onclick = () => { this.orbit.yaw = +b.dataset.yaw; this.syncOrbit(); });
        this.$('ae-anim').onchange = () => this.setPose(this.$('ae-anim').value);
        this.$('ae-time').oninput = () => { this.$('ae-play').checked = false; this.poseAt(+this.$('ae-time').value); };
        this.$('ae-step').onchange = () => this.renderEdit();
        this.$('ae-bone').onchange = () => { const e = this.entry(); if (e) { e.attachmentData.bone = this.$('ae-bone').value; this.reattach(this.selected); this.changed(); } };
        this.$('ae-reset').onclick = () => { const e = this.entry(); if (e) { e.attachmentData = this.A.normalize({ bone: e.attachmentData.bone }); this.changed(true); } };
        this.$('ae-remove').onclick = () => this.removeEntry();
        this.$('ae-add').onclick = () => this.addEntry();
        this.$('ae-revert').onclick = () => this.revert();
        this.$('ae-save').onclick = () => this.save();
        this.$('ae-add-slot').innerHTML = Object.keys(this.A.SLOT_BONES).map(s => `<option>${s}</option>`).join('');
        const items = Object.entries(this.cols().items || {}).filter(([, d]) => d?.render?.model).map(([k, d]) => [k, d.title || k]).sort((a, b) => a[1].localeCompare(b[1]));
        this.$('ae-add-item').innerHTML = items.map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
        this.bindOverlay();
    }

    entry() { return this.equipment?.[this.selected] || null; }

    renderList() {
        const host = this.$('ae-list');
        if (!host) return;
        if (!this.equipment.length) { host.innerHTML = '<div class="ae__empty">Nothing held or worn yet.</div>'; return; }
        host.innerHTML = '';
        this.equipment.forEach((e, i) => {
            const row = document.createElement('div');
            row.className = 'ae__entry' + (i === this.selected ? ' is-on' : '');
            row.innerHTML = `<span>${this.cols().items?.[e.item]?.title || e.item}</span><small>${e.slot} · ${this.A.bareName(this.boneOf(i)?.name || e.attachmentData.bone) || '—'}</small>`;
            row.onclick = () => { this.selected = i; this.renderList(); this.renderEdit(); };
            host.appendChild(row);
        });
    }

    renderEdit() {
        const sec = this.$('ae-edit'), e = this.entry();
        if (!sec) return;
        sec.style.display = e ? '' : 'none';
        if (!e) return;
        this.$('ae-which').textContent = `${e.slot}: ${this.cols().items?.[e.item]?.title || e.item}`;
        // (plain names, "mixamorig" prefixes off: what the data keeps, the same on any rig with those bones)
        const bare = (n) => this.A.bareName(n);
        const bones = [...new Set([...(this.bones?.values() || [])].map(b => bare(b.name)))];
        const cur = bare(this.boneOf(this.selected)?.name || e.attachmentData.bone);
        this.$('ae-bone').innerHTML = (cur && !bones.includes(cur) ? [cur, ...bones] : bones).map(b => `<option${b === cur ? ' selected' : ''}>${b}</option>`).join('');
        this.renderFields();
    }

    /** Steps per click: offset a share of the unit's height, turns in degrees, size in hundredths. */
    steps() {
        const k = +(this.$('ae-step')?.value || 1);
        return { offset: (this.height || 1.8) * 0.005 * k, rotation: k, scale: 0.01 * k };
    }

    renderFields() {
        const host = this.$('ae-fields'), e = this.entry();
        if (!host || !e) return;
        const f = e.attachmentData, st = this.steps();
        host.innerHTML = '';
        for (const g of ['offset', 'rotation', 'scale']) {
            const h = document.createElement('div');
            h.className = 'ae__group';
            h.textContent = g === 'offset' ? 'Move (in the bone\'s frame)' : g === 'rotation' ? 'Turn (degrees)' : 'Size';
            if (g === 'scale') {
                const lab = document.createElement('label');
                lab.className = 'ae__lock';
                lab.innerHTML = '<input type="checkbox"> uniform';
                const cb = lab.firstChild;
                cb.checked = this.uniform;
                cb.onchange = () => { this.uniform = cb.checked; };
                h.appendChild(lab);
            }
            host.appendChild(h);
            for (const a of ['x', 'y', 'z']) {
                const step = st[g], get = () => f[g][a];
                const set = (v) => {
                    const r = +(+v).toFixed(4);
                    if (g === 'scale' && this.uniform) { f.scale.x = f.scale.y = f.scale.z = r; host.querySelectorAll('[data-scale]').forEach(el => { el.value = r; }); }
                    else f[g][a] = r;
                };
                const row = document.createElement('div');
                row.className = 'ae__field';
                row.innerHTML = `<label>${a.toUpperCase()}</label><button class="ae__btn">−</button><input type="number"><button class="ae__btn">+</button>`;
                const [minus, input, plus] = [row.children[1], row.children[2], row.children[3]];
                input.step = String(step);
                if (g === 'scale') input.dataset.scale = a;
                input.value = get();
                const nudge = (d) => { set(get() + d * step); input.value = get(); this.changed(); };
                minus.onclick = () => nudge(-1);
                plus.onclick = () => nudge(1);
                input.oninput = () => { if (input.value !== '' && Number.isFinite(+input.value)) { set(input.value); this.changed(); } };
                input.onwheel = (ev) => { ev.preventDefault(); nudge(ev.deltaY < 0 ? 1 : -1); };
                host.appendChild(row);
            }
        }
    }

    /** Something changed: the item moves now; the fields redraw only when asked (not while typing in them). */
    changed(redraw = false) {
        const i = this.selected, it = this.items?.get(i);
        if (it) this.A.apply(it, this.equipment[i].attachmentData);
        if (redraw) this.renderFields();
        this.dirty();
    }

    dirty() {
        const el = this.$('ae-dirty');
        if (el) el.textContent = this.storedJSON() !== this.savedJSON ? 'Unsaved changes' : '';
    }

    addEntry() {
        const slot = this.$('ae-add-slot').value, item = this.$('ae-add-item').value;
        if (!item) return;
        this.equipment.push({ slot, item, attachmentData: this.A.normalize({}) });
        this.selected = this.equipment.length - 1;
        this.loadItem(this.selected).then(() => { this.renderList(); this.renderEdit(); });
        this.renderList(); this.renderEdit(); this.dirty();
    }

    removeEntry() {
        const i = this.selected;
        if (i < 0) return;
        this.equipment.splice(i, 1);
        this.selected = Math.min(i, this.equipment.length - 1);
        this.loadItems();
        this.renderList(); this.renderEdit(); this.dirty();
    }

    revert() {
        this.equipment = JSON.parse(this.savedJSON).map(e => ({ ...e, attachmentData: this.A.normalize(e.attachmentData) }));
        this.selected = Math.min(Math.max(this.selected, 0), this.equipment.length - 1);
        this.loadItems();
        this.renderList(); this.renderEdit(); this.dirty();
    }

    save() {
        if (!this.def) return;
        const render = JSON.parse(JSON.stringify(this.def.render));
        const list = this.equipment.map(e => ({ ...e, attachmentData: this.A.stored(e.attachmentData) }));
        if (list.length) render.equipment = list; else delete render.equipment;
        document.body.dispatchEvent(new CustomEvent(this.config.saveHook, { detail: { propertyName: this.config.propertyName || 'render', data: render }, bubbles: true }));
        this.savedJSON = this.storedJSON();
        this.dirty();
        const el = this.$('ae-dirty');
        if (el) el.textContent = 'Saved.';
    }

    // ==================== THE PREVIEW ====================

    async boot() {
        const canvas = this.$('ae-canvas');
        if (!canvas) return;
        const token = this._token = {};
        this.stop();
        this.status('Loading…');
        try {
            const T = THREE, C = this.cols();
            if (!this.renderer || this.renderer.domElement !== canvas) {
                this.renderer?.dispose?.();
                this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                this.renderer.shadowMap.enabled = true;
            }
            const scene = this.scene = new T.Scene();
            scene.background = new T.Color(0x3a4048);
            this.camera = new T.PerspectiveCamera(40, 1, 0.1, 20000);
            scene.add(new T.HemisphereLight(0xffffff, 0x404850, 1.6));
            const sun = new T.DirectionalLight(0xffffff, 2.2);
            sun.position.set(2, 4, 3); sun.castShadow = true;
            scene.add(sun);
            const app = { getResourcesPath: () => this.controller.getResourcesPath() };
            this.mm = new GUTS.ModelManager(app, {}, { ShapeFactory: GUTS.ShapeFactory, palette: this.controller.getPalette?.(), textures: C.textures, models: C.models, animations: C.animations, shaders: C.shaders });
            this.sf = new GUTS.ShapeFactory(this.controller.getResourcesPath(), this.controller.getPalette?.(), C.textures, null, 32, C.models, C.animations);
            if (C.shaders) this.sf.setShaders?.(C.shaders);
            const holder = await this.build(this.def.render.model);
            if (token !== this._token) return;
            holder.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
            scene.add(holder);
            this.holder = holder;
            holder.updateMatrixWorld(true);
            const box = new T.Box3().setFromObject(holder);
            this.height = Math.max(0.2, box.max.y - box.min.y);
            this.base = box.min.y;
            const floor = new T.Mesh(new T.CircleGeometry(this.height * 1.5, 48).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: 0x5b626c, roughness: 1 }));
            floor.position.y = this.base; floor.receiveShadow = true;
            scene.add(floor);
            this.bones = this.A.bones(holder);
            await this.loadClips(token);
            if (token !== this._token) return;
            await this.loadItems();
            this.renderList(); this.renderEdit();
            this.resize();
            this._ro?.disconnect();
            this._ro = new ResizeObserver(() => this.resize());
            this._ro.observe(canvas.parentElement);
            this.status(this.bones.size ? '' : 'This model has no skeleton: items attach to its root.');
            this.loop();
        } catch (e) {
            console.error('[AttachmentEditor] preview failed', e);
            this.status(`Couldn't start the preview: ${e.message}`);
        }
    }

    /** A model definition (render.model) as the Graphics Editor makes it. */
    async build(modelData) {
        const root = new THREE.Group();
        for (const name in modelData) {
            const g = await this.sf.createMergedGroupFromJSON(modelData, {}, name, null, null);
            if (g) root.add(g);
        }
        return root;
    }

    /** The unit's animations (render.animations), each as a clip the pose menu can show. */
    async loadClips(token) {
        this.clips = new Map();
        const anims = Object.keys(this.def.render.animations || {});
        if (anims.length) {
            await this.mm.ensureLoaded(this.type, this.id, { [this.id]: this.def });
            for (const name of anims) {
                const am = this.mm.animationModels.get(`${this.type}_${this.id}_${name}`);
                let clip = null;
                am?.traverse?.(o => { if (!clip && o.userData?.animations?.[0]) clip = o.userData.animations[0]; });
                clip = clip || am?.animations?.[0] || null;
                if (clip) this.clips.set(name, clip);
            }
        }
        if (token !== this._token) return;
        const sel = this.$('ae-anim');
        if (sel) sel.innerHTML = ['<option value="">rest</option>', ...[...this.clips.keys()].map(n => `<option${n === 'idle' ? ' selected' : ''}>${n}</option>`)].join('');
        this.setPose(this.clips.has('idle') ? 'idle' : '');
    }

    setPose(name) {
        this.mixer?.stopAllAction();
        this.mixer = null; this.action = null;
        if (!this.holder) return;
        if (!name || !this.clips.get(name)) {
            this.holder.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); });
            return;
        }
        this.mixer = new THREE.AnimationMixer(this.holder);
        this.action = this.mixer.clipAction(this.clips.get(name));
        this.action.play();
        this.poseAt(+(this.$('ae-time')?.value || 0));
    }

    poseAt(t) {
        if (!this.action) return;
        this.action.time = t * this.action.getClip().duration;
        this.mixer.update(0);
    }

    async loadItems() {
        for (const it of this.items?.values() || []) it.parent?.remove(it);
        this.items = new Map();
        await Promise.all(this.equipment.map((e, i) => this.loadItem(i)));
    }

    async loadItem(i) {
        const e = this.equipment[i], def = this.cols().items?.[e?.item];
        if (!def?.render?.model || !this.holder) return;
        const obj = await this.build(def.render.model);
        if (this.equipment[i] !== e) return;
        obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.items.get(i)?.parent?.remove(this.items.get(i));
        this.items.set(i, obj);
        this.A.attach(this.holder, obj, e.attachmentData, e.slot, this.bones);
    }

    /** A new bone for an item: moved there (its fit kept, now in the new bone's frame). */
    reattach(i) {
        const obj = this.items?.get(i), e = this.equipment[i];
        if (!obj || !e) return;
        obj.parent?.remove(obj);
        this.A.attach(this.holder, obj, e.attachmentData, e.slot, this.bones);
        this.renderList();
    }

    boneOf(i) {
        const e = this.equipment?.[i];
        return e && this.bones ? this.A.findBone(this.bones, e.attachmentData, e.slot) : null;
    }

    resize() {
        const p = this.$('ae-canvas')?.parentElement, w = p?.clientWidth, h = p?.clientHeight;
        if (!w || !h || !this.renderer) return;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    loop() {
        let last = performance.now();
        const tick = (now) => {
            if (!this.scene) return;
            const dt = Math.min(0.1, (now - last) / 1000); last = now;
            if (this.$('ae-play')?.checked && this.mixer) {
                this.mixer.update(dt);
                const d = this.action.getClip().duration || 1, el = this.$('ae-time');
                if (el) el.value = (this.action.time % d) / d;
            }
            this.placeCamera();
            this.renderer.render(this.scene, this.camera);
            this._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
    }

    placeCamera() {
        const D = Math.PI / 180, o = this.orbit, H = this.height || 1.8;
        const target = new THREE.Vector3(0, (this.base || 0) + H * o.at, 0);
        const r = H * o.dist * 1.6;
        this.camera.position.set(target.x + Math.sin(o.yaw * D) * Math.cos(o.pitch * D) * r, target.y + Math.sin(o.pitch * D) * r, target.z + Math.cos(o.yaw * D) * Math.cos(o.pitch * D) * r);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
    }

    stop() {
        cancelAnimationFrame(this._raf); this._raf = null;
        this._ro?.disconnect(); this._ro = null;
        this.mixer?.stopAllAction(); this.mixer = null;
        this.scene = null; this.holder = null; this.items = new Map();
    }

    // ==================== THE MOUSE ON THE VIEW ====================

    bindOverlay() {
        const ov = this.$('ae-overlay');
        this.$('ae-tools').querySelectorAll('[data-tool]').forEach(b => b.onclick = () => this.setTool(b.dataset.tool));
        this.setTool(this.tool);
        let drag = null;
        ov.onpointerdown = (e) => {
            e.preventDefault(); ov.focus(); ov.setPointerCapture(e.pointerId);
            drag = { x: e.clientX, y: e.clientY, button: e.button };
            ov.classList.add('is-dragging');
        };
        ov.onpointermove = (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            if (dx || dy) this.onDrag(drag.button, dx, dy, e.shiftKey);
        };
        ov.onpointerup = ov.onpointercancel = (e) => {
            drag = null;
            ov.classList.remove('is-dragging');
            try { ov.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
        };
        ov.oncontextmenu = (e) => e.preventDefault();
        ov.onwheel = (e) => { e.preventDefault(); this.orbit.dist = Math.max(0.3, Math.min(4, this.orbit.dist * Math.exp(e.deltaY * 0.001))); this.syncOrbit(); };
        ov.onkeydown = (e) => {
            const t = { q: 'camera', w: 'move', e: 'turn', r: 'size' }[e.key.toLowerCase()];
            if (t) { this.setTool(t); e.preventDefault(); }
            e.stopPropagation();
        };
    }

    setTool(tool) {
        this.tool = tool;
        this.$('ae-tools')?.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('is-on', b.dataset.tool === tool));
        const ov = this.$('ae-overlay');
        if (ov) ov.dataset.tool = tool;
    }

    syncOrbit() { for (const k of ['yaw', 'pitch', 'dist', 'at']) { const el = this.$('ae-' + k); if (el) el.value = this.orbit[k]; } }

    onDrag(button, dx, dy, fine) {
        if (button === 1) { this.orbit.at = Math.max(0, Math.min(1.1, this.orbit.at - dy * 0.004)); this.syncOrbit(); return; }
        if (button === 2 || this.tool === 'camera') {
            this.orbit.yaw = ((this.orbit.yaw - dx * 0.4 + 540) % 360) - 180;
            this.orbit.pitch = Math.max(-40, Math.min(70, this.orbit.pitch + dy * 0.3));
            this.syncOrbit();
            return;
        }
        this.dragFit(this.tool, dx * (fine ? 0.25 : 1), dy * (fine ? 0.25 : 1));
    }

    /** Drag the selected item: it follows the cursor (Move), turns about the view's axes (Turn), grows (Size). */
    dragFit(tool, dx, dy) {
        const e = this.entry(), obj = this.items?.get(this.selected);
        if (!e || !obj?.parent) return;
        const T = THREE, f = e.attachmentData, cam = this.camera, r4 = (x) => +x.toFixed(4);
        const right = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        obj.parent.updateMatrixWorld(true);
        const P = obj.parent.matrixWorld;
        if (tool === 'move') {
            const at = new T.Vector3().setFromMatrixPosition(obj.matrixWorld);
            const H = this.$('ae-overlay').clientHeight || 600;
            const perPx = 2 * cam.position.distanceTo(at) * Math.tan(cam.fov * Math.PI / 360) / H;
            const world = right.multiplyScalar(dx * perPx).add(up.multiplyScalar(-dy * perPx));
            const local = world.applyMatrix3(new T.Matrix3().setFromMatrix4(P).invert());          // (the bone's frame, its scale undone)
            for (const a of ['x', 'y', 'z']) f.offset[a] = r4(f.offset[a] + local[a]);
        } else if (tool === 'turn') {
            const D = Math.PI / 180, Qp = new T.Quaternion();
            P.decompose(new T.Vector3(), Qp, new T.Vector3());
            const Qpi = Qp.clone().invert();
            let q = new T.Quaternion().setFromEuler(new T.Euler(f.rotation.x * D, f.rotation.y * D, f.rotation.z * D, 'XYZ'));
            for (const [axis, ang] of [[up, dx * 0.6 * D], [right, dy * 0.6 * D]]) {
                if (!ang) continue;
                const R = new T.Quaternion().setFromAxisAngle(axis, ang);
                q = Qpi.clone().multiply(R).multiply(Qp).multiply(q);                              // (turned in the world, kept in the bone's frame)
            }
            const eu = new T.Euler().setFromQuaternion(q, 'XYZ');
            f.rotation = { x: r4(eu.x / D), y: r4(eu.y / D), z: r4(eu.z / D) };
        } else if (tool === 'size') {
            const along = Math.abs(dx) > Math.abs(dy) ? dx : -dy, k = Math.exp(along * 0.004);
            if (this.uniform) for (const a of ['x', 'y', 'z']) f.scale[a] = r4(f.scale[a] * k);
            else {
                const dir = right.multiplyScalar(dx).add(up.multiplyScalar(-dy)).applyMatrix3(new T.Matrix3().setFromMatrix4(obj.matrixWorld).invert()).normalize();
                const a = ['x', 'y', 'z'].reduce((b, n) => (Math.abs(dir[n]) > Math.abs(dir[b]) ? n : b), 'x');
                f.scale[a] = r4(f.scale[a] * k);
            }
        }
        this.changed(true);
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.AttachmentEditor = AttachmentEditor; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.AttachmentEditor = AttachmentEditor; }
export default AttachmentEditor;
export { AttachmentEditor };
