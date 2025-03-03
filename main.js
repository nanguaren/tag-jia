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
            const pathParts = (file.parent?.path === "/" || file.parent?.path === "")
                ? []
                : file.parent?.path.split("/") || [];
            let current = root;
            pathParts.forEach((part, index) => {
                const path = pathParts.slice(0, index + 1).join("/");
                let folder = current.children.find(item => item.type === "folder" && item.path === path);
                if (!folder) {
                    folder = {
                        type: "folder",
                        path: path,
                        name: part,
                        children: []
                    };
                    current.children.push(folder);
                }
                current = folder;
            });
            current.children.push({ type: "file", file }); // 正确添加文件到当前层级
        });
        this.folderStructure = root.children;
        this.restoreCollapseState();
    }
    restoreCollapseState() {
        this.expandedFolders.clear(); // ← 重要：先清空当前展开状态
        Object.entries(this.plugin.settings.folderCollapseState).forEach(([path, isCollapsed]) => {
            // 反转逻辑：仅当保存的折叠状态为false时才展开
            if (!isCollapsed) {
                this.expandedFolders.add(path);
            }
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
        //lines.push(`updated: "${new Date().toISOString()}"`);
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
        fileEl.style.marginLeft = `${indent * 15}px`; // 调整为更合理的缩进值
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
        // 更新逻辑：存储真正的折叠状态
        this.plugin.settings.folderCollapseState[path] = wasExpanded; // 当前状态反转为保存状态
        this.plugin.saveSettings();
        // 清除原有展开状态再重建
        if (wasExpanded) {
            this.expandedFolders.delete(path);
        }
        else {
            this.expandedFolders.add(path);
        }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsic3JjL21haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcclxuICAgIEFwcCxcclxuICAgIEJ1dHRvbkNvbXBvbmVudCxcclxuICAgIE1vZGFsLFxyXG4gICAgTm90aWNlLFxyXG4gICAgUGx1Z2luLFxyXG4gICAgUGx1Z2luU2V0dGluZ1RhYixcclxuICAgIFNldHRpbmcsXHJcbiAgICBURmlsZVxyXG59IGZyb20gXCJvYnNpZGlhblwiO1xyXG5cclxuLy8g5paw5aKe6K+t6KiA57G75Z6L5a6a5LmJXHJcbnR5cGUgQXBwTGFuZ3VhZ2UgPSAnemgnIHwgJ2VuJztcclxuXHJcbmludGVyZmFjZSBUYWdKaWFTZXR0aW5ncyB7XHJcbiAgICBhdXRvUmVmcmVzaDogYm9vbGVhbjtcclxuICAgIGZvbGRlckNvbGxhcHNlU3RhdGU6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+O1xyXG4gICAgbGFuZ3VhZ2U6IEFwcExhbmd1YWdlOyAvLyDmlrDlop7or63oqIDorr7nva7poblcclxufVxyXG5cclxuLy8g5re75Yqg6K+t6KiA6LWE5rqQ5paH5Lu2XHJcbmNvbnN0IExhbmdSZXNvdXJjZXMgPSB7XHJcbiAgICB6aDoge1xyXG4gICAgICAgIGF1dG9SZWZyZXNoOiBcIuiHquWKqOWIt+aWsFwiLFxyXG4gICAgICAgIHJlZnJlc2hEZXNjOiBcIuS/ruaUueaWh+S7tuWQjuiHquWKqOWIt+aWsOaWh+S7tuWIl+ihqFwiLFxyXG4gICAgICAgIGFkZFRhZ3M6IFwi5re75Yqg5qCH562+XCIsXHJcbiAgICAgICAgdGFnRGVzYzogXCLnlKjpgJflj7fliIbpmpTlpJrkuKrmoIfnrb7vvIjovpPlhaXml7bkvJrmnInlu7rorq7vvIlcIixcclxuICAgICAgICByZW1vdmVUYWdzOiBcIuWIoOmZpOagh+etvlwiLFxyXG4gICAgICAgIHJlbW92ZVRhZ0Rlc2M6IFwi55So6YCX5Y+35YiG6ZqU6KaB5Yig6Zmk55qE5qCH562+77yI56m65YiZ5LiN5Yig6Zmk77yJXCIsXHJcbiAgICAgICAgc2VsZWN0QWxsOiBcIuWFqOmAiVwiLFxyXG4gICAgICAgIHVuc2VsZWN0QWxsOiBcIuWFqOS4jemAiVwiLFxyXG4gICAgICAgIHNhdmU6IFwi5L+d5a2Y5L+u5pS5XCIsXHJcbiAgICAgICAgZXhhbXBsZTogXCLnpLrkvovvvJpcIixcclxuICAgICAgICBmaWxlUHJvY2Vzc2VkOiAoY291bnQ6IG51bWJlcikgPT4gYOKchSDmiJDlip/lpITnkIYgJHtjb3VudH0g5Liq5paH5Lu2YCxcclxuICAgICAgICBub0ZpbGVTZWxlY3RlZDogXCLimqDvuI8g6K+36Iez5bCR6YCJ5oup5LiA5Liq5paH5Lu2XCIsXHJcbiAgICAgICAgbm9UYWdzSW5wdXQ6IFwi4pqg77iPIOivt+i+k+WFpeimgea3u+WKoOaIluWIoOmZpOeahOagh+etvlwiLFxyXG4gICAgICAgIGZvbGRlck5hbWU6IChsZXZlbDogbnVtYmVyKSA9PiBsZXZlbCA9PT0gMCA/IFwi5YWo6YOo5paH5Lu2XCIgOiBcIuaWh+S7tuWkuVwiLFxyXG4gICAgICAgIGNvbW1hbmROYW1lOiBcIuiHquWumuS5ieWxnuaAp+agh+etvlwiIFxyXG4gICAgfSxcclxuICAgIGVuOiB7XHJcbiAgICAgICAgYXV0b1JlZnJlc2g6IFwiQXV0byBSZWZyZXNoXCIsXHJcbiAgICAgICAgcmVmcmVzaERlc2M6IFwiUmVmcmVzaCBmaWxlIGxpc3QgYXV0b21hdGljYWxseSB3aGVuIG1vZGlmaWVkXCIsXHJcbiAgICAgICAgYWRkVGFnczogXCJBZGQgdGFnc1wiLFxyXG4gICAgICAgIHRhZ0Rlc2M6IFwiTXVsdGlwbGUgdGFncyBzZXBhcmF0ZWQgYnkgY29tbWFzICh3aXRoIHN1Z2dlc3Rpb25zKVwiLFxyXG4gICAgICAgIHJlbW92ZVRhZ3M6IFwiUmVtb3ZlIHRhZ3NcIixcclxuICAgICAgICByZW1vdmVUYWdEZXNjOiBcIlRhZ3MgdG8gcmVtb3ZlIChlbXB0eSBmb3Igbm9uZSlcIixcclxuICAgICAgICBzZWxlY3RBbGw6IFwiU2VsZWN0IEFsbFwiLFxyXG4gICAgICAgIHVuc2VsZWN0QWxsOiBcIlVuc2VsZWN0IEFsbFwiLFxyXG4gICAgICAgIHNhdmU6IFwiU2F2ZSBDaGFuZ2VzXCIsXHJcbiAgICAgICAgZXhhbXBsZTogXCJFeGFtcGxlOiBcIixcclxuICAgICAgICBmaWxlUHJvY2Vzc2VkOiAoY291bnQ6IG51bWJlcikgPT4gYOKchSBQcm9jZXNzZWQgJHtjb3VudH0gZmlsZXNgLFxyXG4gICAgICAgIG5vRmlsZVNlbGVjdGVkOiBcIuKaoO+4jyBQbGVhc2Ugc2VsZWN0IGF0IGxlYXN0IG9uZSBmaWxlXCIsXHJcbiAgICAgICAgbm9UYWdzSW5wdXQ6IFwi4pqg77iPIFBsZWFzZSBlbnRlciB0YWdzIHRvIGFkZCBvciByZW1vdmVcIixcclxuICAgICAgICBmb2xkZXJOYW1lOiAobGV2ZWw6IG51bWJlcikgPT4gbGV2ZWwgPT09IDAgPyBcIkFsbCBGaWxlc1wiIDogXCJGb2xkZXJcIixcclxuICAgICAgICBjb21tYW5kTmFtZTogXCJBZHZhbmNlZCBUYWcgTWFuYWdlclwiXHJcbiAgICB9XHJcbn07XHJcblxyXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBUYWdKaWFTZXR0aW5ncyA9IHtcclxuICAgIGF1dG9SZWZyZXNoOiB0cnVlLFxyXG4gICAgZm9sZGVyQ29sbGFwc2VTdGF0ZToge30sXHJcbiAgICBsYW5ndWFnZTogJ3poJyAvLyDmt7vliqDnvLrlpLHnmoRsYW5ndWFnZeWtl+autVxyXG59O1xyXG5cclxuaW50ZXJmYWNlIEZvbGRlckl0ZW0ge1xyXG4gICAgdHlwZTogXCJmb2xkZXJcIjtcclxuICAgIHBhdGg6IHN0cmluZztcclxuICAgIG5hbWU6IHN0cmluZztcclxuICAgIGNoaWxkcmVuOiAoRm9sZGVySXRlbSB8IEZpbGVJdGVtKVtdO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgRmlsZUl0ZW0ge1xyXG4gICAgdHlwZTogXCJmaWxlXCI7XHJcbiAgICBmaWxlOiBURmlsZTtcclxufVxyXG5cclxuY2xhc3MgVGFnSmlhU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xyXG4gICAgcGx1Z2luOiBUYWdKaWFQbHVnaW47XHJcblxyXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVGFnSmlhUGx1Z2luKSB7XHJcbiAgICAgICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gICAgICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gICAgfVxyXG5cclxuICAgIGRpc3BsYXkoKSB7XHJcbiAgICAgICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcclxuICAgICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG5cclxuICAgICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgICAgICAgLnNldE5hbWUoXCJMYW5ndWFnZVwiKVxyXG4gICAgICAgICAgICAuc2V0RGVzYyhcIkFwcGxpY2F0aW9uIGRpc3BsYXkgbGFuZ3VhZ2VcIilcclxuICAgICAgICAgICAgLmFkZERyb3Bkb3duKGRyb3Bkb3duID0+IGRyb3Bkb3duXHJcbiAgICAgICAgICAgICAgICAuYWRkT3B0aW9uKCd6aCcsICfkuK3mlocnKVxyXG4gICAgICAgICAgICAgICAgLmFkZE9wdGlvbignZW4nLCAnRW5nbGlzaCcpXHJcbiAgICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MubGFuZ3VhZ2UpXHJcbiAgICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MubGFuZ3VhZ2UgPSB2YWx1ZSBhcyBBcHBMYW5ndWFnZTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiTGFuZ3VhZ2UgY2hhbmdlZCAtIFJlc3RhcnQgcmVxdWlyZWRcIik7XHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAgICAgICAuc2V0TmFtZSh0aGlzLnBsdWdpbi50KCdhdXRvUmVmcmVzaCcpKVxyXG4gICAgICAgICAgICAuc2V0RGVzYyh0aGlzLnBsdWdpbi50KCdyZWZyZXNoRGVzYycpKVxyXG4gICAgICAgICAgICAuYWRkVG9nZ2xlKHRvZ2dsZSA9PiB0b2dnbGVcclxuICAgICAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvUmVmcmVzaClcclxuICAgICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyB2YWx1ZSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b1JlZnJlc2ggPSB2YWx1ZTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICB9XHJcbn1cclxuXHJcblxyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUYWdKaWFQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gICAgc2V0dGluZ3MhOiBUYWdKaWFTZXR0aW5ncztcclxuXHJcbiAgICB0KGtleToga2V5b2YgdHlwZW9mIExhbmdSZXNvdXJjZXNbJ3poJ10sIC4uLmFyZ3M6IGFueVtdKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBsYW5nID0gdGhpcy5zZXR0aW5ncy5sYW5ndWFnZTtcclxuICAgICAgICBjb25zdCByZXNvdXJjZSA9IExhbmdSZXNvdXJjZXNbbGFuZ11ba2V5XTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodHlwZW9mIHJlc291cmNlID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIC8vIOS9v+eUqOexu+Wei+aWreiogOehruS/neWPguaVsOato+ehrlxyXG4gICAgICAgICAgICByZXR1cm4gKHJlc291cmNlIGFzICguLi5hcmdzOiBhbnlbXSkgPT4gc3RyaW5nKSguLi5hcmdzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlc291cmNlIGFzIHN0cmluZztcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBvbmxvYWQoKSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFRhZ0ppYVNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3R5bGVcIik7XHJcbiAgICAgICAgc3R5bGUudGV4dENvbnRlbnQgPSBgXHJcbiAgICAgICAgICAgIC50YWdqaWEtbW9kYWwgeyBwYWRkaW5nOiAxNXB4OyBtYXgtaGVpZ2h0OiA4MHZoOyBvdmVyZmxvdzogYXV0bzsgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWhlYWRlciB7XHJcbiAgICAgICAgICAgICAgICBjdXJzb3I6IHBvaW50ZXI7IHBhZGRpbmc6IDhweDsgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZC1zZWNvbmRhcnkpO1xyXG4gICAgICAgICAgICAgICAgYm9yZGVyLXJhZGl1czogNHB4OyBtYXJnaW46IDRweCAwOyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWljb24geyBmb250LXNpemU6IDAuOGVtOyB1c2VyLXNlbGVjdDogbm9uZTsgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWNoZWNrYm94IHsgbWFyZ2luLWxlZnQ6IGF1dG87IH1cclxuICAgICAgICAgICAgLmZpbGUtaXRlbSB7IG1hcmdpbi1sZWZ0OiAyMHB4OyBwYWRkaW5nOiA0cHggMDsgfVxyXG4gICAgICAgICAgICAuZmlsZS1jaGVja2JveCB7IG1hcmdpbi1yaWdodDogOHB4OyB9XHJcbiAgICAgICAgICAgIC5hY3Rpb24tYmFyIHtcclxuICAgICAgICAgICAgICAgIG1hcmdpbjogMTBweCAwOyBkaXNwbGF5OiBmbGV4OyBnYXA6IDEwcHg7IHBvc2l0aW9uOiBzdGlja3k7XHJcbiAgICAgICAgICAgICAgICB0b3A6IDA7IGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtcHJpbWFyeSk7IHotaW5kZXg6IDE7IHBhZGRpbmc6IDhweCAwO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC5mb2xkZXItY2hpbGRyZW4geyBkaXNwbGF5OiBub25lOyB9XHJcbiAgICAgICAgICAgIC5mb2xkZXItZXhwYW5kZWQgLmZvbGRlci1jaGlsZHJlbiB7IGRpc3BsYXk6IGJsb2NrOyB9XHJcblxyXG4gICAgICAgICAgICAvKiDmoIfnrb7lu7rorq7moLflvI8gKi9cclxuICAgICAgICAgICAgLnRhZy1zdWdnZXN0aW9ucyB7XHJcbiAgICAgICAgICAgICAgICBtYXgtaGVpZ2h0OiAyMDBweDtcclxuICAgICAgICAgICAgICAgIG92ZXJmbG93LXk6IGF1dG87XHJcbiAgICAgICAgICAgICAgICBtYXJnaW4tdG9wOiA1cHg7XHJcbiAgICAgICAgICAgICAgICB3aWR0aDogY2FsYygxMDAlIC0gMjRweCk7XHJcbiAgICAgICAgICAgICAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlcik7XHJcbiAgICAgICAgICAgICAgICBib3JkZXItcmFkaXVzOiA0cHg7XHJcbiAgICAgICAgICAgICAgICBib3gtc2hhZG93OiAwIDJweCA4cHggdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3gtc2hhZG93KTtcclxuICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtcHJpbWFyeSk7XHJcbiAgICAgICAgICAgICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICAgICAgICAgICAgICB6LWluZGV4OiA5OTk5O1xyXG4gICAgICAgICAgICB9XHJcblx0XHRcdC8qIOaWsOWinui+k+WFpeihjOWuueWZqOagt+W8jyAqL1xyXG5cdFx0XHQuaW5wdXQtcm93IHtcclxuXHRcdFx0XHRwb3NpdGlvbjogcmVsYXRpdmU7XHJcblx0XHRcdFx0bWFyZ2luLWJvdHRvbTogMTVweDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Lyog6LCD5pW05bu66K6u5qGG5a6a5L2N5pa55byPICovXHJcblx0XHRcdC50YWctc3VnZ2VzdGlvbnMge1xyXG5cdFx0XHRcdHRvcDogY2FsYygxMDAlICsgNXB4KSAhaW1wb3J0YW50OyAgLyogKzVweOS4jui+k+WFpeahhuS/neaMgemXtOi3nSAqL1xyXG5cdFx0XHRcdGxlZnQ6IDAgIWltcG9ydGFudDtcclxuXHRcdFx0XHR3aWR0aDogMTAwJSAhaW1wb3J0YW50OyAgLyog5LiO6L6T5YWl5qGG5ZCM5a69ICovXHJcblx0XHRcdFx0dHJhbnNmb3JtOiBub25lICFpbXBvcnRhbnQ7IC8qIOa4hemZpOWPr+iDveWtmOWcqOeahOWPmOaNoiAqL1xyXG5cdFx0XHR9XHJcbiAgICAgICAgICAgIC50YWctc3VnZ2VzdGlvbi1pdGVtIHtcclxuICAgICAgICAgICAgICAgIHBhZGRpbmc6IDZweCAxMnB4O1xyXG4gICAgICAgICAgICAgICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAwLjJzO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC50YWctc3VnZ2VzdGlvbi1pdGVtOmhvdmVyIHtcclxuICAgICAgICAgICAgICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJhY2tncm91bmQtc2Vjb25kYXJ5KTtcclxuICAgICAgICAgICAgfWA7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzdHlsZSk7XHJcblxyXG4gICAgICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgICAgICAgIGlkOiBcImN1c3RvbS10YWctbWFuYWdlclwiLFxyXG4gICAgICAgICAgICBuYW1lOiB0aGlzLnQoJ2NvbW1hbmROYW1lJyksICAvLyDlnKhMYW5nUmVzb3VyY2Vz5Lit6ZyA6KaB5re75Yqg5a+55bqU6ZSu5YC8XHJcbiAgICAgICAgICAgIGNhbGxiYWNrOiAoKSA9PiBuZXcgRmlsZVRhZ01vZGFsKHRoaXMuYXBwLCB0aGlzKS5vcGVuKClcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XHJcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmNsYXNzIEZpbGVUYWdNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICAgIHByaXZhdGUgcGx1Z2luOiBUYWdKaWFQbHVnaW47XHJcbiAgICBwcml2YXRlIHNlbGVjdGVkRmlsZXM6IFRGaWxlW10gPSBbXTtcclxuICAgIHByaXZhdGUgdGFnSW5wdXRWYWx1ZSA9IFwiXCI7XHJcbiAgICBwcml2YXRlIGRlbGV0ZVRhZ0lucHV0VmFsdWUgPSBcIlwiO1xyXG4gICAgcHJpdmF0ZSBmb2xkZXJTdHJ1Y3R1cmU6IChGb2xkZXJJdGVtIHwgRmlsZUl0ZW0pW10gPSBbXTtcclxuICAgIHByaXZhdGUgZXhwYW5kZWRGb2xkZXJzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICBwcml2YXRlIGFsbFRhZ3M6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgXHJcblxyXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVGFnSmlhUGx1Z2luKSB7XHJcbiAgICAgICAgc3VwZXIoYXBwKTtcclxuICAgICAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICAgICAgICB0aGlzLmJ1aWxkRm9sZGVyU3RydWN0dXJlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBnZXRBbGxUYWdzKCk6IFNldDxzdHJpbmc+IHtcclxuICAgICAgICBjb25zdCB0YWdzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICAgICAgXHJcblx0Ly8g6I635Y+W5qCH562+55qE5pu05YW85a655pa55byP77yI5pu/5Luj5Y6f5p2l55qEZ2V0VGFnc+aWueazle+8iVxyXG5cdGNvbnN0IHRhZ01hcCA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGVbXCJ0YWdzXCJdIGFzIFJlY29yZDxzdHJpbmcsIG51bWJlcj4gfHwge307IFxyXG5cdE9iamVjdC5rZXlzKHRhZ01hcCkuZm9yRWFjaChmdWxsVGFnID0+IHtcclxuXHRcdGNvbnN0IGNsZWFuVGFnID0gZnVsbFRhZy5zcGxpdCgnLycpWzBdLnRyaW0oKS5yZXBsYWNlKC9eIy8sICcnKTtcclxuXHRcdGlmIChjbGVhblRhZykgdGFncy5hZGQoY2xlYW5UYWcpO1xyXG5cdH0pO1xyXG5cclxuICAgICAgICAvLyDlpITnkIZZQU1MIGZyb250bWF0dGVy5qCH562+XHJcbiAgICAgICAgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZvckVhY2goZmlsZSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhY2hlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk7XHJcbiAgICAgICAgICAgIGlmIChjYWNoZT8uZnJvbnRtYXR0ZXI/LnRhZ3MpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMucGFyc2VGcm9udG1hdHRlclRhZ3MoY2FjaGUuZnJvbnRtYXR0ZXIudGFncykuZm9yRWFjaCh0ID0+IHRhZ3MuYWRkKHQpKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICByZXR1cm4gdGFncztcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHBhcnNlRnJvbnRtYXR0ZXJUYWdzKHRhZ3M6IGFueSk6IHN0cmluZ1tdIHtcclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh0YWdzKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGFncy5tYXAodCA9PiB0LnRvU3RyaW5nKCkudHJpbSgpLnJlcGxhY2UoL14jLywgJycpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHR5cGVvZiB0YWdzID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGFncy5zcGxpdCgnLCcpLm1hcCh0ID0+IHQudHJpbSgpLnJlcGxhY2UoL14jLywgJycpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIG9uT3BlbigpIHsgXHJcbiAgICAgICAgdGhpcy5hbGxUYWdzID0gQXJyYXkuZnJvbSh0aGlzLmdldEFsbFRhZ3MoKSkuc29ydCgpO1xyXG4gICAgICAgIHRoaXMucmVuZGVyTW9kYWxDb250ZW50KCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBidWlsZEZvbGRlclN0cnVjdHVyZSgpIHtcclxuICAgICAgICBjb25zdCByb290OiBGb2xkZXJJdGVtID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcImZvbGRlclwiLFxyXG4gICAgICAgICAgICBwYXRoOiBcIlwiLFxyXG4gICAgICAgICAgICBuYW1lOiB0aGlzLnBsdWdpbi50KCdmb2xkZXJOYW1lJywgMCksXHJcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbXVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKS5mb3JFYWNoKGZpbGUgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSAoZmlsZS5wYXJlbnQ/LnBhdGggPT09IFwiL1wiIHx8IGZpbGUucGFyZW50Py5wYXRoID09PSBcIlwiKSBcclxuICAgICAgICAgICAgICAgID8gW10gXHJcbiAgICAgICAgICAgICAgICA6IGZpbGUucGFyZW50Py5wYXRoLnNwbGl0KFwiL1wiKSB8fCBbXTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxldCBjdXJyZW50ID0gcm9vdDtcclxuICAgIFxyXG4gICAgICAgICAgICBwYXRoUGFydHMuZm9yRWFjaCgocGFydCwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhdGggPSBwYXRoUGFydHMuc2xpY2UoMCwgaW5kZXggKyAxKS5qb2luKFwiL1wiKTtcclxuICAgICAgICAgICAgICAgIGxldCBmb2xkZXIgPSBjdXJyZW50LmNoaWxkcmVuLmZpbmQoXHJcbiAgICAgICAgICAgICAgICAgICAgaXRlbSA9PiBpdGVtLnR5cGUgPT09IFwiZm9sZGVyXCIgJiYgaXRlbS5wYXRoID09PSBwYXRoXHJcbiAgICAgICAgICAgICAgICApIGFzIEZvbGRlckl0ZW07XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIWZvbGRlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvbGRlciA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJmb2xkZXJcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IFtdXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICBjdXJyZW50LmNoaWxkcmVuLnB1c2goZm9sZGVyKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGN1cnJlbnQgPSBmb2xkZXI7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgICAgICBjdXJyZW50LmNoaWxkcmVuLnB1c2goeyB0eXBlOiBcImZpbGVcIiwgZmlsZSB9KTsgIC8vIOato+ehrua3u+WKoOaWh+S7tuWIsOW9k+WJjeWxgue6p1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuZm9sZGVyU3RydWN0dXJlID0gcm9vdC5jaGlsZHJlbjtcclxuICAgICAgICB0aGlzLnJlc3RvcmVDb2xsYXBzZVN0YXRlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZXN0b3JlQ29sbGFwc2VTdGF0ZSgpIHtcclxuICAgICAgICB0aGlzLmV4cGFuZGVkRm9sZGVycy5jbGVhcigpOyAgLy8g4oaQIOmHjeimge+8muWFiOa4heepuuW9k+WJjeWxleW8gOeKtuaAgVxyXG5cclxuICAgICAgICBPYmplY3QuZW50cmllcyh0aGlzLnBsdWdpbi5zZXR0aW5ncy5mb2xkZXJDb2xsYXBzZVN0YXRlKS5mb3JFYWNoKFxyXG4gICAgICAgICAgICAoW3BhdGgsIGlzQ29sbGFwc2VkXSkgPT4geyAgLy8g4oaQIOmHjeWRveWQjeWPguaVsOaYjuehruWQq+S5iVxyXG4gICAgICAgICAgICAgICAgLy8g5Y+N6L2s6YC76L6R77ya5LuF5b2T5L+d5a2Y55qE5oqY5Y+g54q25oCB5Li6ZmFsc2Xml7bmiY3lsZXlvIBcclxuICAgICAgICAgICAgICAgIGlmICghaXNDb2xsYXBzZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmV4cGFuZGVkRm9sZGVycy5hZGQocGF0aCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgcmVuZGVyTW9kYWxDb250ZW50KCkge1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XHJcbiAgICAgICAgdGhpcy5jb250ZW50RWwuYWRkQ2xhc3MoXCJ0YWdqaWEtbW9kYWxcIik7XHJcbiAgICAgICAgdGhpcy5jcmVhdGVGb3JtSW5wdXRzKCk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJGaWxlVHJlZSgpO1xyXG4gICAgICAgIHRoaXMuY3JlYXRlQWN0aW9uQnV0dG9ucygpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgY3JlYXRlRm9ybUlucHV0cygpIHtcclxuICAgICAgICBjb25zdCB0YWdDb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoXCJ0YWctaW5wdXQtY29udGFpbmVyXCIpO1xyXG4gICAgICAgIGNvbnN0IGlucHV0Um93ID0gdGFnQ29udGFpbmVyLmNyZWF0ZURpdihcImlucHV0LXJvd1wiKTtcclxuICAgICAgICBcclxuICAgICAgICBcclxuICAgICAgICAvLyDliJvlu7rmoIfnrb7ovpPlhaXmoYZcclxuICAgICAgICBjb25zdCB0YWdTZXR0aW5nID0gbmV3IFNldHRpbmcoaW5wdXRSb3cpXHJcbiAgICAgICAgICAgIC5zZXROYW1lKHRoaXMucGx1Z2luLnQoJ2FkZFRhZ3MnKSlcclxuICAgICAgICAgICAgLnNldERlc2ModGhpcy5wbHVnaW4udCgndGFnRGVzYycpKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCB0YWdJbnB1dCA9IHRhZ1NldHRpbmcuY29udHJvbEVsLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICAgICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgICAgICAgY2xzOiBcInRhZy1pbnB1dFwiLFxyXG4gICAgICAgICAgICB2YWx1ZTogdGhpcy50YWdJbnB1dFZhbHVlLFxyXG4gICAgICAgICAgICBwbGFjZWhvbGRlcjogYCR7dGhpcy5wbHVnaW4udCgnZXhhbXBsZScpfXByb2plY3QsIGltcG9ydGFudGBcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3VnZ2VzdGlvbldyYXBwZXIgPSBpbnB1dFJvdy5jcmVhdGVEaXYoXCJzdWdnZXN0aW9uLXdyYXBwZXJcIik7XHJcbiAgICAgICAgY29uc3Qgc3VnZ2VzdGlvbkNvbnRhaW5lciA9IHN1Z2dlc3Rpb25XcmFwcGVyLmNyZWF0ZURpdihcInRhZy1zdWdnZXN0aW9uc1wiKTtcclxuICAgICAgICBzdWdnZXN0aW9uQ29udGFpbmVyLmhpZGUoKTtcclxuXHJcbiAgICAgICAgLy8g5q2j56Gu55qE5LqL5Lu25aSE55CG5L2N572uXHJcbiAgICAgICAgdGFnSW5wdXQub25pbnB1dCA9ICgpID0+IHtcclxuICAgICAgICAgICAgdGhpcy50YWdJbnB1dFZhbHVlID0gdGFnSW5wdXQudmFsdWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRDYXJldFBvc2l0aW9uID0gdGFnSW5wdXQuc2VsZWN0aW9uU3RhcnQgfHwgMDtcclxuICAgICAgICAgICAgY29uc3QgaW5wdXRCZWZvcmVDYXJldCA9IHRhZ0lucHV0LnZhbHVlLnNsaWNlKDAsIGN1cnJlbnRDYXJldFBvc2l0aW9uKTtcclxuICAgICAgICAgICAgY29uc3QgbGFzdENvbW1hSW5kZXggPSBpbnB1dEJlZm9yZUNhcmV0Lmxhc3RJbmRleE9mKCcsJyk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50SW5wdXQgPSBpbnB1dEJlZm9yZUNhcmV0XHJcbiAgICAgICAgICAgICAgICAuc2xpY2UobGFzdENvbW1hSW5kZXggKyAxKVxyXG4gICAgICAgICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgICAgICAgLnJlcGxhY2UoL14jLywgJycpO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgc3VnZ2VzdGlvbnMgPSBBcnJheS5mcm9tKHRoaXMuYWxsVGFncylcclxuICAgICAgICAgICAgICAgIC5maWx0ZXIodCA9PiB0LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoY3VycmVudElucHV0LnRvTG93ZXJDYXNlKCkpKVxyXG4gICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkaWZmID0gYS5sZW5ndGggLSBiLmxlbmd0aDtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlmZiAhPT0gMCA/IGRpZmYgOiBhLmxvY2FsZUNvbXBhcmUoYik7XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgLnNsaWNlKDAsIDgpO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5zaG93U3VnZ2VzdGlvbnMoc3VnZ2VzdGlvbkNvbnRhaW5lciwgdGFnSW5wdXQsIHN1Z2dlc3Rpb25zLCBjdXJyZW50SW5wdXQpO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIOWkhOeQhuW7uuiurueCueWHu1xyXG4gICAgICAgIGxldCBpc0NsaWNraW5nU3VnZ2VzdGlvbiA9IGZhbHNlO1xyXG4gICAgICAgIHN1Z2dlc3Rpb25Db250YWluZXIub25tb3VzZWRvd24gPSAoKSA9PiBpc0NsaWNraW5nU3VnZ2VzdGlvbiA9IHRydWU7XHJcbiAgICAgICAgc3VnZ2VzdGlvbkNvbnRhaW5lci5vbm1vdXNldXAgPSAoKSA9PiBpc0NsaWNraW5nU3VnZ2VzdGlvbiA9IGZhbHNlO1xyXG5cclxuICAgICAgICB0YWdJbnB1dC5vbmJsdXIgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlmICghaXNDbGlja2luZ1N1Z2dlc3Rpb24pIHtcclxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gc3VnZ2VzdGlvbkNvbnRhaW5lci5oaWRlKCksIDIwMCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICAvLyDliKDpmaTmoIfnrb7pg6jliIZcclxuICAgICAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbClcclxuICAgICAgICAgICAgLnNldE5hbWUodGhpcy5wbHVnaW4udCgncmVtb3ZlVGFncycpKVxyXG4gICAgICAgICAgICAuc2V0RGVzYyh0aGlzLnBsdWdpbi50KCdyZW1vdmVUYWdEZXNjJykpXHJcbiAgICAgICAgICAgIC5hZGRUZXh0KHRleHQgPT4gdGV4dFxyXG4gICAgICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuZGVsZXRlVGFnSW5wdXRWYWx1ZSlcclxuICAgICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihgJHt0aGlzLnBsdWdpbi50KCdleGFtcGxlJyl9b2xkcHJvamVjdCwgYXJjaGl2ZWRgKVxyXG4gICAgICAgICAgICAgICAgLm9uQ2hhbmdlKHYgPT4gdGhpcy5kZWxldGVUYWdJbnB1dFZhbHVlID0gdikpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgc2hvd1N1Z2dlc3Rpb25zKFxyXG4gICAgICAgIGNvbnRhaW5lcjogSFRNTERpdkVsZW1lbnQsXHJcbiAgICAgICAgaW5wdXQ6IEhUTUxJbnB1dEVsZW1lbnQsXHJcbiAgICAgICAgc3VnZ2VzdGlvbnM6IHN0cmluZ1tdLFxyXG4gICAgICAgIGN1cnJlbnRJbnB1dDogc3RyaW5nXHJcbiAgICApIHtcclxuICAgICAgICBjb250YWluZXIuZW1wdHkoKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoc3VnZ2VzdGlvbnMubGVuZ3RoID09PSAwIHx8IGN1cnJlbnRJbnB1dC5sZW5ndGggPCAxKSB7XHJcbiAgICAgICAgICAgIGNvbnRhaW5lci5oaWRlKCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSAndmFyKC0tYmFja2dyb3VuZC1wcmltYXJ5KSc7XHJcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLmJvcmRlckNvbG9yID0gJ3ZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKSc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3VnZ2VzdGlvbnMuZm9yRWFjaCh0YWcgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBpdGVtID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogJ3RhZy1zdWdnZXN0aW9uLWl0ZW0nIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgbWF0Y2hJbmRleCA9IHRhZy50b0xvd2VyQ2FzZSgpLmluZGV4T2YoY3VycmVudElucHV0LnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgICAgICAgICBpZiAobWF0Y2hJbmRleCA+PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBpdGVtLmFwcGVuZChcclxuICAgICAgICAgICAgICAgICAgICB0YWcuc2xpY2UoMCwgbWF0Y2hJbmRleCksXHJcbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlU3Bhbih7IHRleHQ6IHRhZy5zbGljZShtYXRjaEluZGV4LCBtYXRjaEluZGV4ICsgY3VycmVudElucHV0Lmxlbmd0aCksIGNsczogJ3N1Z2dlc3Rpb24tbWF0Y2gnIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHRhZy5zbGljZShtYXRjaEluZGV4ICsgY3VycmVudElucHV0Lmxlbmd0aClcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBpdGVtLnRleHRDb250ZW50ID0gdGFnO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpdGVtLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmluc2VydFRhZyh0YWcsIGlucHV0LCBjdXJyZW50SW5wdXQpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgaW5wdXRSZWN0ID0gaW5wdXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgY29uc3QgbW9kYWxSZWN0ID0gdGhpcy5jb250ZW50RWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgXHJcbiAgICAgICAgY29udGFpbmVyLnNob3coKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGluc2VydFRhZyhzZWxlY3RlZFRhZzogc3RyaW5nLCBpbnB1dDogSFRNTElucHV0RWxlbWVudCwgY3VycmVudElucHV0OiBzdHJpbmcpIHtcclxuICAgICAgICBjb25zdCBjdXJyZW50VmFsdWUgPSBpbnB1dC52YWx1ZTtcclxuICAgICAgICBjb25zdCBjYXJldFBvcyA9IGlucHV0LnNlbGVjdGlvblN0YXJ0IHx8IDA7XHJcblxyXG4gICAgICAgIGNvbnN0IHRleHRCZWZvcmVDYXJldCA9IGN1cnJlbnRWYWx1ZS5zbGljZSgwLCBjYXJldFBvcyk7XHJcbiAgICAgICAgY29uc3QgbGFzdENvbW1hSW5kZXggPSB0ZXh0QmVmb3JlQ2FyZXQubGFzdEluZGV4T2YoJywnKTtcclxuXHJcbiAgICAgICAgY29uc3QgbmV3VGFncyA9IFtcclxuICAgICAgICAgICAgLi4udGV4dEJlZm9yZUNhcmV0LnNsaWNlKDAsIGxhc3RDb21tYUluZGV4ICsgMSkuc3BsaXQoJywnKS5tYXAodCA9PiB0LnRyaW0oKSksXHJcbiAgICAgICAgICAgIHNlbGVjdGVkVGFnXHJcbiAgICAgICAgXS5maWx0ZXIodCA9PiB0KS5qb2luKCcsICcpO1xyXG5cclxuICAgICAgICBjb25zdCBuZXdWYWx1ZSA9IG5ld1RhZ3MgKyBcclxuICAgICAgICAgICAgKGN1cnJlbnRWYWx1ZS5zbGljZShjYXJldFBvcykuc3RhcnRzV2l0aCgnLCcpID8gJycgOiAnLCAnKSArIFxyXG4gICAgICAgICAgICBjdXJyZW50VmFsdWUuc2xpY2UoY2FyZXRQb3MpLnJlcGxhY2UoL15cXHMqLD9cXHMqLywgJycpO1xyXG5cclxuICAgICAgICBpbnB1dC52YWx1ZSA9IG5ld1ZhbHVlO1xyXG4gICAgICAgIHRoaXMudGFnSW5wdXRWYWx1ZSA9IG5ld1ZhbHVlO1xyXG5cclxuICAgICAgICBjb25zdCBuZXdDYXJldFBvcyA9IG5ld1RhZ3MubGVuZ3RoICsgMjtcclxuICAgICAgICBpbnB1dC5zZXRTZWxlY3Rpb25SYW5nZShuZXdDYXJldFBvcywgbmV3Q2FyZXRQb3MpO1xyXG4gICAgICAgIGlucHV0LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdpbnB1dCcpKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyDkv67mlLnmjInpkq7mloflrZdcclxuICAgIHByaXZhdGUgcmVuZGVyRmlsZVRyZWUoKSB7XHJcbiAgICAgICAgY29uc3QgYWN0aW9uQmFyID0gdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KFwiYWN0aW9uLWJhclwiKTtcclxuICAgICAgICBuZXcgQnV0dG9uQ29tcG9uZW50KGFjdGlvbkJhcilcclxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoYOKchSAke3RoaXMucGx1Z2luLnQoJ3NlbGVjdEFsbCcpfWApXHJcbiAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMudG9nZ2xlQWxsU2VsZWN0aW9uKHRydWUpKTtcclxuICAgICAgICBuZXcgQnV0dG9uQ29tcG9uZW50KGFjdGlvbkJhcilcclxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoYOKdjCAke3RoaXMucGx1Z2luLnQoJ3Vuc2VsZWN0QWxsJyl9YClcclxuICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy50b2dnbGVBbGxTZWxlY3Rpb24oZmFsc2UpKTtcclxuXHJcbiAgICAgICAgLy8g5re75Yqg5paH5Lu25qCR5riy5p+T5Luj56CB77yI5Y6f57y65aSx6YOo5YiG77yJXHJcbiAgICAgICAgY29uc3QgdHJlZUNvbnRhaW5lciA9IHRoaXMuY29udGVudEVsLmNyZWF0ZURpdihcImZpbGUtdHJlZS1jb250YWluZXJcIik7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJGb2xkZXJTdHJ1Y3R1cmUodHJlZUNvbnRhaW5lciwgdGhpcy5mb2xkZXJTdHJ1Y3R1cmUsIDApO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgY3JlYXRlQWN0aW9uQnV0dG9ucygpIHtcclxuICAgICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVFbChcImhyXCIpO1xyXG4gICAgICAgIG5ldyBCdXR0b25Db21wb25lbnQodGhpcy5jb250ZW50RWwpXHJcbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KGDwn5K+ICR7dGhpcy5wbHVnaW4udCgnc2F2ZScpfWApXHJcbiAgICAgICAgICAgIC5zZXRDdGEoKVxyXG4gICAgICAgICAgICAub25DbGljaygoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NGaWxlcygpXHJcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5jbG9zZSgpKVxyXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZShg4p2MIOaTjeS9nOWksei0pTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgdG9nZ2xlQWxsU2VsZWN0aW9uKHNlbGVjdDogYm9vbGVhbikge1xyXG4gICAgICAgIHRoaXMuc2VsZWN0ZWRGaWxlcyA9IHNlbGVjdCA/IFsuLi50aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCldIDogW107XHJcbiAgICAgICAgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdJylcclxuICAgICAgICAgICAgLmZvckVhY2goY2IgPT4gY2IuY2hlY2tlZCA9IHNlbGVjdCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzRmlsZXMoKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnZhbGlkYXRlSW5wdXQoKSkgcmV0dXJuO1xyXG4gICAgICAgIFxyXG5cclxuICAgICAgICBjb25zdCBhZGRUYWdzID0gdGhpcy5wYXJzZVRhZ3ModGhpcy50YWdJbnB1dFZhbHVlKTtcclxuICAgICAgICBjb25zdCByZW1vdmVUYWdzID0gdGhpcy5wYXJzZVRhZ3ModGhpcy5kZWxldGVUYWdJbnB1dFZhbHVlKTtcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkRmlsZXMubWFwKGZpbGUgPT4gXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzU2luZ2xlRmlsZShmaWxlLCBhZGRUYWdzLCByZW1vdmVUYWdzKVxyXG4gICAgICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICApO1xyXG5cclxuICAgICAgICAgICAgbmV3IE5vdGljZSh0aGlzLnBsdWdpbi50KCdmaWxlUHJvY2Vzc2VkJywgdGhpcy5zZWxlY3RlZEZpbGVzLmxlbmd0aCkpO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b1JlZnJlc2gpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5yZXF1ZXN0U2F2ZUxheW91dCgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAn5pyq55+l6ZSZ6K+vJztcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGDmlofku7blpITnkIblpLHotKU6ICR7ZXJyb3JNZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHZhbGlkYXRlSW5wdXQoKTogYm9vbGVhbiB7XHJcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRGaWxlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgbmV3IE5vdGljZSh0aGlzLnBsdWdpbi50KCdub0ZpbGVTZWxlY3RlZCcpKTtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgYWRkRW1wdHkgPSB0aGlzLnRhZ0lucHV0VmFsdWUudHJpbSgpID09PSBcIlwiO1xyXG4gICAgICAgIGNvbnN0IHJlbW92ZUVtcHR5ID0gdGhpcy5kZWxldGVUYWdJbnB1dFZhbHVlLnRyaW0oKSA9PT0gXCJcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoYWRkRW1wdHkgJiYgcmVtb3ZlRW1wdHkpIHtcclxuICAgICAgICAgICAgbmV3IE5vdGljZSh0aGlzLnBsdWdpbi50KCdub1RhZ3NJbnB1dCcpKTtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBwYXJzZVRhZ3MoaW5wdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICAgICAgICByZXR1cm4gaW5wdXRcclxuICAgICAgICAgICAgLnNwbGl0KC9bLO+8jF0vZylcclxuICAgICAgICAgICAgLm1hcCh0ID0+IHQudHJpbSgpLnJlcGxhY2UoLyMvZywgJycpKVxyXG4gICAgICAgICAgICAuZmlsdGVyKHQgPT4gdC5sZW5ndGggPiAwKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHByb2Nlc3NTaW5nbGVGaWxlKGZpbGU6IFRGaWxlLCBhZGRUYWdzOiBzdHJpbmdbXSwgcmVtb3ZlVGFnczogc3RyaW5nW10pIHtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcclxuICAgICAgICBjb25zdCBjYWNoZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpID8/IHsgZnJvbnRtYXR0ZXI6IHt9IH07XHJcbiAgICAgICAgbGV0IGN1cnJlbnRUYWdzID0gdGhpcy5nZXRDdXJyZW50VGFncyhjYWNoZS5mcm9udG1hdHRlcj8udGFncyk7XHJcblxyXG4gICAgICAgIGNvbnN0IG5ld1RhZ3MgPSBbXHJcbiAgICAgICAgICAgIC4uLmN1cnJlbnRUYWdzLmZpbHRlcih0ID0+ICFyZW1vdmVUYWdzLmluY2x1ZGVzKHQpKSxcclxuICAgICAgICAgICAgLi4uYWRkVGFnc1xyXG4gICAgICAgIF0uZmlsdGVyKCh2LCBpLCBhKSA9PiBhLmluZGV4T2YodikgPT09IGkpO1xyXG5cclxuICAgICAgICBjb25zdCBuZXdZQU1MID0gdGhpcy5idWlsZE5ld1lBTUwoY2FjaGUuZnJvbnRtYXR0ZXIgfHwge30sIG5ld1RhZ3MpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB0aGlzLnJlcGxhY2VZQU1MKGNvbnRlbnQsIG5ld1lBTUwpKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldEN1cnJlbnRUYWdzKHRhZ3M6IHVua25vd24pOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgaWYgKCF0YWdzKSByZXR1cm4gW107XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodGFncykpIHJldHVybiB0YWdzLm1hcCh0ID0+IHQudG9TdHJpbmcoKS50cmltKCkpO1xyXG4gICAgICAgIGlmICh0eXBlb2YgdGFncyA9PT0gJ3N0cmluZycpIHJldHVybiB0aGlzLnBhcnNlVGFncyh0YWdzKTtcclxuICAgICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcblxyXG5cclxuICAgIHByaXZhdGUgYnVpbGROZXdZQU1MKG9yaWdpbmFsOiBvYmplY3QsIHRhZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcclxuICAgICAgICBjb25zdCBvdGhlcktleXMgPSBPYmplY3Qua2V5cyhvcmlnaW5hbCkuZmlsdGVyKGsgPT4gayAhPT0gXCJ0YWdzXCIpO1xyXG5cclxuICAgICAgICBpZiAodGFncy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIGxpbmVzLnB1c2goXCJ0YWdzOlwiKTtcclxuICAgICAgICAgICAgdGFncy5mb3JFYWNoKHQgPT4gbGluZXMucHVzaChgICAtICR7dH1gKSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBvdGhlcktleXMuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IChvcmlnaW5hbCBhcyBhbnkpW2tleV07XHJcbiAgICAgICAgICAgIGxpbmVzLnB1c2goYCR7a2V5fTogJHt0aGlzLnN0cmluZ2lmeVlBTUxWYWx1ZSh2YWx1ZSl9YCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vbGluZXMucHVzaChgdXBkYXRlZDogXCIke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1cImApO1xyXG4gICAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgc3RyaW5naWZ5WUFNTFZhbHVlKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcclxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSByZXR1cm4gdmFsdWU7XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gYFske3ZhbHVlLm1hcCh2ID0+IGBcIiR7dn1cImApLmpvaW4oXCIsIFwiKX1dYDtcclxuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgcmVwbGFjZVlBTUwoY29udGVudDogc3RyaW5nLCBuZXdZQU1MOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gY29udGVudC5zcGxpdChcIi0tLVwiKTtcclxuICAgICAgICBjb25zdCBib2R5ID0gcGFydHMuc2xpY2UoMikuam9pbihcIi0tLVwiKS50cmltKCk7XHJcbiAgICAgICAgcmV0dXJuIGAtLS1cXG4ke25ld1lBTUx9XFxuLS0tJHtib2R5ID8gYFxcbiR7Ym9keX1gIDogXCJcIn1gO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgcmVuZGVyRm9sZGVyU3RydWN0dXJlKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGl0ZW1zOiAoRm9sZGVySXRlbSB8IEZpbGVJdGVtKVtdLCBpbmRlbnQ6IG51bWJlcikge1xyXG4gICAgICAgIGNvbnRhaW5lci5lbXB0eSgpO1xyXG4gICAgICAgIGl0ZW1zLmZvckVhY2goaXRlbSA9PiB7XHJcbiAgICAgICAgICAgIGl0ZW0udHlwZSA9PT0gXCJmb2xkZXJcIiBcclxuICAgICAgICAgICAgICAgID8gdGhpcy5yZW5kZXJGb2xkZXJJdGVtKGNvbnRhaW5lciwgaXRlbSwgaW5kZW50KVxyXG4gICAgICAgICAgICAgICAgOiB0aGlzLnJlbmRlckZpbGVJdGVtKGNvbnRhaW5lciwgaXRlbSwgaW5kZW50KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlbmRlckZvbGRlckl0ZW0oY29udGFpbmVyOiBIVE1MRWxlbWVudCwgZm9sZGVyOiBGb2xkZXJJdGVtLCBpbmRlbnQ6IG51bWJlcikge1xyXG4gICAgICAgIGNvbnN0IGRpc3BsYXlOYW1lID0gZm9sZGVyLnBhdGggPT09IFwiXCJcclxuICAgICAgICA/IHRoaXMucGx1Z2luLnQoJ2ZvbGRlck5hbWUnLCAwKSAgLy8g5q2j56Gu55qE5p2h5Lu26KGo6L6+5byPXHJcbiAgICAgICAgOiBmb2xkZXIubmFtZTtcclxuICAgICAgICBcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBpc0V4cGFuZGVkID0gdGhpcy5leHBhbmRlZEZvbGRlcnMuaGFzKGZvbGRlci5wYXRoKTtcclxuICAgICAgICBjb25zdCBmb2xkZXJFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoYGZvbGRlci1pdGVtICR7aXNFeHBhbmRlZCA/ICdmb2xkZXItZXhwYW5kZWQnIDogJyd9YCk7XHJcbiAgICAgICAgZm9sZGVyRWwuc3R5bGUubWFyZ2luTGVmdCA9IGAke2luZGVudCAqIDIwfXB4YDtcclxuICAgICAgICBmb2xkZXJFbC5kYXRhc2V0LnBhdGggPSBmb2xkZXIucGF0aDtcclxuXHJcbiAgICAgICAgXHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgaGVhZGVyID0gZm9sZGVyRWwuY3JlYXRlRGl2KFwiZm9sZGVyLWhlYWRlclwiKTtcclxuICAgIGNvbnN0IGljb24gPSBoZWFkZXIuY3JlYXRlU3Bhbih7XHJcbiAgICAgICAgY2xzOiBcImZvbGRlci1pY29uXCIsXHJcbiAgICAgICAgdGV4dDogaXNFeHBhbmRlZCA/IFwi4pa8XCIgOiBcIuKWtlwiXHJcbiAgICB9KTtcclxuICAgIGljb24ub25jbGljayA9ICgpID0+IHRoaXMudG9nZ2xlRm9sZGVyKGZvbGRlci5wYXRoLCBmb2xkZXJFbCk7XHJcblxyXG4gICAgaGVhZGVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiBkaXNwbGF5TmFtZSB9KTtcclxuXHJcbiAgICBjb25zdCBjaGVja2JveCA9IGhlYWRlci5jcmVhdGVFbChcImlucHV0XCIsIHtcclxuICAgICAgICB0eXBlOiBcImNoZWNrYm94XCIsXHJcbiAgICAgICAgY2xzOiBcImZvbGRlci1jaGVja2JveFwiXHJcbiAgICB9KSBhcyBIVE1MSW5wdXRFbGVtZW50O1xyXG4gICAgY2hlY2tib3guY2hlY2tlZCA9IHRoaXMuaXNBbGxDaGlsZHJlblNlbGVjdGVkKGZvbGRlcik7XHJcbiAgICBjaGVja2JveC5vbmNoYW5nZSA9ICgpID0+IHRoaXMudG9nZ2xlRm9sZGVyU2VsZWN0aW9uKGZvbGRlciwgY2hlY2tib3guY2hlY2tlZCk7XHJcblxyXG4gICAgY29uc3QgY2hpbGRyZW5FbCA9IGZvbGRlckVsLmNyZWF0ZURpdihcImZvbGRlci1jaGlsZHJlblwiKTtcclxuICAgIGlmIChpc0V4cGFuZGVkKSB7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJGb2xkZXJTdHJ1Y3R1cmUoY2hpbGRyZW5FbCwgZm9sZGVyLmNoaWxkcmVuLCBpbmRlbnQgKyAxKTtcclxuICAgIH1cclxufVxyXG5cclxuICAgIHByaXZhdGUgcmVuZGVyRmlsZUl0ZW0oY29udGFpbmVyOiBIVE1MRWxlbWVudCwgZmlsZUl0ZW06IEZpbGVJdGVtLCBpbmRlbnQ6IG51bWJlcikge1xyXG4gICAgICAgIGNvbnN0IGZpbGVFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoXCJmaWxlLWl0ZW1cIik7XHJcbiAgICAgICAgZmlsZUVsLnN0eWxlLm1hcmdpbkxlZnQgPSBgJHtpbmRlbnQgKiAxNX1weGA7ICAvLyDosIPmlbTkuLrmm7TlkIjnkIbnmoTnvKnov5vlgLxcclxuXHJcbiAgICAgICAgY29uc3QgY2hlY2tib3ggPSBmaWxlRWwuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiY2hlY2tib3hcIixcclxuICAgICAgICAgICAgY2xzOiBcImZpbGUtY2hlY2tib3hcIlxyXG4gICAgICAgIH0pIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XHJcbiAgICBcclxuICAgICAgICBjaGVja2JveC5jaGVja2VkID0gdGhpcy5zZWxlY3RlZEZpbGVzLmluY2x1ZGVzKGZpbGVJdGVtLmZpbGUpO1xyXG4gICAgICAgIGNoZWNrYm94Lm9uY2hhbmdlID0gKCkgPT4gdGhpcy50b2dnbGVGaWxlU2VsZWN0aW9uKGZpbGVJdGVtLmZpbGUsIGNoZWNrYm94LmNoZWNrZWQpO1xyXG5cclxuICAgICAgICBmaWxlRWwuY3JlYXRlU3Bhbih7IHRleHQ6IGZpbGVJdGVtLmZpbGUuYmFzZW5hbWUgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB0b2dnbGVGaWxlU2VsZWN0aW9uKGZpbGU6IFRGaWxlLCBzZWxlY3RlZDogYm9vbGVhbikge1xyXG4gICAgICAgIHRoaXMuc2VsZWN0ZWRGaWxlcyA9IHNlbGVjdGVkXHJcbiAgICAgICAgICAgID8gWy4uLnRoaXMuc2VsZWN0ZWRGaWxlcywgZmlsZV0uZmlsdGVyKCh2LCBpLCBhKSA9PiBhLmluZGV4T2YodikgPT09IGkpXHJcbiAgICAgICAgICAgIDogdGhpcy5zZWxlY3RlZEZpbGVzLmZpbHRlcihmID0+IGYgIT09IGZpbGUpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgdG9nZ2xlRm9sZGVyKHBhdGg6IHN0cmluZywgY29udGFpbmVyOiBIVE1MRWxlbWVudCkge1xyXG4gICAgICAgIGNvbnN0IHdhc0V4cGFuZGVkID0gdGhpcy5leHBhbmRlZEZvbGRlcnMuaGFzKHBhdGgpO1xyXG4gICAgICAgIHRoaXMuZXhwYW5kZWRGb2xkZXJzW3dhc0V4cGFuZGVkID8gJ2RlbGV0ZScgOiAnYWRkJ10ocGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgY2hpbGRyZW5Db250YWluZXIgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5mb2xkZXItY2hpbGRyZW5cIikgYXMgSFRNTEVsZW1lbnQ7XHJcbiAgICAgICAgY2hpbGRyZW5Db250YWluZXIuZW1wdHkoKTtcclxuICAgICAgICBpZiAoIXdhc0V4cGFuZGVkKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZvbGRlciA9IHRoaXMuZmluZEZvbGRlckJ5UGF0aChwYXRoKTtcclxuICAgICAgICAgICAgaWYgKGZvbGRlcikge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJGb2xkZXJTdHJ1Y3R1cmUoXHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5Db250YWluZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgZm9sZGVyLmNoaWxkcmVuLFxyXG4gICAgICAgICAgICAgICAgICAgIHBhcnNlSW50KGNvbnRhaW5lci5zdHlsZS5tYXJnaW5MZWZ0IHx8IFwiMFwiKSAvIDIwICsgMVxyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaWNvbiA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLmZvbGRlci1pY29uXCIpIGFzIEhUTUxFbGVtZW50O1xyXG4gICAgICAgIGljb24udGV4dENvbnRlbnQgPSB3YXNFeHBhbmRlZCA/IFwi4pa2XCIgOiBcIuKWvFwiO1xyXG4gICAgICAgIGNvbnRhaW5lci5jbGFzc0xpc3QudG9nZ2xlKFwiZm9sZGVyLWV4cGFuZGVkXCIsICF3YXNFeHBhbmRlZCk7XHJcbiAgICAgICAgLy8g5pu05paw6YC76L6R77ya5a2Y5YKo55yf5q2j55qE5oqY5Y+g54q25oCBXHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZm9sZGVyQ29sbGFwc2VTdGF0ZVtwYXRoXSA9IHdhc0V4cGFuZGVkOyAvLyDlvZPliY3nirbmgIHlj43ovazkuLrkv53lrZjnirbmgIFcclxuICAgICAgICB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuXHJcbiAgICAgICAgLy8g5riF6Zmk5Y6f5pyJ5bGV5byA54q25oCB5YaN6YeN5bu6XHJcbiAgICAgICAgaWYgKHdhc0V4cGFuZGVkKSB7XHJcbiAgICAgICAgICAgIHRoaXMuZXhwYW5kZWRGb2xkZXJzLmRlbGV0ZShwYXRoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLmV4cGFuZGVkRm9sZGVycy5hZGQocGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZmluZEZvbGRlckJ5UGF0aChwYXRoOiBzdHJpbmcpOiBGb2xkZXJJdGVtIHwgdW5kZWZpbmVkIHtcclxuICAgICAgICBjb25zdCB3YWxrID0gKGl0ZW1zOiAoRm9sZGVySXRlbSB8IEZpbGVJdGVtKVtdKTogRm9sZGVySXRlbSB8IHVuZGVmaW5lZCA9PiB7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xyXG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0udHlwZSA9PT0gXCJmb2xkZXJcIikge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIOebtOaOpeWMuemFjeecn+Wunui3r+W+hO+8iOS4jei9rOaNouaYvuekuuWQjeensO+8iVxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChpdGVtLnBhdGggPT09IHBhdGgpIHJldHVybiBpdGVtO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvdW5kID0gd2FsayhpdGVtLmNoaWxkcmVuKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgcmV0dXJuIHdhbGsodGhpcy5mb2xkZXJTdHJ1Y3R1cmUpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgaXNBbGxDaGlsZHJlblNlbGVjdGVkKGZvbGRlcjogRm9sZGVySXRlbSk6IGJvb2xlYW4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGVzID0gdGhpcy5nZXRGb2xkZXJGaWxlcyhmb2xkZXIpO1xyXG4gICAgICAgIHJldHVybiBmaWxlcy5ldmVyeShmID0+IHRoaXMuc2VsZWN0ZWRGaWxlcy5pbmNsdWRlcyhmKSkgJiYgZmlsZXMubGVuZ3RoID4gMDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldEZvbGRlckZpbGVzKGZvbGRlcjogRm9sZGVySXRlbSk6IFRGaWxlW10ge1xyXG4gICAgICAgIGNvbnN0IGZpbGVzOiBURmlsZVtdID0gW107XHJcbiAgICAgICAgY29uc3Qgd2FsayA9IChpdGVtOiBGb2xkZXJJdGVtIHwgRmlsZUl0ZW0pID0+IHtcclxuICAgICAgICAgICAgaWYgKGl0ZW0udHlwZSA9PT0gXCJmb2xkZXJcIikge1xyXG4gICAgICAgICAgICAgICAgaXRlbS5jaGlsZHJlbi5mb3JFYWNoKHdhbGspO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgZmlsZXMucHVzaChpdGVtLmZpbGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgICAgICB3YWxrKGZvbGRlcik7XHJcbiAgICAgICAgcmV0dXJuIGZpbGVzO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgdG9nZ2xlRm9sZGVyU2VsZWN0aW9uKGZvbGRlcjogRm9sZGVySXRlbSwgc2VsZWN0ZWQ6IGJvb2xlYW4pIHtcclxuICAgICAgICBjb25zdCBmaWxlcyA9IHRoaXMuZ2V0Rm9sZGVyRmlsZXMoZm9sZGVyKTtcclxuICAgICAgICB0aGlzLnNlbGVjdGVkRmlsZXMgPSBzZWxlY3RlZFxyXG4gICAgICAgICAgICA/IFsuLi5uZXcgU2V0KFsuLi50aGlzLnNlbGVjdGVkRmlsZXMsIC4uLmZpbGVzXSldXHJcbiAgICAgICAgICAgIDogdGhpcy5zZWxlY3RlZEZpbGVzLmZpbHRlcihmID0+ICFmaWxlcy5pbmNsdWRlcyhmKSk7XHJcblxyXG4gICAgICAgIGNvbnN0IHNlbGVjdG9yUHJlZml4ID0gYFtkYXRhLXBhdGhePVwiJHtmb2xkZXIucGF0aH0vXCJdIC5maWxlLWNoZWNrYm94YDtcclxuICAgICAgICB0aGlzLmNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KHNlbGVjdG9yUHJlZml4KS5mb3JFYWNoKGNiID0+IHtcclxuICAgICAgICAgICAgY2IuY2hlY2tlZCA9IHNlbGVjdGVkO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIG9uQ2xvc2UoKSB7XHJcbiAgICAgICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcclxuICAgIH1cclxufVxyXG4iXSwibmFtZXMiOlsiUGx1Z2luU2V0dGluZ1RhYiIsIlNldHRpbmciLCJOb3RpY2UiLCJQbHVnaW4iLCJNb2RhbCIsIkJ1dHRvbkNvbXBvbmVudCJdLCJtYXBwaW5ncyI6Ijs7OztBQW9CQTtBQUNBLE1BQU0sYUFBYSxHQUFHO0FBQ2xCLElBQUEsRUFBRSxFQUFFO0FBQ0EsUUFBQSxXQUFXLEVBQUUsTUFBTTtBQUNuQixRQUFBLFdBQVcsRUFBRSxlQUFlO0FBQzVCLFFBQUEsT0FBTyxFQUFFLE1BQU07QUFDZixRQUFBLE9BQU8sRUFBRSxvQkFBb0I7QUFDN0IsUUFBQSxVQUFVLEVBQUUsTUFBTTtBQUNsQixRQUFBLGFBQWEsRUFBRSxvQkFBb0I7QUFDbkMsUUFBQSxTQUFTLEVBQUUsSUFBSTtBQUNmLFFBQUEsV0FBVyxFQUFFLEtBQUs7QUFDbEIsUUFBQSxJQUFJLEVB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
