/**
 * 角色提取功能模块
 * 从聊天历史中提取出场角色列表并保存到世界书
 */

// 依赖从主模块获取
let dependencies = null;

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
 * 获取已存在的角色列表（从世界书）
 * @returns {Promise<Array>}
 */
async function getExistingCharacters() {
    const { getSettings, getCharacterWorldbook, loadWorldInfo } = dependencies;
    const settings = getSettings();
    let targetBook = settings.targetWorldbook || getCharacterWorldbook();
    
    if (!targetBook) return [];
    
    try {
        const worldData = await loadWorldInfo(targetBook);
        if (!worldData?.entries) return [];
        
        const entriesArray = Object.values(worldData.entries);
        const characterListEntry = entriesArray.find(e => e && e.comment === settings.characterListName);
        
        if (!characterListEntry?.content) return [];
        
        // 尝试解析已有内容中的角色
        const existingNames = [];
        const lines = characterListEntry.content.split('\n');
        for (const line of lines) {
            const match = line.match(/^-?\s*name:\s*(.+)$/i) || line.match(/^\s*-\s*(.+?)[:：]/);
            if (match) {
                existingNames.push(match[1].trim());
            }
        }
        
        return existingNames;
    } catch (e) {
        console.error(`[角色提取] 获取已有角色失败:`, e);
        return [];
    }
}

/**
 * 保存角色列表到世界书（追加模式）
 * @param {Array} characters - 角色列表
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function saveCharacterListToWorldbook(characters) {
    const { 
        getSettings, 
        getCharacterWorldbook, 
        loadWorldInfo, 
        saveWorldInfo,
        jsonToYaml,
        world_names
    } = dependencies;
    
    try {
        const settings = getSettings();
        const entryName = settings.characterListName || '出场角色列表';
        
        // 确定目标世界书
        let targetBook = settings.targetWorldbook || getCharacterWorldbook();
        
        if (!targetBook || !world_names?.includes(targetBook)) {
            return { success: false, error: "未找到有效的世界书，请先绑定或选择世界书" };
        }

        // 加载世界书
        const worldData = await loadWorldInfo(targetBook);
        if (!worldData) {
            return { success: false, error: `无法加载世界书: ${targetBook}` };
        }

        // 查找或创建条目
        let entry = null;
        let existingContent = '';
        
        if (worldData.entries && typeof worldData.entries === 'object') {
            const entriesArray = Object.values(worldData.entries);
            const existingEntry = entriesArray.find(e => e && e.comment === entryName);
            if (existingEntry) {
                entry = existingEntry;
                existingContent = entry.content || '';
                console.log(`[角色提取] 找到已有条目，将追加内容`);
            }
        }

        // 如果不存在，创建新条目
        if (!entry) {
            const { createWorldInfoEntry } = await import("../../../../world-info.js");
            entry = createWorldInfoEntry(targetBook, worldData);
            if (!entry) {
                return { success: false, error: "创建世界书条目失败" };
            }
        }

        // 格式化新角色内容（使用 YAML 格式）
        const newContent = characters.map(char => jsonToYaml(char, 0)).join('\n\n');

        // 合并内容（追加到底部）
        const finalContent = existingContent 
            ? `${existingContent.trim()}\n\n${newContent}\n\n`
            : `${newContent}\n\n`;

        // 设置条目属性
        const position = settings.characterListPosition ?? 0;
        Object.assign(entry, {
            comment: entryName,
            content: finalContent,
            constant: true,
            selective: true,
            disable: false,
            position: position,
            depth: position === 4 ? (settings.characterListDepth ?? 4) : undefined,
            order: settings.characterListOrder ?? 100,
        });

        // 保存世界书
        await saveWorldInfo(targetBook, worldData, true);

        console.log(`[角色提取] 角色列表已保存到 ${targetBook}, UID: ${entry.uid}`);
        
        return { success: true, uid: String(entry.uid), worldbook: targetBook, count: characters.length };
    } catch (e) {
        console.error(`[角色提取] 保存角色列表失败:`, e);
        return { success: false, error: e.message };
    }
}

/**
 * 执行角色列表提取
 * @param {function} showStatus - 状态显示回调
 */
