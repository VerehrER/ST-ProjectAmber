/**
 * 角色提取功能模块
 * 从聊天历史中提取出场角色列表并保存到世界书
 */

// 依赖从主模块获取
let dependencies = null;
// 保存设置的回调
let saveSettingsCallback = null;

/**
 * 初始化模块依赖
 * @param {object} deps - 依赖对象
 */
export function init(deps) {
    dependencies = deps;
}

/**
 * 获取模块元信息
 */
export function getModuleInfo() {
    return {
        id: 'character-extract',
        name: '角色提取',
        description: '从聊天历史中提取出场角色列表',
        icon: '👥'
    };
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 获取位置显示文本
 */
function getPositionText(position, depth) {
    const positionMap = {
        0: '角色定义之前',
        1: '角色定义之后',
        2: '作者注释之前',
        3: '作者注释之后',
        4: `@ Depth ${depth || 4}`
    };
    return positionMap[position] || '角色定义之前';
}

/**
 * 构建角色提取的消息
 * @param {object} vars - 变量对象
 * @returns {Array}
 */
function buildExtractCharactersMessages(vars) {
    const { getSettings, defaultSettings } = dependencies;
    const settings = getSettings();
    const prompts = {
        u1: settings.promptU1 || defaultSettings.promptU1,
        a1: settings.promptA1 || defaultSettings.promptA1,
        u2: settings.promptU2 || defaultSettings.promptU2,
        a2: settings.promptA2 || defaultSettings.promptA2
    };
    
    const replaceVars = (template) => {
        return template
            .replace(/\{\{user\}\}/g, vars.userName || '{{user}}')
            .replace(/\{\{char\}\}/g, vars.charName || '{{char}}')
            .replace(/\{\{description\}\}/g, vars.description || '')
            .replace(/\{\{persona\}\}/g, vars.persona || '')
            .replace(/\{\{worldInfo\}\}/g, vars.worldInfo || '')
            .replace(/\{\{chatHistory\}\}/g, vars.chatHistory || '')
            .replace(/\{\{existingCharacters\}\}/g, vars.existingCharacters || '');
    };
    
    return [
        { role: 'user', content: replaceVars(prompts.u1) },
        { role: 'assistant', content: replaceVars(prompts.a1) },
        { role: 'user', content: replaceVars(prompts.u2) },
        { role: 'assistant', content: replaceVars(prompts.a2) }
    ];
}

/**
 * 获取当前世界书条目信息
 * @returns {Promise<{entry: object|null, worldbook: string|null}>}
 */
async function getCurrentWorldbookEntry() {
    const { getSettings, getCharacterWorldbook, loadWorldInfo, world_names } = dependencies;
    const settings = getSettings();
    const entryName = settings.characterListName || '出场角色列表';
    let targetBook = settings.targetWorldbook || getCharacterWorldbook();
    
    if (!targetBook || !world_names?.includes(targetBook)) {
        return { entry: null, worldbook: null };
    }
    
    try {
        const worldData = await loadWorldInfo(targetBook);
        if (!worldData?.entries) {
            return { entry: null, worldbook: targetBook, worldData };
        }
        
        const entriesArray = Object.values(worldData.entries);
        const entry = entriesArray.find(e => e && e.comment === entryName);
        
        return { entry: entry || null, worldbook: targetBook, worldData };
    } catch (e) {
        console.error(`[角色提取] 获取世界书条目失败:`, e);
        return { entry: null, worldbook: targetBook };
    }
}

/**
 * 获取已存在的角色列表（从世界书）
 * @returns {Promise<Array>}
 */
async function getExistingCharacters() {
    const { entry } = await getCurrentWorldbookEntry();
    
    if (!entry?.content) return [];
    
    // 尝试解析已有内容中的角色
    const existingNames = [];
    const lines = entry.content.split('\n');
    for (const line of lines) {
        const match = line.match(/^-?\s*name:\s*(.+)$/i) || line.match(/^\s*-\s*(.+?)[:：]/);
        if (match) {
            existingNames.push(match[1].trim());
        }
    }
    
    return existingNames;
}

/**
 * 保存条目内容到世界书
 * @param {string} content - 条目内容
 * @param {object} options - 条目属性选项
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function saveEntryToWorldbook(content, options = {}) {
    const { 
        getSettings, 
        getCharacterWorldbook, 
        loadWorldInfo, 
        saveWorldInfo,
        world_names
    } = dependencies;
    
    try {
        const settings = getSettings();
        const entryName = settings.characterListName || '出场角色列表';
        let targetBook = settings.targetWorldbook || getCharacterWorldbook();
        
        if (!targetBook || !world_names?.includes(targetBook)) {
            return { success: false, error: "未找到有效的世界书，请先绑定或选择世界书" };
        }

        const worldData = await loadWorldInfo(targetBook);
        if (!worldData) {
            return { success: false, error: `无法加载世界书: ${targetBook}` };
        }

        // 查找或创建条目
        let entry = null;
        
        if (worldData.entries && typeof worldData.entries === 'object') {
            const entriesArray = Object.values(worldData.entries);
            entry = entriesArray.find(e => e && e.comment === entryName);
        }

        if (!entry) {
            const { createWorldInfoEntry } = await import("../../../../world-info.js");
            entry = createWorldInfoEntry(targetBook, worldData);
            if (!entry) {
                return { success: false, error: "创建世界书条目失败" };
            }
        }

        // 设置条目属性
        const position = options.position ?? settings.characterListPosition ?? 0;
        Object.assign(entry, {
            comment: entryName,
            content: content,
            constant: true,
            selective: true,
            disable: false,
            position: position,
            depth: position === 4 ? (options.depth ?? settings.characterListDepth ?? 4) : undefined,
            order: options.order ?? settings.characterListOrder ?? 100,
        });

        await saveWorldInfo(targetBook, worldData, true);
        
        return { success: true, uid: String(entry.uid), worldbook: targetBook };
    } catch (e) {
        console.error(`[角色提取] 保存条目失败:`, e);
        return { success: false, error: e.message };
    }
}

/**
 * 追加角色到世界书
 * @param {Array} characters - 角色列表
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function appendCharactersToWorldbook(characters) {
    const { jsonToYaml } = dependencies;
    const { entry } = await getCurrentWorldbookEntry();
    
    const existingContent = entry?.content || '';
    const newContent = characters.map(char => jsonToYaml(char, 0)).join('\n\n');
    const finalContent = existingContent 
        ? `${existingContent.trim()}\n\n${newContent}\n\n`
        : `${newContent}\n\n`;
    
    return saveEntryToWorldbook(finalContent);
}

/**
 * 获取完整提示词预览数据
 * @returns {Promise<{messages: Array, vars: object}>}
 */
async function getPromptPreviewData() {
    const { getSettings, getContext, getChatHistory, getWorldInfoContent, power_user } = dependencies;
    const settings = getSettings();
    const ctx = getContext();
    
    const char = ctx.characters?.[ctx.characterId];
    const description = char?.description || char?.data?.description || '';
    const persona = power_user?.persona_description || '';
    const userName = ctx.name1 || '{{user}}';
    const charName = char?.name || ctx.name2 || '{{char}}';
    const chatHistory = getChatHistory(settings.historyCount || 50);
    const worldInfo = await getWorldInfoContent();
    const existingNames = await getExistingCharacters();
    const existingCharacters = existingNames.length > 0 
        ? `\n\n**已存在角色（不要重复）：** ${existingNames.join('、')}`
        : '';
    
    const vars = {
        userName,
        charName,
        description,
        persona,
        worldInfo,
        chatHistory,
        existingCharacters
    };
    
    const messages = buildExtractCharactersMessages(vars);
    
    return { messages, vars };
}

/**
 * 执行角色列表提取（返回解析结果，不直接保存）
 * @param {function} showStatus - 状态显示回调
 * @returns {Promise<{success: boolean, characters?: Array, error?: string}>}
 */
async function runExtraction(showStatus) {
    const { callLLMJson } = dependencies;
    
    showStatus("正在提取角色列表...");
    
    try {
        const { messages } = await getPromptPreviewData();
        const existingNames = await getExistingCharacters();
        
        console.log(`[角色提取] 开始提取角色...`);
        
        const result = await callLLMJson(messages, true);
        
        if (!result || !Array.isArray(result)) {
            showStatus("未能提取到角色数据", true);
            return { success: false, error: "未能提取到角色数据" };
        }
        
        if (result.length === 0) {
            showStatus("没有发现新角色");
            return { success: true, characters: [] };
        }
        
        // 过滤掉已存在的角色
        const newCharacters = result.filter(c => 
            c.name && !existingNames.some(en => 
                en.toLowerCase() === c.name.toLowerCase()
            )
        );
        
        if (newCharacters.length === 0) {
            showStatus("没有发现新角色（所有角色已存在）");
            return { success: true, characters: [], message: "所有角色已存在" };
        }
        
        console.log(`[角色提取] 发现 ${newCharacters.length} 个新角色:`, newCharacters);
        showStatus(`发现 ${newCharacters.length} 个新角色`);
        
        return { success: true, characters: newCharacters };
        
    } catch (e) {
        console.error(`[角色提取] 提取角色失败:`, e);
        showStatus(`提取失败: ${e.message}`, true);
        return { success: false, error: e.message };
    }
}

/**
 * 执行角色列表提取（兼容旧API）
 * @param {function} showStatus - 状态显示回调
 */
export async function extractCharacterList(showStatus) {
    const result = await runExtraction(showStatus);
    
    if (result.success && result.characters && result.characters.length > 0) {
        const saveResult = await appendCharactersToWorldbook(result.characters);
        if (saveResult.success) {
            showStatus(`成功添加 ${result.characters.length} 个角色到世界书`);
        } else {
            showStatus(saveResult.error, true);
        }
        return saveResult;
    }
    
    return result;
}

/**
 * 显示主弹窗
 */
export function showModal() {
    $('#jtw-character-extract-modal').fadeIn(200);
    // 默认显示第一个标签页
    switchTab('entry');
    // 加载条目内容
    loadEntryContent();
}

/**
 * 隐藏主弹窗
 */
function hideModal() {
    $('#jtw-character-extract-modal').fadeOut(200);
}

/**
 * 切换标签页
 */
function switchTab(tabName) {
    $('.jtw-ce-tab').removeClass('active');
    $(`.jtw-ce-tab[data-tab="${tabName}"]`).addClass('active');
    $('.jtw-ce-tab-content').removeClass('active');
    $(`#jtw-ce-tab-${tabName}`).addClass('active');
}

/**
 * 加载条目内容到编辑区
 */
async function loadEntryContent() {
    const { getSettings } = dependencies;
    const settings = getSettings();
    const { entry, worldbook } = await getCurrentWorldbookEntry();
    
    const $emptyHint = $('#jtw-ce-entry-empty');
    const $editor = $('#jtw-ce-entry-editor');
    const $content = $('#jtw-ce-entry-content');
    const $info = $('#jtw-ce-entry-info');
    
    if (!entry || !entry.content) {
        $emptyHint.show();
        $editor.hide();
        return;
    }
    
    $emptyHint.hide();
    $editor.show();
    $content.val(entry.content);
    
    // 显示条目信息
    const positionText = getPositionText(entry.position, entry.depth);
    $info.html(`
        <span><strong>世界书:</strong> ${escapeHtml(worldbook || '未知')}</span>
        <span><strong>条目名称:</strong> ${escapeHtml(settings.characterListName || '出场角色列表')}</span>
        <span><strong>位置:</strong> ${positionText}</span>
        <span><strong>排序:</strong> ${entry.order || 100}</span>
    `);
}

/**
 * 保存条目编辑
 */
async function saveEntryEdit() {
    const content = $('#jtw-ce-entry-content').val();
    const $saveBtn = $('#jtw-ce-save-entry');
    const $status = $('#jtw-ce-entry-status');
    
    $saveBtn.prop('disabled', true).text('保存中...');
    
    const result = await saveEntryToWorldbook(content);
    
    if (result.success) {
        $status.text('保存成功').removeClass('error').addClass('success').show();
    } else {
        $status.text(result.error).removeClass('success').addClass('error').show();
    }
    
    $saveBtn.prop('disabled', false).text('保存修改');
    setTimeout(() => $status.fadeOut(), 3000);
}

/**
 * 加载提示词预览
 */
async function loadPromptPreview() {
    const $container = $('#jtw-ce-prompt-preview');
    $container.html('<div class="jtw-ce-loading">加载中...</div>');
    
    try {
        const { messages } = await getPromptPreviewData();
        
        const htmlContent = messages
            .filter(m => m.content)
            .map((msg, idx) => {
                const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
                const roleClass = msg.role === 'user' ? 'user' : 'assistant';
                return `
                    <div class="jtw-prompt-message jtw-prompt-${roleClass}">
                        <div class="jtw-prompt-role">${roleLabel} 消息 ${Math.floor(idx / 2) + 1}</div>
                        <div class="jtw-prompt-content">${escapeHtml(msg.content)}</div>
                    </div>
                `;
            }).join('');
        
        $container.html(htmlContent || '<div class="jtw-ce-empty">没有提示词内容</div>');
    } catch (e) {
        $container.html(`<div class="jtw-ce-error">加载失败: ${escapeHtml(e.message)}</div>`);
    }
}

/**
 * 显示提取结果弹窗
 * @param {Array} characters - 提取到的角色列表
 */
function showResultModal(characters) {
    const { jsonToYaml } = dependencies;
    const content = characters.map(char => jsonToYaml(char, 0)).join('\n\n');
    $('#jtw-ce-result-content').val(content);
    $('#jtw-ce-result-count').text(`提取到 ${characters.length} 个新角色`);
    $('#jtw-ce-result-modal').fadeIn(200);
}

/**
 * 隐藏提取结果弹窗
 */
function hideResultModal() {
    $('#jtw-ce-result-modal').fadeOut(200);
}

/**
 * 显示提示词预览弹窗
 */
async function showPromptModal() {
    $('#jtw-ce-prompt-modal').fadeIn(200);
    await loadPromptPreview();
}

/**
 * 隐藏提示词预览弹窗
 */
function hidePromptModal() {
    $('#jtw-ce-prompt-modal').fadeOut(200);
}

/**
 * 保存提取结果
 */
async function saveExtractionResult() {
    const content = $('#jtw-ce-result-content').val();
    const $saveBtn = $('#jtw-ce-result-save');
    const $status = $('#jtw-ce-result-status');
    
    if (!content.trim()) {
        $status.text('内容不能为空').removeClass('success').addClass('error').show();
        setTimeout(() => $status.fadeOut(), 3000);
        return;
    }
    
    $saveBtn.prop('disabled', true).text('保存中...');
    
    // 追加到现有内容
    const { entry } = await getCurrentWorldbookEntry();
    const existingContent = entry?.content || '';
    const finalContent = existingContent 
        ? `${existingContent.trim()}\n\n${content.trim()}\n\n`
        : `${content.trim()}\n\n`;
    
    const result = await saveEntryToWorldbook(finalContent);
    
    if (result.success) {
        $status.text('保存成功').removeClass('error').addClass('success').show();
        setTimeout(() => {
            hideResultModal();
            loadEntryContent(); // 刷新条目内容
        }, 1000);
    } else {
        $status.text(result.error).removeClass('success').addClass('error').show();
    }
    
    $saveBtn.prop('disabled', false).text('保存到世界书');
    setTimeout(() => $status.fadeOut(), 3000);
}

/**
 * 运行提取并显示结果
 */
async function runAndShowResult() {
    const $btn = $('#jtw-ce-run-extract');
    const $status = $('#jtw-ce-settings-status');
    
    $btn.prop('disabled', true).text('提取中...');
    
    const result = await runExtraction((msg, isError) => {
        $status.text(msg)
            .removeClass('success error')
            .addClass(isError ? 'error' : 'success')
            .show();
    });
    
    $btn.prop('disabled', false).text('运行提取');
    
    if (result.success && result.characters && result.characters.length > 0) {
        showResultModal(result.characters);
    }
    
    setTimeout(() => $status.fadeOut(), 5000);
}

/**
 * 渲染设置面板 HTML（仅用于故事助手列表显示，实际功能在弹窗中）
 * @returns {string}
 */
export function renderSettingsPanel() {
    return `
        <div class="jtw-assistant-feature-content" id="jtw-character-extract-settings" style="display: none;">
            <!-- 这里不再需要内容，点击后直接打开弹窗 -->
        </div>
        
        <!-- 角色提取主弹窗 -->
        <div id="jtw-character-extract-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content jtw-ce-modal-content">
                <div class="jtw-modal-header">
                    <h3>👥 角色提取</h3>
                    <button class="jtw-modal-close jtw-ce-close-modal">✕</button>
                </div>
                
                <!-- 标签页导航 -->
                <div class="jtw-ce-tabs">
                    <button class="jtw-ce-tab active" data-tab="entry">条目内容</button>
                    <button class="jtw-ce-tab" data-tab="settings">设置</button>
                </div>
                
                <div class="jtw-modal-body">
                    <!-- 条目内容页 -->
                    <div class="jtw-ce-tab-content active" id="jtw-ce-tab-entry">
                        <div id="jtw-ce-entry-empty" class="jtw-ce-empty-hint" style="display: none;">
                            <div class="jtw-ce-empty-icon">📋</div>
                            <div class="jtw-ce-empty-text">尚未生成角色列表条目</div>
                            <div class="jtw-ce-empty-hint-text">请前往「设置」页面配置并运行提取</div>
                            <button class="jtw-btn primary jtw-ce-goto-settings">前往设置</button>
                        </div>
                        <div id="jtw-ce-entry-editor" style="display: none;">
                            <div id="jtw-ce-entry-info" class="jtw-ce-entry-info"></div>
                            <textarea id="jtw-ce-entry-content" class="jtw-ce-textarea" rows="18" placeholder="条目内容..."></textarea>
                            <div class="jtw-ce-actions">
                                <div id="jtw-ce-entry-status" class="jtw-status" style="display: none;"></div>
                                <button id="jtw-ce-save-entry" class="jtw-btn primary">保存修改</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 设置页 -->
                    <div class="jtw-ce-tab-content" id="jtw-ce-tab-settings">
                        <div class="jtw-ce-settings-grid">
                            <!-- 左侧：基本设置和世界书设置 -->
                            <div class="jtw-ce-settings-left">
                                <div class="jtw-section">
                                    <h4>基本设置</h4>
                                    <div style="margin-bottom: 10px;">
                                        <label>条目名称</label>
                                        <input type="text" id="jtw-ce-entry-name" class="jtw-input" placeholder="出场角色列表" />
                                    </div>
                                </div>
                                
                                <div class="jtw-section">
                                    <h4>世界书设置</h4>
                                    <div style="margin-bottom: 10px;">
                                        <label>条目位置</label>
                                        <select id="jtw-ce-position" class="jtw-select">
                                            <option value="0">角色定义之前</option>
                                            <option value="1">角色定义之后</option>
                                            <option value="2">作者注释之前</option>
                                            <option value="3">作者注释之后</option>
                                            <option value="4">@ Depth</option>
                                        </select>
                                    </div>
                                    <div id="jtw-ce-depth-container" style="margin-bottom: 10px; display: none;">
                                        <label>深度值 (Depth)</label>
                                        <input type="number" id="jtw-ce-depth" class="jtw-input" value="4" min="0" max="999" />
                                    </div>
                                    <div style="margin-bottom: 10px;">
                                        <label>排序优先级</label>
                                        <input type="number" id="jtw-ce-order" class="jtw-input" value="100" min="0" />
                                    </div>
                                </div>
                                
                                <div class="jtw-ce-run-section">
                                    <button id="jtw-ce-run-extract" class="jtw-btn primary">运行提取</button>
                                    <button id="jtw-ce-preview-prompt" class="jtw-btn" style="margin-top: 8px;">📋 预览完整提示词</button>
                                    <div id="jtw-ce-settings-status" class="jtw-status" style="display: none;"></div>
                                </div>
                            </div>
                            
                            <!-- 右侧：提示词设置 -->
                            <div class="jtw-ce-settings-right">
                                <div class="jtw-section jtw-ce-prompts-section">
                                    <h4>提示词设置</h4>
                                    <div style="margin-bottom: 8px;">
                                        <label>User 消息 1</label>
                                        <textarea id="jtw-ce-prompt-u1" class="jtw-input" rows="2"></textarea>
                                    </div>
                                    <div style="margin-bottom: 8px;">
                                        <label>Assistant 消息 1</label>
                                        <textarea id="jtw-ce-prompt-a1" class="jtw-input" rows="2"></textarea>
                                    </div>
                                    <div style="margin-bottom: 8px;">
                                        <label>User 消息 2</label>
                                        <textarea id="jtw-ce-prompt-u2" class="jtw-input" rows="9"></textarea>
                                    </div>
                                    <div style="margin-bottom: 8px;">
                                        <label>Assistant 消息 2</label>
                                        <textarea id="jtw-ce-prompt-a2" class="jtw-input" rows="1"></textarea>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- 提取结果弹窗 -->
        <div id="jtw-ce-result-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content jtw-ce-result-modal-content">
                <div class="jtw-modal-header">
                    <h3>📝 提取结果</h3>
                    <button class="jtw-modal-close jtw-ce-close-result">✕</button>
                </div>
                <div class="jtw-modal-body">
                    <div id="jtw-ce-result-count" class="jtw-ce-result-count"></div>
                    <textarea id="jtw-ce-result-content" class="jtw-ce-textarea" rows="16" placeholder="提取到的角色数据..."></textarea>
                    <div class="jtw-ce-result-hint">您可以在保存前修改上述内容</div>
                    <div class="jtw-ce-actions">
                        <div id="jtw-ce-result-status" class="jtw-status" style="display: none;"></div>
                        <button class="jtw-btn jtw-ce-close-result">取消</button>
                        <button id="jtw-ce-result-save" class="jtw-btn primary">保存到世界书</button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- 提示词预览弹窗 -->
        <div id="jtw-ce-prompt-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content jtw-ce-prompt-modal-content">
                <div class="jtw-modal-header">
                    <h3>📋 完整提示词预览</h3>
                    <button class="jtw-modal-close jtw-ce-close-prompt">✕</button>
                </div>
                <div class="jtw-modal-body">
                    <div id="jtw-ce-prompt-preview" class="jtw-ce-prompt-preview">
                        <div class="jtw-ce-loading">加载中...</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 初始化设置面板事件绑定
 * @param {function} saveSettings - 保存设置回调
 */
export function initSettingsEvents(saveSettings) {
    saveSettingsCallback = saveSettings;
    const { getSettings, defaultSettings } = dependencies;
    const settings = getSettings();
    
    // 关闭主弹窗
    $('.jtw-ce-close-modal').on('click', hideModal);
    $('#jtw-character-extract-modal').on('click', function(e) {
        if (e.target === this) hideModal();
    });
    
    // 关闭结果弹窗
    $('.jtw-ce-close-result').on('click', hideResultModal);
    $('#jtw-ce-result-modal').on('click', function(e) {
        if (e.target === this) hideResultModal();
    });
    
    // 关闭提示词预览弹窗
    $('.jtw-ce-close-prompt').on('click', hidePromptModal);
    $('#jtw-ce-prompt-modal').on('click', function(e) {
        if (e.target === this) hidePromptModal();
    });
    
    // 标签页切换
    $('.jtw-ce-tab').on('click', function() {
        const tab = $(this).data('tab');
        switchTab(tab);
        if (tab === 'settings') {
            // 切换到设置页时不自动加载预览，等用户点击刷新
        }
    });
    
    // 前往设置按钮
    $('.jtw-ce-goto-settings').on('click', function() {
        switchTab('settings');
    });
    
    // 保存条目编辑
    $('#jtw-ce-save-entry').on('click', saveEntryEdit);
    
    // 预览提示词弹窗
    $('#jtw-ce-preview-prompt').on('click', showPromptModal);
    
    // 运行提取
    $('#jtw-ce-run-extract').on('click', runAndShowResult);
    
    // 保存提取结果
    $('#jtw-ce-result-save').on('click', saveExtractionResult);
    
    // 条目名称
    $('#jtw-ce-entry-name').val(settings.characterListName || '出场角色列表').on('change', function() {
        settings.characterListName = $(this).val();
        saveSettings();
    });
    
    // 提示词设置
    const defaultU1 = defaultSettings.promptU1;
    const defaultA1 = defaultSettings.promptA1;
    const defaultU2 = defaultSettings.promptU2;
    const defaultA2 = defaultSettings.promptA2;
    
    $('#jtw-ce-prompt-u1').val(settings.promptU1 || defaultU1).on('change', function() {
        settings.promptU1 = $(this).val();
        saveSettings();
    });
    
    $('#jtw-ce-prompt-a1').val(settings.promptA1 || defaultA1).on('change', function() {
        settings.promptA1 = $(this).val();
        saveSettings();
    });
    
    $('#jtw-ce-prompt-u2').val(settings.promptU2 || defaultU2).on('change', function() {
        settings.promptU2 = $(this).val();
        saveSettings();
    });
    
    $('#jtw-ce-prompt-a2').val(settings.promptA2 || defaultA2).on('change', function() {
        settings.promptA2 = $(this).val();
        saveSettings();
    });
    
    // 条目位置
    $('#jtw-ce-position').val(settings.characterListPosition || 0).on('change', function() {
        settings.characterListPosition = parseInt($(this).val());
        if (settings.characterListPosition === 4) {
            $('#jtw-ce-depth-container').show();
        } else {
            $('#jtw-ce-depth-container').hide();
        }
        saveSettings();
    });
    
    if (settings.characterListPosition === 4) {
        $('#jtw-ce-depth-container').show();
    }
    
    $('#jtw-ce-depth').val(settings.characterListDepth || 4).on('change', function() {
        settings.characterListDepth = parseInt($(this).val()) || 4;
        saveSettings();
    });
    
    $('#jtw-ce-order').val(settings.characterListOrder || 100).on('change', function() {
        settings.characterListOrder = parseInt($(this).val()) || 100;
        saveSettings();
    });
}

/**
 * 模块被点击时的处理（覆盖默认行为）
 */
export function onModuleClick() {
    showModal();
    return false; // 返回 false 阻止默认的面板切换行为
}
