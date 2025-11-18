const { Plugin, PluginSettingTab, Setting, ItemView } = require("obsidian");

const DEFAULT_SETTINGS = {
    displayLocation: 'statusbar',
    ignoreCallouts: false
};

const VIEW_TYPE_SENTENCE_COUNTER = "sentence-counter-view";

class SentenceCounter extends Plugin {

    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_SENTENCE_COUNTER,
            (leaf) => new SentenceCounterView(leaf, this)
        );

        this.addSettingTab(new SentenceCounterSettingTab(this.app, this));

        this.initializeDisplay();

        this.debouncedUpdate = this.debounce(() => this.updateCount(), 150);

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => this.updateCount())
        );

        this.registerEvent(
            this.app.workspace.on("editor-change", () => this.debouncedUpdate())
        );

        this.updateCount();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.refreshDisplay();
    }

    initializeDisplay() {
        if (this.settings.displayLocation === 'statusbar') {
            this.statusBarEl = this.addStatusBarItem();
            this.statusBarEl.setText("0 Sentences");
        } else {
            this.activateSidebarView();
        }
    }

    async refreshDisplay() {
        if (this.statusBarEl) {
            this.statusBarEl.remove();
            this.statusBarEl = null;
        }

        this.app.workspace.detachLeavesOfType(VIEW_TYPE_SENTENCE_COUNTER);
        this.initializeDisplay();
        this.updateCount();
    }

    async activateSidebarView() {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SENTENCE_COUNTER);
        if (existing.length > 0) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({ type: VIEW_TYPE_SENTENCE_COUNTER, active: true });
        this.app.workspace.revealLeaf(leaf);
    }

    onunload() {
        if (this.statusBarEl) this.statusBarEl.remove();
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_SENTENCE_COUNTER);
    }

    updateCount() {
        let editor = null;

        if (this.app.workspace.activeEditor?.editor) {
            editor = this.app.workspace.activeEditor.editor;
        } else {
            const activeView = this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView);
            if (activeView) editor = activeView.editor;
        }

        if (!editor) {
            this.displayCount(0, 0);
            return;
        }

        const text = editor.getValue();
        const cleaned = this.cleanText(text);
        const sentenceCount = this.countSentences(cleaned);
        const charCount = this.countCharacters(cleaned);
        this.displayCount(sentenceCount, charCount);
    }

    displayCount(sentenceCount, charCount) {
        const text = `${sentenceCount} Sentence${sentenceCount !== 1 ? 's' : ''}`;

        if (this.settings.displayLocation === 'statusbar' && this.statusBarEl) {
            this.statusBarEl.setText(text);
        } else if (this.settings.displayLocation === 'sidebar') {
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SENTENCE_COUNTER);
            leaves.forEach(leaf => {
                if (leaf.view instanceof SentenceCounterView) {
                    leaf.view.updateCount(sentenceCount, charCount);
                }
            });
        }
    }

cleanText(text) {
    if (!text || !text.trim().length) return "";
    let cleaned = this.removeFrontmatter(text);
    
    // Remove code blocks
    cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
    
    console.log("ignoreCallouts setting:", this.settings.ignoreCallouts);
    console.log("Text before callout removal:", cleaned);
    
    // Remove callouts if ignoreCallouts is enabled
    if (this.settings.ignoreCallouts) {
        // Match a callout header and all following blockquote lines
        cleaned = cleaned.replace(/^>\s*\[!\w+\].*\n(^>.*\n?)*/gm, "");
    }
    
    console.log("Text after callout removal:", cleaned);
    return cleaned;
}


    countCharacters(text) {
        return text.length;
    }

    countSentences(text) {
        if (!text.trim().length) return 0;

        const exceptions = [
            "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.", "vs.", "etc.", 
            "i.e.", "e.g.", "ca.", "cf.", "Inc.", "Ltd.", "Corp.", "Co.",
            "Ave.", "St.", "Rd.", "Blvd.", ".js", ".css"
        ];

        let working = text;

        for (const ex of exceptions) {
            const escapedEx = ex.replace(/\./g, "\\.");
            working = working.replace(new RegExp(`\\b${escapedEx}`, "gi"),
                ex.replace(".", "PERIOD_PLACEHOLDER"));
        }

        const sentences = working
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        return sentences.length;
    }

    removeFrontmatter(text) {
        if (!text.startsWith('---')) return text;
        const lines = text.split('\n');
        let endIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                endIndex = i;
                break;
            }
        }
        return endIndex !== -1
            ? lines.slice(endIndex + 1).join('\n')
            : text;
    }
}

class SentenceCounterView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.countEl = null;
        this.charCountEl = null;
    }

    getViewType() { return VIEW_TYPE_SENTENCE_COUNTER; }
    getDisplayText() { return "Sentence Counter"; }
    getIcon() { return "hash"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("sentence-counter-view");

        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";
        container.style.height = "100%";
        container.style.padding = "20px";

        const title = container.createEl("h1", { text: "Sentence Count" });
        title.style.marginBottom = "10px";

        this.countEl = container.createEl("div", { text: "0 Sentences" });
        this.countEl.style.fontSize = "20px";
        this.countEl.style.fontWeight = "bold";
        this.countEl.style.marginTop = "10px";

        this.charCountEl = container.createEl("div", { text: "0 Characters" });
        this.charCountEl.style.fontSize = "16px";
        this.charCountEl.style.marginTop = "15px";
        this.charCountEl.style.color = "var(--text-muted)";
    }

    updateCount(sentenceCount, charCount) {
        if (this.countEl) {
            this.countEl.setText(`${sentenceCount} Sentence${sentenceCount !== 1 ? 's' : ''}`);
        }
        if (this.charCountEl) {
            this.charCountEl.setText(`${charCount} Character${charCount !== 1 ? 's' : ''}`);
        }
    }
}

class SentenceCounterSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Sentence Counter Settings' });

        new Setting(containerEl)
            .setName('Display location')
            .setDesc('Choose where to display the sentence count')
            .addDropdown(dropdown => dropdown
                .addOption('statusbar', 'Status Bar')
                .addOption('sidebar', 'Right Sidebar')
                .setValue(this.plugin.settings.displayLocation)
                .onChange(async (value) => {
                    this.plugin.settings.displayLocation = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Ignore callouts')
            .setDesc('Do not include callout note content in counts')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.ignoreCallouts)
                    .onChange(async (value) => {
                        this.plugin.settings.ignoreCallouts = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}

module.exports = SentenceCounter;