export async function extractCharacterList(showStatus) {
    const { 
        getSettings, 
        getContext, 
        getChatHistory, 
        getWorldInfoContent, 
        callLLMJson,
        power_user 
    } = dependencies;
    
    const settings = getSettings();
    const ctx = getContext();
    
    showStatus("正在提取角色列表...");
    
    try {
        // 获取基本信息
        const char = ctx.characters?.[ctx.characterId];
        const description = char?.description || char?.data?.description || '';
        const persona = power_user?.persona_description || '';
        const userName = ctx.name1 || '{{user}}';
        const charName = char?.name || ctx.name2 || '{{char}}';
        
        // 获取聊天历史
        const chatHistory = getChatHistory(settings.historyCount || 50);
        
        // 获取世界书内容
        const worldInfo = await getWorldInfoContent();
        
        // 获取已有角色
        const existingNames = await getExistingCharacters();
        const existingCharacters = existingNames.length > 0 
            ? `\n\n**已存在角色（不要重复）：** ${existingNames.join('、')}`
            : '';
        
        // 构建消息
        const messages = buildExtractCharactersMessages({
            userName,
            charName,
            description,
            persona,
            worldInfo,
            chatHistory,
            existingCharacters
        });
        
        console.log(`[角色提取] 开始提取角色...`);
        
        // 调用 LLM
        const result = await callLLMJson(messages, true);
        
        if (!result || !Array.isArray(result)) {
            showStatus("未能提取到角色数据", true);
            return { success: false, error: "未能提取到角色数据" };
        }
        
        if (result.length === 0) {
            showStatus("没有发现新角色");
            return { success: true, count: 0 };
        }
        
        // 过滤掉已存在的角色
        const newCharacters = result.filter(c => 
            c.name && !existingNames.some(en => 
                en.toLowerCase() === c.name.toLowerCase()
            )
        );
        
        if (newCharacters.length === 0) {
            showStatus("没有发现新角色（所有角色已存在）");
            return { success: true, count: 0, message: "所有角色已存在" };
        }
        
        console.log(`[角色提取] 发现 ${newCharacters.length} 个新角色:`, newCharacters);
        
        // 保存到世界书
        const saveResult = await saveCharacterListToWorldbook(newCharacters);
        
        if (saveResult.success) {
            showStatus(`成功添加 ${saveResult.count} 个角色到「出场角色列表」`);
            return saveResult;
        } else {
            showStatus(saveResult.error, true);
            return saveResult;
        }
        
    } catch (e) {
        console.error(`[角色提取] 提取角色失败:`, e);
        showStatus(`提取失败: ${e.message}`, true);
        return { success: false, error: e.message };
    }
}

/**
 * 渲染设置面板 HTML
 * @returns {string}
 */
export function renderSettingsPanel() {
    return `
        <div class="jtw-assistant-feature-content" id="jtw-character-extract-settings" style="display: none;">
            <div class="jtw-assistant-back-header">
                <button class="jtw-btn jtw-btn-small jtw-assistant-back-btn">← 返回列表</button>
                <h4>👥 角色提取设置</h4>
            </div>
            
            <div class="jtw-section">
                <h4>基本设置</h4>
                <div style="margin-bottom: 10px;">
                    <label>条目名称</label>
                    <input type="text" id="jtw-character-list-name" class="jtw-input" placeholder="出场角色列表" />
                </div>
            </div>
            
            <div class="jtw-section">
                <h4>提示词设置</h4>
                <button id="jtw-toggle-prompts" class="jtw-btn" style="margin-bottom: 10px;">展开自定义提示词</button>
                <div id="jtw-prompts-container" style="display: none;">
                    <div style="margin-bottom: 10px;">
                        <label>User 消息 1</label>
                        <textarea id="jtw-prompt-u1" class="jtw-input" rows="2"></textarea>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label>Assistant 消息 1</label>
                        <textarea id="jtw-prompt-a1" class="jtw-input" rows="2"></textarea>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label>User 消息 2</label>
                        <textarea id="jtw-prompt-u2" class="jtw-input" rows="8"></textarea>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label>Assistant 消息 2</label>
                        <textarea id="jtw-prompt-a2" class="jtw-input" rows="1"></textarea>
                    </div>
                </div>
            </div>
            
            <div class="jtw-section">
                <h4>世界书设置</h4>
                <div style="margin-bottom: 10px;">
                    <label>条目位置</label>
                    <select id="jtw-character-list-position" class="jtw-select">
                        <option value="0">角色定义之前</option>
                        <option value="1">角色定义之后</option>
                        <option value="2">作者注释之前</option>
                        <option value="3">作者注释之后</option>
                        <option value="4">@ Depth</option>
                    </select>
                </div>
                <div id="jtw-character-list-depth-container" style="margin-bottom: 10px; display: none;">
                    <label>深度值 (Depth)</label>
                    <input type="number" id="jtw-character-list-depth" class="jtw-input" value="4" min="0" max="999" />
                </div>
                <div style="margin-bottom: 10px;">
                    <label>排序优先级</label>
                    <input type="number" id="jtw-character-list-order" class="jtw-input" value="100" min="0" />
                </div>
            </div>
            
            <div class="jtw-section">
                <h4>执行操作</h4>
                <button id="jtw-extract-characters" class="jtw-btn primary">提取出场角色列表</button>
                <div id="jtw-character-extract-status" class="jtw-status" style="display: none;"></div>
            </div>
        </div>
    `;
}

