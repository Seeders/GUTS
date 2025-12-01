class ScriptEditor {
    constructor(gameEditor, config) {
        this.gameEditor = gameEditor;
        this.config = config;
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

        const editorContainer = this.container.querySelector('#script-editor');
        if (!editorContainer) {
            console.error("Editor container #script-editor not found");
            return;
        }

        // Create Monaco Editor instance
        this.scriptEditor = monaco.editor.create(editorContainer, {
            value: '',
            language: 'javascript',
            theme: 'vs-dark',
            lineNumbers: 'on',
            tabSize: 2,
            insertSpaces: true,
            automaticLayout: false,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 14,
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            parameterHints: { enabled: true }
        });

        // Set initial size
        this.updateEditorSize();

        // Handle window resize
        window.addEventListener('resize', () => this.updateEditorSize());

        this.setupEventListeners();
    }

    updateEditorSize() {
        if (this.scriptEditor) {
            const editorContainer = this.container.querySelector('#script-editor');
            if (editorContainer) {
                const height = this.DEFAULT_HEIGHT();
                editorContainer.style.height = `${height}px`;
                this.scriptEditor.layout();
            }
        }
    }

    setupEventListeners() {
        document.body.addEventListener('editScript', (event) => {
            this.scriptValue = event.detail.data;
            this.savePropertyName = event.detail.propertyName;
            this.scriptEditor.setValue(this.scriptValue || '');
            this.updateEditorSize();
            // Monaco doesn't need refresh like CodeMirror, but layout() handles it
            setTimeout(() => {
                this.scriptEditor.layout();
            }, 100);
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
        if (this.scriptEditor) {
            this.scriptEditor.dispose();
        }
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}
