class ScriptEditor {
    constructor(gameEditor, config) {
        this.gameEditor = gameEditor;
        this.config = config;
        let theme = "";
        if( this.gameEditor.getCollections().configs.codeMirror ) {
            theme = this.gameEditor.getCollections().themes[this.gameEditor.getCollections().configs.codeMirror.theme].css;
        }
        this.container = document.getElementById('script-editor-container'); // Should be #script-editor-container
        this.MIN_HEIGHT = 200;
        this.isDragging = false;
        this.start_y = 0;
        this.start_h = 0;
        this.DEFAULT_HEIGHT = () => document.body.clientHeight - 200;

        if (!this.container) {
            console.error("ScriptEditor container not found");
            return;
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
                        
        if( theme ) { 
            let styleTag = document.getElementById("theme_style");
            styleTag.innerHTML += theme;
        }
        
    }
   
    setupEventListeners() {
     
        document.body.addEventListener('editScript', (event) => {
            this.scriptValue = event.detail.data;
            this.scriptEditor.setValue(this.scriptValue);
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
        const myCustomEvent = new CustomEvent('savescript', {
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
