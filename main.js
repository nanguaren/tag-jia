'use strict';

var obsidian = require('obsidian');

// 添加语言资源文件
const LangResources = {
    zh: {
        autoRefresh: "自动刷新",
        refreshDesc: "修改文件后自动刷新文件列表",
        addTags: "添加标签",
        tagDesc: "用逗号分隔多个标签（输入时会有建议）",
        removeTags: "删除标签",
        removeTagDesc: "用逗号分隔要删除的标签（空则不删除）",
        selectAll: "全选",
        unselectAll: "全不选",
        save: "保存修改",
        example: "示例：",
        fileProcessed: (count) => `✅ 成功处理 ${count} 个文件`,
        noFileSelected: "⚠️ 请至少选择一个文件",
        noTagsInput: "⚠️ 请输入要添加或删除的标签",
        folderName: (level) => level === 0 ? "全部文件" : "文件夹",
        commandName: "自定义属性标签"
    },
    en: {
        autoRefresh: "Auto Refresh",
        refreshDesc: "Refresh file list automatically when modified",
        addTags: "Add tags",
        tagDesc: "Multiple tags separated by commas (with suggestions)",
        removeTags: "Remove tags",
        removeTagDesc: "Tags to remove (empty for none)",
        selectAll: "Select All",
        unselectAll: "Unselect All",
        save: "Save Changes",
        example: "Example: ",
        fileProcessed: (count) => `✅ Processed ${count} files`,
        noFileSelected: "⚠️ Please select at least one file",
        noTagsInput: "⚠️ Please enter tags to add or remove",
        folderName: (level) => level === 0 ? "All Files" : "Folder",
        commandName: "Advanced Tag Manager"
    }
};
const DEFAULT_SETTINGS = {
    autoRefresh: true,
    folderCollapseState: {},
    language: 'zh' // 添加缺失的language字段
};
class TagJiaSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        new obsidian.Setting(containerEl)
            .setName("Language")
            .setDesc("Application display language")
            .addDropdown(dropdown => dropdown
            .addOption('zh', '中文')
            .addOption('en', 'English')
            .setValue(this.plugin.settings.language)
            .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            new obsidian.Notice("Language changed - Restart required");
        }));
        new obsidian.Setting(containerEl)
            .setName(this.plugin.t('autoRefresh'))
            .setDesc(this.plugin.t('refreshDesc'))
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoRefresh)
            .onChange(async (value) => {
            this.plugin.settings.autoRefresh = value;
            await this.plugin.saveSettings();
        }));
    }
}
class TagJiaPlugin extends obsidian.Plugin {
    t(key, ...args) {
        const lang = this.settings.language;
        const resource = LangResources[lang][key];
        if (typeof resource === 'function') {
            // 使用类型断言确保参数正确
            return resource(...args);
        }
        return resource;
    }
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new TagJiaSettingTab(this.app, this));
        const style = document.createElement("style");
        style.textContent = `
            .tagjia-modal { padding: 15px; max-height: 80vh; overflow: auto; }
            .folder-header {
                cursor: pointer; padding: 8px; background: var(--background-secondary);
                border-radius: 4px; margin: 4px 0; display: flex; align-items: center; gap: 8px;
            }
            .folder-icon { font-size: 0.8em; user-select: none; }
            .folder-checkbox { margin-left: auto; }
            .file-item { margin-left: 20px; padding: 4px 0; }
            .file-checkbox { margin-right: 8px; }
            .action-bar {
                margin: 10px 0; display: flex; gap: 10px; position: sticky;
                top: 0; background: var(--background-primary); z-index: 1; padding: 8px 0;
            }
            .folder-children { display: none; }
            .folder-expanded .folder-children { display: block; }

            /* 标签建议样式 */
            .tag-suggestions {
                max-height: 200px;
                overflow-y: auto;
                margin-top: 5px;
                width: calc(100% - 24px);
                border: 1px solid var(--background-modifier-border);
                border-radius: 4px;
                box-shadow: 0 2px 8px var(--background-modifier-box-shadow);
                background: var(--background-primary);
                position: absolute;
                z-index: 9999;
            }
			/* 新增输入行容器样式 */
			.input-row {
				position: relative;
				margin-bottom: 15px;
			}

			/* 调整建议框定位方式 */
			.tag-suggestions {
				top: calc(100% + 5px) !important;  /* +5px与输入框保持间距 */
				left: 0 !important;
				width: 100% !important;  /* 与输入框同宽 */
				transform: none !important; /* 清除可能存在的变换 */
			}
            .tag-suggestion-item {
                padding: 6px 12px;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            .tag-suggestion-item:hover {
                background-color: var(--background-secondary);
            }`;
        document.head.appendChild(style);
        this.addCommand({
            id: "custom-tag-manager",
            name: this.t('commandName'),
            callback: () => new FileTagModal(this.app, this).open()
        });
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
}
class FileTagModal extends obsidian.Modal {
    constructor(app, plugin) {
        super(app);
        this.selectedFiles = [];
        this.tagInputValue = "";
        this.deleteTagInputValue = "";
        this.folderStructure = [];
        this.expandedFolders = new Set();
        this.allTags = [];
        this.plugin = plugin;
        this.buildFolderStructure();
    }
    getAllTags() {
        const tags = new Set();
        // 获取标签的更兼容方式（替代原来的getTags方法）
        const tagMap = this.app.metadataCache["tags"] || {};
        Object.keys(tagMap).forEach(fullTag => {
            const cleanTag = fullTag.split('/')[0].trim().replace(/^#/, '');
            if (cleanTag)
                tags.add(cleanTag);
        });
        // 处理YAML frontmatter标签
        this.app.vault.getMarkdownFiles().forEach(file => {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.tags) {
                this.parseFrontmatterTags(cache.frontmatter.tags).forEach(t => tags.add(t));
            }
        });
        return tags;
    }
    parseFrontmatterTags(tags) {
        if (Array.isArray(tags)) {
            return tags.map(t => t.toString().trim().replace(/^#/, ''));
        }
        if (typeof tags === 'string') {
            return tags.split(',').map(t => t.trim().replace(/^#/, ''));
        }
        return [];
    }
    async onOpen() {
        this.allTags = Array.from(this.getAllTags()).sort();
        this.renderModalContent();
    }
    buildFolderStructure() {
        const root = {
            type: "folder",
            path: "",
            name: this.plugin.t('folderName', 0),
            children: []
        };
        this.app.vault.getMarkdownFiles().forEach(file => {
            // 修正：使用完整真实路径处理（替代原先行拆分的方式）
            const pathParts = file.parent?.path.split("/") || [];
            let current = root;
            pathParts.forEach((part, index) => {
                const path = pathParts.slice(0, index + 1).join("/");
                let folder = current.children.find(item => item.type === "folder" && item.path === path);
                if (!folder) {
                    folder = {
                        type: "folder",
                        path: path,
                        name: part || this.plugin.t('folderName', 1),
                        children: []
                    };
                    current.children.push(folder);
                }
                current = folder;
            });
            current.children.push({ type: "file", file });
        });
        this.folderStructure = root.children;
        this.restoreCollapseState();
    }
    restoreCollapseState() {
        Object.entries(this.plugin.settings.folderCollapseState).forEach(([path, collapsed]) => {
            if (!collapsed)
                this.expandedFolders.add(path);
        });
    }
    renderModalContent() {
        this.contentEl.empty();
        this.contentEl.addClass("tagjia-modal");
        this.createFormInputs();
        this.renderFileTree();
        this.createActionButtons();
    }
    createFormInputs() {
        const tagContainer = this.contentEl.createDiv("tag-input-container");
        const inputRow = tagContainer.createDiv("input-row");
        // 创建标签输入框
        const tagSetting = new obsidian.Setting(inputRow)
            .setName(this.plugin.t('addTags'))
            .setDesc(this.plugin.t('tagDesc'));
        const tagInput = tagSetting.controlEl.createEl("input", {
            type: "text",
            cls: "tag-input",
            value: this.tagInputValue,
            placeholder: `${this.plugin.t('example')}project, important`
        });
        const suggestionWrapper = inputRow.createDiv("suggestion-wrapper");
        const suggestionContainer = suggestionWrapper.createDiv("tag-suggestions");
        suggestionContainer.hide();
        // 正确的事件处理位置
        tagInput.oninput = () => {
            this.tagInputValue = tagInput.value;
            const currentCaretPosition = tagInput.selectionStart || 0;
            const inputBeforeCaret = tagInput.value.slice(0, currentCaretPosition);
            const lastCommaIndex = inputBeforeCaret.lastIndexOf(',');
            const currentInput = inputBeforeCaret
                .slice(lastCommaIndex + 1)
                .trim()
                .replace(/^#/, '');
            const suggestions = Array.from(this.allTags)
                .filter(t => t.toLowerCase().includes(currentInput.toLowerCase()))
                .sort((a, b) => {
                const diff = a.length - b.length;
                return diff !== 0 ? diff : a.localeCompare(b);
            })
                .slice(0, 8);
            this.showSuggestions(suggestionContainer, tagInput, suggestions, currentInput);
        };
        // 处理建议点击
        let isClickingSuggestion = false;
        suggestionContainer.onmousedown = () => isClickingSuggestion = true;
        suggestionContainer.onmouseup = () => isClickingSuggestion = false;
        tagInput.onblur = () => {
            if (!isClickingSuggestion) {
                setTimeout(() => suggestionContainer.hide(), 200);
            }
        };
        // 删除标签部分
        new obsidian.Setting(this.contentEl)
            .setName(this.plugin.t('removeTags'))
            .setDesc(this.plugin.t('removeTagDesc'))
            .addText(text => text
            .setValue(this.deleteTagInputValue)
            .setPlaceholder(`${this.plugin.t('example')}oldproject, archived`)
            .onChange(v => this.deleteTagInputValue = v));
    }
    showSuggestions(container, input, suggestions, currentInput) {
        container.empty();
        if (suggestions.length === 0 || currentInput.length < 1) {
            container.hide();
            return;
        }
        container.style.backgroundColor = 'var(--background-primary)';
        container.style.borderColor = 'var(--background-modifier-border)';
        suggestions.forEach(tag => {
            const item = container.createDiv({ cls: 'tag-suggestion-item' });
            const matchIndex = tag.toLowerCase().indexOf(currentInput.toLowerCase());
            if (matchIndex >= 0) {
                item.append(tag.slice(0, matchIndex), createSpan({ text: tag.slice(matchIndex, matchIndex + currentInput.length), cls: 'suggestion-match' }), tag.slice(matchIndex + currentInput.length));
            }
            else {
                item.textContent = tag;
            }
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.insertTag(tag, input, currentInput);
            });
        });
        input.getBoundingClientRect();
        this.contentEl.getBoundingClientRect();
        container.show();
    }
    insertTag(selectedTag, input, currentInput) {
        const currentValue = input.value;
        const caretPos = input.selectionStart || 0;
        const textBeforeCaret = currentValue.slice(0, caretPos);
        const lastCommaIndex = textBeforeCaret.lastIndexOf(',');
        const newTags = [
            ...textBeforeCaret.slice(0, lastCommaIndex + 1).split(',').map(t => t.trim()),
            selectedTag
        ].filter(t => t).join(', ');
        const newValue = newTags +
            (currentValue.slice(caretPos).startsWith(',') ? '' : ', ') +
            currentValue.slice(caretPos).replace(/^\s*,?\s*/, '');
        input.value = newValue;
        this.tagInputValue = newValue;
        const newCaretPos = newTags.length + 2;
        input.setSelectionRange(newCaretPos, newCaretPos);
        input.dispatchEvent(new Event('input'));
    }
    // 修改按钮文字
    renderFileTree() {
        const actionBar = this.contentEl.createDiv("action-bar");
        new obsidian.ButtonComponent(actionBar)
            .setButtonText(`✅ ${this.plugin.t('selectAll')}`)
            .onClick(() => this.toggleAllSelection(true));
        new obsidian.ButtonComponent(actionBar)
            .setButtonText(`❌ ${this.plugin.t('unselectAll')}`)
            .onClick(() => this.toggleAllSelection(false));
        // 添加文件树渲染代码（原缺失部分）
        const treeContainer = this.contentEl.createDiv("file-tree-container");
        this.renderFolderStructure(treeContainer, this.folderStructure, 0);
    }
    createActionButtons() {
        this.contentEl.createEl("hr");
        new obsidian.ButtonComponent(this.contentEl)
            .setButtonText(`💾 ${this.plugin.t('save')}`)
            .setCta()
            .onClick(() => {
            this.processFiles()
                .then(() => this.close())
                .catch((error) => {
                new obsidian.Notice(`❌ 操作失败: ${error instanceof Error ? error.message : String(error)}`);
            });
        });
    }
    toggleAllSelection(select) {
        this.selectedFiles = select ? [...this.app.vault.getMarkdownFiles()] : [];
        this.contentEl.querySelectorAll('input[type="checkbox"]')
            .forEach(cb => cb.checked = select);
    }
    async processFiles() {
        if (!this.validateInput())
            return;
        const addTags = this.parseTags(this.tagInputValue);
        const removeTags = this.parseTags(this.deleteTagInputValue);
        try {
            await Promise.all(this.selectedFiles.map(file => this.processSingleFile(file, addTags, removeTags)));
            new obsidian.Notice(this.plugin.t('fileProcessed', this.selectedFiles.length));
            if (this.plugin.settings.autoRefresh) {
                this.app.workspace.requestSaveLayout();
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            throw new Error(`文件处理失败: ${errorMessage}`);
        }
    }
    validateInput() {
        if (this.selectedFiles.length === 0) {
            new obsidian.Notice(this.plugin.t('noFileSelected'));
            return false;
        }
        const addEmpty = this.tagInputValue.trim() === "";
        const removeEmpty = this.deleteTagInputValue.trim() === "";
        if (addEmpty && removeEmpty) {
            new obsidian.Notice(this.plugin.t('noTagsInput'));
            return false;
        }
        return true;
    }
    parseTags(input) {
        return input
            .split(/[,，]/g)
            .map(t => t.trim().replace(/#/g, ''))
            .filter(t => t.length > 0);
    }
    async processSingleFile(file, addTags, removeTags) {
        const content = await this.app.vault.cachedRead(file);
        const cache = this.app.metadataCache.getFileCache(file) ?? { frontmatter: {} };
        let currentTags = this.getCurrentTags(cache.frontmatter?.tags);
        const newTags = [
            ...currentTags.filter(t => !removeTags.includes(t)),
            ...addTags
        ].filter((v, i, a) => a.indexOf(v) === i);
        const newYAML = this.buildNewYAML(cache.frontmatter || {}, newTags);
        await this.app.vault.modify(file, this.replaceYAML(content, newYAML));
    }
    getCurrentTags(tags) {
        if (!tags)
            return [];
        if (Array.isArray(tags))
            return tags.map(t => t.toString().trim());
        if (typeof tags === 'string')
            return this.parseTags(tags);
        return [];
    }
    buildNewYAML(original, tags) {
        const lines = [];
        const otherKeys = Object.keys(original).filter(k => k !== "tags");
        if (tags.length > 0) {
            lines.push("tags:");
            tags.forEach(t => lines.push(`  - ${t}`));
        }
        otherKeys.forEach(key => {
            const value = original[key];
            lines.push(`${key}: ${this.stringifyYAMLValue(value)}`);
        });
        lines.push(`updated: "${new Date().toISOString()}"`);
        return lines.join("\n");
    }
    stringifyYAMLValue(value) {
        if (typeof value === "string")
            return value;
        if (Array.isArray(value))
            return `[${value.map(v => `"${v}"`).join(", ")}]`;
        return JSON.stringify(value);
    }
    replaceYAML(content, newYAML) {
        const parts = content.split("---");
        const body = parts.slice(2).join("---").trim();
        return `---\n${newYAML}\n---${body ? `\n${body}` : ""}`;
    }
    renderFolderStructure(container, items, indent) {
        container.empty();
        items.forEach(item => {
            item.type === "folder"
                ? this.renderFolderItem(container, item, indent)
                : this.renderFileItem(container, item, indent);
        });
    }
    renderFolderItem(container, folder, indent) {
        const displayName = folder.path === ""
            ? this.plugin.t('folderName', 0) // 正确的条件表达式
            : folder.name;
        const isExpanded = this.expandedFolders.has(folder.path);
        const folderEl = container.createDiv(`folder-item ${isExpanded ? 'folder-expanded' : ''}`);
        folderEl.style.marginLeft = `${indent * 20}px`;
        folderEl.dataset.path = folder.path;
        const header = folderEl.createDiv("folder-header");
        const icon = header.createSpan({
            cls: "folder-icon",
            text: isExpanded ? "▼" : "▶"
        });
        icon.onclick = () => this.toggleFolder(folder.path, folderEl);
        header.createSpan({ text: displayName });
        const checkbox = header.createEl("input", {
            type: "checkbox",
            cls: "folder-checkbox"
        });
        checkbox.checked = this.isAllChildrenSelected(folder);
        checkbox.onchange = () => this.toggleFolderSelection(folder, checkbox.checked);
        const childrenEl = folderEl.createDiv("folder-children");
        if (isExpanded) {
            this.renderFolderStructure(childrenEl, folder.children, indent + 1);
        }
    }
    renderFileItem(container, fileItem, indent) {
        const fileEl = container.createDiv("file-item");
        fileEl.style.marginLeft = `${indent * 20}px`;
        const checkbox = fileEl.createEl("input", {
            type: "checkbox",
            cls: "file-checkbox"
        });
        checkbox.checked = this.selectedFiles.includes(fileItem.file);
        checkbox.onchange = () => this.toggleFileSelection(fileItem.file, checkbox.checked);
        fileEl.createSpan({ text: fileItem.file.basename });
    }
    toggleFileSelection(file, selected) {
        this.selectedFiles = selected
            ? [...this.selectedFiles, file].filter((v, i, a) => a.indexOf(v) === i)
            : this.selectedFiles.filter(f => f !== file);
    }
    toggleFolder(path, container) {
        const wasExpanded = this.expandedFolders.has(path);
        this.expandedFolders[wasExpanded ? 'delete' : 'add'](path);
        // 修复类型错误：添加类型断言
        const childrenContainer = container.querySelector(".folder-children");
        childrenContainer.empty();
        if (!wasExpanded) {
            const folder = this.findFolderByPath(path);
            if (folder) {
                this.renderFolderStructure(childrenContainer, folder.children, parseInt(container.style.marginLeft || "0") / 20 + 1);
            }
        }
        const icon = container.querySelector(".folder-icon");
        icon.textContent = wasExpanded ? "▶" : "▼";
        container.classList.toggle("folder-expanded", !wasExpanded);
        this.plugin.settings.folderCollapseState[path] = !wasExpanded;
        this.plugin.saveSettings();
    }
    findFolderByPath(path) {
        const walk = (items) => {
            for (const item of items) {
                if (item.type === "folder") {
                    // 直接匹配真实路径（不转换显示名称）
                    if (item.path === path)
                        return item;
                    const found = walk(item.children);
                    if (found)
                        return found;
                }
            }
        };
        return walk(this.folderStructure);
    }
    isAllChildrenSelected(folder) {
        const files = this.getFolderFiles(folder);
        return files.every(f => this.selectedFiles.includes(f)) && files.length > 0;
    }
    getFolderFiles(folder) {
        const files = [];
        const walk = (item) => {
            if (item.type === "folder") {
                item.children.forEach(walk);
            }
            else {
                files.push(item.file);
            }
        };
        walk(folder);
        return files;
    }
    toggleFolderSelection(folder, selected) {
        const files = this.getFolderFiles(folder);
        this.selectedFiles = selected
            ? [...new Set([...this.selectedFiles, ...files])]
            : this.selectedFiles.filter(f => !files.includes(f));
        const selectorPrefix = `[data-path^="${folder.path}/"] .file-checkbox`;
        this.contentEl.querySelectorAll(selectorPrefix).forEach(cb => {
            cb.checked = selected;
        });
    }
    onClose() {
        this.contentEl.empty();
    }
}

module.exports = TagJiaPlugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsic3JjL21haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcclxuICAgIEFwcCxcclxuICAgIEJ1dHRvbkNvbXBvbmVudCxcclxuICAgIE1vZGFsLFxyXG4gICAgTm90aWNlLFxyXG4gICAgUGx1Z2luLFxyXG4gICAgUGx1Z2luU2V0dGluZ1RhYixcclxuICAgIFNldHRpbmcsXHJcbiAgICBURmlsZVxyXG59IGZyb20gXCJvYnNpZGlhblwiO1xyXG5cclxuLy8g5paw5aKe6K+t6KiA57G75Z6L5a6a5LmJXHJcbnR5cGUgQXBwTGFuZ3VhZ2UgPSAnemgnIHwgJ2VuJztcclxuXHJcbmludGVyZmFjZSBUYWdKaWFTZXR0aW5ncyB7XHJcbiAgICBhdXRvUmVmcmVzaDogYm9vbGVhbjtcclxuICAgIGZvbGRlckNvbGxhcHNlU3RhdGU6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+O1xyXG4gICAgbGFuZ3VhZ2U6IEFwcExhbmd1YWdlOyAvLyDmlrDlop7or63oqIDorr7nva7poblcclxufVxyXG5cclxuLy8g5re75Yqg6K+t6KiA6LWE5rqQ5paH5Lu2XHJcbmNvbnN0IExhbmdSZXNvdXJjZXMgPSB7XHJcbiAgICB6aDoge1xyXG4gICAgICAgIGF1dG9SZWZyZXNoOiBcIuiHquWKqOWIt+aWsFwiLFxyXG4gICAgICAgIHJlZnJlc2hEZXNjOiBcIuS/ruaUueaWh+S7tuWQjuiHquWKqOWIt+aWsOaWh+S7tuWIl+ihqFwiLFxyXG4gICAgICAgIGFkZFRhZ3M6IFwi5re75Yqg5qCH562+XCIsXHJcbiAgICAgICAgdGFnRGVzYzogXCLnlKjpgJflj7fliIbpmpTlpJrkuKrmoIfnrb7vvIjovpPlhaXml7bkvJrmnInlu7rorq7vvIlcIixcclxuICAgICAgICByZW1vdmVUYWdzOiBcIuWIoOmZpOagh+etvlwiLFxyXG4gICAgICAgIHJlbW92ZVRhZ0Rlc2M6IFwi55So6YCX5Y+35YiG6ZqU6KaB5Yig6Zmk55qE5qCH562+77yI56m65YiZ5LiN5Yig6Zmk77yJXCIsXHJcbiAgICAgICAgc2VsZWN0QWxsOiBcIuWFqOmAiVwiLFxyXG4gICAgICAgIHVuc2VsZWN0QWxsOiBcIuWFqOS4jemAiVwiLFxyXG4gICAgICAgIHNhdmU6IFwi5L+d5a2Y5L+u5pS5XCIsXHJcbiAgICAgICAgZXhhbXBsZTogXCLnpLrkvovvvJpcIixcclxuICAgICAgICBmaWxlUHJvY2Vzc2VkOiAoY291bnQ6IG51bWJlcikgPT4gYOKchSDmiJDlip/lpITnkIYgJHtjb3VudH0g5Liq5paH5Lu2YCxcclxuICAgICAgICBub0ZpbGVTZWxlY3RlZDogXCLimqDvuI8g6K+36Iez5bCR6YCJ5oup5LiA5Liq5paH5Lu2XCIsXHJcbiAgICAgICAgbm9UYWdzSW5wdXQ6IFwi4pqg77iPIOivt+i+k+WFpeimgea3u+WKoOaIluWIoOmZpOeahOagh+etvlwiLFxyXG4gICAgICAgIGZvbGRlck5hbWU6IChsZXZlbDogbnVtYmVyKSA9PiBsZXZlbCA9PT0gMCA/IFwi5YWo6YOo5paH5Lu2XCIgOiBcIuaWh+S7tuWkuVwiLFxyXG4gICAgICAgIGNvbW1hbmROYW1lOiBcIuiHquWumuS5ieWxnuaAp+agh+etvlwiIFxyXG4gICAgfSxcclxuICAgIGVuOiB7XHJcbiAgICAgICAgYXV0b1JlZnJlc2g6IFwiQXV0byBSZWZyZXNoXCIsXHJcbiAgICAgICAgcmVmcmVzaERlc2M6IFwiUmVmcmVzaCBmaWxlIGxpc3QgYXV0b21hdGljYWxseSB3aGVuIG1vZGlmaWVkXCIsXHJcbiAgICAgICAgYWRkVGFnczogXCJBZGQgdGFnc1wiLFxyXG4gICAgICAgIHRhZ0Rlc2M6IFwiTXVsdGlwbGUgdGFncyBzZXBhcmF0ZWQgYnkgY29tbWFzICh3aXRoIHN1Z2dlc3Rpb25zKVwiLFxyXG4gICAgICAgIHJlbW92ZVRhZ3M6IFwiUmVtb3ZlIHRhZ3NcIixcclxuICAgICAgICByZW1vdmVUYWdEZXNjOiBcIlRhZ3MgdG8gcmVtb3ZlIChlbXB0eSBmb3Igbm9uZSlcIixcclxuICAgICAgICBzZWxlY3RBbGw6IFwiU2VsZWN0IEFsbFwiLFxyXG4gICAgICAgIHVuc2VsZWN0QWxsOiBcIlVuc2VsZWN0IEFsbFwiLFxyXG4gICAgICAgIHNhdmU6IFwiU2F2ZSBDaGFuZ2VzXCIsXHJcbiAgICAgICAgZXhhbXBsZTogXCJFeGFtcGxlOiBcIixcclxuICAgICAgICBmaWxlUHJvY2Vzc2VkOiAoY291bnQ6IG51bWJlcikgPT4gYOKchSBQcm9jZXNzZWQgJHtjb3VudH0gZmlsZXNgLFxyXG4gICAgICAgIG5vRmlsZVNlbGVjdGVkOiBcIuKaoO+4jyBQbGVhc2Ugc2VsZWN0IGF0IGxlYXN0IG9uZSBmaWxlXCIsXHJcbiAgICAgICAgbm9UYWdzSW5wdXQ6IFwi4pqg77iPIFBsZWFzZSBlbnRlciB0YWdzIHRvIGFkZCBvciByZW1vdmVcIixcclxuICAgICAgICBmb2xkZXJOYW1lOiAobGV2ZWw6IG51bWJlcikgPT4gbGV2ZWwgPT09IDAgPyBcIkFsbCBGaWxlc1wiIDogXCJGb2xkZXJcIixcclxuICAgICAgICBjb21tYW5kTmFtZTogXCJBZHZhbmNlZCBUYWcgTWFuYWdlclwiXHJcbiAgICB9XHJcbn07XHJcblxyXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBUYWdKaWFTZXR0aW5ncyA9IHtcclxuICAgIGF1dG9SZWZyZXNoOiB0cnVlLFxyXG4gICAgZm9sZGVyQ29sbGFwc2VTdGF0ZToge30sXHJcbiAgICBsYW5ndWFnZTogJ3poJyAvLyDmt7vliqDnvLrlpLHnmoRsYW5ndWFnZeWtl+autVxyXG59O1xyXG5cclxuaW50ZXJmYWNlIEZvbGRlckl0ZW0ge1xyXG4gICAgdHlwZTogXCJmb2xkZXJcIjtcclxuICAgIHBhdGg6IHN0cmluZztcclxuICAgIG5hbWU6IHN0cmluZztcclxuICAgIGNoaWxkcmVuOiAoRm9sZGVySXRlbSB8IEZpbGVJdGVtKVtdO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgRmlsZUl0ZW0ge1xyXG4gICAgdHlwZTogXCJmaWxlXCI7XHJcbiAgICBmaWxlOiBURmlsZTtcclxufVxyXG5cclxuY2xhc3MgVGFnSmlhU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xyXG4gICAgcGx1Z2luOiBUYWdKaWFQbHVnaW47XHJcblxyXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVGFnSmlhUGx1Z2luKSB7XHJcbiAgICAgICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gICAgICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gICAgfVxyXG5cclxuICAgIGRpc3BsYXkoKSB7XHJcbiAgICAgICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcclxuICAgICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG5cclxuICAgICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgICAgICAgLnNldE5hbWUoXCJMYW5ndWFnZVwiKVxyXG4gICAgICAgICAgICAuc2V0RGVzYyhcIkFwcGxpY2F0aW9uIGRpc3BsYXkgbGFuZ3VhZ2VcIilcclxuICAgICAgICAgICAgLmFkZERyb3Bkb3duKGRyb3Bkb3duID0+IGRyb3Bkb3duXHJcbiAgICAgICAgICAgICAgICAuYWRkT3B0aW9uKCd6aCcsICfkuK3mlocnKVxyXG4gICAgICAgICAgICAgICAgLmFkZE9wdGlvbignZW4nLCAnRW5nbGlzaCcpXHJcbiAgICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MubGFuZ3VhZ2UpXHJcbiAgICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MubGFuZ3VhZ2UgPSB2YWx1ZSBhcyBBcHBMYW5ndWFnZTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiTGFuZ3VhZ2UgY2hhbmdlZCAtIFJlc3RhcnQgcmVxdWlyZWRcIik7XHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAgICAgICAuc2V0TmFtZSh0aGlzLnBsdWdpbi50KCdhdXRvUmVmcmVzaCcpKVxyXG4gICAgICAgICAgICAuc2V0RGVzYyh0aGlzLnBsdWdpbi50KCdyZWZyZXNoRGVzYycpKVxyXG4gICAgICAgICAgICAuYWRkVG9nZ2xlKHRvZ2dsZSA9PiB0b2dnbGVcclxuICAgICAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvUmVmcmVzaClcclxuICAgICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyB2YWx1ZSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b1JlZnJlc2ggPSB2YWx1ZTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICB9XHJcbn1cclxuXHJcblxyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUYWdKaWFQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gICAgc2V0dGluZ3MhOiBUYWdKaWFTZXR0aW5ncztcclxuXHJcbiAgICB0KGtleToga2V5b2YgdHlwZW9mIExhbmdSZXNvdXJjZXNbJ3poJ10sIC4uLmFyZ3M6IGFueVtdKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBsYW5nID0gdGhpcy5zZXR0aW5ncy5sYW5ndWFnZTtcclxuICAgICAgICBjb25zdCByZXNvdXJjZSA9IExhbmdSZXNvdXJjZXNbbGFuZ11ba2V5XTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodHlwZW9mIHJlc291cmNlID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIC8vIOS9v+eUqOexu+Wei+aWreiogOehruS/neWPguaVsOato+ehrlxyXG4gICAgICAgICAgICByZXR1cm4gKHJlc291cmNlIGFzICguLi5hcmdzOiBhbnlbXSkgPT4gc3RyaW5nKSguLi5hcmdzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlc291cmNlIGFzIHN0cmluZztcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBvbmxvYWQoKSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFRhZ0ppYVNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3R5bGVcIik7XHJcbiAgICAgICAgc3R5bGUudGV4dENvbnRlbnQgPSBgXHJcbiAgICAgICAgICAgIC50YWdqaWEtbW9kYWwgeyBwYWRkaW5nOiAxNXB4OyBtYXgtaGVpZ2h0OiA4MHZoOyBvdmVyZmxvdzogYXV0bzsgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWhlYWRlciB7XHJcbiAgICAgICAgICAgICAgICBjdXJzb3I6IHBvaW50ZXI7IHBhZGRpbmc6IDhweDsgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZC1zZWNvbmRhcnkpO1xyXG4gICAgICAgICAgICAgICAgYm9yZGVyLXJhZGl1czogNHB4OyBtYXJnaW46IDRweCAwOyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWljb24geyBmb250LXNpemU6IDAuOGVtOyB1c2VyLXNlbGVjdDogbm9uZTsgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWNoZWNrYm94IHsgbWFyZ2luLWxlZnQ6IGF1dG87IH1cclxuICAgICAgICAgICAgLmZpbGUtaXRlbSB7IG1hcmdpbi1sZWZ0OiAyMHB4OyBwYWRkaW5nOiA0cHggMDsgfVxyXG4gICAgICAgICAgICAuZmlsZS1jaGVja2JveCB7IG1hcmdpbi1yaWdodDogOHB4OyB9XHJcbiAgICAgICAgICAgIC5hY3Rpb24tYmFyIHtcclxuICAgICAgICAgICAgICAgIG1hcmdpbjogMTBweCAwOyBkaXNwbGF5OiBmbGV4OyBnYXA6IDEwcHg7IHBvc2l0aW9uOiBzdGlja3k7XHJcbiAgICAgICAgICAgICAgICB0b3A6IDA7IGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtcHJpbWFyeSk7IHotaW5kZXg6IDE7IHBhZGRpbmc6IDhweCAwO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC5mb2xkZXItY2hpbGRyZW4geyBkaXNwbGF5OiBub25lOyB9XHJcbiAgICAgICAgICAgIC5mb2xkZXItZXhwYW5kZWQgLmZvbGRlci1jaGlsZHJlbiB7IGRpc3BsYXk6IGJsb2NrOyB9XHJcblxyXG4gICAgICAgICAgICAvKiDmoIfnrb7lu7rorq7moLflvI8gKi9cclxuICAgICAgICAgICAgLnRhZy1zdWdnZXN0aW9ucyB7XHJcbiAgICAgICAgICAgICAgICBtYXgtaGVpZ2h0OiAyMDBweDtcclxuICAgICAgICAgICAgICAgIG92ZXJmbG93LXk6IGF1dG87XHJcbiAgICAgICAgICAgICAgICBtYXJnaW4tdG9wOiA1cHg7XHJcbiAgICAgICAgICAgICAgICB3aWR0aDogY2FsYygxMDAlIC0gMjRweCk7XHJcbiAgICAgICAgICAgICAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlcik7XHJcbiAgICAgICAgICAgICAgICBib3JkZXItcmFkaXVzOiA0cHg7XHJcbiAgICAgICAgICAgICAgICBib3gtc2hhZG93OiAwIDJweCA4cHggdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3gtc2hhZG93KTtcclxuICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtcHJpbWFyeSk7XHJcbiAgICAgICAgICAgICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICAgICAgICAgICAgICB6LWluZGV4OiA5OTk5O1xyXG4gICAgICAgICAgICB9XHJcblx0XHRcdC8qIOaWsOWinui+k+WFpeihjOWuueWZqOagt+W8jyAqL1xyXG5cdFx0XHQuaW5wdXQtcm93IHtcclxuXHRcdFx0XHRwb3NpdGlvbjogcmVsYXRpdmU7XHJcblx0XHRcdFx0bWFyZ2luLWJvdHRvbTogMTVweDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Lyog6LCD5pW05bu66K6u5qGG5a6a5L2N5pa55byPICovXHJcblx0XHRcdC50YWctc3VnZ2VzdGlvbnMge1xyXG5cdFx0XHRcdHRvcDogY2FsYygxMDAlICsgNXB4KSAhaW1wb3J0YW50OyAgLyogKzVweOS4jui+k+WFpeahhuS/neaMgemXtOi3nSAqL1xyXG5cdFx0XHRcdGxlZnQ6IDAgIWltcG9ydGFudDtcclxuXHRcdFx0XHR3aWR0aDogMTAwJSAhaW1wb3J0YW50OyAgLyog5LiO6L6T5YWl5qGG5ZCM5a69ICovXHJcblx0XHRcdFx0dHJhbnNmb3JtOiBub25lICFpbXBvcnRhbnQ7IC8qIOa4hemZpOWPr+iDveWtmOWcqOeahOWPmOaNoiAqL1xyXG5cdFx0XHR9XHJcbiAgICAgICAgICAgIC50YWctc3VnZ2VzdGlvbi1pdGVtIHtcclxuICAgICAgICAgICAgICAgIHBhZGRpbmc6IDZweCAxMnB4O1xyXG4gICAgICAgICAgICAgICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAwLjJzO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC50YWctc3VnZ2VzdGlvbi1pdGVtOmhvdmVyIHtcclxuICAgICAgICAgICAgICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJhY2tncm91bmQtc2Vjb25kYXJ5KTtcclxuICAgICAgICAgICAgfWA7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzdHlsZSk7XHJcblxyXG4gICAgICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgICAgICAgIGlkOiBcImN1c3RvbS10YWctbWFuYWdlclwiLFxyXG4gICAgICAgICAgICBuYW1lOiB0aGlzLnQoJ2NvbW1hbmROYW1lJyksICAvLyDlnKhMYW5nUmVzb3VyY2Vz5Lit6ZyA6KaB5re75Yqg5a+55bqU6ZSu5YC8XHJcbiAgICAgICAgICAgIGNhbGxiYWNrOiAoKSA9PiBuZXcgRmlsZVRhZ01vZGFsKHRoaXMuYXBwLCB0aGlzKS5vcGVuKClcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XHJcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmNsYXNzIEZpbGVUYWdNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICAgIHByaXZhdGUgcGx1Z2luOiBUYWdKaWFQbHVnaW47XHJcbiAgICBwcml2YXRlIHNlbGVjdGVkRmlsZXM6IFRGaWxlW10gPSBbXTtcclxuICAgIHByaXZhdGUgdGFnSW5wdXRWYWx1ZSA9IFwiXCI7XHJcbiAgICBwcml2YXRlIGRlbGV0ZVRhZ0lucHV0VmFsdWUgPSBcIlwiO1xyXG4gICAgcHJpdmF0ZSBmb2xkZXJTdHJ1Y3R1cmU6IChGb2xkZXJJdGVtIHwgRmlsZUl0ZW0pW10gPSBbXTtcclxuICAgIHByaXZhdGUgZXhwYW5kZWRGb2xkZXJzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICBwcml2YXRlIGFsbFRhZ3M6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgXHJcblxyXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVGFnSmlhUGx1Z2luKSB7XHJcbiAgICAgICAgc3VwZXIoYXBwKTtcclxuICAgICAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICAgICAgICB0aGlzLmJ1aWxkRm9sZGVyU3RydWN0dXJlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBnZXRBbGxUYWdzKCk6IFNldDxzdHJpbmc+IHtcclxuICAgICAgICBjb25zdCB0YWdzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICAgICAgXHJcblx0Ly8g6I635Y+W5qCH562+55qE5pu05YW85a655pa55byP77yI5pu/5Luj5Y6f5p2l55qEZ2V0VGFnc+aWueazle+8iVxyXG5cdGNvbnN0IHRhZ01hcCA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGVbXCJ0YWdzXCJdIGFzIFJlY29yZDxzdHJpbmcsIG51bWJlcj4gfHwge307IFxyXG5cdE9iamVjdC5rZXlzKHRhZ01hcCkuZm9yRWFjaChmdWxsVGFnID0+IHtcclxuXHRcdGNvbnN0IGNsZWFuVGFnID0gZnVsbFRhZy5zcGxpdCgnLycpWzBdLnRyaW0oKS5yZXBsYWNlKC9eIy8sICcnKTtcclxuXHRcdGlmIChjbGVhblRhZykgdGFncy5hZGQoY2xlYW5UYWcpO1xyXG5cdH0pO1xyXG5cclxuICAgICAgICAvLyDlpITnkIZZQU1MIGZyb250bWF0dGVy5qCH562+XHJcbiAgICAgICAgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZvckVhY2goZmlsZSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhY2hlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk7XHJcbiAgICAgICAgICAgIGlmIChjYWNoZT8uZnJvbnRtYXR0ZXI/LnRhZ3MpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMucGFyc2VGcm9udG1hdHRlclRhZ3MoY2FjaGUuZnJvbnRtYXR0ZXIudGFncykuZm9yRWFjaCh0ID0+IHRhZ3MuYWRkKHQpKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICByZXR1cm4gdGFncztcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHBhcnNlRnJvbnRtYXR0ZXJUYWdzKHRhZ3M6IGFueSk6IHN0cmluZ1tdIHtcclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh0YWdzKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGFncy5tYXAodCA9PiB0LnRvU3RyaW5nKCkudHJpbSgpLnJlcGxhY2UoL14jLywgJycpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHR5cGVvZiB0YWdzID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGFncy5zcGxpdCgnLCcpLm1hcCh0ID0+IHQudHJpbSgpLnJlcGxhY2UoL14jLywgJycpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIG9uT3BlbigpIHsgXHJcbiAgICAgICAgdGhpcy5hbGxUYWdzID0gQXJyYXkuZnJvbSh0aGlzLmdldEFsbFRhZ3MoKSkuc29ydCgpO1xyXG4gICAgICAgIHRoaXMucmVuZGVyTW9kYWxDb250ZW50KCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBidWlsZEZvbGRlclN0cnVjdHVyZSgpIHtcclxuICAgICAgICBjb25zdCByb290OiBGb2xkZXJJdGVtID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcImZvbGRlclwiLFxyXG4gICAgICAgICAgICBwYXRoOiBcIlwiLCAgLy8g5L+d5oyB6Lev5b6E5Li656m65a2X56ym5Liy77yI6YeN6KaB77yB77yJXHJcbiAgICAgICAgICAgIG5hbWU6IHRoaXMucGx1Z2luLnQoJ2ZvbGRlck5hbWUnLCAwKSxcclxuICAgICAgICAgICAgY2hpbGRyZW46IFtdXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZvckVhY2goZmlsZSA9PiB7XHJcbiAgICAgICAgICAgIC8vIOS/ruato++8muS9v+eUqOWujOaVtOecn+Wunui3r+W+hOWkhOeQhu+8iOabv+S7o+WOn+WFiOihjOaLhuWIhueahOaWueW8j++8iVxyXG4gICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBmaWxlLnBhcmVudD8ucGF0aC5zcGxpdChcIi9cIikgfHwgW107XHJcbiAgICAgICAgICAgIGxldCBjdXJyZW50ID0gcm9vdDtcclxuXHJcbiAgICAgICAgICAgIHBhdGhQYXJ0cy5mb3JFYWNoKChwYXJ0LCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGF0aCA9IHBhdGhQYXJ0cy5zbGljZSgwLCBpbmRleCArIDEpLmpvaW4oXCIvXCIpO1xyXG4gICAgICAgICAgICAgICAgbGV0IGZvbGRlciA9IGN1cnJlbnQuY2hpbGRyZW4uZmluZChcclxuICAgICAgICAgICAgICAgICAgICBpdGVtID0+IGl0ZW0udHlwZSA9PT0gXCJmb2xkZXJcIiAmJiBpdGVtLnBhdGggPT09IHBhdGhcclxuICAgICAgICAgICAgICAgICkgYXMgRm9sZGVySXRlbTtcclxuICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFmb2xkZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBmb2xkZXIgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiZm9sZGVyXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsICAvLyDkv53mjIHnnJ/lrp7ot6/lvoRcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCB8fCB0aGlzLnBsdWdpbi50KCdmb2xkZXJOYW1lJywgMSksIC8vIOWkhOeQhuagueaWh+S7tuWkueWQjeensFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjogW11cclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnQuY2hpbGRyZW4ucHVzaChmb2xkZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY3VycmVudCA9IGZvbGRlcjtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICBcclxuICAgICAgICAgICAgY3VycmVudC5jaGlsZHJlbi5wdXNoKHsgdHlwZTogXCJmaWxlXCIsIGZpbGUgfSk7IFxyXG4gICAgICAgIH0pO1xyXG4gICAgXHJcbiAgICAgICAgdGhpcy5mb2xkZXJTdHJ1Y3R1cmUgPSByb290LmNoaWxkcmVuO1xyXG4gICAgICAgIHRoaXMucmVzdG9yZUNvbGxhcHNlU3RhdGUoKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlc3RvcmVDb2xsYXBzZVN0YXRlKCkge1xyXG4gICAgICAgIE9iamVjdC5lbnRyaWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLmZvbGRlckNvbGxhcHNlU3RhdGUpLmZvckVhY2goXHJcbiAgICAgICAgICAgIChbcGF0aCwgY29sbGFwc2VkXSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFjb2xsYXBzZWQpIHRoaXMuZXhwYW5kZWRGb2xkZXJzLmFkZChwYXRoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZW5kZXJNb2RhbENvbnRlbnQoKSB7XHJcbiAgICAgICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcclxuICAgICAgICB0aGlzLmNvbnRlbnRFbC5hZGRDbGFzcyhcInRhZ2ppYS1tb2RhbFwiKTtcclxuICAgICAgICB0aGlzLmNyZWF0ZUZvcm1JbnB1dHMoKTtcclxuICAgICAgICB0aGlzLnJlbmRlckZpbGVUcmVlKCk7XHJcbiAgICAgICAgdGhpcy5jcmVhdGVBY3Rpb25CdXR0b25zKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjcmVhdGVGb3JtSW5wdXRzKCkge1xyXG4gICAgICAgIGNvbnN0IHRhZ0NvbnRhaW5lciA9IHRoaXMuY29udGVudEVsLmNyZWF0ZURpdihcInRhZy1pbnB1dC1jb250YWluZXJcIik7XHJcbiAgICAgICAgY29uc3QgaW5wdXRSb3cgPSB0YWdDb250YWluZXIuY3JlYXRlRGl2KFwiaW5wdXQtcm93XCIpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIOWIm+W7uuagh+etvui+k+WFpeahhlxyXG4gICAgICAgIGNvbnN0IHRhZ1NldHRpbmcgPSBuZXcgU2V0dGluZyhpbnB1dFJvdylcclxuICAgICAgICAgICAgLnNldE5hbWUodGhpcy5wbHVnaW4udCgnYWRkVGFncycpKVxyXG4gICAgICAgICAgICAuc2V0RGVzYyh0aGlzLnBsdWdpbi50KCd0YWdEZXNjJykpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHRhZ0lucHV0ID0gdGFnU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxyXG4gICAgICAgICAgICBjbHM6IFwidGFnLWlucHV0XCIsXHJcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLnRhZ0lucHV0VmFsdWUsXHJcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBgJHt0aGlzLnBsdWdpbi50KCdleGFtcGxlJyl9cHJvamVjdCwgaW1wb3J0YW50YFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCBzdWdnZXN0aW9uV3JhcHBlciA9IGlucHV0Um93LmNyZWF0ZURpdihcInN1Z2dlc3Rpb24td3JhcHBlclwiKTtcclxuICAgICAgICBjb25zdCBzdWdnZXN0aW9uQ29udGFpbmVyID0gc3VnZ2VzdGlvbldyYXBwZXIuY3JlYXRlRGl2KFwidGFnLXN1Z2dlc3Rpb25zXCIpO1xyXG4gICAgICAgIHN1Z2dlc3Rpb25Db250YWluZXIuaGlkZSgpO1xyXG5cclxuICAgICAgICAvLyDmraPnoa7nmoTkuovku7blpITnkIbkvY3nva5cclxuICAgICAgICB0YWdJbnB1dC5vbmlucHV0ID0gKCkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnRhZ0lucHV0VmFsdWUgPSB0YWdJbnB1dC52YWx1ZTtcclxuICAgICAgICAgICAgY29uc3QgY3VycmVudENhcmV0UG9zaXRpb24gPSB0YWdJbnB1dC5zZWxlY3Rpb25TdGFydCB8fCAwO1xyXG4gICAgICAgICAgICBjb25zdCBpbnB1dEJlZm9yZUNhcmV0ID0gdGFnSW5wdXQudmFsdWUuc2xpY2UoMCwgY3VycmVudENhcmV0UG9zaXRpb24pO1xyXG4gICAgICAgICAgICBjb25zdCBsYXN0Q29tbWFJbmRleCA9IGlucHV0QmVmb3JlQ2FyZXQubGFzdEluZGV4T2YoJywnKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRJbnB1dCA9IGlucHV0QmVmb3JlQ2FyZXRcclxuICAgICAgICAgICAgICAgIC5zbGljZShsYXN0Q29tbWFJbmRleCArIDEpXHJcbiAgICAgICAgICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgICAgICAgICAucmVwbGFjZSgvXiMvLCAnJyk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdWdnZXN0aW9ucyA9IEFycmF5LmZyb20odGhpcy5hbGxUYWdzKVxyXG4gICAgICAgICAgICAgICAgLmZpbHRlcih0ID0+IHQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhjdXJyZW50SW5wdXQudG9Mb3dlckNhc2UoKSkpXHJcbiAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpZmYgPSBhLmxlbmd0aCAtIGIubGVuZ3RoO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBkaWZmICE9PSAwID8gZGlmZiA6IGEubG9jYWxlQ29tcGFyZShiKTtcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICAuc2xpY2UoMCwgOCk7XHJcblxyXG4gICAgICAgICAgICB0aGlzLnNob3dTdWdnZXN0aW9ucyhzdWdnZXN0aW9uQ29udGFpbmVyLCB0YWdJbnB1dCwgc3VnZ2VzdGlvbnMsIGN1cnJlbnRJbnB1dCk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8g5aSE55CG5bu66K6u54K55Ye7XHJcbiAgICAgICAgbGV0IGlzQ2xpY2tpbmdTdWdnZXN0aW9uID0gZmFsc2U7XHJcbiAgICAgICAgc3VnZ2VzdGlvbkNvbnRhaW5lci5vbm1vdXNlZG93biA9ICgpID0+IGlzQ2xpY2tpbmdTdWdnZXN0aW9uID0gdHJ1ZTtcclxuICAgICAgICBzdWdnZXN0aW9uQ29udGFpbmVyLm9ubW91c2V1cCA9ICgpID0+IGlzQ2xpY2tpbmdTdWdnZXN0aW9uID0gZmFsc2U7XHJcblxyXG4gICAgICAgIHRhZ0lucHV0Lm9uYmx1ciA9ICgpID0+IHtcclxuICAgICAgICAgICAgaWYgKCFpc0NsaWNraW5nU3VnZ2VzdGlvbikge1xyXG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiBzdWdnZXN0aW9uQ29udGFpbmVyLmhpZGUoKSwgMjAwKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIOWIoOmZpOagh+etvumDqOWIhlxyXG4gICAgICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKVxyXG4gICAgICAgICAgICAuc2V0TmFtZSh0aGlzLnBsdWdpbi50KCdyZW1vdmVUYWdzJykpXHJcbiAgICAgICAgICAgIC5zZXREZXNjKHRoaXMucGx1Z2luLnQoJ3JlbW92ZVRhZ0Rlc2MnKSlcclxuICAgICAgICAgICAgLmFkZFRleHQodGV4dCA9PiB0ZXh0XHJcbiAgICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5kZWxldGVUYWdJbnB1dFZhbHVlKVxyXG4gICAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGAke3RoaXMucGx1Z2luLnQoJ2V4YW1wbGUnKX1vbGRwcm9qZWN0LCBhcmNoaXZlZGApXHJcbiAgICAgICAgICAgICAgICAub25DaGFuZ2UodiA9PiB0aGlzLmRlbGV0ZVRhZ0lucHV0VmFsdWUgPSB2KSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBzaG93U3VnZ2VzdGlvbnMoXHJcbiAgICAgICAgY29udGFpbmVyOiBIVE1MRGl2RWxlbWVudCxcclxuICAgICAgICBpbnB1dDogSFRNTElucHV0RWxlbWVudCxcclxuICAgICAgICBzdWdnZXN0aW9uczogc3RyaW5nW10sXHJcbiAgICAgICAgY3VycmVudElucHV0OiBzdHJpbmdcclxuICAgICkge1xyXG4gICAgICAgIGNvbnRhaW5lci5lbXB0eSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzdWdnZXN0aW9ucy5sZW5ndGggPT09IDAgfHwgY3VycmVudElucHV0Lmxlbmd0aCA8IDEpIHtcclxuICAgICAgICAgICAgY29udGFpbmVyLmhpZGUoKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLmJhY2tncm91bmRDb2xvciA9ICd2YXIoLS1iYWNrZ3JvdW5kLXByaW1hcnkpJztcclxuICAgICAgICBjb250YWluZXIuc3R5bGUuYm9yZGVyQ29sb3IgPSAndmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpJztcclxuICAgICAgICBcclxuICAgICAgICBzdWdnZXN0aW9ucy5mb3JFYWNoKHRhZyA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGl0ZW0gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiAndGFnLXN1Z2dlc3Rpb24taXRlbScgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBtYXRjaEluZGV4ID0gdGFnLnRvTG93ZXJDYXNlKCkuaW5kZXhPZihjdXJyZW50SW5wdXQudG9Mb3dlckNhc2UoKSk7XHJcbiAgICAgICAgICAgIGlmIChtYXRjaEluZGV4ID49IDApIHtcclxuICAgICAgICAgICAgICAgIGl0ZW0uYXBwZW5kKFxyXG4gICAgICAgICAgICAgICAgICAgIHRhZy5zbGljZSgwLCBtYXRjaEluZGV4KSxcclxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVTcGFuKHsgdGV4dDogdGFnLnNsaWNlKG1hdGNoSW5kZXgsIG1hdGNoSW5kZXggKyBjdXJyZW50SW5wdXQubGVuZ3RoKSwgY2xzOiAnc3VnZ2VzdGlvbi1tYXRjaCcgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgdGFnLnNsaWNlKG1hdGNoSW5kZXggKyBjdXJyZW50SW5wdXQubGVuZ3RoKVxyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGl0ZW0udGV4dENvbnRlbnQgPSB0YWc7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGl0ZW0uYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuaW5zZXJ0VGFnKHRhZywgaW5wdXQsIGN1cnJlbnRJbnB1dCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCBpbnB1dFJlY3QgPSBpbnB1dC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICBjb25zdCBtb2RhbFJlY3QgPSB0aGlzLmNvbnRlbnRFbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICBcclxuICAgICAgICBcclxuICAgICAgICBjb250YWluZXIuc2hvdygpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgaW5zZXJ0VGFnKHNlbGVjdGVkVGFnOiBzdHJpbmcsIGlucHV0OiBIVE1MSW5wdXRFbGVtZW50LCBjdXJyZW50SW5wdXQ6IHN0cmluZykge1xyXG4gICAgICAgIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IGlucHV0LnZhbHVlO1xyXG4gICAgICAgIGNvbnN0IGNhcmV0UG9zID0gaW5wdXQuc2VsZWN0aW9uU3RhcnQgfHwgMDtcclxuXHJcbiAgICAgICAgY29uc3QgdGV4dEJlZm9yZUNhcmV0ID0gY3VycmVudFZhbHVlLnNsaWNlKDAsIGNhcmV0UG9zKTtcclxuICAgICAgICBjb25zdCBsYXN0Q29tbWFJbmRleCA9IHRleHRCZWZvcmVDYXJldC5sYXN0SW5kZXhPZignLCcpO1xyXG5cclxuICAgICAgICBjb25zdCBuZXdUYWdzID0gW1xyXG4gICAgICAgICAgICAuLi50ZXh0QmVmb3JlQ2FyZXQuc2xpY2UoMCwgbGFzdENvbW1hSW5kZXggKyAxKS5zcGxpdCgnLCcpLm1hcCh0ID0+IHQudHJpbSgpKSxcclxuICAgICAgICAgICAgc2VsZWN0ZWRUYWdcclxuICAgICAgICBdLmZpbHRlcih0ID0+IHQpLmpvaW4oJywgJyk7XHJcblxyXG4gICAgICAgIGNvbnN0IG5ld1ZhbHVlID0gbmV3VGFncyArIFxyXG4gICAgICAgICAgICAoY3VycmVudFZhbHVlLnNsaWNlKGNhcmV0UG9zKS5zdGFydHNXaXRoKCcsJykgPyAnJyA6ICcsICcpICsgXHJcbiAgICAgICAgICAgIGN1cnJlbnRWYWx1ZS5zbGljZShjYXJldFBvcykucmVwbGFjZSgvXlxccyosP1xccyovLCAnJyk7XHJcblxyXG4gICAgICAgIGlucHV0LnZhbHVlID0gbmV3VmFsdWU7XHJcbiAgICAgICAgdGhpcy50YWdJbnB1dFZhbHVlID0gbmV3VmFsdWU7XHJcblxyXG4gICAgICAgIGNvbnN0IG5ld0NhcmV0UG9zID0gbmV3VGFncy5sZW5ndGggKyAyO1xyXG4gICAgICAgIGlucHV0LnNldFNlbGVjdGlvblJhbmdlKG5ld0NhcmV0UG9zLCBuZXdDYXJldFBvcyk7XHJcbiAgICAgICAgaW5wdXQuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ2lucHV0JykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIOS/ruaUueaMiemSruaWh+Wtl1xyXG4gICAgcHJpdmF0ZSByZW5kZXJGaWxlVHJlZSgpIHtcclxuICAgICAgICBjb25zdCBhY3Rpb25CYXIgPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoXCJhY3Rpb24tYmFyXCIpO1xyXG4gICAgbmV3IEJ1dHRvbkNvbXBvbmVudChhY3Rpb25CYXIpXHJcbiAgICAgICAgLnNldEJ1dHRvblRleHQoYOKchSAke3RoaXMucGx1Z2luLnQoJ3NlbGVjdEFsbCcpfWApXHJcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy50b2dnbGVBbGxTZWxlY3Rpb24odHJ1ZSkpO1xyXG4gICAgbmV3IEJ1dHRvbkNvbXBvbmVudChhY3Rpb25CYXIpXHJcbiAgICAgICAgLnNldEJ1dHRvblRleHQoYOKdjCAke3RoaXMucGx1Z2luLnQoJ3Vuc2VsZWN0QWxsJyl9YClcclxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnRvZ2dsZUFsbFNlbGVjdGlvbihmYWxzZSkpO1xyXG5cclxuICAgIC8vIOa3u+WKoOaWh+S7tuagkea4suafk+S7o+egge+8iOWOn+e8uuWksemDqOWIhu+8iVxyXG4gICAgY29uc3QgdHJlZUNvbnRhaW5lciA9IHRoaXMuY29udGVudEVsLmNyZWF0ZURpdihcImZpbGUtdHJlZS1jb250YWluZXJcIik7XHJcbiAgICB0aGlzLnJlbmRlckZvbGRlclN0cnVjdHVyZSh0cmVlQ29udGFpbmVyLCB0aGlzLmZvbGRlclN0cnVjdHVyZSwgMCk7XHJcbn1cclxuXHJcbiAgICBwcml2YXRlIGNyZWF0ZUFjdGlvbkJ1dHRvbnMoKSB7XHJcbiAgICAgICAgdGhpcy5jb250ZW50RWwuY3JlYXRlRWwoXCJoclwiKTtcclxuICAgICAgICBuZXcgQnV0dG9uQ29tcG9uZW50KHRoaXMuY29udGVudEVsKVxyXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChg8J+SviAke3RoaXMucGx1Z2luLnQoJ3NhdmUnKX1gKVxyXG4gICAgICAgICAgICAuc2V0Q3RhKClcclxuICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzRmlsZXMoKVxyXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuY2xvc2UoKSlcclxuICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoYOKdjCDmk43kvZzlpLHotKU6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHRvZ2dsZUFsbFNlbGVjdGlvbihzZWxlY3Q6IGJvb2xlYW4pIHtcclxuICAgICAgICB0aGlzLnNlbGVjdGVkRmlsZXMgPSBzZWxlY3QgPyBbLi4udGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpXSA6IFtdO1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXScpXHJcbiAgICAgICAgICAgIC5mb3JFYWNoKGNiID0+IGNiLmNoZWNrZWQgPSBzZWxlY3QpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0ZpbGVzKCkge1xyXG4gICAgICAgIGlmICghdGhpcy52YWxpZGF0ZUlucHV0KCkpIHJldHVybjtcclxuICAgICAgICBcclxuXHJcbiAgICAgICAgY29uc3QgYWRkVGFncyA9IHRoaXMucGFyc2VUYWdzKHRoaXMudGFnSW5wdXRWYWx1ZSk7XHJcbiAgICAgICAgY29uc3QgcmVtb3ZlVGFncyA9IHRoaXMucGFyc2VUYWdzKHRoaXMuZGVsZXRlVGFnSW5wdXRWYWx1ZSk7XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgICAgICAgICAgICAgdGhpcy5zZWxlY3RlZEZpbGVzLm1hcChmaWxlID0+IFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc1NpbmdsZUZpbGUoZmlsZSwgYWRkVGFncywgcmVtb3ZlVGFncylcclxuICAgICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UodGhpcy5wbHVnaW4udCgnZmlsZVByb2Nlc3NlZCcsIHRoaXMuc2VsZWN0ZWRGaWxlcy5sZW5ndGgpKTtcclxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9SZWZyZXNoKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmVxdWVzdFNhdmVMYXlvdXQoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ+acquefpemUmeivryc7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihg5paH5Lu25aSE55CG5aSx6LSlOiAke2Vycm9yTWVzc2FnZX1gKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB2YWxpZGF0ZUlucHV0KCk6IGJvb2xlYW4ge1xyXG4gICAgICAgIGlmICh0aGlzLnNlbGVjdGVkRmlsZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UodGhpcy5wbHVnaW4udCgnbm9GaWxlU2VsZWN0ZWQnKSk7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGFkZEVtcHR5ID0gdGhpcy50YWdJbnB1dFZhbHVlLnRyaW0oKSA9PT0gXCJcIjtcclxuICAgICAgICBjb25zdCByZW1vdmVFbXB0eSA9IHRoaXMuZGVsZXRlVGFnSW5wdXRWYWx1ZS50cmltKCkgPT09IFwiXCI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGFkZEVtcHR5ICYmIHJlbW92ZUVtcHR5KSB7XHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UodGhpcy5wbHVnaW4udCgnbm9UYWdzSW5wdXQnKSk7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgcGFyc2VUYWdzKGlucHV0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgcmV0dXJuIGlucHV0XHJcbiAgICAgICAgICAgIC5zcGxpdCgvWyzvvIxdL2cpXHJcbiAgICAgICAgICAgIC5tYXAodCA9PiB0LnRyaW0oKS5yZXBsYWNlKC8jL2csICcnKSlcclxuICAgICAgICAgICAgLmZpbHRlcih0ID0+IHQubGVuZ3RoID4gMCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzU2luZ2xlRmlsZShmaWxlOiBURmlsZSwgYWRkVGFnczogc3RyaW5nW10sIHJlbW92ZVRhZ3M6IHN0cmluZ1tdKSB7XHJcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XHJcbiAgICAgICAgY29uc3QgY2FjaGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKSA/PyB7IGZyb250bWF0dGVyOiB7fSB9O1xyXG4gICAgICAgIGxldCBjdXJyZW50VGFncyA9IHRoaXMuZ2V0Q3VycmVudFRhZ3MoY2FjaGUuZnJvbnRtYXR0ZXI/LnRhZ3MpO1xyXG5cclxuICAgICAgICBjb25zdCBuZXdUYWdzID0gW1xyXG4gICAgICAgICAgICAuLi5jdXJyZW50VGFncy5maWx0ZXIodCA9PiAhcmVtb3ZlVGFncy5pbmNsdWRlcyh0KSksXHJcbiAgICAgICAgICAgIC4uLmFkZFRhZ3NcclxuICAgICAgICBdLmZpbHRlcigodiwgaSwgYSkgPT4gYS5pbmRleE9mKHYpID09PSBpKTtcclxuXHJcbiAgICAgICAgY29uc3QgbmV3WUFNTCA9IHRoaXMuYnVpbGROZXdZQU1MKGNhY2hlLmZyb250bWF0dGVyIHx8IHt9LCBuZXdUYWdzKTtcclxuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdGhpcy5yZXBsYWNlWUFNTChjb250ZW50LCBuZXdZQU1MKSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBnZXRDdXJyZW50VGFncyh0YWdzOiB1bmtub3duKTogc3RyaW5nW10ge1xyXG4gICAgICAgIGlmICghdGFncykgcmV0dXJuIFtdO1xyXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHRhZ3MpKSByZXR1cm4gdGFncy5tYXAodCA9PiB0LnRvU3RyaW5nKCkudHJpbSgpKTtcclxuICAgICAgICBpZiAodHlwZW9mIHRhZ3MgPT09ICdzdHJpbmcnKSByZXR1cm4gdGhpcy5wYXJzZVRhZ3ModGFncyk7XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICBwcml2YXRlIGJ1aWxkTmV3WUFNTChvcmlnaW5hbDogb2JqZWN0LCB0YWdzOiBzdHJpbmdbXSk6IHN0cmluZyB7XHJcbiAgICAgICAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XHJcbiAgICAgICAgY29uc3Qgb3RoZXJLZXlzID0gT2JqZWN0LmtleXMob3JpZ2luYWwpLmZpbHRlcihrID0+IGsgIT09IFwidGFnc1wiKTtcclxuXHJcbiAgICAgICAgaWYgKHRhZ3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBsaW5lcy5wdXNoKFwidGFnczpcIik7XHJcbiAgICAgICAgICAgIHRhZ3MuZm9yRWFjaCh0ID0+IGxpbmVzLnB1c2goYCAgLSAke3R9YCkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgb3RoZXJLZXlzLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSAob3JpZ2luYWwgYXMgYW55KVtrZXldO1xyXG4gICAgICAgICAgICBsaW5lcy5wdXNoKGAke2tleX06ICR7dGhpcy5zdHJpbmdpZnlZQU1MVmFsdWUodmFsdWUpfWApO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBsaW5lcy5wdXNoKGB1cGRhdGVkOiBcIiR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpfVwiYCk7XHJcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBzdHJpbmdpZnlZQU1MVmFsdWUodmFsdWU6IHVua25vd24pOiBzdHJpbmcge1xyXG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZTtcclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBgWyR7dmFsdWUubWFwKHYgPT4gYFwiJHt2fVwiYCkuam9pbihcIiwgXCIpfV1gO1xyXG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZXBsYWNlWUFNTChjb250ZW50OiBzdHJpbmcsIG5ld1lBTUw6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICAgICAgY29uc3QgcGFydHMgPSBjb250ZW50LnNwbGl0KFwiLS0tXCIpO1xyXG4gICAgICAgIGNvbnN0IGJvZHkgPSBwYXJ0cy5zbGljZSgyKS5qb2luKFwiLS0tXCIpLnRyaW0oKTtcclxuICAgICAgICByZXR1cm4gYC0tLVxcbiR7bmV3WUFNTH1cXG4tLS0ke2JvZHkgPyBgXFxuJHtib2R5fWAgOiBcIlwifWA7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZW5kZXJGb2xkZXJTdHJ1Y3R1cmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgaXRlbXM6IChGb2xkZXJJdGVtIHwgRmlsZUl0ZW0pW10sIGluZGVudDogbnVtYmVyKSB7XHJcbiAgICAgICAgY29udGFpbmVyLmVtcHR5KCk7XHJcbiAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtID0+IHtcclxuICAgICAgICAgICAgaXRlbS50eXBlID09PSBcImZvbGRlclwiIFxyXG4gICAgICAgICAgICAgICAgPyB0aGlzLnJlbmRlckZvbGRlckl0ZW0oY29udGFpbmVyLCBpdGVtLCBpbmRlbnQpXHJcbiAgICAgICAgICAgICAgICA6IHRoaXMucmVuZGVyRmlsZUl0ZW0oY29udGFpbmVyLCBpdGVtLCBpbmRlbnQpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgcmVuZGVyRm9sZGVySXRlbShjb250YWluZXI6IEhUTUxFbGVtZW50LCBmb2xkZXI6IEZvbGRlckl0ZW0sIGluZGVudDogbnVtYmVyKSB7XHJcbiAgICAgICAgY29uc3QgZGlzcGxheU5hbWUgPSBmb2xkZXIucGF0aCA9PT0gXCJcIlxyXG4gICAgICAgID8gdGhpcy5wbHVnaW4udCgnZm9sZGVyTmFtZScsIDApICAvLyDmraPnoa7nmoTmnaHku7booajovr7lvI9cclxuICAgICAgICA6IGZvbGRlci5uYW1lO1xyXG4gICAgICAgIFxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGlzRXhwYW5kZWQgPSB0aGlzLmV4cGFuZGVkRm9sZGVycy5oYXMoZm9sZGVyLnBhdGgpO1xyXG4gICAgICAgIGNvbnN0IGZvbGRlckVsID0gY29udGFpbmVyLmNyZWF0ZURpdihgZm9sZGVyLWl0ZW0gJHtpc0V4cGFuZGVkID8gJ2ZvbGRlci1leHBhbmRlZCcgOiAnJ31gKTtcclxuICAgICAgICBmb2xkZXJFbC5zdHlsZS5tYXJnaW5MZWZ0ID0gYCR7aW5kZW50ICogMjB9cHhgO1xyXG4gICAgICAgIGZvbGRlckVsLmRhdGFzZXQucGF0aCA9IGZvbGRlci5wYXRoO1xyXG5cclxuICAgICAgICBcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBoZWFkZXIgPSBmb2xkZXJFbC5jcmVhdGVEaXYoXCJmb2xkZXItaGVhZGVyXCIpO1xyXG4gICAgY29uc3QgaWNvbiA9IGhlYWRlci5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLWljb25cIixcclxuICAgICAgICB0ZXh0OiBpc0V4cGFuZGVkID8gXCLilrxcIiA6IFwi4pa2XCJcclxuICAgIH0pO1xyXG4gICAgaWNvbi5vbmNsaWNrID0gKCkgPT4gdGhpcy50b2dnbGVGb2xkZXIoZm9sZGVyLnBhdGgsIGZvbGRlckVsKTtcclxuXHJcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IHRleHQ6IGRpc3BsYXlOYW1lIH0pO1xyXG5cclxuICAgIGNvbnN0IGNoZWNrYm94ID0gaGVhZGVyLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICAgIHR5cGU6IFwiY2hlY2tib3hcIixcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLWNoZWNrYm94XCJcclxuICAgIH0pIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XHJcbiAgICBjaGVja2JveC5jaGVja2VkID0gdGhpcy5pc0FsbENoaWxkcmVuU2VsZWN0ZWQoZm9sZGVyKTtcclxuICAgIGNoZWNrYm94Lm9uY2hhbmdlID0gKCkgPT4gdGhpcy50b2dnbGVGb2xkZXJTZWxlY3Rpb24oZm9sZGVyLCBjaGVja2JveC5jaGVja2VkKTtcclxuXHJcbiAgICBjb25zdCBjaGlsZHJlbkVsID0gZm9sZGVyRWwuY3JlYXRlRGl2KFwiZm9sZGVyLWNoaWxkcmVuXCIpO1xyXG4gICAgaWYgKGlzRXhwYW5kZWQpIHtcclxuICAgICAgICB0aGlzLnJlbmRlckZvbGRlclN0cnVjdHVyZShjaGlsZHJlbkVsLCBmb2xkZXIuY2hpbGRyZW4sIGluZGVudCArIDEpO1xyXG4gICAgfVxyXG59XHJcblxyXG4gICAgcHJpdmF0ZSByZW5kZXJGaWxlSXRlbShjb250YWluZXI6IEhUTUxFbGVtZW50LCBmaWxlSXRlbTogRmlsZUl0ZW0sIGluZGVudDogbnVtYmVyKSB7XHJcbiAgICAgICAgY29uc3QgZmlsZUVsID0gY29udGFpbmVyLmNyZWF0ZURpdihcImZpbGUtaXRlbVwiKTtcclxuICAgICAgICBmaWxlRWwuc3R5bGUubWFyZ2luTGVmdCA9IGAke2luZGVudCAqIDIwfXB4YDtcclxuXHJcbiAgICAgICAgY29uc3QgY2hlY2tib3ggPSBmaWxlRWwuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiY2hlY2tib3hcIixcclxuICAgICAgICAgICAgY2xzOiBcImZpbGUtY2hlY2tib3hcIlxyXG4gICAgICAgIH0pIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9IHRoaXMuc2VsZWN0ZWRGaWxlcy5pbmNsdWRlcyhmaWxlSXRlbS5maWxlKTtcclxuICAgICAgICBjaGVja2JveC5vbmNoYW5nZSA9ICgpID0+IHRoaXMudG9nZ2xlRmlsZVNlbGVjdGlvbihmaWxlSXRlbS5maWxlLCBjaGVja2JveC5jaGVja2VkKTtcclxuXHJcbiAgICAgICAgZmlsZUVsLmNyZWF0ZVNwYW4oeyB0ZXh0OiBmaWxlSXRlbS5maWxlLmJhc2VuYW1lIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgdG9nZ2xlRmlsZVNlbGVjdGlvbihmaWxlOiBURmlsZSwgc2VsZWN0ZWQ6IGJvb2xlYW4pIHtcclxuICAgICAgICB0aGlzLnNlbGVjdGVkRmlsZXMgPSBzZWxlY3RlZFxyXG4gICAgICAgICAgICA/IFsuLi50aGlzLnNlbGVjdGVkRmlsZXMsIGZpbGVdLmZpbHRlcigodiwgaSwgYSkgPT4gYS5pbmRleE9mKHYpID09PSBpKVxyXG4gICAgICAgICAgICA6IHRoaXMuc2VsZWN0ZWRGaWxlcy5maWx0ZXIoZiA9PiBmICE9PSBmaWxlKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHRvZ2dsZUZvbGRlcihwYXRoOiBzdHJpbmcsIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpIHtcclxuICAgICAgICBjb25zdCB3YXNFeHBhbmRlZCA9IHRoaXMuZXhwYW5kZWRGb2xkZXJzLmhhcyhwYXRoKTtcclxuICAgICAgICB0aGlzLmV4cGFuZGVkRm9sZGVyc1t3YXNFeHBhbmRlZCA/ICdkZWxldGUnIDogJ2FkZCddKHBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIOS/ruWkjeexu+Wei+mUmeivr++8mua3u+WKoOexu+Wei+aWreiogFxyXG4gICAgICAgIGNvbnN0IGNoaWxkcmVuQ29udGFpbmVyID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIuZm9sZGVyLWNoaWxkcmVuXCIpIGFzIEhUTUxFbGVtZW50O1xyXG4gICAgICAgIGNoaWxkcmVuQ29udGFpbmVyLmVtcHR5KCk7XHJcbiAgICAgICAgaWYgKCF3YXNFeHBhbmRlZCkge1xyXG4gICAgICAgICAgICBjb25zdCBmb2xkZXIgPSB0aGlzLmZpbmRGb2xkZXJCeVBhdGgocGF0aCk7XHJcbiAgICAgICAgICAgIGlmIChmb2xkZXIpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyRm9sZGVyU3RydWN0dXJlKFxyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuQ29udGFpbmVyLFxyXG4gICAgICAgICAgICAgICAgICAgIGZvbGRlci5jaGlsZHJlbixcclxuICAgICAgICAgICAgICAgICAgICBwYXJzZUludChjb250YWluZXIuc3R5bGUubWFyZ2luTGVmdCB8fCBcIjBcIikgLyAyMCArIDFcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGljb24gPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5mb2xkZXItaWNvblwiKSBhcyBIVE1MRWxlbWVudDtcclxuICAgICAgICBpY29uLnRleHRDb250ZW50ID0gd2FzRXhwYW5kZWQgPyBcIuKWtlwiIDogXCLilrxcIjtcclxuICAgICAgICBjb250YWluZXIuY2xhc3NMaXN0LnRvZ2dsZShcImZvbGRlci1leHBhbmRlZFwiLCAhd2FzRXhwYW5kZWQpO1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmZvbGRlckNvbGxhcHNlU3RhdGVbcGF0aF0gPSAhd2FzRXhwYW5kZWQ7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBmaW5kRm9sZGVyQnlQYXRoKHBhdGg6IHN0cmluZyk6IEZvbGRlckl0ZW0gfCB1bmRlZmluZWQge1xyXG4gICAgICAgIGNvbnN0IHdhbGsgPSAoaXRlbXM6IChGb2xkZXJJdGVtIHwgRmlsZUl0ZW0pW10pOiBGb2xkZXJJdGVtIHwgdW5kZWZpbmVkID0+IHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS50eXBlID09PSBcImZvbGRlclwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8g55u05o6l5Yy56YWN55yf5a6e6Lev5b6E77yI5LiN6L2s5o2i5pi+56S65ZCN56ew77yJXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGl0ZW0ucGF0aCA9PT0gcGF0aCkgcmV0dXJuIGl0ZW07XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm91bmQgPSB3YWxrKGl0ZW0uY2hpbGRyZW4pO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgICAgICByZXR1cm4gd2Fsayh0aGlzLmZvbGRlclN0cnVjdHVyZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBpc0FsbENoaWxkcmVuU2VsZWN0ZWQoZm9sZGVyOiBGb2xkZXJJdGVtKTogYm9vbGVhbiB7XHJcbiAgICAgICAgY29uc3QgZmlsZXMgPSB0aGlzLmdldEZvbGRlckZpbGVzKGZvbGRlcik7XHJcbiAgICAgICAgcmV0dXJuIGZpbGVzLmV2ZXJ5KGYgPT4gdGhpcy5zZWxlY3RlZEZpbGVzLmluY2x1ZGVzKGYpKSAmJiBmaWxlcy5sZW5ndGggPiAwO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZ2V0Rm9sZGVyRmlsZXMoZm9sZGVyOiBGb2xkZXJJdGVtKTogVEZpbGVbXSB7XHJcbiAgICAgICAgY29uc3QgZmlsZXM6IFRGaWxlW10gPSBbXTtcclxuICAgICAgICBjb25zdCB3YWxrID0gKGl0ZW06IEZvbGRlckl0ZW0gfCBGaWxlSXRlbSkgPT4ge1xyXG4gICAgICAgICAgICBpZiAoaXRlbS50eXBlID09PSBcImZvbGRlclwiKSB7XHJcbiAgICAgICAgICAgICAgICBpdGVtLmNoaWxkcmVuLmZvckVhY2god2Fsayk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBmaWxlcy5wdXNoKGl0ZW0uZmlsZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgICAgIHdhbGsoZm9sZGVyKTtcclxuICAgICAgICByZXR1cm4gZmlsZXM7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB0b2dnbGVGb2xkZXJTZWxlY3Rpb24oZm9sZGVyOiBGb2xkZXJJdGVtLCBzZWxlY3RlZDogYm9vbGVhbikge1xyXG4gICAgICAgIGNvbnN0IGZpbGVzID0gdGhpcy5nZXRGb2xkZXJGaWxlcyhmb2xkZXIpO1xyXG4gICAgICAgIHRoaXMuc2VsZWN0ZWRGaWxlcyA9IHNlbGVjdGVkXHJcbiAgICAgICAgICAgID8gWy4uLm5ldyBTZXQoWy4uLnRoaXMuc2VsZWN0ZWRGaWxlcywgLi4uZmlsZXNdKV1cclxuICAgICAgICAgICAgOiB0aGlzLnNlbGVjdGVkRmlsZXMuZmlsdGVyKGYgPT4gIWZpbGVzLmluY2x1ZGVzKGYpKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc2VsZWN0b3JQcmVmaXggPSBgW2RhdGEtcGF0aF49XCIke2ZvbGRlci5wYXRofS9cIl0gLmZpbGUtY2hlY2tib3hgO1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oc2VsZWN0b3JQcmVmaXgpLmZvckVhY2goY2IgPT4ge1xyXG4gICAgICAgICAgICBjYi5jaGVja2VkID0gc2VsZWN0ZWQ7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgb25DbG9zZSgpIHtcclxuICAgICAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgfVxyXG59XHJcbiJdLCJuYW1lcyI6WyJQbHVnaW5TZXR0aW5nVGFiIiwiU2V0dGluZyIsIk5vdGljZSIsIlBsdWdpbiIsIk1vZGFsIiwiQnV0dG9uQ29tcG9uZW50Il0sIm1hcHBpbmdzIjoiOzs7O0FBb0JBO0FBQ0EsTUFBTSxhQUFhLEdBQUc7QUFDbEIsSUFBQSxFQUFFLEVBQUU7QUFDQSxRQUFBLFdBQVcsRUFBRSxNQUFNO0FBQ25CLFFBQUEsV0FBVyxFQUFFLGVBQWU7QUFDNUIsUUFBQSxPQUFPLEVBQUUsTUFBTTtBQUNmLFFBQUEsT0FBTyxFQUFFLG9CQUFvQjtBQUM3QixRQUFBLFVBQVUsRUFBRSxNQUFNO0FBQ2xCLFFBQUEsYUFBYSxFQUFFLG9CQUFvQjtBQUNuQyxRQUFBLFNBQVMsRUFBRSxJQUFJO0FBQ2YsUUFBQSxXQUFXLEVBQUUsS0FBSztBQUNsQixRQUFBLElBQUksRUFBRSxNQUFNO0FBQ1osUUFBQSxPQUFPLEVBQUUsS0FBSztRQUNkLGFBQWEsRUFBRSxDQUFDLEtBQWEsS0FBSyxDQUFBLE9BQUEsRUFBVSxLQUFLLENBQU0sSUFBQSxDQUFBO0FBQ3ZELFFBQUEsY0FBYyxFQUFFLGNBQWM7QUFDOUIsUUFBQSxXQUFXLEVBQUUsaUJBQWlCO0FBQzlCLFFBQUEsVUFBVSxFQUFFLENBQUMsS0FBYSxLQUFLLEtBQUssS0FBSyxDQUFDLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFDM0QsUUFBQSxXQUFXLEVBQUUsU0FBUztBQUN6QixLQUFBO0FBQ0QsSUFBQSxFQUFFLEVBQUU7QUFDQSxRQUFBLFdBQVcsRUFBRSxjQUFjO0FBQzNCLFFBQUEsV0FBVyxFQUFFLCtDQUErQztBQUM1RCxRQUFBLE9BQU8sRUFBRSxVQUFVO0FBQ25CLFFBQUEsT0FBTyxFQUFFLHNEQUFzRDtBQUMvRCxRQUFBLFVBQVUsRUFBRSxhQUFhO0FBQ3pCLFFBQUEsYUFBYSxFQUFFLGlDQUFpQztBQUNoRCxRQUFBLFNBQVMsRUFBRSxZQUFZO0FBQ3ZCLFFBQUEsV0FBVyxFQUFFLGNBQWM7QUFDM0IsUUFBQSxJQUFJLEVBQUUsY0FBYztBQUNwQixRQUFBLE9BQU8s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
