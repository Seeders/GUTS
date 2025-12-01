class ScriptEditor {
    constructor(gameEditor, config) {
      
        this.gameEditor = gameEditor;
        this.config = config;
        let theme = "";
        if( this.gameEditor.getCollections().configs.codeMirror ) {
            theme = this.gameEditor.getCollections().themes[this.gameEditor.getCollections().configs.codeMirror.theme].css;
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
        
        
    }
   
    setupEventListeners() {
     
        document.body.addEventListener('editScript', (event) => {
            this.scriptValue = event.detail.data;
            this.savePropertyName = event.detail.propertyName;
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
