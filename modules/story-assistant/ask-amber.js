/**
 * 问问琥珀功能模块
 * 与AI助手琥珀进行对话，可选择性注入世界书和上下文
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
        id: 'ask-amber',
        name: '问问琥珀',
        description: '与AI助手琥珀对话，获取帮助和建议',
        icon: '✨'
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
 * 获取默认设置
 */
function getDefaultAmberSettings() {
    return {
        // 提示词设置
        promptU1: '你是琥珀，我的女仆，我正在进行角色扮演游戏，现在需要你的帮助。',
        promptA1: '主人您好，我是琥珀，请问有什么需要帮助的吗？',
        worldInfoTemplate: `【世界设定】
<world_info>
{{description}}
{{worldInfo}}
玩家角色：{{user}}
{{persona}}
</world_info>`,
        chatHistoryTemplate: `【历史记录】
<chat_history>
{{chatHistory}}
</chat_history>`,
        promptA2: '了解！琥珀马上为您服务：',
        // 世界书结果默认设置
        worldbookDefaults: {
            entryName: '',
            entryKeys: '',
            entryConstant: false,
            entryPosition: 0,
            entryDepth: 4,
            entryOrder: 100
        }
    };
}

/**
 * 获取当前琥珀设置
 */
function getAmberSettings() {
    const { getSettings, defaultSettings } = dependencies;
    const settings = getSettings();
    
    if (!settings.askAmber) {
        settings.askAmber = getDefaultAmberSettings();
    }
    
    return settings.askAmber;
}

/**
 * 构建对话消息
 * @param {string} userQuestion - 用户的问题
 * @param {object} options - 选项（是否注入世界书、上下文等）
 * @returns {Promise<Array>}
 */
