class ScriptEditor {
    constructor(gameEditor, config) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.container = document.getElementById('script-editor-container');
        this.savePropertyName = "script";

        if (!this.container) {
            console.error("ScriptEditor container not found");
            return;
        }

        this.editorContainer = this.container.querySelector('#script-editor');
        if (!this.editorContainer) {
            console.error("Editor container #script-editor not found");
            return;
        }

        // Create Monaco Editor instance
        this.scriptEditor = monaco.editor.create(this.editorContainer, {
            value: '',
            language: 'javascript',
            theme: 'vs-dark',
            lineNumbers: 'on',
            tabSize: 2,
            insertSpaces: true,
            automaticLayout: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 14,
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            parameterHints: { enabled: true }
        });

        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());

        // Initial layout after a short delay to ensure DOM is ready
        setTimeout(() => this.handleResize(), 100);

        this.setupEventListeners();
    }

    handleResize() {
        if (this.scriptEditor) {
            this.scriptEditor.layout();
        }
    }

    setupEventListeners() {
        document.body.addEventListener('editScript', (event) => {
            this.scriptValue = event.detail.data;
            this.savePropertyName = event.detail.propertyName;
            this.scriptEditor.setValue(this.scriptValue || '');

            // Ensure proper layout after content load
            setTimeout(() => this.handleResize(), 50);
        });

        // Listen for unload events
        document.body.addEventListener('unloadScript', () => {
            this.handleUnload();
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

    /**
     * Handles unloading the script editor data
     * Clears editor content and resets state
     */
    handleUnload() {
        // Clear editor content
        if (this.scriptEditor) {
            this.scriptEditor.setValue('');
        }

        // Reset state
        this.scriptValue = null;
        this.savePropertyName = 'script';
    }
}