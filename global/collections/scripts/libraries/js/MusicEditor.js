/**
 * MusicEditor - Editor for music composition (instruments, patterns, tracks)
 *
 * Supports three editing modes:
 * - Instruments: ADSR envelope, oscillator, filter settings
 * - Patterns: Piano roll note entry
 * - Tracks: Multi-voice arrangement with sections
 */
class MusicEditor {
    constructor(controller, moduleConfig, GUTS) {
        this.controller = controller;
        this.moduleConfig = moduleConfig;
        this.GUTS = GUTS;

        // Current state
        this.currentData = null;
        this.propertyName = null;
        this.objectData = null;
        this.currentMode = 'patterns'; // 'instruments', 'patterns', 'tracks'

        // Audio context for preview
        this.audioContext = null;
        this.isPlaying = false;
        this.isLooping = false;
        this.playbackTimeoutId = null;
        this.scheduledNotes = [];

        // Pattern editor state
        this.currentOctave = 4;
        this.gridColumns = 64;
        this.gridRows = 24; // 2 octaves
        this.zoom = 1;
        this.scrollX = 0;
        this.scrollY = 0;
        this.currentTool = 'pencil'; // 'select', 'pencil', 'erase'
        this.selectedNotes = [];

        // Track editor state
        this.selectedSection = null;
        this.selectedVoice = null;

        // Canvas references
        this.mainCanvas = null;
        this.ctx = null;

        // Undo/redo
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 50;

        // Loading flag
        this._isLoading = false;

        // Note frequency table
        this.noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        // Resize observer
        this.resizeObserver = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listen for load hook
        document.body.addEventListener(this.moduleConfig.loadHook, (event) => {
            this.load(event.detail);
        });

        // Listen for unload event
        document.body.addEventListener(this.moduleConfig.unloadHook, () => {
            this.unload();
        });

        // Get container
        const container = document.getElementById(this.moduleConfig.container);
        if (!container) return;

        // Tab buttons
        document.getElementById('me-tab-instruments')?.addEventListener('click', () => this.switchTab('instruments'));
        document.getElementById('me-tab-patterns')?.addEventListener('click', () => this.switchTab('patterns'));
        document.getElementById('me-tab-tracks')?.addEventListener('click', () => this.switchTab('tracks'));

        // Transport controls
        document.getElementById('me-play-btn')?.addEventListener('click', () => this.play());
        document.getElementById('me-stop-btn')?.addEventListener('click', () => this.stop());
        document.getElementById('me-loop-toggle')?.addEventListener('change', (e) => {
            this.isLooping = e.target.checked;
        });

        // Save button
        document.getElementById('me-save-btn')?.addEventListener('click', () => this.save());

        // Tool buttons
        document.getElementById('me-tool-select')?.addEventListener('click', () => this.setTool('select'));
        document.getElementById('me-tool-pencil')?.addEventListener('click', () => this.setTool('pencil'));
        document.getElementById('me-tool-erase')?.addEventListener('click', () => this.setTool('erase'));

        // Zoom buttons
        document.getElementById('me-zoom-in')?.addEventListener('click', () => this.setZoom(this.zoom * 1.25));
        document.getElementById('me-zoom-out')?.addEventListener('click', () => this.setZoom(this.zoom / 1.25));
        document.getElementById('me-zoom-fit')?.addEventListener('click', () => this.fitToView());

        // Undo/redo buttons
        document.getElementById('me-undo')?.addEventListener('click', () => this.undo());
        document.getElementById('me-redo')?.addEventListener('click', () => this.redo());

        // Octave buttons
        document.getElementById('me-octave-down')?.addEventListener('click', () => this.changeOctave(-1));
        document.getElementById('me-octave-up')?.addEventListener('click', () => this.changeOctave(1));

        // Instrument controls
        this.setupInstrumentListeners();

        // Pattern controls
        this.setupPatternListeners();

        // Track controls
        this.setupTrackListeners();

        // Property inputs
        this.setupPropertyListeners();

        // Canvas setup (deferred until visible)
        this.setupCanvasListeners();

        // Keyboard shortcuts
        this.setupKeyboardListeners();
    }