async function buildMessages(userQuestion, options = {}) {
    const { getSettings, getContext, getChatHistory, getWorldInfoContent, power_user } = dependencies;
    const settings = getSettings();
    const amberSettings = getAmberSettings();
    
    // 调试日志：输出选项
    console.log('[问问琥珀] buildMessages 选项:', {
        includeWorldInfo: options.includeWorldInfo,
        worldInfoActivatedOnly: options.worldInfoActivatedOnly,
        includeChatHistory: options.includeChatHistory
    });
    
    // 检查用户问题是否为空，防止误操作
    if (!userQuestion || !userQuestion.trim()) {
        throw new Error('请输入您的问题');
    }
    
    const ctx = getContext();
    const char = ctx.characters?.[ctx.characterId];
    const description = char?.description || char?.data?.description || '';
    const persona = power_user?.persona_description || '';
    const userName = ctx.name1 || '{{user}}';
    const charName = char?.name || ctx.name2 || '{{char}}';
    
    // 变量替换函数
    const replaceVars = (template) => {
        return template
            .replace(/\{\{user\}\}/g, userName)
            .replace(/\{\{char\}\}/g, charName)
            .replace(/\{\{description\}\}/g, description)
            .replace(/\{\{persona\}\}/g, persona);
    };
    
    const messages = [];
    
    // User 消息 1
    messages.push({
        role: 'user',
        content: replaceVars(amberSettings.promptU1 || getDefaultAmberSettings().promptU1)
    });
    
    // Assistant 消息 1
    messages.push({
        role: 'assistant',
        content: replaceVars(amberSettings.promptA1 || getDefaultAmberSettings().promptA1)
    });
    
    // 构建 User 消息 2（用户问题 + 可选的世界书和上下文）
    let user2Parts = [];
    
    // 如果注入世界书
    if (options.includeWorldInfo) {
        // 根据选项决定是获取全部条目还是仅激活的条目
        console.log('[问问琥珀] 调用 getWorldInfoContent，activatedOnly:', options.worldInfoActivatedOnly);
        const worldInfo = await getWorldInfoContent({ activatedOnly: options.worldInfoActivatedOnly });
        console.log('[问问琥珀] 获取到的世界书内容长度:', worldInfo.length, '字符');
        console.log('[问问琥珀] 世界书内容预览:', worldInfo.substring(0, 200));
        let worldInfoContent = amberSettings.worldInfoTemplate || getDefaultAmberSettings().worldInfoTemplate;
        worldInfoContent = replaceVars(worldInfoContent).replace(/\{\{worldInfo\}\}/g, worldInfo);
        user2Parts.push(worldInfoContent);
    }
    
    // 如果注入上下文
    if (options.includeChatHistory) {
        const ctx = getContext();
        const chat = ctx.chat || [];
        const totalMessages = chat.length;
        
        // 获取层数范围
        let startLayer = options.historyStartLayer;
        let endLayer = options.historyEndLayer;
        
        // 只有当 min 留空时才使用全局设置
        if (!startLayer || startLayer === '') {
            const historyCount = settings.historyCount || 50;
            const chatHistory = getChatHistory(historyCount);
            let chatHistoryContent = amberSettings.chatHistoryTemplate || getDefaultAmberSettings().chatHistoryTemplate;
            chatHistoryContent = replaceVars(chatHistoryContent).replace(/\{\{chatHistory\}\}/g, chatHistory);
            user2Parts.push(chatHistoryContent);
        } else {
            // 根据层数范围获取消息
            startLayer = parseInt(startLayer);
            endLayer = parseInt(endLayer) || totalMessages;
            
            // 限制范围
            startLayer = Math.max(1, Math.min(startLayer, totalMessages));
            endLayer = Math.max(startLayer, Math.min(endLayer, totalMessages));
            
            // 转换为数组索引（层数从1开始，数组索引从0开始）
            const startIndex = startLayer - 1;
            const endIndex = endLayer;
            
            const selectedMessages = chat.slice(startIndex, endIndex);
            
            // 应用标签处理（和 getChatHistory 相同的逻辑）
            const { extractIncludeTags, removeTaggedContent } = dependencies;
            const lines = selectedMessages.map(msg => {
                const name = msg.is_user ? (ctx.name1 || '{{user}}') : (msg.name || ctx.name2 || '{{char}}');
                let content = msg.mes || '';
                
                // 1. 先处理仅包括标签（如果设置了）
                if (settings.includeTags && settings.includeTags.trim()) {
                    content = extractIncludeTags(content, settings.includeTags);
                    
                    // 如果开启了额外排除处理，则继续处理
                    if (settings.applyExcludeAfterInclude && content) {
                        content = removeTaggedContent(content, settings.excludeTags);
                    }
                } else {
                    // 2. 没有仅包括标签时，直接移除排除标签内容
                    content = removeTaggedContent(content, settings.excludeTags);
                }
                
                return `${name}: ${content}`;
            });
            
            const chatHistory = lines.join('\n\n');
            let chatHistoryContent = amberSettings.chatHistoryTemplate || getDefaultAmberSettings().chatHistoryTemplate;
            chatHistoryContent = replaceVars(chatHistoryContent).replace(/\{\{chatHistory\}\}/g, chatHistory);
            user2Parts.push(chatHistoryContent);
        }
    }
    
    // 添加用户问题
    user2Parts.push(userQuestion);
    
    messages.push({
        role: 'user',
        content: user2Parts.join('\n\n')
    });
    
    // 如果有 Assistant 消息 2
    if (amberSettings.promptA2 && amberSettings.promptA2.trim()) {
        messages.push({
            role: 'assistant',
            content: replaceVars(amberSettings.promptA2)
        });
    }
    
    return messages;
}

/**
 * 获取完整提示词预览
 * @param {string} userQuestion - 用户的问题
 * @param {object} options - 选项
 * @returns {Promise<Array>}
 */
async function getPromptPreview(userQuestion, options = {}) {
    return buildMessages(userQuestion, options);
}

/**
 * 调用 AI 获取回复
 * @param {string} userQuestion - 用户的问题
 * @param {object} options - 选项
 * @returns {Promise<string>}
 */
async function askAmber(userQuestion, options = {}) {
    const { callLLM } = dependencies;
    
    const messages = await buildMessages(userQuestion, options);
    
    // 调用 LLM（不需要 JSON 解析）
    const response = await callLLM(messages);
    
    return response;
}

