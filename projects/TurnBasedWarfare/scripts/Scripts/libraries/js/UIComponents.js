class UIComponents {
    static createStatCard(label, value, className = '') {
        const card = document.createElement('div');
        card.className = `enhanced-ui-stat ${className}`;
        card.innerHTML = `
            <div class="stat-label">${label}</div>
            <div class="stat-value">${value}</div>
        `;
        return card;
    }

    static createProgressBar(current, max, label = '') {
        const container = document.createElement('div');
        container.className = 'progress-container';
        
        const percentage = max > 0 ? (current / max) * 100 : 0;
        
        container.innerHTML = `
            <div class="progress-label">${label}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="progress-text">${current}/${max}</div>
        `;
        
        return container;
    }

    static createNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Style the notification
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem;
            border-radius: 5px;
            color: white;
            font-family: 'Courier New', monospace;
            z-index: 1000;
            animation: slideIn 0.3s ease-out;
            max-width: 300px;
        `;
        
        const colors = {
            info: '#0088ff',
            success: '#00ff00',
            warning: '#ffaa00',
            error: '#ff4444'
        };
        
        notification.style.backgroundColor = colors[type] || colors.info;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, duration);
        
        return notification;
    }

    static addProgressBarCSS() {
        const style = document.createElement('style');
        style.textContent = `
            .progress-container {
                margin: 0.5rem 0;
            }
            
            .progress-label {
                font-size: 0.8rem;
                color: #aaa;
                margin-bottom: 0.2rem;
            }
            
            .progress-bar {
                width: 100%;
                height: 1rem;
                background: #333;
                border: 1px solid #555;
                border-radius: 3px;
                overflow: hidden;
            }
            
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #00ff00, #88ff88);
                transition: width 0.3s ease;
            }
            
            .progress-text {
                font-size: 0.7rem;
                color: #ccc;
                margin-top: 0.2rem;
                text-align: center;
            }
            
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
}

// Initialize CSS when the script loads
if (typeof document !== 'undefined') {
    window.GUTS.UIComponents = UIComponents;
    document.addEventListener('DOMContentLoaded', () => {
        window.GUTS.UIComponents.addProgressBarCSS();
    });
}