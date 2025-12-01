class ScriptEditor {
    constructor(gameEditor, config) {

        this.gameEditor = gameEditor;
        this.config = config;
        this.scriptEditor = null; // Lazy initialize

        // Apply theme CSS if configured
        if( this.gameEditor.getCollections().configs.codeMirror ) {
            const theme = this.gameEditor.getCollections().themes[this.gameEditor.getCollections().configs.codeMirror.theme]?.css;
            if( theme ) {
              let styleTag = document.createElement('style');
              styleTag.innerHTML = theme;
              styleTag.setAttribute('id', 'codeMirrorTheme');
              document.head.append(styleTag);
            }
        }

        this.container = document.getElementById('script-editor-container');
        this.MIN_HEIGHT = 200;
        this.isDragging = false;
        this.start_y = 0;
        this.start_h = 0;
        this.DEFAULT_HEIGHT = () => document.body.clientHeight - 200;
        this.savePropertyName = "script";

        if (!this.container) {
            console.error("ScriptEditor container not found");
            return;
        }

        this.setupEventListeners();
    }

    // Initialize CodeMirror only when container is visible
    initCodeMirror() {
        if (this.scriptEditor) {
            return; // Already initialized
        }

        const textArea = this.container.querySelector('#script-editor');
        if (!textArea) {
            console.error("Textarea #script-editor not found");
            return;
        }

        this.scriptEditor = CodeMirror.fromTextArea(textArea, {
            mode: 'javascript',
            lineNumbers: true,
            tabSize: 2,
            indentWithTabs: false,
            extraKeys: { 'Ctrl-Space': 'autocomplete' },
            hintOptions: { completeSingle: false }
        });

        this.scriptEditor.setSize(null, this.DEFAULT_HEIGHT());
    }

    setupEventListeners() {

        document.body.addEventListener('editScript', (event) => {
            this.scriptValue = event.detail.data;
            this.savePropertyName = event.detail.propertyName;

            // Use requestAnimationFrame to ensure container is rendered
            requestAnimationFrame(() => {
                // Initialize CodeMirror on first use (container is now visible)
                this.initCodeMirror();

                if (!this.scriptEditor) {
                    console.error("CodeMirror not initialized");
                    return;
                }

                this.scriptEditor.setValue(this.scriptValue);
                this.scriptEditor.setSize(null, this.DEFAULT_HEIGHT());
                this.scriptEditor.scrollTo(0, 0);
                this.scriptEditor.refresh();

                // Additional refresh after layout settles
                setTimeout(() => {
                    this.scriptEditor.refresh();
                }, 100);
            });
        });

        const saveBtn = this.container.querySelector('#save-script-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveScript());
        } else {
            console.warn("Save button not found");
        }
    }

    saveScript() {

        if (!this.gameEditor.getCurrentObject()) {
            console.warn("No selected object to save script to");
            return;
        }
        const scriptText = this.scriptEditor.getValue();

        const myCustomEvent = new CustomEvent('saveScript', {
            detail: { data: scriptText, propertyName: this.savePropertyName },
            bubbles: true,
            cancelable: true
        });


        document.body.dispatchEvent(myCustomEvent);
    }

    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}
