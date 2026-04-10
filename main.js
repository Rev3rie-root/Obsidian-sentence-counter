const { Plugin, PluginSettingTab, Setting, ItemView } = require("obsidian");

const DEFAULT_SETTINGS = {
    displayLocation: 'statusbar',
    ignoreCallouts: false,
    showWordCount: true,
    stripMarkdownFromCharCount: true
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
            this.displayCount(0, 0, 0);
            return;
        }

        const text = editor.getValue();
        const cleaned = this.cleanText(text);
        const sentenceCount = this.countSentences(cleaned);
        const wordCount = this.countWords(cleaned);
        const charCount = this.countCharacters(text, cleaned);
        this.displayCount(sentenceCount, wordCount, charCount);
    }

    displayCount(sentenceCount, wordCount, charCount) {
        if (this.settings.displayLocation === 'statusbar' && this.statusBarEl) {
            const text = `${sentenceCount} Sentence${sentenceCount !== 1 ? 's' : ''}`;
            this.statusBarEl.setText(text);
        } else if (this.settings.displayLocation === 'sidebar') {
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SENTENCE_COUNTER);
            leaves.forEach(leaf => {
                if (leaf.view instanceof SentenceCounterView) {
                    leaf.view.updateCount(sentenceCount, wordCount, charCount);
                }
            });
        }
    }

    cleanText(text) {
        if (!text || !text.trim().length) return "";
        let cleaned = this.removeFrontmatter(text);
        cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
        cleaned = cleaned.replace(/`[^`]+`/g, "");
        if (this.settings.ignoreCallouts) {
            const lines = cleaned.split('\n');
            let insideCallout = false;
            const filtered = lines.filter(line => {
                if (/^>\s*\[!\w+\]/.test(line)) {
                    insideCallout = true;
                    return false;
                }
                if (insideCallout && /^>/.test(line)) return false;
                insideCallout = false;
                return true;
            });
            cleaned = filtered.join('\n');
        }
        return cleaned;
    }

    stripMarkdown(text) {
        let stripped = text;
        stripped = stripped.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");
        stripped = stripped.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
        stripped = stripped.replace(/\[\[([^\]]+)\]\]/g, "$1");
        stripped = stripped.replace(/!\[([^\]]*)\]\([^\)]+\)/g, "");
        stripped = stripped.replace(/(\*\*|__)(.*?)\1/g, "$2");
        stripped = stripped.replace(/(\*|_)(.*?)\1/g, "$2");
        stripped = stripped.replace(/~~(.*?)~~/g, "$1");
        stripped = stripped.replace(/==(.*?)==/g, "$1");
        stripped = stripped.replace(/^#{1,6}\s+/gm, "");
        stripped = stripped.replace(/^>\s*/gm, "");
        stripped = stripped.replace(/^[\s]*[-*+]\s+/gm, "");
        stripped = stripped.replace(/^[\s]*\d+\.\s+/gm, "");
        stripped = stripped.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, "");
        stripped = stripped.replace(/<[^>]+>/g, "");
        return stripped;
    }

    countCharacters(originalText, cleanedText) {
        if (this.settings.stripMarkdownFromCharCount) {
            const stripped = this.stripMarkdown(cleanedText);
            return stripped.replace(/\s+/g, " ").trim().length;
        } else {
            return cleanedText.length;
        }
    }

    countWords(text) {
        if (!text.trim().length) return 0;
        const words = text.trim().split(/\s+/).filter(word => word.length > 0);
        return words.length;
    }

    countSentences(text) {
        if (!text.trim().length) return 0;
        const exceptions = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.", "vs.", "etc.", "i.e.", "e.g.", "ca.", "cf.", "Inc.", "Ltd.", "Corp.", "Co.", "Ave.", "St.", "Rd.", "Blvd.", ".js", ".css", ".md", ".txt", "Ph.D.", "M.D.", "B.A.", "M.A.", "U.S.", "U.K.", "a.m.", "p.m."];
        let working = text;
        for (const ex of exceptions) {
            const escapedEx = ex.replace(/\./g, "\\.");
            working = working.replace(new RegExp(`\\b${escapedEx}`, "gi"), ex.replace(/\./g, "PERIOD_PLACEHOLDER"));
        }
        working = working.replace(/\.{3}/g, "ELLIPSIS_PLACEHOLDER");
        const sentences = working.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
        return sentences.length;
    }

    removeFrontmatter(text) {
        if (!text.startsWith('---')) return text;
        const lines = text.split('\n');
        let endIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === '---') {
                endIndex = i;
                break;
            }
        }
        return endIndex !== -1 ? lines.slice(endIndex + 1).join('\n') : text;
    }
}

class SentenceCounterView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_SENTENCE_COUNTER; }
    getDisplayText() { return "Sentence Counter"; }
    getIcon() { return "hash"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        
        // Use a CSS class instead of writing styles in JS!
        container.addClass("sentence-counter-view-container");

        const content = container.createDiv({ cls: "sentence-counter-content" });

        content.createEl("h1", { text: "Statistics", cls: "sentence-counter-title" });

        this.countEl = content.createDiv({ text: "0 Sentences", cls: "sentence-counter-number" });
        this.wordCountEl = content.createDiv({ text: "0 Words", cls: "sentence-counter-word-count" });
        this.charCountEl = content.createDiv({ text: "0 Characters", cls: "sentence-counter-char-count" });
    }

    updateCount(sentenceCount, wordCount, charCount) {
        if (this.countEl) {
            this.countEl.setText(`${sentenceCount} Sentence${sentenceCount !== 1 ? 's' : ''}`);
        }
        if (this.wordCountEl) {
            if (this.plugin.settings.showWordCount) {
                this.wordCountEl.setText(`${wordCount} Word${wordCount !== 1 ? 's' : ''}`);
                this.wordCountEl.style.display = "block";
            } else {
                this.wordCountEl.style.display = "none";
            }
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

        containerEl.createEl('h3', { text: 'Content Filtering' });

        new Setting(containerEl)
            .setName('Ignore callouts')
            .setDesc('Do not include callout note content in counts')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ignoreCallouts)
                .onChange(async (value) => {
                    this.plugin.settings.ignoreCallouts = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateCount();
                }));

        containerEl.createEl('h3', { text: 'Display Options' });

        new Setting(containerEl)
            .setName('Show word count')
            .setDesc('Display word count in sidebar view')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showWordCount)
                .onChange(async (value) => {
                    this.plugin.settings.showWordCount = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateCount();
                }));

        new Setting(containerEl)
            .setName('Strip markdown from character count')
            .setDesc('Remove markdown formatting symbols from character count')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.stripMarkdownFromCharCount)
                .onChange(async (value) => {
                    this.plugin.settings.stripMarkdownFromCharCount = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateCount();
                }));
    }
}

module.exports = SentenceCounter;
