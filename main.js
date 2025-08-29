const { Plugin } = require("obsidian");

class SentenceCounter extends Plugin {
    onload() {
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.setText("Sentences: 0");
        
        // Register events
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => this.updateCount())
        );
        this.registerEvent(
            this.app.workspace.on("editor-change", () => this.updateCount())
        );
        
        // Initial count update
        this.updateCount();
    }

    onunload() {
        // Clean up if needed
    }

    updateCount() {
        // Try multiple ways to get the active editor
        let editor = null;
        
        // Method 1: Try activeEditor (newer Obsidian versions)
        if (this.app.workspace.activeEditor?.editor) {
            editor = this.app.workspace.activeEditor.editor;
        }
        // Method 2: Try getActiveViewOfType (older versions)
        else {
            const activeView = this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView);
            if (activeView) {
                editor = activeView.editor;
            }
        }
        
        if (!editor) {
            this.statusBarEl.setText("Sentences: 0");
            return;
        }

        const text = editor.getValue();
        const count = this.countSentences(text);
        this.statusBarEl.setText(`Sentences: ${count}`);
    }

    countSentences(text) {
        if (!text || text.trim().length === 0) {
            return 0;
        }

        // Remove YAML frontmatter (properties section)
        const cleanedText = this.removeFrontmatter(text);
        
        if (!cleanedText || cleanedText.trim().length === 0) {
            return 0;
        }

        // Common abbreviations that shouldn't end sentences
        const exceptions = [
            "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.",
            "vs.", "etc.", "i.e.", "e.g.", "ca.", "cf.", "Inc.",
            "Ltd.", "Corp.", "Co.", "Ave.", "St.", "Rd.", "Blvd."
        ];
        
        let working = cleanedText;
        
        // Replace exceptions with placeholder to avoid false sentence breaks
        for (const ex of exceptions) {
            // Properly escape the period for regex
            const escapedEx = ex.replace(/\./g, "\\.");
            working = working.replace(new RegExp(escapedEx, "gi"), ex.replace(".", "PERIOD_PLACEHOLDER"));
        }
        
        // Split on sentence-ending punctuation
        const sentences = working
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
        
        return sentences.length;
    }

    removeFrontmatter(text) {
        // Check if the text starts with YAML frontmatter
        if (!text.startsWith('---')) {
            return text;
        }
        
        // Find the closing --- of the frontmatter
        const lines = text.split('\n');
        let endIndex = -1;
        
        // Start from line 1 (skip the opening ---) and look for closing ---
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                endIndex = i;
                break;
            }
        }
        
        // If we found the closing ---, return everything after it
        if (endIndex !== -1) {
            return lines.slice(endIndex + 1).join('\n');
        }
        
        // If no closing --- found, return original text (malformed frontmatter)
        return text;
    }
}

module.exports = SentenceCounter;
