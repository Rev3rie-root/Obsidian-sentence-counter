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
        const text = `${sentenceCount} Sentence${sentenceCount !== 1 ? 's' : ''}`;

        if (this.settings.displayLocation === 'statusbar' && this.statusBarEl) {
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
        
        // Remove code blocks (both fenced and inline)
        cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
        cleaned = cleaned.replace(/`[^`]+`/g, "");
        
        // Remove callouts if enabled
        if (this.settings.ignoreCallouts) {
            // Match callout header and all subsequent blockquote lines
            // This handles callouts at end of file and multi-line callouts
            cleaned = cleaned.replace(/^>\s*\[!\w+\][^\n]*\n?(?:^>.*\n?)*/gm, "");
            // Clean up any remaining standalone blockquote markers from callouts
            cleaned = cleaned.replace(/^>\s*$/gm, "");
        }
        
        return cleaned;
    }

    stripMarkdown(text) {
        let stripped = text;
        
        // Remove links but keep link text: [text](url) -> text
        stripped = stripped.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");
        
        // Remove wiki-links but keep link text: [[link|text]] -> text, [[link]] -> link
        stripped = stripped.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
        stripped = stripped.replace(/\[\[([^\]]+)\]\]/g, "$1");
        
        // Remove images
        stripped = stripped.replace(/!\[([^\]]*)\]\([^\)]+\)/g, "");
        
        // Remove bold and italic markers
        stripped = stripped.replace(/(\*\*|__)(.*?)\1/g, "$2");
        stripped = stripped.replace(/(\*|_)(.*?)\1/g, "$2");
        
        // Remove strikethrough
        stripped = stripped.replace(/~~(.*?)~~/g, "$1");
        
        // Remove highlights
        stripped = stripped.replace(/==(.*?)==/g, "$1");
        
        // Remove headers
        stripped = stripped.replace(/^#{1,6}\s+/gm, "");
        
        // Remove blockquote markers
        stripped = stripped.replace(/^>\s*/gm, "");
        
        // Remove list markers
        stripped = stripped.replace(/^[\s]*[-*+]\s+/gm, "");
        stripped = stripped.replace(/^[\s]*\d+\.\s+/gm, "");
        
        // Remove horizontal rules
        stripped = stripped.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, "");
        
        // Remove HTML tags
        stripped = stripped.replace(/<[^>]+>/g, "");
        
        return stripped;
    }

    countCharacters(originalText, cleanedText) {
        if (this.settings.stripMarkdownFromCharCount) {
            // Strip markdown from the cleaned text (already has callouts/code removed)
            const stripped = this.stripMarkdown(cleanedText);
            // Remove extra whitespace and count
            return stripped.replace(/\s+/g, " ").trim().length;
        } else {
            // Count all characters in cleaned text
            return cleanedText.length;
        }
    }

    countWords(text) {
        if (!text.trim().length) return 0;
        
        // Split on whitespace and filter out empty strings
        const words = text
            .trim()
            .split(/\s+/)
            .filter(word => word.length > 0);
        
        return words.length;
    }

    countSentences(text) {
        if (!text.trim().length) return 0;

        const exceptions = [
            "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.", "vs.", "etc.", 
            "i.e.", "e.g.", "ca.", "cf.", "Inc.", "Ltd.", "Corp.", "Co.",
            "Ave.", "St.", "Rd.", "Blvd.", ".js", ".css", ".md", ".txt",
            "Ph.D.", "M.D.", "B.A.", "M.A.", "U.S.", "U.K.", "a.m.", "p.m."
        ];

        let working = text;

        // Replace exceptions with placeholder
        for (const ex of exceptions) {
            const escapedEx = ex.replace(/\./g, "\\.");
            working = working.replace(new RegExp(`\\b${escapedEx}`, "gi"),
                ex.replace(/\./g, "PERIOD_PLACEHOLDER"));
        }

        // Handle ellipsis
        working = working.replace(/\.{3}/g, "ELLIPSIS_PLACEHOLDER");

        // Split on sentence-ending punctuation
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
        this.wordCountEl = null;
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

        const title = container.createEl("h1", { text: "Statistics" });
        title.style.marginBottom = "20px";

        this.countEl = container.createEl("div", { text: "0 Sentences" });
        this.countEl.style.fontSize = "20px";
        this.countEl.style.fontWeight = "bold";
        this.countEl.style.marginTop = "10px";

        this.wordCountEl = container.createEl("div", { text: "0 Words" });
        this.wordCountEl.style.fontSize = "18px";
        this.wordCountEl.style.marginTop = "10px";
        this.wordCountEl.style.color = "var(--text-muted)";

        this.charCountEl = container.createEl("div", { text: "0 Characters" });
        this.charCountEl.style.fontSize = "16px";
        this.charCountEl.style.marginTop = "10px";
        this.charCountEl.style.color = "var(--text-muted)";
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
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.ignoreCallouts)
                    .onChange(async (value) => {
                        this.plugin.settings.ignoreCallouts = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateCount();
                    })
            );

        containerEl.createEl('h3', { text: 'Display Options' });

        new Setting(containerEl)
            .setName('Show word count')
            .setDesc('Display word count in sidebar view')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.showWordCount)
                    .onChange(async (value) => {
                        this.plugin.settings.showWordCount = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateCount();
                    })
            );

        new Setting(containerEl)
            .setName('Strip markdown from character count')
            .setDesc('Remove markdown formatting symbols from character count (recommended for accurate reading length)')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.stripMarkdownFromCharCount)
                    .onChange(async (value) => {
                        this.plugin.settings.stripMarkdownFromCharCount = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateCount();
                    })
            );
    }
}

module.exports = SentenceCounter;
