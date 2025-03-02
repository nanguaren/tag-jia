'use strict';

var obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    autoRefresh: true,
    folderCollapseState: {}
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
            .setName("自动刷新")
            .setDesc("修改文件后自动刷新文件列表")
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoRefresh)
            .onChange(async (value) => {
            this.plugin.settings.autoRefresh = value;
            await this.plugin.saveSettings();
        }));
    }
}
class TagJiaPlugin extends obsidian.Plugin {
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
            name: "自定义属性标签",
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
            name: "全部文件",
            children: []
        };
        this.app.vault.getMarkdownFiles().forEach(file => {
            const parts = file.path.split("/").slice(0, -1);
            let current = root;
            parts.forEach((part, index) => {
                const path = parts.slice(0, index + 1).join("/");
                let folder = current.children.find(item => item.type === "folder" && item.path === path);
                if (!folder) {
                    folder = {
                        type: "folder",
                        path,
                        name: part,
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
            .setName("添加标签")
            .setDesc("用逗号分隔多个标签（输入时会有建议）");
        const tagInput = tagSetting.controlEl.createEl("input", {
            type: "text",
            cls: "tag-input",
            value: this.tagInputValue,
            placeholder: "示例：项目, 重要"
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
        // 删除标签输入框
        new obsidian.Setting(this.contentEl)
            .setName("删除标签")
            .setDesc("用逗号分隔要删除的标签（空则不删除）")
            .addText(text => text
            .setValue(this.deleteTagInputValue)
            .setPlaceholder("示例：旧项目, 已归档")
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
    renderFileTree() {
        const actionBar = this.contentEl.createDiv("action-bar");
        new obsidian.ButtonComponent(actionBar)
            .setButtonText("✅ 全选").onClick(() => this.toggleAllSelection(true));
        new obsidian.ButtonComponent(actionBar)
            .setButtonText("❌ 全不选").onClick(() => this.toggleAllSelection(false));
        const treeContainer = this.contentEl.createDiv();
        this.renderFolderStructure(treeContainer, this.folderStructure, 0);
    }
    createActionButtons() {
        this.contentEl.createEl("hr");
        new obsidian.ButtonComponent(this.contentEl)
            .setButtonText("💾 保存修改")
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
            new obsidian.Notice(`✅ 成功处理 ${this.selectedFiles.length} 个文件`);
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
            new obsidian.Notice("⚠️ 请至少选择一个文件");
            return false;
        }
        const addEmpty = this.tagInputValue.trim() === "";
        const removeEmpty = this.deleteTagInputValue.trim() === "";
        if (addEmpty && removeEmpty) {
            new obsidian.Notice("⚠️ 请输入要添加或删除的标签");
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
        header.createSpan({ text: folder.name });
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsic3JjL21haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcclxuICAgIEFwcCxcclxuICAgIEJ1dHRvbkNvbXBvbmVudCxcclxuICAgIE1vZGFsLFxyXG4gICAgTm90aWNlLFxyXG4gICAgUGx1Z2luLFxyXG4gICAgUGx1Z2luU2V0dGluZ1RhYixcclxuICAgIFNldHRpbmcsXHJcbiAgICBURmlsZVxyXG59IGZyb20gXCJvYnNpZGlhblwiO1xyXG5cclxuaW50ZXJmYWNlIFRhZ0ppYVNldHRpbmdzIHtcclxuICAgIGF1dG9SZWZyZXNoOiBib29sZWFuO1xyXG4gICAgZm9sZGVyQ29sbGFwc2VTdGF0ZTogUmVjb3JkPHN0cmluZywgYm9vbGVhbj47XHJcbn1cclxuXHJcbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IFRhZ0ppYVNldHRpbmdzID0ge1xyXG4gICAgYXV0b1JlZnJlc2g6IHRydWUsXHJcbiAgICBmb2xkZXJDb2xsYXBzZVN0YXRlOiB7fVxyXG59O1xyXG5cclxuaW50ZXJmYWNlIEZvbGRlckl0ZW0ge1xyXG4gICAgdHlwZTogXCJmb2xkZXJcIjtcclxuICAgIHBhdGg6IHN0cmluZztcclxuICAgIG5hbWU6IHN0cmluZztcclxuICAgIGNoaWxkcmVuOiAoRm9sZGVySXRlbSB8IEZpbGVJdGVtKVtdO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgRmlsZUl0ZW0ge1xyXG4gICAgdHlwZTogXCJmaWxlXCI7XHJcbiAgICBmaWxlOiBURmlsZTtcclxufVxyXG5cclxuY2xhc3MgVGFnSmlhU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xyXG4gICAgcGx1Z2luOiBUYWdKaWFQbHVnaW47XHJcblxyXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVGFnSmlhUGx1Z2luKSB7XHJcbiAgICAgICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gICAgICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gICAgfVxyXG5cclxuICAgIGRpc3BsYXkoKSB7XHJcbiAgICAgICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcclxuICAgICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG5cclxuICAgICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgICAgICAgLnNldE5hbWUoXCLoh6rliqjliLfmlrBcIilcclxuICAgICAgICAgICAgLnNldERlc2MoXCLkv67mlLnmlofku7blkI7oh6rliqjliLfmlrDmlofku7bliJfooahcIilcclxuICAgICAgICAgICAgLmFkZFRvZ2dsZSh0b2dnbGUgPT4gdG9nZ2xlXHJcbiAgICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b1JlZnJlc2gpXHJcbiAgICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgdmFsdWUgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9SZWZyZXNoID0gdmFsdWU7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUYWdKaWFQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gICAgc2V0dGluZ3MhOiBUYWdKaWFTZXR0aW5ncztcclxuXHJcbiAgICBhc3luYyBvbmxvYWQoKSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFRhZ0ppYVNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3R5bGVcIik7XHJcbiAgICAgICAgc3R5bGUudGV4dENvbnRlbnQgPSBgXHJcbiAgICAgICAgICAgIC50YWdqaWEtbW9kYWwgeyBwYWRkaW5nOiAxNXB4OyBtYXgtaGVpZ2h0OiA4MHZoOyBvdmVyZmxvdzogYXV0bzsgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWhlYWRlciB7XHJcbiAgICAgICAgICAgICAgICBjdXJzb3I6IHBvaW50ZXI7IHBhZGRpbmc6IDhweDsgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZC1zZWNvbmRhcnkpO1xyXG4gICAgICAgICAgICAgICAgYm9yZGVyLXJhZGl1czogNHB4OyBtYXJnaW46IDRweCAwOyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWljb24geyBmb250LXNpemU6IDAuOGVtOyB1c2VyLXNlbGVjdDogbm9uZTsgfVxyXG4gICAgICAgICAgICAuZm9sZGVyLWNoZWNrYm94IHsgbWFyZ2luLWxlZnQ6IGF1dG87IH1cclxuICAgICAgICAgICAgLmZpbGUtaXRlbSB7IG1hcmdpbi1sZWZ0OiAyMHB4OyBwYWRkaW5nOiA0cHggMDsgfVxyXG4gICAgICAgICAgICAuZmlsZS1jaGVja2JveCB7IG1hcmdpbi1yaWdodDogOHB4OyB9XHJcbiAgICAgICAgICAgIC5hY3Rpb24tYmFyIHtcclxuICAgICAgICAgICAgICAgIG1hcmdpbjogMTBweCAwOyBkaXNwbGF5OiBmbGV4OyBnYXA6IDEwcHg7IHBvc2l0aW9uOiBzdGlja3k7XHJcbiAgICAgICAgICAgICAgICB0b3A6IDA7IGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtcHJpbWFyeSk7IHotaW5kZXg6IDE7IHBhZGRpbmc6IDhweCAwO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC5mb2xkZXItY2hpbGRyZW4geyBkaXNwbGF5OiBub25lOyB9XHJcbiAgICAgICAgICAgIC5mb2xkZXItZXhwYW5kZWQgLmZvbGRlci1jaGlsZHJlbiB7IGRpc3BsYXk6IGJsb2NrOyB9XHJcblxyXG4gICAgICAgICAgICAvKiDmoIfnrb7lu7rorq7moLflvI8gKi9cclxuICAgICAgICAgICAgLnRhZy1zdWdnZXN0aW9ucyB7XHJcbiAgICAgICAgICAgICAgICBtYXgtaGVpZ2h0OiAyMDBweDtcclxuICAgICAgICAgICAgICAgIG92ZXJmbG93LXk6IGF1dG87XHJcbiAgICAgICAgICAgICAgICBtYXJnaW4tdG9wOiA1cHg7XHJcbiAgICAgICAgICAgICAgICB3aWR0aDogY2FsYygxMDAlIC0gMjRweCk7XHJcbiAgICAgICAgICAgICAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlcik7XHJcbiAgICAgICAgICAgICAgICBib3JkZXItcmFkaXVzOiA0cHg7XHJcbiAgICAgICAgICAgICAgICBib3gtc2hhZG93OiAwIDJweCA4cHggdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3gtc2hhZG93KTtcclxuICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtcHJpbWFyeSk7XHJcbiAgICAgICAgICAgICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICAgICAgICAgICAgICB6LWluZGV4OiA5OTk5O1xyXG4gICAgICAgICAgICB9XHJcblx0XHRcdC8qIOaWsOWinui+k+WFpeihjOWuueWZqOagt+W8jyAqL1xyXG5cdFx0XHQuaW5wdXQtcm93IHtcclxuXHRcdFx0XHRwb3NpdGlvbjogcmVsYXRpdmU7XHJcblx0XHRcdFx0bWFyZ2luLWJvdHRvbTogMTVweDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Lyog6LCD5pW05bu66K6u5qGG5a6a5L2N5pa55byPICovXHJcblx0XHRcdC50YWctc3VnZ2VzdGlvbnMge1xyXG5cdFx0XHRcdHRvcDogY2FsYygxMDAlICsgNXB4KSAhaW1wb3J0YW50OyAgLyogKzVweOS4jui+k+WFpeahhuS/neaMgemXtOi3nSAqL1xyXG5cdFx0XHRcdGxlZnQ6IDAgIWltcG9ydGFudDtcclxuXHRcdFx0XHR3aWR0aDogMTAwJSAhaW1wb3J0YW50OyAgLyog5LiO6L6T5YWl5qGG5ZCM5a69ICovXHJcblx0XHRcdFx0dHJhbnNmb3JtOiBub25lICFpbXBvcnRhbnQ7IC8qIOa4hemZpOWPr+iDveWtmOWcqOeahOWPmOaNoiAqL1xyXG5cdFx0XHR9XHJcbiAgICAgICAgICAgIC50YWctc3VnZ2VzdGlvbi1pdGVtIHtcclxuICAgICAgICAgICAgICAgIHBhZGRpbmc6IDZweCAxMnB4O1xyXG4gICAgICAgICAgICAgICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAwLjJzO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC50YWctc3VnZ2VzdGlvbi1pdGVtOmhvdmVyIHtcclxuICAgICAgICAgICAgICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJhY2tncm91bmQtc2Vjb25kYXJ5KTtcclxuICAgICAgICAgICAgfWA7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzdHlsZSk7XHJcblxyXG4gICAgICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgICAgICAgIGlkOiBcImN1c3RvbS10YWctbWFuYWdlclwiLFxyXG4gICAgICAgICAgICBuYW1lOiBcIuiHquWumuS5ieWxnuaAp+agh+etvlwiLFxyXG4gICAgICAgICAgICBjYWxsYmFjazogKCkgPT4gbmV3IEZpbGVUYWdNb2RhbCh0aGlzLmFwcCwgdGhpcykub3BlbigpXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xyXG4gICAgfVxyXG59XHJcblxyXG5jbGFzcyBGaWxlVGFnTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XHJcbiAgICBwcml2YXRlIHBsdWdpbjogVGFnSmlhUGx1Z2luO1xyXG4gICAgcHJpdmF0ZSBzZWxlY3RlZEZpbGVzOiBURmlsZVtdID0gW107XHJcbiAgICBwcml2YXRlIHRhZ0lucHV0VmFsdWUgPSBcIlwiO1xyXG4gICAgcHJpdmF0ZSBkZWxldGVUYWdJbnB1dFZhbHVlID0gXCJcIjtcclxuICAgIHByaXZhdGUgZm9sZGVyU3RydWN0dXJlOiAoRm9sZGVySXRlbSB8IEZpbGVJdGVtKVtdID0gW107XHJcbiAgICBwcml2YXRlIGV4cGFuZGVkRm9sZGVycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gICAgcHJpdmF0ZSBhbGxUYWdzOiBzdHJpbmdbXSA9IFtdO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IFRhZ0ppYVBsdWdpbikge1xyXG4gICAgICAgIHN1cGVyKGFwcCk7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgICAgICAgdGhpcy5idWlsZEZvbGRlclN0cnVjdHVyZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZ2V0QWxsVGFncygpOiBTZXQ8c3RyaW5nPiB7XHJcbiAgICAgICAgY29uc3QgdGFncyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gICAgICAgIFxyXG5cdC8vIOiOt+WPluagh+etvueahOabtOWFvOWuueaWueW8j++8iOabv+S7o+WOn+adpeeahGdldFRhZ3Pmlrnms5XvvIlcclxuXHRjb25zdCB0YWdNYXAgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlW1widGFnc1wiXSBhcyBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHx8IHt9OyBcclxuXHRPYmplY3Qua2V5cyh0YWdNYXApLmZvckVhY2goZnVsbFRhZyA9PiB7XHJcblx0XHRjb25zdCBjbGVhblRhZyA9IGZ1bGxUYWcuc3BsaXQoJy8nKVswXS50cmltKCkucmVwbGFjZSgvXiMvLCAnJyk7XHJcblx0XHRpZiAoY2xlYW5UYWcpIHRhZ3MuYWRkKGNsZWFuVGFnKTtcclxuXHR9KTtcclxuXHJcbiAgICAgICAgLy8g5aSE55CGWUFNTCBmcm9udG1hdHRlcuagh+etvlxyXG4gICAgICAgIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKS5mb3JFYWNoKGZpbGUgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBjYWNoZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpO1xyXG4gICAgICAgICAgICBpZiAoY2FjaGU/LmZyb250bWF0dGVyPy50YWdzKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBhcnNlRnJvbnRtYXR0ZXJUYWdzKGNhY2hlLmZyb250bWF0dGVyLnRhZ3MpLmZvckVhY2godCA9PiB0YWdzLmFkZCh0KSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRhZ3M7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBwYXJzZUZyb250bWF0dGVyVGFncyh0YWdzOiBhbnkpOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodGFncykpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRhZ3MubWFwKHQgPT4gdC50b1N0cmluZygpLnRyaW0oKS5yZXBsYWNlKC9eIy8sICcnKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh0eXBlb2YgdGFncyA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRhZ3Muc3BsaXQoJywnKS5tYXAodCA9PiB0LnRyaW0oKS5yZXBsYWNlKC9eIy8sICcnKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBvbk9wZW4oKSB7IFxyXG4gICAgICAgIHRoaXMuYWxsVGFncyA9IEFycmF5LmZyb20odGhpcy5nZXRBbGxUYWdzKCkpLnNvcnQoKTtcclxuICAgICAgICB0aGlzLnJlbmRlck1vZGFsQ29udGVudCgpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYnVpbGRGb2xkZXJTdHJ1Y3R1cmUoKSB7XHJcbiAgICAgICAgY29uc3Qgcm9vdDogRm9sZGVySXRlbSA9IHtcclxuICAgICAgICAgICAgdHlwZTogXCJmb2xkZXJcIixcclxuICAgICAgICAgICAgcGF0aDogXCJcIixcclxuICAgICAgICAgICAgbmFtZTogXCLlhajpg6jmlofku7ZcIixcclxuICAgICAgICAgICAgY2hpbGRyZW46IFtdXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZvckVhY2goZmlsZSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gZmlsZS5wYXRoLnNwbGl0KFwiL1wiKS5zbGljZSgwLCAtMSk7XHJcbiAgICAgICAgICAgIGxldCBjdXJyZW50ID0gcm9vdDtcclxuXHJcbiAgICAgICAgICAgIHBhcnRzLmZvckVhY2goKHBhcnQsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBwYXRoID0gcGFydHMuc2xpY2UoMCwgaW5kZXggKyAxKS5qb2luKFwiL1wiKTtcclxuICAgICAgICAgICAgICAgIGxldCBmb2xkZXIgPSBjdXJyZW50LmNoaWxkcmVuLmZpbmQoXHJcbiAgICAgICAgICAgICAgICAgICAgaXRlbSA9PiBpdGVtLnR5cGUgPT09IFwiZm9sZGVyXCIgJiYgaXRlbS5wYXRoID09PSBwYXRoXHJcbiAgICAgICAgICAgICAgICApIGFzIEZvbGRlckl0ZW07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCFmb2xkZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBmb2xkZXIgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiZm9sZGVyXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHBhcnQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiBbXVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudC5jaGlsZHJlbi5wdXNoKGZvbGRlcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50ID0gZm9sZGVyO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGN1cnJlbnQuY2hpbGRyZW4ucHVzaCh7IHR5cGU6IFwiZmlsZVwiLCBmaWxlIH0pO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB0aGlzLmZvbGRlclN0cnVjdHVyZSA9IHJvb3QuY2hpbGRyZW47XHJcbiAgICAgICAgdGhpcy5yZXN0b3JlQ29sbGFwc2VTdGF0ZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgcmVzdG9yZUNvbGxhcHNlU3RhdGUoKSB7XHJcbiAgICAgICAgT2JqZWN0LmVudHJpZXModGhpcy5wbHVnaW4uc2V0dGluZ3MuZm9sZGVyQ29sbGFwc2VTdGF0ZSkuZm9yRWFjaChcclxuICAgICAgICAgICAgKFtwYXRoLCBjb2xsYXBzZWRdKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWNvbGxhcHNlZCkgdGhpcy5leHBhbmRlZEZvbGRlcnMuYWRkKHBhdGgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlbmRlck1vZGFsQ29udGVudCgpIHtcclxuICAgICAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKFwidGFnamlhLW1vZGFsXCIpO1xyXG4gICAgICAgIHRoaXMuY3JlYXRlRm9ybUlucHV0cygpO1xyXG4gICAgICAgIHRoaXMucmVuZGVyRmlsZVRyZWUoKTtcclxuICAgICAgICB0aGlzLmNyZWF0ZUFjdGlvbkJ1dHRvbnMoKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGNyZWF0ZUZvcm1JbnB1dHMoKSB7XHJcbiAgICAgICAgY29uc3QgdGFnQ29udGFpbmVyID0gdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KFwidGFnLWlucHV0LWNvbnRhaW5lclwiKTtcclxuICAgICAgICBjb25zdCBpbnB1dFJvdyA9IHRhZ0NvbnRhaW5lci5jcmVhdGVEaXYoXCJpbnB1dC1yb3dcIik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8g5Yib5bu65qCH562+6L6T5YWl5qGGXHJcbiAgICAgICAgY29uc3QgdGFnU2V0dGluZyA9IG5ldyBTZXR0aW5nKGlucHV0Um93KVxyXG4gICAgICAgICAgICAuc2V0TmFtZShcIua3u+WKoOagh+etvlwiKVxyXG4gICAgICAgICAgICAuc2V0RGVzYyhcIueUqOmAl+WPt+WIhumalOWkmuS4quagh+etvu+8iOi+k+WFpeaXtuS8muacieW7uuiuru+8iVwiKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCB0YWdJbnB1dCA9IHRhZ1NldHRpbmcuY29udHJvbEVsLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICAgICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgICAgICAgY2xzOiBcInRhZy1pbnB1dFwiLFxyXG4gICAgICAgICAgICB2YWx1ZTogdGhpcy50YWdJbnB1dFZhbHVlLFxyXG4gICAgICAgICAgICBwbGFjZWhvbGRlcjogXCLnpLrkvovvvJrpobnnm64sIOmHjeimgVwiXHJcbiAgICAgICAgfSkgYXMgSFRNTElucHV0RWxlbWVudDtcclxuXHJcbiAgICAgICAgY29uc3Qgc3VnZ2VzdGlvbldyYXBwZXIgPSBpbnB1dFJvdy5jcmVhdGVEaXYoXCJzdWdnZXN0aW9uLXdyYXBwZXJcIik7XHJcbiAgICAgICAgY29uc3Qgc3VnZ2VzdGlvbkNvbnRhaW5lciA9IHN1Z2dlc3Rpb25XcmFwcGVyLmNyZWF0ZURpdihcInRhZy1zdWdnZXN0aW9uc1wiKTtcclxuICAgICAgICBzdWdnZXN0aW9uQ29udGFpbmVyLmhpZGUoKTtcclxuXHJcbiAgICAgICAgLy8g5q2j56Gu55qE5LqL5Lu25aSE55CG5L2N572uXHJcbiAgICAgICAgdGFnSW5wdXQub25pbnB1dCA9ICgpID0+IHtcclxuICAgICAgICAgICAgdGhpcy50YWdJbnB1dFZhbHVlID0gdGFnSW5wdXQudmFsdWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRDYXJldFBvc2l0aW9uID0gdGFnSW5wdXQuc2VsZWN0aW9uU3RhcnQgfHwgMDtcclxuICAgICAgICAgICAgY29uc3QgaW5wdXRCZWZvcmVDYXJldCA9IHRhZ0lucHV0LnZhbHVlLnNsaWNlKDAsIGN1cnJlbnRDYXJldFBvc2l0aW9uKTtcclxuICAgICAgICAgICAgY29uc3QgbGFzdENvbW1hSW5kZXggPSBpbnB1dEJlZm9yZUNhcmV0Lmxhc3RJbmRleE9mKCcsJyk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50SW5wdXQgPSBpbnB1dEJlZm9yZUNhcmV0XHJcbiAgICAgICAgICAgICAgICAuc2xpY2UobGFzdENvbW1hSW5kZXggKyAxKVxyXG4gICAgICAgICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgICAgICAgLnJlcGxhY2UoL14jLywgJycpO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgc3VnZ2VzdGlvbnMgPSBBcnJheS5mcm9tKHRoaXMuYWxsVGFncylcclxuICAgICAgICAgICAgICAgIC5maWx0ZXIodCA9PiB0LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoY3VycmVudElucHV0LnRvTG93ZXJDYXNlKCkpKVxyXG4gICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkaWZmID0gYS5sZW5ndGggLSBiLmxlbmd0aDtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlmZiAhPT0gMCA/IGRpZmYgOiBhLmxvY2FsZUNvbXBhcmUoYik7XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgLnNsaWNlKDAsIDgpO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5zaG93U3VnZ2VzdGlvbnMoc3VnZ2VzdGlvbkNvbnRhaW5lciwgdGFnSW5wdXQsIHN1Z2dlc3Rpb25zLCBjdXJyZW50SW5wdXQpO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIOWkhOeQhuW7uuiurueCueWHu1xyXG4gICAgICAgIGxldCBpc0NsaWNraW5nU3VnZ2VzdGlvbiA9IGZhbHNlO1xyXG4gICAgICAgIHN1Z2dlc3Rpb25Db250YWluZXIub25tb3VzZWRvd24gPSAoKSA9PiBpc0NsaWNraW5nU3VnZ2VzdGlvbiA9IHRydWU7XHJcbiAgICAgICAgc3VnZ2VzdGlvbkNvbnRhaW5lci5vbm1vdXNldXAgPSAoKSA9PiBpc0NsaWNraW5nU3VnZ2VzdGlvbiA9IGZhbHNlO1xyXG5cclxuICAgICAgICB0YWdJbnB1dC5vbmJsdXIgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlmICghaXNDbGlja2luZ1N1Z2dlc3Rpb24pIHtcclxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gc3VnZ2VzdGlvbkNvbnRhaW5lci5oaWRlKCksIDIwMCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICAvLyDliKDpmaTmoIfnrb7ovpPlhaXmoYZcclxuICAgICAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbClcclxuICAgICAgICAgICAgLnNldE5hbWUoXCLliKDpmaTmoIfnrb5cIilcclxuICAgICAgICAgICAgLnNldERlc2MoXCLnlKjpgJflj7fliIbpmpTopoHliKDpmaTnmoTmoIfnrb7vvIjnqbrliJnkuI3liKDpmaTvvIlcIilcclxuICAgICAgICAgICAgLmFkZFRleHQodGV4dCA9PiB0ZXh0XHJcbiAgICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5kZWxldGVUYWdJbnB1dFZhbHVlKVxyXG4gICAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwi56S65L6L77ya5pen6aG555uuLCDlt7LlvZLmoaNcIilcclxuICAgICAgICAgICAgICAgIC5vbkNoYW5nZSh2ID0+IHRoaXMuZGVsZXRlVGFnSW5wdXRWYWx1ZSA9IHYpKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHNob3dTdWdnZXN0aW9ucyhcclxuICAgICAgICBjb250YWluZXI6IEhUTUxEaXZFbGVtZW50LFxyXG4gICAgICAgIGlucHV0OiBIVE1MSW5wdXRFbGVtZW50LFxyXG4gICAgICAgIHN1Z2dlc3Rpb25zOiBzdHJpbmdbXSxcclxuICAgICAgICBjdXJyZW50SW5wdXQ6IHN0cmluZ1xyXG4gICAgKSB7XHJcbiAgICAgICAgY29udGFpbmVyLmVtcHR5KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHN1Z2dlc3Rpb25zLmxlbmd0aCA9PT0gMCB8fCBjdXJyZW50SW5wdXQubGVuZ3RoIDwgMSkge1xyXG4gICAgICAgICAgICBjb250YWluZXIuaGlkZSgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb250YWluZXIuc3R5bGUuYmFja2dyb3VuZENvbG9yID0gJ3ZhcigtLWJhY2tncm91bmQtcHJpbWFyeSknO1xyXG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5ib3JkZXJDb2xvciA9ICd2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlciknO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN1Z2dlc3Rpb25zLmZvckVhY2godGFnID0+IHtcclxuICAgICAgICAgICAgY29uc3QgaXRlbSA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6ICd0YWctc3VnZ2VzdGlvbi1pdGVtJyB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoSW5kZXggPSB0YWcudG9Mb3dlckNhc2UoKS5pbmRleE9mKGN1cnJlbnRJbnB1dC50b0xvd2VyQ2FzZSgpKTtcclxuICAgICAgICAgICAgaWYgKG1hdGNoSW5kZXggPj0gMCkge1xyXG4gICAgICAgICAgICAgICAgaXRlbS5hcHBlbmQoXHJcbiAgICAgICAgICAgICAgICAgICAgdGFnLnNsaWNlKDAsIG1hdGNoSW5kZXgpLFxyXG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZVNwYW4oeyB0ZXh0OiB0YWcuc2xpY2UobWF0Y2hJbmRleCwgbWF0Y2hJbmRleCArIGN1cnJlbnRJbnB1dC5sZW5ndGgpLCBjbHM6ICdzdWdnZXN0aW9uLW1hdGNoJyB9KSxcclxuICAgICAgICAgICAgICAgICAgICB0YWcuc2xpY2UobWF0Y2hJbmRleCArIGN1cnJlbnRJbnB1dC5sZW5ndGgpXHJcbiAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaXRlbS50ZXh0Q29udGVudCA9IHRhZztcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaXRlbS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5pbnNlcnRUYWcodGFnLCBpbnB1dCwgY3VycmVudElucHV0KTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IGlucHV0UmVjdCA9IGlucHV0LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIGNvbnN0IG1vZGFsUmVjdCA9IHRoaXMuY29udGVudEVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnRhaW5lci5zaG93KCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBpbnNlcnRUYWcoc2VsZWN0ZWRUYWc6IHN0cmluZywgaW5wdXQ6IEhUTUxJbnB1dEVsZW1lbnQsIGN1cnJlbnRJbnB1dDogc3RyaW5nKSB7XHJcbiAgICAgICAgY29uc3QgY3VycmVudFZhbHVlID0gaW5wdXQudmFsdWU7XHJcbiAgICAgICAgY29uc3QgY2FyZXRQb3MgPSBpbnB1dC5zZWxlY3Rpb25TdGFydCB8fCAwO1xyXG5cclxuICAgICAgICBjb25zdCB0ZXh0QmVmb3JlQ2FyZXQgPSBjdXJyZW50VmFsdWUuc2xpY2UoMCwgY2FyZXRQb3MpO1xyXG4gICAgICAgIGNvbnN0IGxhc3RDb21tYUluZGV4ID0gdGV4dEJlZm9yZUNhcmV0Lmxhc3RJbmRleE9mKCcsJyk7XHJcblxyXG4gICAgICAgIGNvbnN0IG5ld1RhZ3MgPSBbXHJcbiAgICAgICAgICAgIC4uLnRleHRCZWZvcmVDYXJldC5zbGljZSgwLCBsYXN0Q29tbWFJbmRleCArIDEpLnNwbGl0KCcsJykubWFwKHQgPT4gdC50cmltKCkpLFxyXG4gICAgICAgICAgICBzZWxlY3RlZFRhZ1xyXG4gICAgICAgIF0uZmlsdGVyKHQgPT4gdCkuam9pbignLCAnKTtcclxuXHJcbiAgICAgICAgY29uc3QgbmV3VmFsdWUgPSBuZXdUYWdzICsgXHJcbiAgICAgICAgICAgIChjdXJyZW50VmFsdWUuc2xpY2UoY2FyZXRQb3MpLnN0YXJ0c1dpdGgoJywnKSA/ICcnIDogJywgJykgKyBcclxuICAgICAgICAgICAgY3VycmVudFZhbHVlLnNsaWNlKGNhcmV0UG9zKS5yZXBsYWNlKC9eXFxzKiw/XFxzKi8sICcnKTtcclxuXHJcbiAgICAgICAgaW5wdXQudmFsdWUgPSBuZXdWYWx1ZTtcclxuICAgICAgICB0aGlzLnRhZ0lucHV0VmFsdWUgPSBuZXdWYWx1ZTtcclxuXHJcbiAgICAgICAgY29uc3QgbmV3Q2FyZXRQb3MgPSBuZXdUYWdzLmxlbmd0aCArIDI7XHJcbiAgICAgICAgaW5wdXQuc2V0U2VsZWN0aW9uUmFuZ2UobmV3Q2FyZXRQb3MsIG5ld0NhcmV0UG9zKTtcclxuICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnaW5wdXQnKSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZW5kZXJGaWxlVHJlZSgpIHtcclxuICAgICAgICBjb25zdCBhY3Rpb25CYXIgPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoXCJhY3Rpb24tYmFyXCIpO1xyXG4gICAgICAgIG5ldyBCdXR0b25Db21wb25lbnQoYWN0aW9uQmFyKVxyXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIuKchSDlhajpgIlcIikub25DbGljaygoKSA9PiB0aGlzLnRvZ2dsZUFsbFNlbGVjdGlvbih0cnVlKSk7XHJcbiAgICAgICAgbmV3IEJ1dHRvbkNvbXBvbmVudChhY3Rpb25CYXIpXHJcbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwi4p2MIOWFqOS4jemAiVwiKS5vbkNsaWNrKCgpID0+IHRoaXMudG9nZ2xlQWxsU2VsZWN0aW9uKGZhbHNlKSk7XHJcblxyXG4gICAgICAgIGNvbnN0IHRyZWVDb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoKTtcclxuICAgICAgICB0aGlzLnJlbmRlckZvbGRlclN0cnVjdHVyZSh0cmVlQ29udGFpbmVyLCB0aGlzLmZvbGRlclN0cnVjdHVyZSwgMCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjcmVhdGVBY3Rpb25CdXR0b25zKCkge1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLmNyZWF0ZUVsKFwiaHJcIik7XHJcbiAgICAgICAgbmV3IEJ1dHRvbkNvbXBvbmVudCh0aGlzLmNvbnRlbnRFbClcclxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCLwn5K+IOS/neWtmOS/ruaUuVwiKVxyXG4gICAgICAgICAgICAuc2V0Q3RhKClcclxuICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzRmlsZXMoKVxyXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuY2xvc2UoKSlcclxuICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoYOKdjCDmk43kvZzlpLHotKU6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHRvZ2dsZUFsbFNlbGVjdGlvbihzZWxlY3Q6IGJvb2xlYW4pIHtcclxuICAgICAgICB0aGlzLnNlbGVjdGVkRmlsZXMgPSBzZWxlY3QgPyBbLi4udGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpXSA6IFtdO1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXScpXHJcbiAgICAgICAgICAgIC5mb3JFYWNoKGNiID0+IGNiLmNoZWNrZWQgPSBzZWxlY3QpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0ZpbGVzKCkge1xyXG4gICAgICAgIGlmICghdGhpcy52YWxpZGF0ZUlucHV0KCkpIHJldHVybjtcclxuXHJcbiAgICAgICAgY29uc3QgYWRkVGFncyA9IHRoaXMucGFyc2VUYWdzKHRoaXMudGFnSW5wdXRWYWx1ZSk7XHJcbiAgICAgICAgY29uc3QgcmVtb3ZlVGFncyA9IHRoaXMucGFyc2VUYWdzKHRoaXMuZGVsZXRlVGFnSW5wdXRWYWx1ZSk7XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgICAgICAgICAgICAgdGhpcy5zZWxlY3RlZEZpbGVzLm1hcChmaWxlID0+IFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc1NpbmdsZUZpbGUoZmlsZSwgYWRkVGFncywgcmVtb3ZlVGFncylcclxuICAgICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYOKchSDmiJDlip/lpITnkIYgJHt0aGlzLnNlbGVjdGVkRmlsZXMubGVuZ3RofSDkuKrmlofku7ZgKTtcclxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9SZWZyZXNoKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmVxdWVzdFNhdmVMYXlvdXQoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ+acquefpemUmeivryc7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihg5paH5Lu25aSE55CG5aSx6LSlOiAke2Vycm9yTWVzc2FnZX1gKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB2YWxpZGF0ZUlucHV0KCk6IGJvb2xlYW4ge1xyXG4gICAgICAgIGlmICh0aGlzLnNlbGVjdGVkRmlsZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCLimqDvuI8g6K+36Iez5bCR6YCJ5oup5LiA5Liq5paH5Lu2XCIpO1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBhZGRFbXB0eSA9IHRoaXMudGFnSW5wdXRWYWx1ZS50cmltKCkgPT09IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcmVtb3ZlRW1wdHkgPSB0aGlzLmRlbGV0ZVRhZ0lucHV0VmFsdWUudHJpbSgpID09PSBcIlwiO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChhZGRFbXB0eSAmJiByZW1vdmVFbXB0eSkge1xyXG4gICAgICAgICAgICBuZXcgTm90aWNlKFwi4pqg77iPIOivt+i+k+WFpeimgea3u+WKoOaIluWIoOmZpOeahOagh+etvlwiKTtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBwYXJzZVRhZ3MoaW5wdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICAgICAgICByZXR1cm4gaW5wdXRcclxuICAgICAgICAgICAgLnNwbGl0KC9bLO+8jF0vZylcclxuICAgICAgICAgICAgLm1hcCh0ID0+IHQudHJpbSgpLnJlcGxhY2UoLyMvZywgJycpKVxyXG4gICAgICAgICAgICAuZmlsdGVyKHQgPT4gdC5sZW5ndGggPiAwKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIHByb2Nlc3NTaW5nbGVGaWxlKGZpbGU6IFRGaWxlLCBhZGRUYWdzOiBzdHJpbmdbXSwgcmVtb3ZlVGFnczogc3RyaW5nW10pIHtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcclxuICAgICAgICBjb25zdCBjYWNoZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpID8/IHsgZnJvbnRtYXR0ZXI6IHt9IH07XHJcbiAgICAgICAgbGV0IGN1cnJlbnRUYWdzID0gdGhpcy5nZXRDdXJyZW50VGFncyhjYWNoZS5mcm9udG1hdHRlcj8udGFncyk7XHJcblxyXG4gICAgICAgIGNvbnN0IG5ld1RhZ3MgPSBbXHJcbiAgICAgICAgICAgIC4uLmN1cnJlbnRUYWdzLmZpbHRlcih0ID0+ICFyZW1vdmVUYWdzLmluY2x1ZGVzKHQpKSxcclxuICAgICAgICAgICAgLi4uYWRkVGFnc1xyXG4gICAgICAgIF0uZmlsdGVyKCh2LCBpLCBhKSA9PiBhLmluZGV4T2YodikgPT09IGkpO1xyXG5cclxuICAgICAgICBjb25zdCBuZXdZQU1MID0gdGhpcy5idWlsZE5ld1lBTUwoY2FjaGUuZnJvbnRtYXR0ZXIgfHwge30sIG5ld1RhZ3MpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB0aGlzLnJlcGxhY2VZQU1MKGNvbnRlbnQsIG5ld1lBTUwpKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldEN1cnJlbnRUYWdzKHRhZ3M6IHVua25vd24pOiBzdHJpbmdbXSB7XHJcbiAgICAgICAgaWYgKCF0YWdzKSByZXR1cm4gW107XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodGFncykpIHJldHVybiB0YWdzLm1hcCh0ID0+IHQudG9TdHJpbmcoKS50cmltKCkpO1xyXG4gICAgICAgIGlmICh0eXBlb2YgdGFncyA9PT0gJ3N0cmluZycpIHJldHVybiB0aGlzLnBhcnNlVGFncyh0YWdzKTtcclxuICAgICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcblxyXG5cclxuICAgIHByaXZhdGUgYnVpbGROZXdZQU1MKG9yaWdpbmFsOiBvYmplY3QsIHRhZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcclxuICAgICAgICBjb25zdCBvdGhlcktleXMgPSBPYmplY3Qua2V5cyhvcmlnaW5hbCkuZmlsdGVyKGsgPT4gayAhPT0gXCJ0YWdzXCIpO1xyXG5cclxuICAgICAgICBpZiAodGFncy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIGxpbmVzLnB1c2goXCJ0YWdzOlwiKTtcclxuICAgICAgICAgICAgdGFncy5mb3JFYWNoKHQgPT4gbGluZXMucHVzaChgICAtICR7dH1gKSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBvdGhlcktleXMuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IChvcmlnaW5hbCBhcyBhbnkpW2tleV07XHJcbiAgICAgICAgICAgIGxpbmVzLnB1c2goYCR7a2V5fTogJHt0aGlzLnN0cmluZ2lmeVlBTUxWYWx1ZSh2YWx1ZSl9YCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGxpbmVzLnB1c2goYHVwZGF0ZWQ6IFwiJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XCJgKTtcclxuICAgICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHN0cmluZ2lmeVlBTUxWYWx1ZSh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHZhbHVlO1xyXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGBbJHt2YWx1ZS5tYXAodiA9PiBgXCIke3Z9XCJgKS5qb2luKFwiLCBcIil9XWA7XHJcbiAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlcGxhY2VZQU1MKGNvbnRlbnQ6IHN0cmluZywgbmV3WUFNTDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IGNvbnRlbnQuc3BsaXQoXCItLS1cIik7XHJcbiAgICAgICAgY29uc3QgYm9keSA9IHBhcnRzLnNsaWNlKDIpLmpvaW4oXCItLS1cIikudHJpbSgpO1xyXG4gICAgICAgIHJldHVybiBgLS0tXFxuJHtuZXdZQU1MfVxcbi0tLSR7Ym9keSA/IGBcXG4ke2JvZHl9YCA6IFwiXCJ9YDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlbmRlckZvbGRlclN0cnVjdHVyZShjb250YWluZXI6IEhUTUxFbGVtZW50LCBpdGVtczogKEZvbGRlckl0ZW0gfCBGaWxlSXRlbSlbXSwgaW5kZW50OiBudW1iZXIpIHtcclxuICAgICAgICBjb250YWluZXIuZW1wdHkoKTtcclxuICAgICAgICBpdGVtcy5mb3JFYWNoKGl0ZW0gPT4ge1xyXG4gICAgICAgICAgICBpdGVtLnR5cGUgPT09IFwiZm9sZGVyXCIgXHJcbiAgICAgICAgICAgICAgICA/IHRoaXMucmVuZGVyRm9sZGVySXRlbShjb250YWluZXIsIGl0ZW0sIGluZGVudClcclxuICAgICAgICAgICAgICAgIDogdGhpcy5yZW5kZXJGaWxlSXRlbShjb250YWluZXIsIGl0ZW0sIGluZGVudCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZW5kZXJGb2xkZXJJdGVtKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGZvbGRlcjogRm9sZGVySXRlbSwgaW5kZW50OiBudW1iZXIpIHtcclxuICAgICAgICBjb25zdCBpc0V4cGFuZGVkID0gdGhpcy5leHBhbmRlZEZvbGRlcnMuaGFzKGZvbGRlci5wYXRoKTtcclxuICAgICAgICBjb25zdCBmb2xkZXJFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoYGZvbGRlci1pdGVtICR7aXNFeHBhbmRlZCA/ICdmb2xkZXItZXhwYW5kZWQnIDogJyd9YCk7XHJcbiAgICAgICAgZm9sZGVyRWwuc3R5bGUubWFyZ2luTGVmdCA9IGAke2luZGVudCAqIDIwfXB4YDtcclxuICAgICAgICBmb2xkZXJFbC5kYXRhc2V0LnBhdGggPSBmb2xkZXIucGF0aDtcclxuXHJcbiAgICAgICAgY29uc3QgaGVhZGVyID0gZm9sZGVyRWwuY3JlYXRlRGl2KFwiZm9sZGVyLWhlYWRlclwiKTtcclxuICAgICAgICBjb25zdCBpY29uID0gaGVhZGVyLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgICAgICBjbHM6IFwiZm9sZGVyLWljb25cIixcclxuICAgICAgICAgICAgdGV4dDogaXNFeHBhbmRlZCA/IFwi4pa8XCIgOiBcIuKWtlwiXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgaWNvbi5vbmNsaWNrID0gKCkgPT4gdGhpcy50b2dnbGVGb2xkZXIoZm9sZGVyLnBhdGgsIGZvbGRlckVsKTtcclxuXHJcbiAgICAgICAgaGVhZGVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiBmb2xkZXIubmFtZSB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgY2hlY2tib3ggPSBoZWFkZXIuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiY2hlY2tib3hcIixcclxuICAgICAgICAgICAgY2xzOiBcImZvbGRlci1jaGVja2JveFwiXHJcbiAgICAgICAgfSkgYXMgSFRNTElucHV0RWxlbWVudDtcclxuICAgICAgICBjaGVja2JveC5jaGVja2VkID0gdGhpcy5pc0FsbENoaWxkcmVuU2VsZWN0ZWQoZm9sZGVyKTtcclxuICAgICAgICBjaGVja2JveC5vbmNoYW5nZSA9ICgpID0+IHRoaXMudG9nZ2xlRm9sZGVyU2VsZWN0aW9uKGZvbGRlciwgY2hlY2tib3guY2hlY2tlZCk7XHJcblxyXG4gICAgICAgIGNvbnN0IGNoaWxkcmVuRWwgPSBmb2xkZXJFbC5jcmVhdGVEaXYoXCJmb2xkZXItY2hpbGRyZW5cIik7XHJcbiAgICAgICAgaWYgKGlzRXhwYW5kZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXJGb2xkZXJTdHJ1Y3R1cmUoY2hpbGRyZW5FbCwgZm9sZGVyLmNoaWxkcmVuLCBpbmRlbnQgKyAxKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZW5kZXJGaWxlSXRlbShjb250YWluZXI6IEhUTUxFbGVtZW50LCBmaWxlSXRlbTogRmlsZUl0ZW0sIGluZGVudDogbnVtYmVyKSB7XHJcbiAgICAgICAgY29uc3QgZmlsZUVsID0gY29udGFpbmVyLmNyZWF0ZURpdihcImZpbGUtaXRlbVwiKTtcclxuICAgICAgICBmaWxlRWwuc3R5bGUubWFyZ2luTGVmdCA9IGAke2luZGVudCAqIDIwfXB4YDtcclxuXHJcbiAgICAgICAgY29uc3QgY2hlY2tib3ggPSBmaWxlRWwuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiY2hlY2tib3hcIixcclxuICAgICAgICAgICAgY2xzOiBcImZpbGUtY2hlY2tib3hcIlxyXG4gICAgICAgIH0pIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9IHRoaXMuc2VsZWN0ZWRGaWxlcy5pbmNsdWRlcyhmaWxlSXRlbS5maWxlKTtcclxuICAgICAgICBjaGVja2JveC5vbmNoYW5nZSA9ICgpID0+IHRoaXMudG9nZ2xlRmlsZVNlbGVjdGlvbihmaWxlSXRlbS5maWxlLCBjaGVja2JveC5jaGVja2VkKTtcclxuXHJcbiAgICAgICAgZmlsZUVsLmNyZWF0ZVNwYW4oeyB0ZXh0OiBmaWxlSXRlbS5maWxlLmJhc2VuYW1lIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgdG9nZ2xlRmlsZVNlbGVjdGlvbihmaWxlOiBURmlsZSwgc2VsZWN0ZWQ6IGJvb2xlYW4pIHtcclxuICAgICAgICB0aGlzLnNlbGVjdGVkRmlsZXMgPSBzZWxlY3RlZFxyXG4gICAgICAgICAgICA/IFsuLi50aGlzLnNlbGVjdGVkRmlsZXMsIGZpbGVdLmZpbHRlcigodiwgaSwgYSkgPT4gYS5pbmRleE9mKHYpID09PSBpKVxyXG4gICAgICAgICAgICA6IHRoaXMuc2VsZWN0ZWRGaWxlcy5maWx0ZXIoZiA9PiBmICE9PSBmaWxlKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHRvZ2dsZUZvbGRlcihwYXRoOiBzdHJpbmcsIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpIHtcclxuICAgICAgICBjb25zdCB3YXNFeHBhbmRlZCA9IHRoaXMuZXhwYW5kZWRGb2xkZXJzLmhhcyhwYXRoKTtcclxuICAgICAgICB0aGlzLmV4cGFuZGVkRm9sZGVyc1t3YXNFeHBhbmRlZCA/ICdkZWxldGUnIDogJ2FkZCddKHBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIOS/ruWkjeexu+Wei+mUmeivr++8mua3u+WKoOexu+Wei+aWreiogFxyXG4gICAgICAgIGNvbnN0IGNoaWxkcmVuQ29udGFpbmVyID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIuZm9sZGVyLWNoaWxkcmVuXCIpIGFzIEhUTUxFbGVtZW50O1xyXG4gICAgICAgIGNoaWxkcmVuQ29udGFpbmVyLmVtcHR5KCk7XHJcbiAgICAgICAgaWYgKCF3YXNFeHBhbmRlZCkge1xyXG4gICAgICAgICAgICBjb25zdCBmb2xkZXIgPSB0aGlzLmZpbmRGb2xkZXJCeVBhdGgocGF0aCk7XHJcbiAgICAgICAgICAgIGlmIChmb2xkZXIpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyRm9sZGVyU3RydWN0dXJlKFxyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuQ29udGFpbmVyLFxyXG4gICAgICAgICAgICAgICAgICAgIGZvbGRlci5jaGlsZHJlbixcclxuICAgICAgICAgICAgICAgICAgICBwYXJzZUludChjb250YWluZXIuc3R5bGUubWFyZ2luTGVmdCB8fCBcIjBcIikgLyAyMCArIDFcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGljb24gPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5mb2xkZXItaWNvblwiKSBhcyBIVE1MRWxlbWVudDtcclxuICAgICAgICBpY29uLnRleHRDb250ZW50ID0gd2FzRXhwYW5kZWQgPyBcIuKWtlwiIDogXCLilrxcIjtcclxuICAgICAgICBjb250YWluZXIuY2xhc3NMaXN0LnRvZ2dsZShcImZvbGRlci1leHBhbmRlZFwiLCAhd2FzRXhwYW5kZWQpO1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmZvbGRlckNvbGxhcHNlU3RhdGVbcGF0aF0gPSAhd2FzRXhwYW5kZWQ7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBmaW5kRm9sZGVyQnlQYXRoKHBhdGg6IHN0cmluZyk6IEZvbGRlckl0ZW0gfCB1bmRlZmluZWQge1xyXG4gICAgICAgIGNvbnN0IHdhbGsgPSAoaXRlbXM6IChGb2xkZXJJdGVtIHwgRmlsZUl0ZW0pW10pOiBGb2xkZXJJdGVtIHwgdW5kZWZpbmVkID0+IHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS50eXBlID09PSBcImZvbGRlclwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGl0ZW0ucGF0aCA9PT0gcGF0aCkgcmV0dXJuIGl0ZW07XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm91bmQgPSB3YWxrKGl0ZW0uY2hpbGRyZW4pO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgICAgICByZXR1cm4gd2Fsayh0aGlzLmZvbGRlclN0cnVjdHVyZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBpc0FsbENoaWxkcmVuU2VsZWN0ZWQoZm9sZGVyOiBGb2xkZXJJdGVtKTogYm9vbGVhbiB7XHJcbiAgICAgICAgY29uc3QgZmlsZXMgPSB0aGlzLmdldEZvbGRlckZpbGVzKGZvbGRlcik7XHJcbiAgICAgICAgcmV0dXJuIGZpbGVzLmV2ZXJ5KGYgPT4gdGhpcy5zZWxlY3RlZEZpbGVzLmluY2x1ZGVzKGYpKSAmJiBmaWxlcy5sZW5ndGggPiAwO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZ2V0Rm9sZGVyRmlsZXMoZm9sZGVyOiBGb2xkZXJJdGVtKTogVEZpbGVbXSB7XHJcbiAgICAgICAgY29uc3QgZmlsZXM6IFRGaWxlW10gPSBbXTtcclxuICAgICAgICBjb25zdCB3YWxrID0gKGl0ZW06IEZvbGRlckl0ZW0gfCBGaWxlSXRlbSkgPT4ge1xyXG4gICAgICAgICAgICBpZiAoaXRlbS50eXBlID09PSBcImZvbGRlclwiKSB7XHJcbiAgICAgICAgICAgICAgICBpdGVtLmNoaWxkcmVuLmZvckVhY2god2Fsayk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBmaWxlcy5wdXNoKGl0ZW0uZmlsZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgICAgIHdhbGsoZm9sZGVyKTtcclxuICAgICAgICByZXR1cm4gZmlsZXM7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSB0b2dnbGVGb2xkZXJTZWxlY3Rpb24oZm9sZGVyOiBGb2xkZXJJdGVtLCBzZWxlY3RlZDogYm9vbGVhbikge1xyXG4gICAgICAgIGNvbnN0IGZpbGVzID0gdGhpcy5nZXRGb2xkZXJGaWxlcyhmb2xkZXIpO1xyXG4gICAgICAgIHRoaXMuc2VsZWN0ZWRGaWxlcyA9IHNlbGVjdGVkXHJcbiAgICAgICAgICAgID8gWy4uLm5ldyBTZXQoWy4uLnRoaXMuc2VsZWN0ZWRGaWxlcywgLi4uZmlsZXNdKV1cclxuICAgICAgICAgICAgOiB0aGlzLnNlbGVjdGVkRmlsZXMuZmlsdGVyKGYgPT4gIWZpbGVzLmluY2x1ZGVzKGYpKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc2VsZWN0b3JQcmVmaXggPSBgW2RhdGEtcGF0aF49XCIke2ZvbGRlci5wYXRofS9cIl0gLmZpbGUtY2hlY2tib3hgO1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oc2VsZWN0b3JQcmVmaXgpLmZvckVhY2goY2IgPT4ge1xyXG4gICAgICAgICAgICBjYi5jaGVja2VkID0gc2VsZWN0ZWQ7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgb25DbG9zZSgpIHtcclxuICAgICAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgfVxyXG59XHJcbiJdLCJuYW1lcyI6WyJQbHVnaW5TZXR0aW5nVGFiIiwiU2V0dGluZyIsIlBsdWdpbiIsIk1vZGFsIiwiQnV0dG9uQ29tcG9uZW50IiwiTm90aWNlIl0sIm1hcHBpbmdzIjoiOzs7O0FBZ0JBLE1BQU0sZ0JB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
