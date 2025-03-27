// ScriptEditor.js
class ScriptEditor {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.container = null;
        this.editorElement = null;
        this.initialize();
    }

    initialize() {
        // Create container if not exists
        this.container = document.createElement('div');
        this.container.className = 'script-editor-container';
        this.container.innerHTML = `
            <div class="tab-content" id="script-tab">
                <h3>Script</h3>
                <textarea id="script-editor" class="script-editor" placeholder="Enter your script here..."></textarea>
                <button id="save-script-btn">Save Script</button>
            </div>
        `;

        // Setup tabs if not already present
        this.setupTabs();
        
        // Initialize editor
        this.editorElement = this.container.querySelector('#script-editor');
        this.updateEditorContent();

        // Add event listeners
        this.container.querySelector('#save-script-btn')
            .addEventListener('click', () => this.saveScript());
    }

    setupTabs() {
        let tabsContainer = this.gameEditor.elements.editor.querySelector('.tabs');
        if (!tabsContainer) {
            tabsContainer = document.createElement('div');
            tabsContainer.className = 'tabs';
            this.gameEditor.elements.editor.prepend(tabsContainer);
        }

        // Ensure script tab exists
        if (!tabsContainer.querySelector('[data-tab="script"]')) {
            tabsContainer.innerHTML += `
                <div class="tab" data-tab="script">Script</div>
            `;
            // Make Properties tab active by default if it's the first one
            const propertiesTab = tabsContainer.querySelector('[data-tab="advanced"]');
            if (propertiesTab && !tabsContainer.querySelector('.active')) {
                propertiesTab.classList.add('active');
            }
        }

        // Add tab switching logic
        this.setupTabListeners();
    }

    setupTabListeners() {
        const tabs = this.gameEditor.elements.editor.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                const allContents = this.gameEditor.elements.editor.querySelectorAll('.tab-content');
                allContents.forEach(c => c.classList.remove('active'));
                
                tab.classList.add('active');
                const content = this.gameEditor.elements.editor.querySelector(`#${tab.dataset.tab}-tab`);
                if (content) content.classList.add('active');
            });
        });
    }

    updateEditorContent() {
        const currentObject = this.gameEditor.state.objectTypes[this.gameEditor.state.selectedType]?.[this.gameEditor.state.selectedObject];
        this.editorElement.value = currentObject?.script || '';
    }

    saveScript() {
        if (!this.gameEditor.state.selectedObject) return;
        const scriptText = this.editorElement.value;
        this.gameEditor.state.objectTypes[this.gameEditor.state.selectedType][this.gameEditor.state.selectedObject].script = scriptText;
        this.gameEditor.saveObject();
    }

    render() {
        // Append to editor if not already present
        if (!this.gameEditor.elements.editor.contains(this.container)) {
            this.gameEditor.elements.editor.appendChild(this.container);
        }
        this.updateEditorContent();
    }

    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

export { ScriptEditor };