/**
 * 显示主弹窗
 */
export function showModal() {
    // 如果 DOM 不存在，先创建
    ensureModalExists();
    
    const { getContext } = dependencies;
    const ctx = getContext();
    const chat = ctx.chat || [];
    const totalMessages = chat.length;
    
    $('#jtw-ask-amber-modal').fadeIn(200);
    switchTab('chat');
    
    // 设置 max 默认值为当前最新楼层数
    $('#jtw-aa-history-end').attr('placeholder', totalMessages).attr('max', totalMessages);
    // 如果没有填写，设置为默认值
    if (!$('#jtw-aa-history-end').val()) {
        $('#jtw-aa-history-end').val(totalMessages);
    }
    
    // 清空上次的输入和结果
    // $('#jtw-aa-question').val('');
}

/**
 * 隐藏主弹窗
 */
function hideModal() {
    $('#jtw-ask-amber-modal').fadeOut(200);
}

/**
 * 切换标签页
 */
function switchTab(tabName) {
    $('.jtw-aa-tab').removeClass('active');
    $(`.jtw-aa-tab[data-tab="${tabName}"]`).addClass('active');
    $('.jtw-aa-tab-content').removeClass('active');
    $(`#jtw-aa-tab-${tabName}`).addClass('active');
}

/**
 * 显示提示词预览弹窗
 */
