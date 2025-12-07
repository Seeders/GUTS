class LoadingSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.loadingSystem = this;
        this.loadingSteps = [
            'Initializing game engine...',
            'Loading unit data...',
            'Preparing battlefield...',
            'Setting up AI opponents...',
            'Ready to battle!'
        ];
    }

    showLoadingWithProgress(onComplete) {
        let currentStep = 0;
        const loadingText = document.querySelector('.loading-text');
        
        const progressInterval = setInterval(() => {
            if (currentStep < this.loadingSteps.length) {
                if (loadingText) {
                    loadingText.textContent = this.loadingSteps[currentStep];
                }
                currentStep++;
            } else {
                clearInterval(progressInterval);
                onComplete();
            }
        }, 400);
    }
}