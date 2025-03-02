import {
    App,
    ButtonComponent,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile
} from "obsidian";

interface TagJiaSettings {
    autoRefresh: boolean;
    folderCollapseState: Record<string, boolean>;
}

const DEFAULT_SETTINGS: TagJiaSettings = {
    autoRefresh: true,
    folderCollapseState: {}
};

interface FolderItem {
    type: "folder";
    path: string;
    name: string;
    children: (FolderItem | FileItem)[];
}

interface FileItem {
    type: "file";
    file: TFile;
}

class TagJiaSettingTab extends PluginSettingTab {
    plugin: TagJiaPlugin;

    constructor(app: App, plugin: TagJiaPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("自动刷新")
            .setDesc("修改文件后自动刷新文件列表")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoRefresh)
                .onChange(async value => {
                    this.plugin.settings.autoRefresh = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}

export default class TagJiaPlugin extends Plugin {
    settings!: TagJiaSettings;

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

class FileTagModal extends Modal {
    private plugin: TagJiaPlugin;
    private selectedFiles: TFile[] = [];
    private tagInputValue = "";
    private deleteTagInputValue = "";
    private folderStructure: (FolderItem | FileItem)[] = [];
    private expandedFolders = new Set<string>();
    private allTags: string[] = [];

    constructor(app: App, plugin: TagJiaPlugin) {
        super(app);
        this.plugin = plugin;
        this.buildFolderStructure();
    }

    private getAllTags(): Set<string> {
        const tags = new Set<string>();
        
	// 获取标签的更兼容方式（替代原来的getTags方法）
	const tagMap = this.app.metadataCache["tags"] as Record<string, number> || {}; 
	Object.keys(tagMap).forEach(fullTag => {
		const cleanTag = fullTag.split('/')[0].trim().replace(/^#/, '');
		if (cleanTag) tags.add(cleanTag);
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

    private parseFrontmatterTags(tags: any): string[] {
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

    private buildFolderStructure() {
        const root: FolderItem = {
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
                let folder = current.children.find(
                    item => item.type === "folder" && item.path === path
                ) as FolderItem;

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

    private restoreCollapseState() {
        Object.entries(this.plugin.settings.folderCollapseState).forEach(
            ([path, collapsed]) => {
                if (!collapsed) this.expandedFolders.add(path);
            }
        );
    }

    private renderModalContent() {
        this.contentEl.empty();
        this.contentEl.addClass("tagjia-modal");
        this.createFormInputs();
        this.renderFileTree();
        this.createActionButtons();
    }

    private createFormInputs() {
        const tagContainer = this.contentEl.createDiv("tag-input-container");
        const inputRow = tagContainer.createDiv("input-row");
        
        // 创建标签输入框
        const tagSetting = new Setting(inputRow)
            .setName("添加标签")
            .setDesc("用逗号分隔多个标签（输入时会有建议）");
        
        const tagInput = tagSetting.controlEl.createEl("input", {
            type: "text",
            cls: "tag-input",
            value: this.tagInputValue,
            placeholder: "示例：项目, 重要"
        }) as HTMLInputElement;

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
        new Setting(this.contentEl)
            .setName("删除标签")
            .setDesc("用逗号分隔要删除的标签（空则不删除）")
            .addText(text => text
                .setValue(this.deleteTagInputValue)
                .setPlaceholder("示例：旧项目, 已归档")
                .onChange(v => this.deleteTagInputValue = v));
    }

    private showSuggestions(
        container: HTMLDivElement,
        input: HTMLInputElement,
        suggestions: string[],
        currentInput: string
    ) {
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
                item.append(
                    tag.slice(0, matchIndex),
                    createSpan({ text: tag.slice(matchIndex, matchIndex + currentInput.length), cls: 'suggestion-match' }),
                    tag.slice(matchIndex + currentInput.length)
                );
            } else {
                item.textContent = tag;
            }

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.insertTag(tag, input, currentInput);
            });
        });

        const inputRect = input.getBoundingClientRect();
        const modalRect = this.contentEl.getBoundingClientRect();
        
        
        container.show();
    }

    private insertTag(selectedTag: string, input: HTMLInputElement, currentInput: string) {
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

    private renderFileTree() {
        const actionBar = this.contentEl.createDiv("action-bar");
        new ButtonComponent(actionBar)
            .setButtonText("✅ 全选").onClick(() => this.toggleAllSelection(true));
        new ButtonComponent(actionBar)
            .setButtonText("❌ 全不选").onClick(() => this.toggleAllSelection(false));

        const treeContainer = this.contentEl.createDiv();
        this.renderFolderStructure(treeContainer, this.folderStructure, 0);
    }

    private createActionButtons() {
        this.contentEl.createEl("hr");
        new ButtonComponent(this.contentEl)
            .setButtonText("💾 保存修改")
            .setCta()
            .onClick(() => {
                this.processFiles()
                    .then(() => this.close())
                    .catch((error) => {
                        new Notice(`❌ 操作失败: ${error instanceof Error ? error.message : String(error)}`);
                    });
            });
    }

    private toggleAllSelection(select: boolean) {
        this.selectedFiles = select ? [...this.app.vault.getMarkdownFiles()] : [];
        this.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
            .forEach(cb => cb.checked = select);
    }

    private async processFiles() {
        if (!this.validateInput()) return;

        const addTags = this.parseTags(this.tagInputValue);
        const removeTags = this.parseTags(this.deleteTagInputValue);

        try {
            await Promise.all(
                this.selectedFiles.map(file => 
                    this.processSingleFile(file, addTags, removeTags)
                )
            );

            new Notice(`✅ 成功处理 ${this.selectedFiles.length} 个文件`);
            if (this.plugin.settings.autoRefresh) {
                this.app.workspace.requestSaveLayout();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            throw new Error(`文件处理失败: ${errorMessage}`);
        }
    }

    private validateInput(): boolean {
        if (this.selectedFiles.length === 0) {
            new Notice("⚠️ 请至少选择一个文件");
            return false;
        }

        const addEmpty = this.tagInputValue.trim() === "";
        const removeEmpty = this.deleteTagInputValue.trim() === "";
        
        if (addEmpty && removeEmpty) {
            new Notice("⚠️ 请输入要添加或删除的标签");
            return false;
        }

        return true;
    }

    private parseTags(input: string): string[] {
        return input
            .split(/[,，]/g)
            .map(t => t.trim().replace(/#/g, ''))
            .filter(t => t.length > 0);
    }

    private async processSingleFile(file: TFile, addTags: string[], removeTags: string[]) {
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

    private getCurrentTags(tags: unknown): string[] {
        if (!tags) return [];
        if (Array.isArray(tags)) return tags.map(t => t.toString().trim());
        if (typeof tags === 'string') return this.parseTags(tags);
        return [];
    }


    private buildNewYAML(original: object, tags: string[]): string {
        const lines: string[] = [];
        const otherKeys = Object.keys(original).filter(k => k !== "tags");

        if (tags.length > 0) {
            lines.push("tags:");
            tags.forEach(t => lines.push(`  - ${t}`));
        }

        otherKeys.forEach(key => {
            const value = (original as any)[key];
            lines.push(`${key}: ${this.stringifyYAMLValue(value)}`);
        });

        lines.push(`updated: "${new Date().toISOString()}"`);
        return lines.join("\n");
    }

    private stringifyYAMLValue(value: unknown): string {
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return `[${value.map(v => `"${v}"`).join(", ")}]`;
        return JSON.stringify(value);
    }

    private replaceYAML(content: string, newYAML: string): string {
        const parts = content.split("---");
        const body = parts.slice(2).join("---").trim();
        return `---\n${newYAML}\n---${body ? `\n${body}` : ""}`;
    }

    private renderFolderStructure(container: HTMLElement, items: (FolderItem | FileItem)[], indent: number) {
        container.empty();
        items.forEach(item => {
            item.type === "folder" 
                ? this.renderFolderItem(container, item, indent)
                : this.renderFileItem(container, item, indent);
        });
    }

    private renderFolderItem(container: HTMLElement, folder: FolderItem, indent: number) {
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
        }) as HTMLInputElement;
        checkbox.checked = this.isAllChildrenSelected(folder);
        checkbox.onchange = () => this.toggleFolderSelection(folder, checkbox.checked);

        const childrenEl = folderEl.createDiv("folder-children");
        if (isExpanded) {
            this.renderFolderStructure(childrenEl, folder.children, indent + 1);
        }
    }

    private renderFileItem(container: HTMLElement, fileItem: FileItem, indent: number) {
        const fileEl = container.createDiv("file-item");
        fileEl.style.marginLeft = `${indent * 20}px`;

        const checkbox = fileEl.createEl("input", {
            type: "checkbox",
            cls: "file-checkbox"
        }) as HTMLInputElement;
        
        checkbox.checked = this.selectedFiles.includes(fileItem.file);
        checkbox.onchange = () => this.toggleFileSelection(fileItem.file, checkbox.checked);

        fileEl.createSpan({ text: fileItem.file.basename });
    }

    private toggleFileSelection(file: TFile, selected: boolean) {
        this.selectedFiles = selected
            ? [...this.selectedFiles, file].filter((v, i, a) => a.indexOf(v) === i)
            : this.selectedFiles.filter(f => f !== file);
    }

    private toggleFolder(path: string, container: HTMLElement) {
        const wasExpanded = this.expandedFolders.has(path);
        this.expandedFolders[wasExpanded ? 'delete' : 'add'](path);
        
        // 修复类型错误：添加类型断言
        const childrenContainer = container.querySelector(".folder-children") as HTMLElement;
        childrenContainer.empty();
        if (!wasExpanded) {
            const folder = this.findFolderByPath(path);
            if (folder) {
                this.renderFolderStructure(
                    childrenContainer,
                    folder.children,
                    parseInt(container.style.marginLeft || "0") / 20 + 1
                );
            }
        }

        const icon = container.querySelector(".folder-icon") as HTMLElement;
        icon.textContent = wasExpanded ? "▶" : "▼";
        container.classList.toggle("folder-expanded", !wasExpanded);
        this.plugin.settings.folderCollapseState[path] = !wasExpanded;
        this.plugin.saveSettings();
    }

    private findFolderByPath(path: string): FolderItem | undefined {
        const walk = (items: (FolderItem | FileItem)[]): FolderItem | undefined => {
            for (const item of items) {
                if (item.type === "folder") {
                    if (item.path === path) return item;
                    const found = walk(item.children);
                    if (found) return found;
                }
            }
        };
        return walk(this.folderStructure);
    }

    private isAllChildrenSelected(folder: FolderItem): boolean {
        const files = this.getFolderFiles(folder);
        return files.every(f => this.selectedFiles.includes(f)) && files.length > 0;
    }

    private getFolderFiles(folder: FolderItem): TFile[] {
        const files: TFile[] = [];
        const walk = (item: FolderItem | FileItem) => {
            if (item.type === "folder") {
                item.children.forEach(walk);
            } else {
                files.push(item.file);
            }
        };
        walk(folder);
        return files;
    }

    private toggleFolderSelection(folder: FolderItem, selected: boolean) {
        const files = this.getFolderFiles(folder);
        this.selectedFiles = selected
            ? [...new Set([...this.selectedFiles, ...files])]
            : this.selectedFiles.filter(f => !files.includes(f));

        const selectorPrefix = `[data-path^="${folder.path}/"] .file-checkbox`;
        this.contentEl.querySelectorAll<HTMLInputElement>(selectorPrefix).forEach(cb => {
            cb.checked = selected;
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
