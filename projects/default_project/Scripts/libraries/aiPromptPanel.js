class AIPromptPanel {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
      console.log(this.gameEditor);
        const aiConfig = this.gameEditor.getCollections().configs.ai;
        this.elements = {
            launchBtn: null,
            aiPromptModal: null,
            promptTextarea: null,
            sendBtn: null,
            closeBtn: null,
            previewArea: null,
            applyBtn: null
        };
        this.init(aiConfig);
    }

    init(aiConfig) {
       this.setupHooks();
        // Create the AI Prompt Modal
        const modal = document.getElementById('modal-aiPromptPanel');

        this.config = aiConfig;
        // Cache elements
        this.elements = {
            aiPromptModal: modal,
            promptTextarea: modal.querySelector('#ai-prompt-textarea'),
            prePromptTextarea: modal.querySelector('#ai-pre-prompt-textarea'),
            sendBtn: modal.querySelector('#send-ai-prompt-btn'),
            closeBtn: modal.querySelector('#close-ai-prompt-modal'),
            previewArea: modal.querySelector('#ai-response-preview'),
            applyBtn: modal.querySelector('#apply-ai-response-btn')
        };

        // Setup event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.elements.sendBtn.addEventListener('click', () => this.sendPromptToAI());
        this.elements.closeBtn.addEventListener('click', () => {
            this.elements.aiPromptModal.classList.remove('show');
        });
        this.elements.applyBtn.addEventListener('click', () => {
            this.applyAIResponse();
        });
    }

    setupHooks() {
        
        document.body.addEventListener('renderEditor', () => {
            if(this.elements.launchBtn) this.elements.launchBtn.remove();
            this.elements.launchBtn = document.createElement('button');
            this.elements.launchBtn.innerHTML = "AI Prompt";
            this.elements.launchBtn.id = 'ai-prompt-modal';
            this.gameEditor.elements.editor.querySelector(".actions>div")?.appendChild(this.elements.launchBtn);
            this.elements.launchBtn.addEventListener('click', () => {
                this.showModal();
            });
        });
    }

    generateContextPrompt(object) {
        const type = this.gameEditor.core.getSingularType(this.gameEditor.core.state.selectedType);
		let defaultPrompt = this.config.defaultPrompt.trim().replace(/\$\{type\}/g, type);
        return `${defaultPrompt}\n\nContext Object: \n\n${JSON.stringify(object, null, 2)}`;
		
    }

    async sendPromptToAI() {
        const prompt = `${this.elements.prePromptTextarea.value} \n\n ${this.elements.promptTextarea.value}`;

        try {
            this.elements.previewArea.value = "Generating ..."; // Use .value for textarea

            const { aiEndPoint, aiModel, apiKey, headers, requestBody } = this.prepareAIConfig(prompt);
            console.log('Request config:', { aiEndPoint, aiModel, apiKey, headers, requestBody });

            const response = await fetch(aiEndPoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`AI generation failed: ${response.statusText}`);
            }

            const responseData = await response.json();
            console.log('Raw API response:', responseData);

            const aiOutput = this.extractAIOutput(responseData);
            const cleanedOutput = this.cleanOutput(aiOutput);
            console.log('Cleaned output:', cleanedOutput);

            const parsedResponse = this.parseJSONResponse(cleanedOutput);
            this.elements.previewArea.value = JSON.stringify(parsedResponse, null, 2); // Use .value
            this.elements.applyBtn.style.display = 'block';
        } catch (error) {
            console.error('AI Generation Error:', error);
            this.elements.previewArea.value = `Error: ${error.message}`; // Use .value
            this.elements.applyBtn.style.display = 'none';
        }
    }

    prepareAIConfig(prompt) {
        let updated = false;

        let aiEndPoint = this.config.aiEndPoint || "http://127.0.0.1:11434/api/generate";
        let aiModel = this.config.aiModel || "deepseek-r1:32b";
        const apiKey = this.config.aiApiKey || "";

        if (!this.config.aiEndPoint) {
            this.config.aiEndPoint = aiEndPoint;
            updated = true;
        }
        if (!this.config.aiModel) {
            this.config.aiModel = aiModel;
            updated = true;
        }
        if (updated) {
            this.gameEditor.renderObjectList();
            this.gameEditor.saveToLocalStorage();
        }

        const headers = { 'Content-Type': 'application/json' };
        let requestBody = { 
            prompt, 
            model: aiModel, 
            jsonOnly: true, 
            stream: false 
        };

        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
            requestBody = {
                model: aiModel,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that generates valid JSON objects based on user prompts.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 500
            };
        }

        return { aiEndPoint, aiModel, apiKey, headers, requestBody };
    }

    extractAIOutput(responseData) {
        return responseData.response || responseData.result || responseData;
    }

 cleanOutput(aiOutput) {
        const outputString = typeof aiOutput === 'string' ? aiOutput : JSON.stringify(aiOutput);
        return outputString
            .replace(/```json\s*/g, '') // Remove ```json and optional whitespace/newlines
            .replace(/```\s*/g, '')     // Remove ``` and optional whitespace/newlines
            .replace(/<think\s*>[\s\S]*?<\/think\s*>/gi, '') // Remove <think> tags
            .replace(/<think[\s\S]*?\/>/gi, '') // Remove self-closing <think> tags
            .trim(); // Remove leading/trailing whitespace
    }

    parseJSONResponse(cleanedOutput) {
        try {
            return JSON.parse(cleanedOutput);
        } catch (parseError) {
            throw new Error('Invalid JSON response from AI:\n' + cleanedOutput);
        }
    }

    applyAIResponse() {
        try {
            const responseText = this.elements.previewArea.value; // Use .value for textarea
            const parsedResponse = JSON.parse(responseText);

            if (!parsedResponse.id) {
                alert("Must include id in new object.");
                return;
            }

            const { selectedType } = this.gameEditor.core.state;
            this.gameEditor.state.project.objectTypes[selectedType][parsedResponse.id] = parsedResponse;

            this.gameEditor.renderObjectList();
            this.gameEditor.selectObject(parsedResponse.id); // Use new id instead of old selectedObject
            this.gameEditor.saveToLocalStorage();

            this.elements.aiPromptModal.classList.remove('show');
        } catch (error) {
            console.error('Error applying AI response:', error);
            alert('Failed to apply AI response. Please check the JSON format.');
        }
    }

    showModal() {
        const currentObject = this.gameEditor.getCurrentObject();
        this.elements.prePromptTextarea.value = this.generateContextPrompt(currentObject); // Use .value
        this.elements.previewArea.value = ''; // Use .value
        this.elements.applyBtn.style.display = 'none';
        this.elements.aiPromptModal.classList.add('show');
    }
}













