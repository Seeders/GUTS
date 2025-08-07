class MenuManager {
    constructor(app){
        this.game = app;
        this.game.menuManager = this;
    }
    showTutorial() {
        alert('Tutorial coming soon! Check the battle log for basic instructions when you start playing.');
    }

    showSettings() {
        alert('Settings menu coming soon! Graphics and audio options will be available here.');
    }

    showCredits() {
        alert('Auto Battle Arena\nDeveloped with Claude AI\n\nA tactical auto-battler game featuring strategic unit placement and AI opponents.');
    }
}