/**
 * 初始化设置面板事件绑定
 * @param {function} saveSettings - 保存设置回调
 */
export function initSettingsEvents(saveSettings) {
    const { getSettings, defaultSettings } = dependencies;
    const settings = getSettings();
    
    // 角色列表设置
    $('#jtw-character-list-name').val(settings.characterListName || '出场角色列表').on('change', function() {
        settings.characterListName = $(this).val();
        saveSettings();
    });
    
    // 提示词设置（设置初始值）
    const defaultU1 = defaultSettings.promptU1;
    const defaultA1 = defaultSettings.promptA1;
    const defaultU2 = defaultSettings.promptU2;
    const defaultA2 = defaultSettings.promptA2;
    
    $('#jtw-prompt-u1').val(settings.promptU1 || defaultU1).on('change', function() {
        settings.promptU1 = $(this).val();
        saveSettings();
    });
    
    $('#jtw-prompt-a1').val(settings.promptA1 || defaultA1).on('change', function() {
        settings.promptA1 = $(this).val();
        saveSettings();
    });
    
    $('#jtw-prompt-u2').val(settings.promptU2 || defaultU2).on('change', function() {
        settings.promptU2 = $(this).val();
        saveSettings();
    });
    
    $('#jtw-prompt-a2').val(settings.promptA2 || defaultA2).on('change', function() {
        settings.promptA2 = $(this).val();
        saveSettings();
    });
    
    // 提示词折叠按钮
    $('#jtw-toggle-prompts').on('click', function() {
        const $container = $('#jtw-prompts-container');
        const $button = $(this);
        if ($container.is(':visible')) {
            $container.slideUp();
            $button.text('展开自定义提示词');
        } else {
            $container.slideDown();
            $button.text('收起自定义提示词');
        }
    });
    
    $('#jtw-character-list-position').val(settings.characterListPosition || 0).on('change', function() {
        settings.characterListPosition = parseInt($(this).val());
        // 显示/隐藏深度输入框
        if (settings.characterListPosition === 4) {
            $('#jtw-character-list-depth-container').show();
        } else {
            $('#jtw-character-list-depth-container').hide();
        }
        saveSettings();
    });
    
    // 初始化深度输入框显示状态
    if (settings.characterListPosition === 4) {
        $('#jtw-character-list-depth-container').show();
    }
    
    $('#jtw-character-list-depth').val(settings.characterListDepth || 4).on('change', function() {
        settings.characterListDepth = parseInt($(this).val()) || 4;
        saveSettings();
    });
    
    $('#jtw-character-list-order').val(settings.characterListOrder || 100).on('change', function() {
        settings.characterListOrder = parseInt($(this).val()) || 100;
        saveSettings();
    });
    
    // 提取角色按钮
    $('#jtw-extract-characters').on('click', async function() {
        $(this).prop('disabled', true);
        try {
            await extractCharacterList((msg, isError) => {
                const $status = $('#jtw-character-extract-status');
                $status.text(msg)
                    .removeClass('success error')
                    .addClass(isError ? 'error' : 'success')
                    .show();
                setTimeout(() => $status.fadeOut(), 5000);
            });
        } finally {
            $(this).prop('disabled', false);
        }
    });
}