async function showPromptPreviewModal() {
    const question = $('#jtw-aa-question').val().trim() || '（请输入您的问题）';
    const includeWorldInfo = $('#jtw-aa-include-worldinfo').prop('checked');
    const worldInfoActivatedOnly = $('input[name="jtw-aa-worldinfo-mode"]:checked').val() === 'activated';
    const includeChatHistory = $('#jtw-aa-include-history').prop('checked');
    const historyStartLayer = $('#jtw-aa-history-start').val();
    const historyEndLayer = $('#jtw-aa-history-end').val();
    
    console.log('[问问琥珀] 预览弹窗选项:', {
        includeWorldInfo,
        worldInfoActivatedOnly,
        includeChatHistory,
        historyStartLayer,
        historyEndLayer
    });
    
    const $container = $('#jtw-aa-prompt-preview-content');
    $container.html('<div class="jtw-ce-loading">加载中...</div>');
    $('#jtw-aa-prompt-preview-modal').fadeIn(200);
    
    try {
        const messages = await getPromptPreview(question, {
            includeWorldInfo,
            worldInfoActivatedOnly,
            includeChatHistory,
            historyStartLayer,
            historyEndLayer
        });
        
        const htmlContent = messages
            .filter(m => m.content)
            .map((msg, idx) => {
                const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
                const roleClass = msg.role === 'user' ? 'user' : 'assistant';
                return `
                    <div class="jtw-prompt-message jtw-prompt-${roleClass}">
                        <div class="jtw-prompt-role">${roleLabel}</div>
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
 * 隐藏提示词预览弹窗
 */
function hidePromptPreviewModal() {
    $('#jtw-aa-prompt-preview-modal').fadeOut(200);
}

/**
 * 执行询问
 */
async function runAsk() {
    const question = $('#jtw-aa-question').val().trim();
    
    if (!question) {
        showStatus('请输入您的问题', true);
        return;
    }
    
    const includeWorldInfo = $('#jtw-aa-include-worldinfo').prop('checked');
    const worldInfoActivatedOnly = $('input[name="jtw-aa-worldinfo-mode"]:checked').val() === 'activated';
    const includeChatHistory = $('#jtw-aa-include-history').prop('checked');
    const historyStartLayer = $('#jtw-aa-history-start').val();
    const historyEndLayer = $('#jtw-aa-history-end').val();
    
    const $btn = $('#jtw-aa-run');
    const $status = $('#jtw-aa-status');
    
    $btn.prop('disabled', true).text('琥珀思考中...');
    $status.text('正在向琥珀提问...').removeClass('error').addClass('success').show();
    
    try {
        const response = await askAmber(question, {
            includeWorldInfo,
            worldInfoActivatedOnly,
            includeChatHistory,
            historyStartLayer,
            historyEndLayer
        });
        
        if (!response) {
            showStatus('琥珀没有回复', true);
            return;
        }
        
        // 显示结果弹窗
        showResultModal(response);
        $status.hide();
        
    } catch (e) {
        console.error('[问问琥珀] 询问失败:', e);
        showStatus(`询问失败: ${e.message}`, true);
    } finally {
        $btn.prop('disabled', false).text('询问一下');
    }
}

/**
 * 显示结果确认弹窗
 */
function showResultModal(response) {
    const amberSettings = getAmberSettings();
    const defaults = amberSettings.worldbookDefaults || {};
    
    $('#jtw-aa-result-content').val(response);
    
    // 填充世界书设置默认值
    $('#jtw-aa-result-entry-name').val(defaults.entryName || '');
    $('#jtw-aa-result-entry-keys').val(defaults.entryKeys || '');
    $('#jtw-aa-result-entry-constant').prop('checked', defaults.entryConstant || false);
    $('#jtw-aa-result-entry-position').val(defaults.entryPosition ?? 0);
    $('#jtw-aa-result-entry-depth').val(defaults.entryDepth ?? 4);
    $('#jtw-aa-result-entry-order').val(defaults.entryOrder ?? 100);
    
    // 显示/隐藏深度
    if (parseInt($('#jtw-aa-result-entry-position').val()) === 4) {
        $('#jtw-aa-result-depth-container').show();
    } else {
        $('#jtw-aa-result-depth-container').hide();
    }
    
    $('#jtw-aa-result-modal').fadeIn(200);
}

/**
 * 隐藏结果弹窗
 */
function hideResultModal() {
    $('#jtw-aa-result-modal').fadeOut(200);
}

/**
 * 复制结果到剪贴板
 */
async function copyResult() {
    const content = $('#jtw-aa-result-content').val();
    const $status = $('#jtw-aa-result-status');
    
    try {
        await navigator.clipboard.writeText(content);
        $status.text('已复制到剪贴板').removeClass('error').addClass('success').show();
        setTimeout(() => $status.fadeOut(), 2000);
    } catch (e) {
        $status.text('复制失败').removeClass('success').addClass('error').show();
        setTimeout(() => $status.fadeOut(), 2000);
    }
}

/**
 * 保存结果到世界书
 */
async function saveResultToWorldbook() {
    const { getSettings, getCharacterWorldbook, loadWorldInfo, saveWorldInfo, createWorldInfoEntry, world_names } = dependencies;
    
    const content = $('#jtw-aa-result-content').val().trim();
    
    if (!content) {
        showResultStatus('没有可保存的内容', true);
        return;
    }
    
    // 获取世界书设置
    const entryName = $('#jtw-aa-result-entry-name').val().trim();
    const entryKeys = $('#jtw-aa-result-entry-keys').val().trim();
    const entryConstant = $('#jtw-aa-result-entry-constant').prop('checked');
    const entryPosition = parseInt($('#jtw-aa-result-entry-position').val());
    const entryDepthVal = $('#jtw-aa-result-entry-depth').val();
    const entryDepth = entryDepthVal === '' ? 4 : parseInt(entryDepthVal);
    const entryOrderVal = $('#jtw-aa-result-entry-order').val();
    const entryOrder = entryOrderVal === '' ? 100 : parseInt(entryOrderVal);
    
    if (!entryName) {
        showResultStatus('请输入条目名称', true);
        return;
    }
    
    const $saveBtn = $('#jtw-aa-result-save-wb');
    $saveBtn.prop('disabled', true).text('保存中...');
    
    try {
        const settings = getSettings();
        let targetBook = settings.targetWorldbook || getCharacterWorldbook();
        
        if (!targetBook || !world_names?.includes(targetBook)) {
            throw new Error('未找到有效的世界书');
        }
        
        const worldData = await loadWorldInfo(targetBook);
        if (!worldData) {
            throw new Error('无法加载世界书');
        }
        
        // 查找或创建条目
        let entry = null;
        let isUpdate = false;
        
        if (worldData.entries && typeof worldData.entries === 'object') {
            const entriesArray = Object.values(worldData.entries);
            entry = entriesArray.find(e => e && e.comment === entryName);
            if (entry) {
                isUpdate = true;
            }
        }
        
        if (!entry) {
            entry = createWorldInfoEntry(targetBook, worldData);
            if (!entry) {
                throw new Error('创建条目失败');
            }
        }
        
        // 设置条目属性
        Object.assign(entry, {
            comment: entryName,
            content: content,
            key: entryKeys ? entryKeys.split(',').map(k => k.trim()) : [entryName],
            constant: entryConstant,
            selective: true,
            disable: false,
            position: entryPosition,
            depth: entryPosition === 4 ? entryDepth : undefined,
            order: entryOrder
        });
        
        await saveWorldInfo(targetBook, worldData, true);
        
        // 保存世界书默认设置
        const amberSettings = getAmberSettings();
        amberSettings.worldbookDefaults = {
            entryName,
            entryKeys,
            entryConstant,
            entryPosition,
            entryDepth,
            entryOrder
        };
        saveSettingsCallback();
        
        showResultStatus(`已${isUpdate ? '更新' : '保存'}到世界书`, false);
        
        setTimeout(() => {
            hideResultModal();
        }, 1500);
        
    } catch (e) {
        console.error('[问问琥珀] 保存失败:', e);
        showResultStatus(`保存失败: ${e.message}`, true);
    } finally {
        $saveBtn.prop('disabled', false).text('保存到世界书');
    }
}

/**
 * 显示状态消息
 */
function showStatus(message, isError = false) {
    const $status = $('#jtw-aa-status');
    $status.text(message)
        .removeClass('success error')
        .addClass(isError ? 'error' : 'success')
        .show();
    
    setTimeout(() => $status.fadeOut(), 5000);
}

/**
 * 显示结果弹窗状态
 */
function showResultStatus(message, isError = false) {
    const $status = $('#jtw-aa-result-status');
    $status.text(message)
        .removeClass('success error')
        .addClass(isError ? 'error' : 'success')
        .show();
    
    setTimeout(() => $status.fadeOut(), 5000);
}

// 标记事件是否已绑定
let eventsInitialized = false;

/**
 * 获取模态框 HTML（不包含设置占位）
 */
function getModalHtml() {
    return `
        <!-- 问问琥珀主弹窗 -->
        <div id="jtw-ask-amber-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content jtw-aa-modal-content">
                <div class="jtw-modal-header">
                    <h3>✨ 问问琥珀</h3>
                    <button class="jtw-modal-close jtw-aa-close-modal">✕</button>
                </div>
                
                <!-- 标签页导航 -->
                <div class="jtw-ce-tabs">
                    <button class="jtw-aa-tab active" data-tab="chat">互动</button>
                    <button class="jtw-aa-tab" data-tab="settings">设置</button>
                </div>
                
                <div class="jtw-modal-body">
                    <!-- 互动页 -->
                    <div class="jtw-aa-tab-content active" id="jtw-aa-tab-chat">
                        <div class="jtw-aa-greeting">
                            <div class="jtw-aa-greeting-text">主人您好，我是琥珀，请问有什么需要帮助的吗？</div>
                        </div>
                        
                        <div class="jtw-section">
                            <label>您的问题</label>
                            <textarea id="jtw-aa-question" class="jtw-input" rows="6" placeholder="请输入您想问琥珀的问题..."></textarea>
                        </div>
                        
                        <div class="jtw-section">
                            <h4>注入选项</h4>
                            <div class="jtw-aa-options">
                                <div class="jtw-aa-worldinfo-row">
                                    <div class="jtw-checkbox-row">
                                        <input type="checkbox" id="jtw-aa-include-worldinfo" checked />
                                        <label for="jtw-aa-include-worldinfo">注入世界书内容</label>
                                    </div>
                                    <div class="jtw-aa-worldinfo-mode" id="jtw-aa-worldinfo-mode">
                                        <label style="margin-left: 24px;">
                                            <input type="radio" name="jtw-aa-worldinfo-mode" value="all" checked /> 全部条目
                                        </label>
                                        <label style="margin-left: 10px;">
                                            <input type="radio" name="jtw-aa-worldinfo-mode" value="activated" /> 仅激活的条目
                                        </label>
                                        <div class="jtw-hint" style="padding-left: 24px;">（"仅激活"基于上一次生成时的关键词匹配结果）</div>
                                    </div>
                                </div>
                                <div class="jtw-aa-history-row">
                                    <div class="jtw-checkbox-row">
                                        <input type="checkbox" id="jtw-aa-include-history" checked />
                                        <label for="jtw-aa-include-history">注入上下文（聊天历史）</label>
                                    </div>
                                    <div class="jtw-aa-history-range-inline" id="jtw-aa-history-range-inline">
                                        <label>层数范围：</label>
                                        <input type="number" id="jtw-aa-history-start" class="jtw-input jtw-aa-layer-input" placeholder="开始" min="1" />
                                        <span>~</span>
                                        <input type="number" id="jtw-aa-history-end" class="jtw-input jtw-aa-layer-input" placeholder="结束" min="1" />
                                    </div>
                                    <div class="jtw-hint" style="padding-left: 24px;">（留空使用全局设置）</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="jtw-aa-actions">
                            <button id="jtw-aa-run" class="jtw-btn primary jtw-aa-run-btn">询问一下</button>
                            <button id="jtw-aa-preview-prompt" class="jtw-btn jtw-aa-preview-btn">📋 预览完整提示词</button>
                        </div>
                        
                        <div id="jtw-aa-status" class="jtw-status" style="display: none;"></div>
                    </div>
                    
                    <!-- 设置页 -->
                    <div class="jtw-aa-tab-content" id="jtw-aa-tab-settings">
                        <div class="jtw-section">
                            <h4>提示词设置</h4>
                            <div style="margin-bottom: 10px;">
                                <label>User 消息 1</label>
                                <textarea id="jtw-aa-prompt-u1" class="jtw-input" rows="2" placeholder="你是琥珀，我可爱的女仆..."></textarea>
                            </div>
                            <div style="margin-bottom: 10px;">
                                <label>Assistant 消息 1</label>
                                <textarea id="jtw-aa-prompt-a1" class="jtw-input" rows="2" placeholder="主人您好，我是琥珀..."></textarea>
                            </div>
                        </div>
                        
                        <div class="jtw-section">
                            <h4>世界书内容模板</h4>
                            <textarea id="jtw-aa-worldinfo-template" class="jtw-input" rows="6" placeholder="【世界设定】..."></textarea>
                            <div class="jtw-hint">可用变量: {{description}}, {{worldInfo}}, {{user}}, {{char}}, {{persona}}</div>
                        </div>
                        
                        <div class="jtw-section">
                            <h4>上下文内容模板</h4>
                            <textarea id="jtw-aa-history-template" class="jtw-input" rows="4" placeholder="【历史记录】..."></textarea>
                            <div class="jtw-hint">可用变量: {{chatHistory}}</div>
                        </div>
                        
                        <div class="jtw-section">
                            <h4>Assistant 消息 2</h4>
                            <textarea id="jtw-aa-prompt-a2" class="jtw-input" rows="1" placeholder="留空则省略此消息"></textarea>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- 提示词预览弹窗 -->
        <div id="jtw-aa-prompt-preview-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content jtw-ce-prompt-modal-content">
                <div class="jtw-modal-header">
                    <h3>📋 完整提示词预览</h3>
                    <button class="jtw-modal-close jtw-aa-close-preview">✕</button>
                </div>
                <div class="jtw-modal-body">
                    <div id="jtw-aa-prompt-preview-content" class="jtw-ce-prompt-preview">
                        <div class="jtw-ce-loading">加载中...</div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- 结果确认弹窗 -->
        <div id="jtw-aa-result-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content jtw-aa-result-modal-content">
                <div class="jtw-modal-header">
                    <h3>✨ 琥珀的回复</h3>
                    <button class="jtw-modal-close jtw-aa-close-result">✕</button>
                </div>
                <div class="jtw-modal-body">
                    <textarea id="jtw-aa-result-content" class="jtw-ce-textarea" rows="12" placeholder="琥珀的回复..."></textarea>
                    
                    <div class="jtw-aa-result-actions-row">
                        <button id="jtw-aa-result-copy" class="jtw-btn">📋 一键复制</button>
                    </div>
                    
                    <div class="jtw-section" style="margin-top: 15px;">
                        <h4>保存到世界书（可选）</h4>
                        <div style="margin-bottom: 10px;">
                            <label>条目名称</label>
                            <input type="text" id="jtw-aa-result-entry-name" class="jtw-input" placeholder="条目名称" />
                        </div>
                        <div style="margin-bottom: 10px;">
                            <label>关键词（逗号分隔）</label>
                            <input type="text" id="jtw-aa-result-entry-keys" class="jtw-input" placeholder="关键词1,关键词2" />
                        </div>
                        <div class="jtw-checkbox-row" style="margin-bottom: 10px;">
                            <input type="checkbox" id="jtw-aa-result-entry-constant" />
                            <label for="jtw-aa-result-entry-constant">始终启用（Constant）</label>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <div style="flex: 1;">
                                <label>条目位置</label>
                                <select id="jtw-aa-result-entry-position" class="jtw-select">
                                    <option value="0">角色定义之前</option>
                                    <option value="1">角色定义之后</option>
                                    <option value="2">作者注释之前</option>
                                    <option value="3">作者注释之后</option>
                                    <option value="4">@ Depth</option>
                                </select>
                            </div>
                            <div id="jtw-aa-result-depth-container" style="flex: 1; display: none;">
                                <label>深度</label>
                                <input type="number" id="jtw-aa-result-entry-depth" class="jtw-input" value="4" min="0" />
                            </div>
                            <div style="flex: 1;">
                                <label>排序</label>
                                <input type="number" id="jtw-aa-result-entry-order" class="jtw-input" value="100" min="0" />
                            </div>
                        </div>
                    </div>
                    
                    <div id="jtw-aa-result-status" class="jtw-status" style="display: none;"></div>
                </div>
                <div class="jtw-modal-footer">
                    <button class="jtw-btn jtw-aa-close-result">关闭</button>
                    <button id="jtw-aa-result-save-wb" class="jtw-btn primary">保存到世界书</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 确保模态框 DOM 存在
 */
function ensureModalExists() {
    if ($('#jtw-ask-amber-modal').length === 0) {
        $('body').append(getModalHtml());
        // 绑定事件
        if (!eventsInitialized) {
            bindModalEvents();
        }
    }
}

/**
 * 绑定模态框事件（与 initSettingsEvents 分开，只负责弹窗本身的事件）
 */
function bindModalEvents() {
    const amberSettings = getAmberSettings();
    const defaults = getDefaultAmberSettings();
    
    // 关闭主弹窗 - 只能通过 X 按钮关闭
    $('#jtw-ask-amber-modal .jtw-aa-close-modal').off('click').on('click', function(e) {
        e.stopPropagation();
        hideModal();
    });
    // 在整个弹窗（包括遮罩层）上阻止所有事件冒泡
    $('#jtw-ask-amber-modal').off('click mousedown pointerdown touchstart touchend').on('click mousedown pointerdown touchstart touchend', function(e) {
        e.stopPropagation();
    });
    
    // 关闭提示词预览弹窗
    $('#jtw-aa-prompt-preview-modal .jtw-aa-close-preview').off('click').on('click', function(e) {
        e.stopPropagation();
        hidePromptPreviewModal();
    });
    $('#jtw-aa-prompt-preview-modal').off('click mousedown pointerdown touchstart touchend').on('click mousedown pointerdown touchstart touchend', function(e) {
        e.stopPropagation();
    });
    
    // 关闭结果弹窗
    $('#jtw-aa-result-modal .jtw-aa-close-result').off('click').on('click', function(e) {
        e.stopPropagation();
        hideResultModal();
    });
    $('#jtw-aa-result-modal').off('click mousedown pointerdown touchstart touchend').on('click mousedown pointerdown touchstart touchend', function(e) {
        e.stopPropagation();
    });
    
    // 标签页切换 - 直接绑定
    $('#jtw-ask-amber-modal .jtw-aa-tab').off('click').on('click', function(e) {
        e.stopPropagation();
        const tab = $(this).data('tab');
        switchTab(tab);
    });
    
    // 运行询问
    $('#jtw-aa-run').off('click').on('click', runAsk);
    
    // 预览提示词
    $('#jtw-aa-preview-prompt').off('click').on('click', showPromptPreviewModal);
    
    // 复制结果
    $('#jtw-aa-result-copy').off('click').on('click', copyResult);
    
    // 保存到世界书
    $('#jtw-aa-result-save-wb').off('click').on('click', saveResultToWorldbook);
    
    // 结果弹窗位置变化时显示/隐藏深度
    $('#jtw-aa-result-entry-position').off('change').on('change', function() {
        if (parseInt($(this).val()) === 4) {
            $('#jtw-aa-result-depth-container').show();
        } else {
            $('#jtw-aa-result-depth-container').hide();
        }
    });
    
    // 设置页面字段初始化
    $('#jtw-aa-prompt-u1').val(amberSettings.promptU1 || defaults.promptU1);
    $('#jtw-aa-prompt-a1').val(amberSettings.promptA1 || defaults.promptA1);
    $('#jtw-aa-worldinfo-template').val(amberSettings.worldInfoTemplate || defaults.worldInfoTemplate);
    $('#jtw-aa-history-template').val(amberSettings.chatHistoryTemplate || defaults.chatHistoryTemplate);
    $('#jtw-aa-prompt-a2').val(amberSettings.promptA2 || '');
    
    // 设置变更保存
    $('#jtw-aa-prompt-u1').off('change').on('change', function() {
        amberSettings.promptU1 = $(this).val();
        if (saveSettingsCallback) saveSettingsCallback();
    });
    
    $('#jtw-aa-prompt-a1').off('change').on('change', function() {
        amberSettings.promptA1 = $(this).val();
        if (saveSettingsCallback) saveSettingsCallback();
    });
    
    $('#jtw-aa-worldinfo-template').off('change').on('change', function() {
        amberSettings.worldInfoTemplate = $(this).val();
        if (saveSettingsCallback) saveSettingsCallback();
    });
    
    $('#jtw-aa-history-template').off('change').on('change', function() {
        amberSettings.chatHistoryTemplate = $(this).val();
        if (saveSettingsCallback) saveSettingsCallback();
    });
    
    $('#jtw-aa-prompt-a2').off('change').on('change', function() {
        amberSettings.promptA2 = $(this).val();
        if (saveSettingsCallback) saveSettingsCallback();
    });
    
    // 注入世界书勾选框变化时显示/隐藏模式选项
    $('#jtw-aa-include-worldinfo').off('change').on('change', function() {
        if ($(this).prop('checked')) {
            $('#jtw-aa-worldinfo-mode').show();
        } else {
            $('#jtw-aa-worldinfo-mode').hide();
        }
    });
    
    // 注入上下文勾选框变化时显示/隐藏层数范围
    $('#jtw-aa-include-history').off('change').on('change', function() {
        if ($(this).prop('checked')) {
            $('#jtw-aa-history-range-inline').show();
        } else {
            $('#jtw-aa-history-range-inline').hide();
        }
    });
    
    eventsInitialized = true;
}

/**
 * 渲染设置面板 HTML（简化版，模态框在 showModal 时动态创建）
 */
export function renderSettingsPanel() {
    return `
        <div class="jtw-assistant-feature-content" id="jtw-ask-amber-settings" style="display: none;">
            <!-- 占位，实际功能在弹窗中 -->
        </div>
    `;
}

/**
 * 初始化事件绑定（设置保存回调）
 */
export function initSettingsEvents(saveSettings) {
    saveSettingsCallback = saveSettings;
}

/**
 * 模块被点击时的处理
 */
export function onModuleClick() {
    showModal();
    return false;
}
