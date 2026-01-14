/**
 * GameChatSystem - In-game chat for multiplayer (WC3/Dota style)
 *
 * Features:
 * - Press Enter to open chat input
 * - Press Enter again to send message (or Escape to cancel)
 * - Messages fade out after a few seconds
 * - Unobtrusive overlay in bottom-left (above minimap)
 */
class GameChatSystem extends GUTS.BaseSystem {
    static services = [];

    constructor(game) {
        super(game);
        this.game.gameChatSystem = this;

        this.isInputActive = false;
        this.messageTimeout = 8000; // Messages fade after 8 seconds
        this.networkListener = null;
        this.boundHandlers = {};
    }

    init(params) {
        this.params = params || {};

        this.setupElements();

        // Always setup keyboard listener so Enter works
        this.setupKeyboardListener();

        // Check if we're in multiplayer mode
        const isMultiplayer = this.game.clientNetworkManager?.isConnected;
        console.log('[GameChatSystem] init - isMultiplayer:', isMultiplayer);

        if (isMultiplayer) {
            this.setupNetworkListener();
            this.showChat();
        } else {
            // Hide chat in single player
            this.hideChat();
        }
    }

    setupElements() {
        this.chatContainer = document.getElementById('gameChat');
        this.messagesContainer = document.getElementById('gameChatMessages');
        this.inputContainer = document.getElementById('gameChatInputContainer');
        this.input = document.getElementById('gameChatInput');
    }

    setupKeyboardListener() {
        this.boundHandlers.keydown = (e) => this.handleKeyDown(e);
        document.addEventListener('keydown', this.boundHandlers.keydown);

        // Input-specific handlers
        if (this.input) {
            this.boundHandlers.inputKeydown = (e) => this.handleInputKeyDown(e);
            this.boundHandlers.inputBlur = () => this.closeInput();
            this.input.addEventListener('keydown', this.boundHandlers.inputKeydown);
            this.input.addEventListener('blur', this.boundHandlers.inputBlur);
        }
    }

    setupNetworkListener() {
        const nm = this.game.clientNetworkManager;
        if (nm) {
            this.networkListener = nm.listen('CHAT_MESSAGE', (data) => {
                // Handle game context messages
                if (data.context === 'game') {
                    this.displayMessage(data);
                }
            });
        }
    }

    handleKeyDown(e) {
        // Don't capture if already typing in the chat input
        if (this.isInputActive) return;

        // Don't capture if typing in another input
        if (document.activeElement?.tagName === 'INPUT' ||
            document.activeElement?.tagName === 'TEXTAREA') {
            return;
        }

        // Enter key opens chat
        if (e.key === 'Enter') {
            e.preventDefault();
            this.openInput();
        }
    }

    handleInputKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.sendMessage();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.closeInput();
        }

        // Stop propagation to prevent game controls from receiving input
        e.stopPropagation();
    }

    openInput() {
        if (!this.inputContainer || !this.input) return;

        this.isInputActive = true;
        this.inputContainer.classList.remove('hidden');
        this.input.focus();
    }

    closeInput() {
        if (!this.inputContainer || !this.input) return;

        this.isInputActive = false;
        this.inputContainer.classList.add('hidden');
        this.input.value = '';
        this.input.blur();
    }

    sendMessage() {
        if (!this.input) return;

        const content = this.input.value.trim();

        // Close input regardless of content
        this.closeInput();

        // Don't send empty messages
        if (!content) return;

        const nm = this.game.clientNetworkManager;
        if (nm?.socket) {
            nm.socket.emit('CHAT_MESSAGE', {
                content: content,
                context: 'game'
            });
        }
    }

    displayMessage(data) {
        if (!this.messagesContainer) return;

        const messageEl = document.createElement('div');
        messageEl.className = `game-chat-message ${data.type === 'system' ? 'system' : ''}`;

        if (data.type === 'system') {
            messageEl.innerHTML = `<span class="chat-system-text">${this.escapeHtml(data.content)}</span>`;
        } else {
            // Determine sender class based on team
            let senderClass = '';
            const myTeam = this.game.state?.myTeam;
            if (data.team !== undefined && myTeam !== undefined) {
                senderClass = data.team === myTeam ? 'ally' : 'enemy';
            }

            const time = new Date(data.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            });

            messageEl.innerHTML = `
                <span class="chat-time">${time}</span>
                <span class="chat-sender ${senderClass}">${this.escapeHtml(data.sender)}:</span>
                <span class="chat-text">${this.escapeHtml(data.content)}</span>
            `;
        }

        this.messagesContainer.appendChild(messageEl);

        // Auto-scroll to bottom
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

        // Start fade timer
        this.scheduleFade(messageEl);

        // Limit displayed messages
        this.trimMessages();
    }

    scheduleFade(messageEl) {
        setTimeout(() => {
            messageEl.classList.add('fading');

            // Remove after fade animation
            setTimeout(() => {
                if (messageEl.parentNode) {
                    messageEl.remove();
                }
            }, 500);
        }, this.messageTimeout);
    }

    trimMessages() {
        const maxMessages = 10;
        while (this.messagesContainer && this.messagesContainer.children.length > maxMessages) {
            this.messagesContainer.firstChild?.remove();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showChat() {
        if (this.chatContainer) {
            this.chatContainer.style.display = 'block';
        }
    }

    hideChat() {
        if (this.chatContainer) {
            this.chatContainer.style.display = 'none';
        }
    }

    // Add a system message locally
    addSystemMessage(content) {
        this.displayMessage({
            type: 'system',
            content: content,
            timestamp: Date.now()
        });
    }

    dispose() {
        // Remove keyboard listeners
        if (this.boundHandlers.keydown) {
            document.removeEventListener('keydown', this.boundHandlers.keydown);
        }

        if (this.input) {
            if (this.boundHandlers.inputKeydown) {
                this.input.removeEventListener('keydown', this.boundHandlers.inputKeydown);
            }
            if (this.boundHandlers.inputBlur) {
                this.input.removeEventListener('blur', this.boundHandlers.inputBlur);
            }
        }

        // Remove network listener
        if (this.networkListener) {
            this.networkListener();
            this.networkListener = null;
        }

        this.boundHandlers = {};
        this.hideChat();
    }

    onSceneUnload() {
        this.dispose();
    }
}
