// ScriptEditor.js
class ScriptEditor {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.container = this.gameEditor.elements.scriptEditorContainer; // Should be #script-editor-container
        this.MIN_HEIGHT = 200;
        this.isDragging = false;
        this.start_y = 0;
        this.start_h = 0;
        this.DEFAULT_HEIGHT = () => document.body.clientHeight - 200;

        if (!this.container) {
            console.error("ScriptEditor container not found");
            return;
        } else {
            console.log("Container found:", this.container);
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

        this.setupEventListeners();
                        
        if( this.gameEditor.state.objectTypes.configs.codeMirror ) {
            let styleTag = document.getElementById("theme_style");
            styleTag.innerHTML += this.gameEditor.state.objectTypes.themes[this.gameEditor.state.objectTypes.configs.codeMirror.theme].css;
        }
        
    }
   
    setupEventListeners() {
     
        document.body.addEventListener('editScript', (event) => {
            this.scriptData = event.detail;
            this.scriptEditor.setValue(this.scriptData.script);
            this.scriptEditor.setSize(null, this.DEFAULT_HEIGHT());
            this.scriptEditor.refresh();
            setTimeout(() => {
                this.scriptEditor.refresh();
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
        if (!this.gameEditor.state.selectedObject) {
            console.warn("No selected object to save script to");
            return;
        }
        const scriptText = this.scriptEditor.getValue();
        // Create a custom event with data
        const myCustomEvent = new CustomEvent('saveScript', {
            detail: scriptText, 
            bubbles: true, 
            cancelable: true 
        });

        // Dispatch the event
        document.body.dispatchEvent(myCustomEvent);
    }

    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

export { ScriptEditor };