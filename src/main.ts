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

// 新增语言类型定义
type AppLanguage = 'zh' | 'en';

interface TagJiaSettings {
    autoRefresh: boolean;
    folderCollapseState: Record<string, boolean>;
    language: AppLanguage; // 新增语言设置项
}

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
        fileProcessed: (count: number) => `✅ 成功处理 ${count} 个文件`,
        noFileSelected: "⚠️ 请至少选择一个文件",
        noTagsInput: "⚠️ 请输入要添加或删除的标签",
        folderName: (level: number) => level === 0 ? "全部文件" : "文件夹",
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
        fileProcessed: (count: number) => `✅ Processed ${count} files`,
        noFileSelected: "⚠️ Please select at least one file",
        noTagsInput: "⚠️ Please enter tags to add or remove",
        folderName: (level: number) => level === 0 ? "All Files" : "Folder",
        commandName: "Advanced Tag Manager"
    }
};

const DEFAULT_SETTINGS: TagJiaSettings = {
    autoRefresh: true,
    folderCollapseState: {},
    language: 'zh' // 添加缺失的language字段
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
            .setName("Language")
            .setDesc("Application display language")
            .addDropdown(dropdown => dropdown
                .addOption('zh', '中文')
                .addOption('en', 'English')
                .setValue(this.plugin.settings.language)
                .onChange(async (value) => {
                    this.plugin.settings.language = value as AppLanguage;
                    await this.plugin.saveSettings();
                    new Notice("Language changed - Restart required");
                }));

        new Setting(containerEl)
            .setName(this.plugin.t('autoRefresh'))
            .setDesc(this.plugin.t('refreshDesc'))
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

    t(key: keyof typeof LangResources['zh'], ...args: any[]): string {
        const lang = this.settings.language;
        const resource = LangResources[lang][key];
        
        if (typeof resource === 'function') {
            // 使用类型断言确保参数正确
            return (resource as (...args: any[]) => string)(...args);
        }
        return resource as string;
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
            name: this.t('commandName'),  // 在LangResources中需要添加对应键值
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
                let folder = current.children.find(
                    item => item.type === "folder" && item.path === path
                ) as FolderItem;
        
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
        
            current.children.push({ type: "file", file });  // 正确添加文件到当前层级
        });
        
        this.folderStructure = root.children;
        this.restoreCollapseState();
    }

    private restoreCollapseState() {
        this.expandedFolders.clear();  // ← 重要：先清空当前展开状态

        Object.entries(this.plugin.settings.folderCollapseState).forEach(
            ([path, isCollapsed]) => {  // ← 重命名参数明确含义
                // 反转逻辑：仅当保存的折叠状态为false时才展开
                if (!isCollapsed) {
                    this.expandedFolders.add(path);
                }
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
        new Setting(this.contentEl)
            .setName(this.plugin.t('removeTags'))
            .setDesc(this.plugin.t('removeTagDesc'))
            .addText(text => text
                .setValue(this.deleteTagInputValue)
                .setPlaceholder(`${this.plugin.t('example')}oldproject, archived`)
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

    // 修改按钮文字
    private renderFileTree() {
        const actionBar = this.contentEl.createDiv("action-bar");
        new ButtonComponent(actionBar)
            .setButtonText(`✅ ${this.plugin.t('selectAll')}`)
            .onClick(() => this.toggleAllSelection(true));
        new ButtonComponent(actionBar)
            .setButtonText(`❌ ${this.plugin.t('unselectAll')}`)
            .onClick(() => this.toggleAllSelection(false));

        // 添加文件树渲染代码（原缺失部分）
        const treeContainer = this.contentEl.createDiv("file-tree-container");
        this.renderFolderStructure(treeContainer, this.folderStructure, 0);
    }

    private createActionButtons() {
        this.contentEl.createEl("hr");
        new ButtonComponent(this.contentEl)
            .setButtonText(`💾 ${this.plugin.t('save')}`)
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

            new Notice(this.plugin.t('fileProcessed', this.selectedFiles.length));
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
            new Notice(this.plugin.t('noFileSelected'));
            return false;
        }

        const addEmpty = this.tagInputValue.trim() === "";
        const removeEmpty = this.deleteTagInputValue.trim() === "";
        
        if (addEmpty && removeEmpty) {
            new Notice(this.plugin.t('noTagsInput'));
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

        //lines.push(`updated: "${new Date().toISOString()}"`);
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
        const displayName = folder.path === ""
        ? this.plugin.t('folderName', 0)  // 正确的条件表达式
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
        fileEl.style.marginLeft = `${indent * 15}px`;  // 调整为更合理的缩进值

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
        // 更新逻辑：存储真正的折叠状态
        this.plugin.settings.folderCollapseState[path] = wasExpanded; // 当前状态反转为保存状态
        this.plugin.saveSettings();

        // 清除原有展开状态再重建
        if (wasExpanded) {
            this.expandedFolders.delete(path);
        } else {
            this.expandedFolders.add(path);
        }
    }

    private findFolderByPath(path: string): FolderItem | undefined {
        const walk = (items: (FolderItem | FileItem)[]): FolderItem | undefined => {
            for (const item of items) {
                if (item.type === "folder") {
                    // 直接匹配真实路径（不转换显示名称）
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