    setupInstrumentListeners() {
        const sliders = [
            { id: 'me-inst-duration', val: 'me-inst-duration-val', format: v => `${parseFloat(v).toFixed(2)}s` },
            { id: 'me-inst-attack', val: 'me-inst-attack-val', format: v => `${parseFloat(v).toFixed(3)}s` },
            { id: 'me-inst-decay', val: 'me-inst-decay-val', format: v => `${parseFloat(v).toFixed(2)}s` },
            { id: 'me-inst-sustain', val: 'me-inst-sustain-val', format: v => `${Math.round(parseFloat(v) * 100)}%` },
            { id: 'me-inst-release', val: 'me-inst-release-val', format: v => `${parseFloat(v).toFixed(2)}s` },
            { id: 'me-inst-filter-freq', val: 'me-inst-filter-freq-val', format: v => `${Math.round(v)}Hz` },
            { id: 'me-inst-filter-q', val: 'me-inst-filter-q-val', format: v => parseFloat(v).toFixed(1) }
        ];

        sliders.forEach(({ id, val, format }) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    if (this._isLoading) return;
                    const valEl = document.getElementById(val);
                    if (valEl) valEl.textContent = format(el.value);
                    this.updateInstrumentFromUI();
                    this.renderInstrumentEditor();
                });
            }
        });

        // Oscillator and filter type selects
        document.getElementById('me-inst-oscillator')?.addEventListener('change', () => {
            if (!this._isLoading) this.updateInstrumentFromUI();
        });
        document.getElementById('me-inst-filter-type')?.addEventListener('change', () => {
            if (!this._isLoading) this.updateInstrumentFromUI();
        });

        // Preview button
        document.getElementById('me-preview-note-btn')?.addEventListener('click', () => {
            this.previewNote('A4');
        });
    }

    setupPatternListeners() {
        // BPM, steps, length inputs
        document.getElementById('me-pattern-bpm')?.addEventListener('change', () => {
            if (!this._isLoading) this.updatePatternSettings();
        });
        document.getElementById('me-pattern-steps')?.addEventListener('change', () => {
            if (!this._isLoading) this.updatePatternSettings();
        });
        document.getElementById('me-pattern-length')?.addEventListener('change', () => {
            if (!this._isLoading) {
                this.updatePatternLength();
                this.render();
            }
        });

        // Preview instrument selector
        document.getElementById('me-preview-instrument')?.addEventListener('change', () => {
            // Just used for playback preview
        });
    }

    setupTrackListeners() {
        // Track BPM and steps
        document.getElementById('me-track-bpm')?.addEventListener('change', () => {
            if (!this._isLoading && this.currentData) {
                this.currentData.bpm = parseInt(document.getElementById('me-track-bpm').value) || 120;
            }
        });
        document.getElementById('me-track-steps')?.addEventListener('change', () => {
            if (!this._isLoading && this.currentData) {
                this.currentData.stepsPerBeat = parseInt(document.getElementById('me-track-steps').value) || 4;
            }
        });

        // Add section/voice buttons
        document.getElementById('me-add-section-btn')?.addEventListener('click', () => this.addSection());
        document.getElementById('me-add-voice-btn')?.addEventListener('click', () => this.addVoice());

        // Remove section/voice buttons
        document.getElementById('me-remove-section-btn')?.addEventListener('click', () => this.removeSelectedSection());
        document.getElementById('me-remove-voice-btn')?.addEventListener('click', () => this.removeSelectedVoice());

        // Voice inspector inputs
        document.getElementById('me-voice-name')?.addEventListener('change', () => this.updateSelectedVoice());
        document.getElementById('me-voice-instrument')?.addEventListener('change', () => this.updateSelectedVoice());
        document.getElementById('me-voice-volume')?.addEventListener('input', (e) => {
            document.getElementById('me-voice-volume-val').textContent = `${Math.round(parseFloat(e.target.value) * 100)}%`;
            if (!this._isLoading) this.updateSelectedVoice();
        });
        document.getElementById('me-voice-octave-shift')?.addEventListener('change', () => this.updateSelectedVoice());

        // Section inspector inputs
        document.getElementById('me-section-name')?.addEventListener('change', () => this.updateSelectedSection());
        document.getElementById('me-section-start')?.addEventListener('change', () => this.updateSelectedSection());
        document.getElementById('me-section-end')?.addEventListener('change', () => this.updateSelectedSection());
    }

    setupPropertyListeners() {
        document.getElementById('me-prop-title')?.addEventListener('change', () => {
            if (!this._isLoading && this.currentData) {
                this.currentData.title = document.getElementById('me-prop-title').value;
            }
        });
        document.getElementById('me-prop-description')?.addEventListener('change', () => {
            if (!this._isLoading && this.currentData) {
                this.currentData.description = document.getElementById('me-prop-description').value;
            }
        });
    }

    setupCanvasListeners() {
        const canvas = document.getElementById('me-main-canvas');
        if (!canvas) return;

        this.mainCanvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Mouse events
        canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e));
        canvas.addEventListener('wheel', (e) => this.handleCanvasWheel(e));

        // Prevent context menu
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Resize observer for canvas container
        const canvasArea = canvas.parentElement;
        if (canvasArea && typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.resizeCanvas();
            });
            this.resizeObserver.observe(canvasArea);
        }

        // Window resize fallback
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        if (!this.mainCanvas) return;

        const container = this.mainCanvas.parentElement;
        if (!container) return;

        // Account for toolbar and status bar
        const toolbarHeight = 40;
        const statusBarHeight = 32;
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight - toolbarHeight - statusBarHeight;

        if (this.mainCanvas.width !== newWidth || this.mainCanvas.height !== newHeight) {
            this.mainCanvas.width = Math.max(100, newWidth);
            this.mainCanvas.height = Math.max(100, newHeight);
            this.render();
        }
    }

    setupKeyboardListeners() {
        document.addEventListener('keydown', (e) => {
            // Only handle when music editor is visible
            const container = document.getElementById(this.moduleConfig.container);
            if (!container || !container.classList.contains('show')) return;

            // Don't interfere with text inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Space - play/stop
            if (e.code === 'Space') {
                e.preventDefault();
                this.isPlaying ? this.stop() : this.play();
            }

            // Ctrl+Z - undo
            if (e.ctrlKey && e.code === 'KeyZ') {
                e.preventDefault();
                this.undo();
            }

            // Ctrl+Y - redo
            if (e.ctrlKey && e.code === 'KeyY') {
                e.preventDefault();
                this.redo();
            }

            // Z/X - change octave (pattern mode)
            if (this.currentMode === 'patterns') {
                if (e.code === 'KeyZ' && !e.ctrlKey) this.changeOctave(-1);
                if (e.code === 'KeyX') this.changeOctave(1);

                // Piano keyboard input
                this.handlePianoKeyboard(e);
            }

            // P/E keys for tools
            if (e.code === 'KeyP') this.setTool('pencil');
            if (e.code === 'KeyE' && !e.ctrlKey) this.setTool('erase');
        });
    }

    handlePianoKeyboard(e) {
        const keyMap = {
            'KeyA': 'C', 'KeyW': 'C#', 'KeyS': 'D', 'KeyE': 'D#', 'KeyD': 'E',
            'KeyF': 'F', 'KeyT': 'F#', 'KeyG': 'G', 'KeyY': 'G#', 'KeyH': 'A',
            'KeyU': 'A#', 'KeyJ': 'B', 'KeyK': 'C+1'
        };

        const note = keyMap[e.code];
        if (note) {
            const octave = note.includes('+1') ? this.currentOctave + 1 : this.currentOctave;
            const noteName = note.replace('+1', '') + octave;
            this.previewNote(noteName);
        }
    }

    // =========================================================================
    // Data Loading / Saving
    // =========================================================================

    load(detail) {
        this._isLoading = true;

        this.propertyName = detail.propertyName;
        this.objectData = detail.objectData || this.controller?.getCurrentObject();
        this.currentData = detail.data || {};

        // Detect mode from data structure
        this.currentMode = this.detectDataType(this.currentData);

        // Show the editor
        this.showEditor();

        // Initialize canvas
        this.initCanvas();

        // Load data into UI
        this.loadDataIntoUI();

        // Populate instrument/pattern dropdowns
        this.populateDropdowns();

        this._isLoading = false;

        // Initial render
        this.render();

        this.updateStatus('Ready');
    }

    detectDataType(data) {
        if (data.oscillator !== undefined) return 'instruments';
        if (data.notes !== undefined) return 'patterns';
        if (data.voices !== undefined || data.sections !== undefined) return 'tracks';
        return 'patterns'; // Default
    }

    showEditor() {
        Object.values(document.getElementsByClassName('editor-module')).forEach((editor) => {
            editor.classList.remove('show');
        });
        document.getElementById(this.moduleConfig.container)?.classList.add('show');
    }

    initCanvas() {
        if (!this.mainCanvas) {
            this.mainCanvas = document.getElementById('me-main-canvas');
            if (this.mainCanvas) {
                this.ctx = this.mainCanvas.getContext('2d');
            }
        }

        // Use centralized resize method
        this.resizeCanvas();
    }

    loadDataIntoUI() {
        // Set title and description
        const titleEl = document.getElementById('me-prop-title');
        const descEl = document.getElementById('me-prop-description');
        if (titleEl) titleEl.value = this.currentData.title || '';
        if (descEl) descEl.value = this.currentData.description || '';

        // Show correct tab
        this.switchTab(this.currentMode);

        // Mode-specific UI loading
        switch (this.currentMode) {
            case 'instruments':
                this.loadInstrumentUI();
                break;
            case 'patterns':
                this.loadPatternUI();
                break;
            case 'tracks':
                this.loadTrackUI();
                break;
        }
    }

    loadInstrumentUI() {
        const data = this.currentData;

        // Oscillator
        const oscEl = document.getElementById('me-inst-oscillator');
        if (oscEl) oscEl.value = data.oscillator || 'sine';

        // Duration
        this.setSliderValue('me-inst-duration', data.duration || 0.5, 'me-inst-duration-val', v => `${parseFloat(v).toFixed(2)}s`);

        // Envelope
        const env = data.envelope || {};
        this.setSliderValue('me-inst-attack', env.attack || 0.01, 'me-inst-attack-val', v => `${parseFloat(v).toFixed(3)}s`);
        this.setSliderValue('me-inst-decay', env.decay || 0.1, 'me-inst-decay-val', v => `${parseFloat(v).toFixed(2)}s`);
        this.setSliderValue('me-inst-sustain', env.sustain || 0.5, 'me-inst-sustain-val', v => `${Math.round(parseFloat(v) * 100)}%`);
        this.setSliderValue('me-inst-release', env.release || 0.3, 'me-inst-release-val', v => `${parseFloat(v).toFixed(2)}s`);

        // Filter
        const filter = data.filter || {};
        const filterTypeEl = document.getElementById('me-inst-filter-type');
        if (filterTypeEl) filterTypeEl.value = filter.type || 'none';
        this.setSliderValue('me-inst-filter-freq', filter.frequency || 2000, 'me-inst-filter-freq-val', v => `${Math.round(v)}Hz`);
        this.setSliderValue('me-inst-filter-q', filter.Q || 1, 'me-inst-filter-q-val', v => parseFloat(v).toFixed(1));
    }

    loadPatternUI() {
        const data = this.currentData;

        // BPM (use default if not set)
        const bpmEl = document.getElementById('me-pattern-bpm');
        if (bpmEl) bpmEl.value = 120;

        // Steps per beat
        const stepsEl = document.getElementById('me-pattern-steps');
        if (stepsEl) stepsEl.value = 4;

        // Length
        const notes = data.notes || [];
        const lengthEl = document.getElementById('me-pattern-length');
        if (lengthEl) lengthEl.value = Math.max(64, notes.length);

        // Octave display
        this.updateOctaveDisplay();
    }

    loadTrackUI() {
        const data = this.currentData;

        // BPM and steps
        const bpmEl = document.getElementById('me-track-bpm');
        if (bpmEl) bpmEl.value = data.bpm || 120;

        const stepsEl = document.getElementById('me-track-steps');
        if (stepsEl) stepsEl.value = data.stepsPerBeat || 4;

        // Render sections list
        this.renderSectionsList();

        // Render voices list
        this.renderVoicesList();

        // Update counts
        this.updateSectionCount();
        this.updateVoiceCount();
    }

    setSliderValue(id, value, displayId, format) {
        const el = document.getElementById(id);
        if (el) {
            el.value = value;
            const displayEl = document.getElementById(displayId);
            if (displayEl) displayEl.textContent = format(value);
        }
    }

    populateDropdowns() {
        const collections = this.controller?.getCollections() || {};

        // Populate preview instrument dropdown
        const previewInst = document.getElementById('me-preview-instrument');
        if (previewInst) {
            previewInst.innerHTML = '<option value="">Default (Sine)</option>';
            const instruments = collections.instruments || {};
            Object.keys(instruments).forEach(key => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = instruments[key].title || key;
                previewInst.appendChild(opt);
            });
        }

        // Populate voice instrument dropdown
        const voiceInst = document.getElementById('me-voice-instrument');
        if (voiceInst) {
            voiceInst.innerHTML = '';
            const instruments = collections.instruments || {};
            Object.keys(instruments).forEach(key => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = instruments[key].title || key;
                voiceInst.appendChild(opt);
            });
        }
    }

    save() {
        // Gather data from current mode
        this.collectDataFromUI();

        // Dispatch save event
        const saveEvent = new CustomEvent(this.moduleConfig.saveHook, {
            detail: {
                data: this.currentData,
                propertyName: this.propertyName
            }
        });
        document.body.dispatchEvent(saveEvent);

        this.updateStatus('Saved');
    }

    collectDataFromUI() {
        // Common properties
        this.currentData.title = document.getElementById('me-prop-title')?.value || this.currentData.title;
        this.currentData.description = document.getElementById('me-prop-description')?.value || this.currentData.description;

        // Mode-specific collection
        switch (this.currentMode) {
            case 'instruments':
                this.collectInstrumentData();
                break;
            case 'patterns':
                // Notes are already updated via toggleNote
                break;
            case 'tracks':
                this.collectTrackData();
                break;
        }
    }

    collectInstrumentData() {
        this.currentData.oscillator = document.getElementById('me-inst-oscillator')?.value || 'sine';
        this.currentData.duration = parseFloat(document.getElementById('me-inst-duration')?.value) || 0.5;

        this.currentData.envelope = {
            attack: parseFloat(document.getElementById('me-inst-attack')?.value) || 0.01,
            decay: parseFloat(document.getElementById('me-inst-decay')?.value) || 0.1,
            sustain: parseFloat(document.getElementById('me-inst-sustain')?.value) || 0.5,
            release: parseFloat(document.getElementById('me-inst-release')?.value) || 0.3
        };

        const filterType = document.getElementById('me-inst-filter-type')?.value;
        if (filterType && filterType !== 'none') {
            this.currentData.filter = {
                type: filterType,
                frequency: parseFloat(document.getElementById('me-inst-filter-freq')?.value) || 2000,
                Q: parseFloat(document.getElementById('me-inst-filter-q')?.value) || 1
            };
        } else {
            delete this.currentData.filter;
        }
    }

    collectTrackData() {
        this.currentData.bpm = parseInt(document.getElementById('me-track-bpm')?.value) || 120;
        this.currentData.stepsPerBeat = parseInt(document.getElementById('me-track-steps')?.value) || 4;
        // voices and sections are updated in real-time
    }

    unload() {
        this.stop();
        this.currentData = null;
        this.propertyName = null;
        this.selectedSection = null;
        this.selectedVoice = null;

        // Clear undo/redo stacks
        this.undoStack = [];
        this.redoStack = [];
    }

    // =========================================================================
    // Tab Switching
    // =========================================================================

    switchTab(mode) {
        this.currentMode = mode;

        // Update tab active states
        ['instruments', 'patterns', 'tracks'].forEach(m => {
            const tab = document.getElementById(`me-tab-${m}`);
            if (tab) {
                tab.classList.toggle('me-tab--active', m === mode);
            }
        });

        // Show/hide panels
        document.getElementById('me-instruments-panel').style.display = mode === 'instruments' ? 'block' : 'none';
        document.getElementById('me-patterns-panel').style.display = mode === 'patterns' ? 'block' : 'none';
        document.getElementById('me-tracks-panel').style.display = mode === 'tracks' ? 'block' : 'none';

        // Show/hide inspectors
        document.getElementById('me-section-inspector').style.display = 'none';
        document.getElementById('me-voice-inspector').style.display = 'none';

        // Re-render
        this.render();
    }

    // =========================================================================
    // Rendering
    // =========================================================================

    render() {
        if (!this.ctx || !this.mainCanvas) return;

        switch (this.currentMode) {
            case 'instruments':
                this.renderInstrumentEditor();
                break;
            case 'patterns':
                this.renderPatternEditor();
                break;
            case 'tracks':
                this.renderTrackEditor();
                break;
        }
    }

    clearCanvas() {
        if (!this.ctx) return;
        this.ctx.fillStyle = '#0a0a0f';
        this.ctx.fillRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    }

    // =========================================================================
    // Instrument Editor
    // =========================================================================

    renderInstrumentEditor() {
        this.clearCanvas();
        this.drawADSRVisualization();
    }

    drawADSRVisualization() {
        const ctx = this.ctx;
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const padding = 60;

        const env = this.currentData?.envelope || { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 };
        const duration = this.currentData?.duration || 0.5;

        // Calculate total time
        const totalTime = env.attack + env.decay + duration + env.release;
        const scale = (width - padding * 2) / totalTime;

        // Draw grid
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) {
            const y = padding + (height - padding * 2) * i / 10;
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
        }

        // Draw envelope curve
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 3;
        ctx.beginPath();

        let x = padding;
        let y = height - padding;
        ctx.moveTo(x, y);

        // Attack
        x += env.attack * scale;
        y = padding;
        ctx.lineTo(x, y);

        // Decay
        x += env.decay * scale;
        y = padding + (1 - env.sustain) * (height - padding * 2);
        ctx.lineTo(x, y);

        // Sustain (hold for duration)
        x += duration * scale;
        ctx.lineTo(x, y);

        // Release
        x += env.release * scale;
        y = height - padding;
        ctx.lineTo(x, y);

        ctx.stroke();

        // Draw labels
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';

        let labelX = padding;
        ctx.fillText('Attack', labelX + env.attack * scale / 2, height - padding + 20);
        labelX += env.attack * scale;
        ctx.fillText('Decay', labelX + env.decay * scale / 2, height - padding + 20);
        labelX += env.decay * scale;
        ctx.fillText('Sustain', labelX + duration * scale / 2, height - padding + 20);
        labelX += duration * scale;
        ctx.fillText('Release', labelX + env.release * scale / 2, height - padding + 20);

        // Draw amplitude labels
        ctx.textAlign = 'right';
        ctx.fillText('1.0', padding - 10, padding + 4);
        ctx.fillText('0.0', padding - 10, height - padding + 4);

        // Draw current values
        ctx.textAlign = 'left';
        ctx.fillStyle = '#9ca3af';
        ctx.fillText(`A: ${env.attack.toFixed(3)}s`, padding, 30);
        ctx.fillText(`D: ${env.decay.toFixed(2)}s`, padding + 100, 30);
        ctx.fillText(`S: ${Math.round(env.sustain * 100)}%`, padding + 200, 30);
        ctx.fillText(`R: ${env.release.toFixed(2)}s`, padding + 300, 30);
    }

    updateInstrumentFromUI() {
        if (!this.currentData) return;
        this.collectInstrumentData();
    }

    // =========================================================================
    // Pattern Editor (Piano Roll)
    // =========================================================================

    renderPatternEditor() {
        this.clearCanvas();
        this.drawPianoRollGrid();
        this.drawNotes();
    }

    drawPianoRollGrid() {
        const ctx = this.ctx;
        const cellWidth = 20 * this.zoom;
        const cellHeight = 16 * this.zoom;
        const keyWidth = 40;

        // Draw piano keys on left
        for (let row = 0; row < this.gridRows; row++) {
            const y = row * cellHeight;
            const noteIndex = (this.gridRows - 1 - row) % 12;
            const isBlackKey = [1, 3, 6, 8, 10].includes(noteIndex);

            ctx.fillStyle = isBlackKey ? '#1a1a2e' : '#16213e';
            ctx.fillRect(0, y, keyWidth, cellHeight);

            // Note label
            const octave = Math.floor((this.gridRows - 1 - row) / 12) + this.currentOctave - 1;
            ctx.fillStyle = '#6b7280';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(this.noteNames[noteIndex] + octave, 4, y + cellHeight - 4);

            // Row line
            ctx.strokeStyle = '#1f1f2e';
            ctx.beginPath();
            ctx.moveTo(keyWidth, y);
            ctx.lineTo(this.mainCanvas.width, y);
            ctx.stroke();
        }

        // Draw vertical grid lines (steps)
        const notes = this.currentData?.notes || [];
        const stepsPerBeat = 4;

        for (let col = 0; col <= this.gridColumns; col++) {
            const x = col * cellWidth + keyWidth;
            const isBeat = col % stepsPerBeat === 0;
            const isBar = col % (stepsPerBeat * 4) === 0;

            ctx.strokeStyle = isBar ? '#3f3f5e' : (isBeat ? '#2a2a3e' : '#1f1f2e');
            ctx.lineWidth = isBar ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.mainCanvas.height);
            ctx.stroke();

            // Bar number
            if (isBar && col > 0) {
                ctx.fillStyle = '#6b7280';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(Math.floor(col / (stepsPerBeat * 4)), x, 12);
            }
        }
    }

    drawNotes() {
        const ctx = this.ctx;
        const cellWidth = 20 * this.zoom;
        const cellHeight = 16 * this.zoom;
        const keyWidth = 40;
        const notes = this.currentData?.notes || [];

        for (let step = 0; step < notes.length; step++) {
            const note = notes[step];
            if (note && note !== '-') {
                const gridPos = this.noteToGridPosition(note);
                if (gridPos !== null) {
                    const x = step * cellWidth + keyWidth;
                    const y = gridPos * cellHeight;

                    // Draw note block
                    ctx.fillStyle = '#6366f1';
                    ctx.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);

                    // Draw note name
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '9px monospace';
                    ctx.textAlign = 'left';
                    ctx.fillText(note, x + 4, y + cellHeight - 4);
                }
            }
        }
    }

    noteToGridPosition(noteName) {
        // Handle chords (take first note)
        if (noteName.includes(',')) {
            noteName = noteName.split(',')[0];
        }

        const match = noteName.match(/^([A-G]#?)(\d)$/);
        if (!match) return null;

        const noteIndex = this.noteNames.indexOf(match[1]);
        const octave = parseInt(match[2]);

        const semitoneFromBase = (octave - this.currentOctave + 1) * 12 + noteIndex;
        const row = this.gridRows - 1 - semitoneFromBase;

        if (row < 0 || row >= this.gridRows) return null;
        return row;
    }

    gridPositionToNote(row) {
        const semitoneFromBase = this.gridRows - 1 - row;
        const octave = Math.floor(semitoneFromBase / 12) + this.currentOctave - 1;
        const noteIndex = semitoneFromBase % 12;

        if (noteIndex < 0 || noteIndex >= 12) return null;
        return this.noteNames[noteIndex] + octave;
    }

    handleCanvasMouseDown(e) {
        if (this.currentMode !== 'patterns') return;

        const rect = this.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const cellWidth = 20 * this.zoom;
        const cellHeight = 16 * this.zoom;
        const keyWidth = 40;

        const col = Math.floor((x - keyWidth) / cellWidth);
        const row = Math.floor(y / cellHeight);

        if (col < 0 || col >= this.gridColumns || row < 0 || row >= this.gridRows) return;

        const note = this.gridPositionToNote(row);
        if (!note) return;

        this.pushUndo();

        if (this.currentTool === 'pencil') {
            this.toggleNote(col, note);
        } else if (this.currentTool === 'erase') {
            this.removeNote(col);
        }

        this.render();

        // Preview the note
        this.previewNote(note);

        // Update status
        this.updateStatus(`Step: ${col}, Note: ${note}`);
    }

    handleCanvasMouseMove(e) {
        if (this.currentMode !== 'patterns') return;

        const rect = this.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const cellWidth = 20 * this.zoom;
        const cellHeight = 16 * this.zoom;
        const keyWidth = 40;

        const col = Math.floor((x - keyWidth) / cellWidth);
        const row = Math.floor(y / cellHeight);

        if (col >= 0 && col < this.gridColumns && row >= 0 && row < this.gridRows) {
            const note = this.gridPositionToNote(row);
            document.getElementById('me-status-position').textContent = `Step: ${col}`;
            document.getElementById('me-status-note').textContent = `Note: ${note || '--'}`;
        }
    }

    handleCanvasMouseUp(e) {
        // End drag operations
    }

    handleCanvasWheel(e) {
        e.preventDefault();
        if (e.ctrlKey) {
            // Zoom
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.setZoom(this.zoom * delta);
        } else {
            // Scroll
            this.scrollX += e.deltaX;
            this.scrollY += e.deltaY;
            this.render();
        }
    }

    toggleNote(step, note) {
        if (!this.currentData) return;
        if (!this.currentData.notes) this.currentData.notes = [];

        // Expand array if needed
        while (this.currentData.notes.length <= step) {
            this.currentData.notes.push('-');
        }

        // Toggle
        if (this.currentData.notes[step] === note) {
            this.currentData.notes[step] = '-';
        } else {
            this.currentData.notes[step] = note;
        }
    }

    removeNote(step) {
        if (!this.currentData?.notes) return;
        if (step < this.currentData.notes.length) {
            this.currentData.notes[step] = '-';
        }
    }

    updatePatternLength() {
        const length = parseInt(document.getElementById('me-pattern-length')?.value) || 64;
        if (!this.currentData.notes) this.currentData.notes = [];

        // Extend or trim
        while (this.currentData.notes.length < length) {
            this.currentData.notes.push('-');
        }
        if (this.currentData.notes.length > length) {
            this.currentData.notes = this.currentData.notes.slice(0, length);
        }

        this.gridColumns = length;
    }

    updatePatternSettings() {
        // BPM and steps per beat are used for playback, not stored in pattern
    }

    changeOctave(delta) {
        this.currentOctave = Math.max(1, Math.min(7, this.currentOctave + delta));
        this.updateOctaveDisplay();
        this.render();
    }

    updateOctaveDisplay() {
        const display = document.getElementById('me-octave-display');
        if (display) display.textContent = this.currentOctave;
    }

    // =========================================================================
    // Track Editor
    // =========================================================================

    renderTrackEditor() {
        this.clearCanvas();
        this.drawTrackTimeline();
    }

    drawTrackTimeline() {
        const ctx = this.ctx;
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        const data = this.currentData || {};
        const voices = data.voices || [];
        const sections = data.sections || [];
        const bpm = data.bpm || 120;
        const stepsPerBeat = data.stepsPerBeat || 4;

        // Calculate total steps from sections
        let totalSteps = 256;
        sections.forEach(s => {
            if (s.endStep > totalSteps) totalSteps = s.endStep;
        });

        const labelWidth = 100;
        const stepWidth = (width - labelWidth) / totalSteps * this.zoom;
        const sectionHeight = 24;
        const voiceHeight = 40;

        // Draw beat grid
        for (let step = 0; step <= totalSteps; step++) {
            const x = labelWidth + step * stepWidth;
            const isBeat = step % stepsPerBeat === 0;
            const isBar = step % (stepsPerBeat * 4) === 0;

            ctx.strokeStyle = isBar ? '#3f3f5e' : (isBeat ? '#2a2a3e' : '#1f1f2e');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            // Bar numbers
            if (isBar) {
                ctx.fillStyle = '#6b7280';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(Math.floor(step / (stepsPerBeat * 4)) + 1, x, 12);
            }
        }

        // Draw sections row
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
        ctx.fillRect(labelWidth, 20, width - labelWidth, sectionHeight);

        sections.forEach((section, i) => {
            const x = labelWidth + section.startStep * stepWidth;
            const w = (section.endStep - section.startStep) * stepWidth;

            // Section block
            ctx.fillStyle = this.getSectionColor(section.name);
            ctx.fillRect(x + 2, 22, w - 4, sectionHeight - 4);

            // Section name
            ctx.fillStyle = '#ffffff';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(section.name, x + 6, 38);

            // Selection highlight
            if (this.selectedSection === i) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 2, 22, w - 4, sectionHeight - 4);
            }
        });

        // Draw voice lanes
        voices.forEach((voice, i) => {
            const y = 50 + i * voiceHeight;

            // Lane background
            ctx.fillStyle = i % 2 === 0 ? '#0f0f1a' : '#12121f';
            ctx.fillRect(0, y, width, voiceHeight);

            // Voice label
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, y, labelWidth, voiceHeight);
            ctx.fillStyle = '#e5e5e5';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(voice.name || `Voice ${i + 1}`, 8, y + 16);
            ctx.fillStyle = '#6b7280';
            ctx.font = '9px sans-serif';
            ctx.fillText(`[${voice.instrument}]`, 8, y + 28);

            // Draw pattern blocks for each section
            sections.forEach(section => {
                const patternId = section.voicePatterns?.[voice.name];
                if (patternId) {
                    const x = labelWidth + section.startStep * stepWidth;
                    const w = (section.endStep - section.startStep) * stepWidth;

                    ctx.fillStyle = '#3730a3';
                    ctx.fillRect(x + 2, y + 4, w - 4, voiceHeight - 8);

                    ctx.fillStyle = '#ffffff';
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.fillText(patternId, x + 6, y + voiceHeight / 2 + 3);
                }
            });

            // Selection highlight for voice
            if (this.selectedVoice === i) {
                ctx.strokeStyle = '#818cf8';
                ctx.lineWidth = 2;
                ctx.strokeRect(1, y + 1, labelWidth - 2, voiceHeight - 2);
            }
        });
    }

    getSectionColor(name) {
        const colors = {
            intro: '#059669',
            verse: '#2563eb',
            chorus: '#dc2626',
            bridge: '#7c3aed',
            outro: '#d97706'
        };
        return colors[name?.toLowerCase()] || '#6366f1';
    }

    renderSectionsList() {
        const container = document.getElementById('me-sections-list');
        if (!container) return;

        container.innerHTML = '';
        const sections = this.currentData?.sections || [];

        sections.forEach((section, i) => {
            const item = document.createElement('div');
            item.className = 'me-list-item' + (this.selectedSection === i ? ' me-list-item--selected' : '');
            item.innerHTML = `
                <span class="me-list-item__name">${section.name}</span>
                <span class="me-list-item__info">${section.startStep}-${section.endStep}</span>
            `;
            item.addEventListener('click', () => this.selectSection(i));
            container.appendChild(item);
        });
    }

    renderVoicesList() {
        const container = document.getElementById('me-voices-list');
        if (!container) return;

        container.innerHTML = '';
        const voices = this.currentData?.voices || [];

        voices.forEach((voice, i) => {
            const item = document.createElement('div');
            item.className = 'me-list-item' + (this.selectedVoice === i ? ' me-list-item--selected' : '');
            item.innerHTML = `
                <span class="me-list-item__name">${voice.name}</span>
                <span class="me-list-item__info">${voice.instrument}</span>
            `;
            item.addEventListener('click', () => this.selectVoice(i));
            container.appendChild(item);
        });
    }

    updateSectionCount() {
        const el = document.getElementById('me-section-count');
        if (el) el.textContent = (this.currentData?.sections || []).length;
    }

    updateVoiceCount() {
        const el = document.getElementById('me-voice-count');
        if (el) el.textContent = (this.currentData?.voices || []).length;
    }

    selectSection(index) {
        this.selectedSection = index;
        this.selectedVoice = null;

        // Show section inspector
        document.getElementById('me-section-inspector').style.display = 'block';
        document.getElementById('me-voice-inspector').style.display = 'none';

        // Load section into inspector
        const section = this.currentData?.sections?.[index];
        if (section) {
            document.getElementById('me-section-name').value = section.name || '';
            document.getElementById('me-section-start').value = section.startStep || 0;
            document.getElementById('me-section-end').value = section.endStep || 0;

            // Render voice pattern assignments
            this.renderVoicePatternAssignments(section);
        }

        this.renderSectionsList();
        this.renderVoicesList();
        this.render();
    }

    selectVoice(index) {
        this.selectedVoice = index;
        this.selectedSection = null;

        // Show voice inspector
        document.getElementById('me-voice-inspector').style.display = 'block';
        document.getElementById('me-section-inspector').style.display = 'none';

        // Load voice into inspector
        const voice = this.currentData?.voices?.[index];
        if (voice) {
            document.getElementById('me-voice-name').value = voice.name || '';
            document.getElementById('me-voice-instrument').value = voice.instrument || '';
            document.getElementById('me-voice-volume').value = voice.volume || 1;
            document.getElementById('me-voice-volume-val').textContent = `${Math.round((voice.volume || 1) * 100)}%`;
            document.getElementById('me-voice-octave-shift').value = voice.octaveShift || 0;
        }

        this.renderSectionsList();
        this.renderVoicesList();
        this.render();
    }

    renderVoicePatternAssignments(section) {
        const container = document.getElementById('me-section-voice-patterns');
        if (!container) return;

        container.innerHTML = '';
        const voices = this.currentData?.voices || [];
        const collections = this.controller?.getCollections() || {};
        const patterns = collections.patterns || {};

        voices.forEach(voice => {
            const row = document.createElement('div');
            row.className = 'me-voice-pattern-row';

            const select = document.createElement('select');
            select.className = 'me-select';
            select.innerHTML = '<option value="">-- None --</option>';

            Object.keys(patterns).forEach(key => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = patterns[key].title || key;
                if (section.voicePatterns?.[voice.name] === key) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });

            select.addEventListener('change', () => {
                if (!section.voicePatterns) section.voicePatterns = {};
                if (select.value) {
                    section.voicePatterns[voice.name] = select.value;
                } else {
                    delete section.voicePatterns[voice.name];
                }
                this.render();
            });

            row.innerHTML = `<span class="me-voice-pattern-row__name">${voice.name}:</span>`;
            row.appendChild(select);
            container.appendChild(row);
        });
    }

    addSection() {
        if (!this.currentData) return;
        if (!this.currentData.sections) this.currentData.sections = [];

        // Calculate next section start
        let startStep = 0;
        this.currentData.sections.forEach(s => {
            if (s.endStep > startStep) startStep = s.endStep;
        });

        const newSection = {
            name: `section${this.currentData.sections.length + 1}`,
            startStep: startStep,
            endStep: startStep + 64,
            voicePatterns: {}
        };

        this.currentData.sections.push(newSection);
        this.updateSectionCount();
        this.renderSectionsList();
        this.selectSection(this.currentData.sections.length - 1);
    }

    addVoice() {
        if (!this.currentData) return;
        if (!this.currentData.voices) this.currentData.voices = [];

        const collections = this.controller?.getCollections() || {};
        const instruments = Object.keys(collections.instruments || {});

        const newVoice = {
            name: `voice${this.currentData.voices.length + 1}`,
            instrument: instruments[0] || 'sine',
            volume: 1.0,
            octaveShift: 0
        };

        this.currentData.voices.push(newVoice);
        this.updateVoiceCount();
        this.renderVoicesList();
        this.selectVoice(this.currentData.voices.length - 1);
    }

    removeSelectedSection() {
        if (this.selectedSection === null || !this.currentData?.sections) return;

        this.currentData.sections.splice(this.selectedSection, 1);
        this.selectedSection = null;
        document.getElementById('me-section-inspector').style.display = 'none';
        this.updateSectionCount();
        this.renderSectionsList();
        this.render();
    }

    removeSelectedVoice() {
        if (this.selectedVoice === null || !this.currentData?.voices) return;

        const voiceName = this.currentData.voices[this.selectedVoice].name;

        // Remove voice from all section assignments
        this.currentData.sections?.forEach(section => {
            if (section.voicePatterns) {
                delete section.voicePatterns[voiceName];
            }
        });

        this.currentData.voices.splice(this.selectedVoice, 1);
        this.selectedVoice = null;
        document.getElementById('me-voice-inspector').style.display = 'none';
        this.updateVoiceCount();
        this.renderVoicesList();
        this.render();
    }

    updateSelectedSection() {
        if (this.selectedSection === null || !this.currentData?.sections) return;

        const section = this.currentData.sections[this.selectedSection];
        section.name = document.getElementById('me-section-name')?.value || section.name;
        section.startStep = parseInt(document.getElementById('me-section-start')?.value) || 0;
        section.endStep = parseInt(document.getElementById('me-section-end')?.value) || 0;

        this.renderSectionsList();
        this.render();
    }

    updateSelectedVoice() {
        if (this.selectedVoice === null || !this.currentData?.voices) return;

        const voice = this.currentData.voices[this.selectedVoice];
        const oldName = voice.name;
        voice.name = document.getElementById('me-voice-name')?.value || voice.name;
        voice.instrument = document.getElementById('me-voice-instrument')?.value || voice.instrument;
        voice.volume = parseFloat(document.getElementById('me-voice-volume')?.value) || 1;
        voice.octaveShift = parseInt(document.getElementById('me-voice-octave-shift')?.value) || 0;

        // Update section voice patterns if name changed
        if (oldName !== voice.name) {
            this.currentData.sections?.forEach(section => {
                if (section.voicePatterns && section.voicePatterns[oldName]) {
                    section.voicePatterns[voice.name] = section.voicePatterns[oldName];
                    delete section.voicePatterns[oldName];
                }
            });
        }

        this.renderVoicesList();
        this.render();
    }

    // =========================================================================
    // Tools and Zoom
    // =========================================================================

    setTool(tool) {
        this.currentTool = tool;
        ['select', 'pencil', 'erase'].forEach(t => {
            const btn = document.getElementById(`me-tool-${t}`);
            if (btn) btn.classList.toggle('editor-module__btn--active', t === tool);
        });
    }

    setZoom(zoom) {
        this.zoom = Math.max(0.25, Math.min(4, zoom));
        document.getElementById('me-status-zoom').textContent = `Zoom: ${Math.round(this.zoom * 100)}%`;
        this.render();
    }

    fitToView() {
        // Calculate zoom to fit content
        this.zoom = 1;
        this.render();
    }

    // =========================================================================
    // Audio Playback
    // =========================================================================

    async initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async previewNote(noteName) {
        await this.initAudio();

        const frequency = this.getNoteFrequency(noteName);
        const instrument = this.getPreviewInstrument();

        this.playNoteWithInstrument(frequency, instrument);
    }

    getPreviewInstrument() {
        if (this.currentMode === 'instruments' && this.currentData?.oscillator) {
            return this.currentData;
        }

        const selectedId = document.getElementById('me-preview-instrument')?.value;
        if (selectedId) {
            const collections = this.controller?.getCollections() || {};
            return collections.instruments?.[selectedId] || this.getDefaultInstrument();
        }

        return this.getDefaultInstrument();
    }

    getDefaultInstrument() {
        return {
            oscillator: 'sine',
            duration: 0.5,
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 }
        };
    }

    playNoteWithInstrument(frequency, instrument) {
        const ctx = this.audioContext;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = instrument.oscillator || 'sine';
        osc.frequency.setValueAtTime(frequency, now);

        const env = ctx.createGain();
        env.gain.setValueAtTime(0, now);

        const attack = instrument.envelope?.attack || 0.01;
        const decay = instrument.envelope?.decay || 0.1;
        const sustain = instrument.envelope?.sustain || 0.5;
        const release = instrument.envelope?.release || 0.3;
        const duration = instrument.duration || 0.5;

        // ADSR envelope
        env.gain.linearRampToValueAtTime(0.3, now + attack);
        env.gain.linearRampToValueAtTime(0.3 * sustain, now + attack + decay);
        env.gain.setValueAtTime(0.3 * sustain, now + duration);
        env.gain.linearRampToValueAtTime(0, now + duration + release);

        // Apply filter if defined
        let output = osc;
        if (instrument.filter?.type && instrument.filter.type !== 'none') {
            const filter = ctx.createBiquadFilter();
            filter.type = instrument.filter.type;
            filter.frequency.setValueAtTime(instrument.filter.frequency || 2000, now);
            filter.Q.setValueAtTime(instrument.filter.Q || 1, now);
            osc.connect(filter);
            output = filter;
        }

        output.connect(env);
        env.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + duration + release + 0.1);
    }

    getNoteFrequency(noteName) {
        // Handle chords
        if (noteName.includes(',')) {
            noteName = noteName.split(',')[0];
        }

        const match = noteName.match(/^([A-G]#?)(\d)$/);
        if (!match) return 440;

        const noteIndex = this.noteNames.indexOf(match[1]);
        const octave = parseInt(match[2]);
        const semitone = octave * 12 + noteIndex;

        // A4 = 440Hz at semitone 57
        return 440 * Math.pow(2, (semitone - 57) / 12);
    }

    async play() {
        await this.initAudio();
        this.isPlaying = true;

        switch (this.currentMode) {
            case 'instruments':
                this.previewNote('A4');
                break;
            case 'patterns':
                this.playPattern();
                break;
            case 'tracks':
                this.playTrack();
                break;
        }
    }

    playPattern() {
        const notes = this.currentData?.notes || [];
        const bpm = parseInt(document.getElementById('me-pattern-bpm')?.value) || 120;
        const stepsPerBeat = parseInt(document.getElementById('me-pattern-steps')?.value) || 4;
        const msPerStep = (60000 / bpm) / stepsPerBeat;
        const instrument = this.getPreviewInstrument();

        let step = 0;
        const playStep = () => {
            if (!this.isPlaying) return;

            const note = notes[step];
            if (note && note !== '-') {
                // Handle chords
                const noteList = note.split(',');
                noteList.forEach(n => {
                    const freq = this.getNoteFrequency(n.trim());
                    this.playNoteWithInstrument(freq, instrument);
                });
            }

            step++;
            if (step >= notes.length) {
                if (this.isLooping) {
                    step = 0;
                } else {
                    this.isPlaying = false;
                    return;
                }
            }

            this.playbackTimeoutId = setTimeout(playStep, msPerStep);
        };

        playStep();
    }

    playTrack() {
        // Track playback with sections and voices
        const data = this.currentData;
        if (!data?.voices || !data?.sections) return;

        const bpm = data.bpm || 120;
        const stepsPerBeat = data.stepsPerBeat || 4;
        const msPerStep = (60000 / bpm) / stepsPerBeat;

        const collections = this.controller?.getCollections() || {};

        // Calculate total steps
        let totalSteps = 0;
        data.sections.forEach(s => {
            if (s.endStep > totalSteps) totalSteps = s.endStep;
        });

        let step = 0;
        const playStep = () => {
            if (!this.isPlaying) return;

            // Find current section
            const currentSection = data.sections.find(s => step >= s.startStep && step < s.endStep);

            if (currentSection) {
                // Play each voice
                data.voices.forEach(voice => {
                    const patternId = currentSection.voicePatterns?.[voice.name];
                    if (patternId) {
                        const pattern = collections.patterns?.[patternId];
                        const instrument = collections.instruments?.[voice.instrument] || this.getDefaultInstrument();

                        if (pattern?.notes) {
                            const patternStep = (step - currentSection.startStep) % pattern.notes.length;
                            const note = pattern.notes[patternStep];

                            if (note && note !== '-') {
                                const noteList = note.split(',');
                                noteList.forEach(n => {
                                    let freq = this.getNoteFrequency(n.trim());
                                    // Apply octave shift
                                    freq *= Math.pow(2, voice.octaveShift || 0);

                                    // Adjust volume
                                    const instWithVolume = { ...instrument };
                                    // Volume handled by voice.volume but we simplify here
                                    this.playNoteWithInstrument(freq, instWithVolume);
                                });
                            }
                        }
                    }
                });
            }

            step++;
            if (step >= totalSteps) {
                if (this.isLooping) {
                    step = 0;
                } else {
                    this.isPlaying = false;
                    return;
                }
            }

            this.playbackTimeoutId = setTimeout(playStep, msPerStep);
        };

        playStep();
    }

    stop() {
        this.isPlaying = false;
        if (this.playbackTimeoutId) {
            clearTimeout(this.playbackTimeoutId);
            this.playbackTimeoutId = null;
        }
    }

    // =========================================================================
    // Undo/Redo
    // =========================================================================

    pushUndo() {
        this.undoStack.push(JSON.stringify(this.currentData));
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo() {
        if (this.undoStack.length === 0) return;

        this.redoStack.push(JSON.stringify(this.currentData));
        this.currentData = JSON.parse(this.undoStack.pop());

        this.loadDataIntoUI();
        this.render();
    }

    redo() {
        if (this.redoStack.length === 0) return;

        this.undoStack.push(JSON.stringify(this.currentData));
        this.currentData = JSON.parse(this.redoStack.pop());

        this.loadDataIntoUI();
        this.render();
    }

    // =========================================================================
    // Status
    // =========================================================================

    updateStatus(message) {
        // Status updates handled via individual elements
    }
}

// Export for GUTS namespace
if (typeof window !== 'undefined') {
    window.GUTS = window.GUTS || {};
    window.GUTS.MusicEditor = MusicEditor;
}
