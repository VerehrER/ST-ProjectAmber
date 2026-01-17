/**
 * 自定义任务功能模块
 * 提供生成指令和并行注入两种任务类型
 */

// 依赖从主模块获取
let dependencies = null;
// 保存设置的回调
let saveSettingsCallback = null;
// 当前运行状态
let isTaskRunning = false;
// 当前编辑的任务索引（-1表示新建）
let editingTaskIndex = -1;

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
        id: 'custom-tasks',
        name: '自定义任务',
        description: '生成指令和并行注入任务管理',
        icon: '📋'
    };
}

/**
 * 模块点击行为 - 直接进入功能，不显示设置面板
 */
export function onModuleClick() {
    // 返回 false 表示不执行默认的面板切换行为
    // 因为自定义任务有独立的标签页，这里我们通过切换标签页来实现
    return false;
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
 * 生成唯一ID
 */
function generateTaskId() {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 创建默认生成指令任务对象
 */
export function createDefaultTask() {
    return {
        id: generateTaskId(),
        type: 'generate',  // 'generate' 或 'parallel'
        name: '',
        promptU1: '',
        promptA1: '',
        promptU2: '',
        promptA2: '',
        historyStartLayer: null,  // 历史消息开始层数，null 表示使用全局设置
        historyEndLayer: null,    // 历史消息结束层数，null 表示使用全局设置
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/**
 * 创建默认并行任务对象
 */
export function createDefaultParallelTask() {
    return {
        id: generateTaskId(),
        type: 'parallel',
        name: '',
        enabled: false,           // 是否启用
        prompt: '',               // 注入的提示词
        position: 'chat',         // 注入位置: 'before', 'after', 'chat'
        depth: 4,                 // 深度（当position为chat时有效）
        role: 'system',           // 角色: 'system', 'user', 'assistant'
        interval: 0,              // 间隔注入（0表示每次都注入）
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/**
 * 渲染任务列表
 */
export function renderTaskList() {
    const { getSettings } = dependencies;
    const settings = getSettings();
    const tasks = settings.customTasks || [];
    const $list = $('#jtw-task-list');
    
    if (tasks.length === 0) {
        $list.html('<div class="jtw-task-empty">暂无自定义任务，点击「新增」创建</div>');
        return;
    }
    
    const items = tasks.map((task, index) => {
        const isParallel = task.type === 'parallel';
        const typeIcon = isParallel ? '🔀' : '📝';
        const typeName = isParallel ? '并行注入' : '生成指令';
        
        if (isParallel) {
            // 并行任务的渲染
            const statusClass = task.enabled ? 'enabled' : 'disabled';
            const statusText = task.enabled ? '已启用' : '已禁用';
            const positionText = {
                'before': '主提示前',
                'after': '主提示后', 
                'chat': `聊天@${task.depth ?? 4}`
            }[task.position] || '聊天';
            const intervalText = task.interval > 0 ? `每${task.interval}楼` : '每次';
            
            return `
                <div class="jtw-task-item jtw-task-parallel ${statusClass}" data-index="${index}">
                    <div class="jtw-task-info">
                        <span class="jtw-task-type-badge">${typeIcon} ${typeName}</span>
                        <span class="jtw-task-name">${escapeHtml(task.name || '未命名任务')}</span>
                        <span class="jtw-task-meta">${positionText} | ${intervalText}</span>
                    </div>
                    <div class="jtw-task-actions">
                        <label class="jtw-task-toggle" title="${statusText}">
                            <input type="checkbox" class="jtw-task-enable" data-index="${index}" ${task.enabled ? 'checked' : ''} />
                            <span class="jtw-toggle-slider"></span>
                        </label>
                        <button class="jtw-btn jtw-btn-icon jtw-task-edit" data-index="${index}" title="修改">✏️</button>
                        <button class="jtw-btn jtw-btn-icon jtw-task-export" data-index="${index}" title="导出">📤</button>
                        <button class="jtw-btn jtw-btn-icon jtw-task-delete" data-index="${index}" title="删除">🗑️</button>
                    </div>
                </div>
            `;
        } else {
            // 生成指令任务的渲染
            return `
                <div class="jtw-task-item" data-index="${index}">
                    <div class="jtw-task-info">
                        <span class="jtw-task-type-badge">${typeIcon} ${typeName}</span>
                        <span class="jtw-task-name">${escapeHtml(task.name || '未命名任务')}</span>
                        <span class="jtw-task-entry-title">→ ${escapeHtml(task.entryTitle || '未设置')}</span>
                    </div>
                    <div class="jtw-task-actions">
                        <button class="jtw-btn jtw-btn-icon jtw-task-run" data-index="${index}" title="运行">▶️</button>
                        <button class="jtw-btn jtw-btn-icon jtw-task-edit" data-index="${index}" title="修改">✏️</button>
                        <button class="jtw-btn jtw-btn-icon jtw-task-export" data-index="${index}" title="导出">📤</button>
                        <button class="jtw-btn jtw-btn-icon jtw-task-delete" data-index="${index}" title="删除">🗑️</button>
                    </div>
                </div>
            `;
        }
    }).join('');
    
    $list.html(items);
}

/**
 * 显示任务列表视图
 */
export function showTaskListView() {
    $('#jtw-task-list-view').show();
    $('#jtw-task-type-view').hide();
    $('#jtw-task-edit-view').hide();
    $('#jtw-parallel-task-edit-view').hide();
    renderTaskList();
}

/**
 * 显示任务类型选择视图
 */
function showTaskTypeView() {
    $('#jtw-task-list-view').hide();
    $('#jtw-task-type-view').show();
    $('#jtw-task-edit-view').hide();
    $('#jtw-parallel-task-edit-view').hide();
}

/**
 * 显示任务编辑视图（生成指令）
 */
function showTaskEditView(task, isNew = true) {
    $('#jtw-task-list-view').hide();
    $('#jtw-task-type-view').hide();
    $('#jtw-task-edit-view').show();
    $('#jtw-parallel-task-edit-view').hide();
    
    // 设置标题
    $('#jtw-task-edit-title').text(isNew ? '新建生成指令' : '编辑生成指令');
    
    // 填充表单
    $('#jtw-task-name').val(task.name || '');
    $('#jtw-task-prompt-u1').val(task.promptU1 || '');
    $('#jtw-task-prompt-a1').val(task.promptA1 || '');
    $('#jtw-task-prompt-u2').val(task.promptU2 || '');
    $('#jtw-task-prompt-a2').val(task.promptA2 || '');
    $('#jtw-task-history-start').val(task.historyStartLayer ?? '');
    $('#jtw-task-history-end').val(task.historyEndLayer ?? '');
}

/**
 * 显示并行任务编辑视图
 */
function showParallelTaskEditView(task, isNew = true) {
    $('#jtw-task-list-view').hide();
    $('#jtw-task-type-view').hide();
    $('#jtw-task-edit-view').hide();
    $('#jtw-parallel-task-edit-view').show();
    
    // 设置标题
    $('#jtw-parallel-task-edit-title').text(isNew ? '新建并行注入' : '编辑并行注入');
    
    // 填充表单
    $('#jtw-parallel-task-name').val(task.name || '');
    $('#jtw-parallel-task-prompt').val(task.prompt || '');
    $('#jtw-parallel-task-position').val(task.position || 'chat');
    $('#jtw-parallel-task-depth').val(task.depth ?? 4);
    $('#jtw-parallel-task-role').val(task.role || 'system');
    $('#jtw-parallel-task-interval').val(task.interval ?? 0);
    
    // 显示/隐藏深度和角色输入框
    if ($('#jtw-parallel-task-position').val() === 'chat') {
        $('#jtw-parallel-depth-container').show();
        $('#jtw-parallel-role-container').show();
    } else {
        $('#jtw-parallel-depth-container').hide();
        $('#jtw-parallel-role-container').hide();
    }
}

/**
 * 从并行任务表单获取数据
 */
function getParallelTaskFromForm() {
    const depthValue = $('#jtw-parallel-task-depth').val();
    // const intervalValue = $('#jtw-parallel-task-interval').val();
    
    return {
        name: $('#jtw-parallel-task-name').val().trim(),
        prompt: $('#jtw-parallel-task-prompt').val(),
        position: $('#jtw-parallel-task-position').val(),
        depth: depthValue === '' ? 4 : parseInt(depthValue),
        role: $('#jtw-parallel-task-role').val() || 'system',
        interval: parseInt($('#jtw-parallel-task-interval').val()) || 0
        // interval: intervalValue === '' ? 0 : parseInt(intervalValue)
    };
}

/**
 * 保存并行任务
 */
function saveParallelTask() {
    const { getSettings } = dependencies;
    const settings = getSettings();
    if (!settings.customTasks) {
        settings.customTasks = [];
    }
    
    const formData = getParallelTaskFromForm();
    
    // 验证必填字段
    if (!formData.name) {
        showTaskStatus('请输入任务名称', true);
        return;
    }
    if (!formData.prompt) {
        showTaskStatus('请输入注入的提示词', true);
        return;
    }
    
    if (editingTaskIndex >= 0) {
        // 更新现有任务
        const existingTask = settings.customTasks[editingTaskIndex];
        Object.assign(existingTask, formData, { updatedAt: Date.now() });
    } else {
        // 创建新任务
        const newTask = createDefaultParallelTask();
        Object.assign(newTask, formData);
        settings.customTasks.push(newTask);
    }
    
    saveSettingsCallback();
    showTaskListView();
    showTaskStatus(editingTaskIndex >= 0 ? '并行注入已更新' : '并行注入已创建');
    editingTaskIndex = -1;
}

/**
 * 切换并行任务启用状态
 */
function toggleParallelTask(index, enabled) {
    const { getSettings } = dependencies;
    const settings = getSettings();
    if (!settings.customTasks || index < 0 || index >= settings.customTasks.length) {
        return;
    }
    
    const task = settings.customTasks[index];
    if (task.type !== 'parallel') return;
    
    task.enabled = enabled;
    task.updatedAt = Date.now();
    saveSettingsCallback();
    
    showTaskStatus(enabled ? `已启用: ${task.name}` : `已禁用: ${task.name}`);
}

/**
 * 从表单获取任务数据
 */
function getTaskFromForm() {
    const historyStartValue = $('#jtw-task-history-start').val().trim();
    const historyEndValue = $('#jtw-task-history-end').val().trim();
    return {
        name: $('#jtw-task-name').val().trim(),
        promptU1: $('#jtw-task-prompt-u1').val(),
        promptA1: $('#jtw-task-prompt-a1').val(),
        promptU2: $('#jtw-task-prompt-u2').val(),
        promptA2: $('#jtw-task-prompt-a2').val(),
        historyStartLayer: historyStartValue === '' ? null : parseInt(historyStartValue),
        historyEndLayer: historyEndValue === '' ? null : parseInt(historyEndValue)
    };
}

/**
 * 保存任务
 */
function saveTask() {
    const { getSettings } = dependencies;
    const settings = getSettings();
    if (!settings.customTasks) {
        settings.customTasks = [];
    }
    
    const formData = getTaskFromForm();
    
    // 验证必填字段
    if (!formData.name) {
        showTaskStatus('请输入指令名称', true);
        return;
    }
    
    if (editingTaskIndex >= 0) {
        // 更新现有任务
        const existingTask = settings.customTasks[editingTaskIndex];
        Object.assign(existingTask, formData, { updatedAt: Date.now() });
    } else {
        // 创建新任务
        const newTask = createDefaultTask();
        Object.assign(newTask, formData);
        settings.customTasks.push(newTask);
    }
    
    saveSettingsCallback();
    showTaskListView();
    showTaskStatus(editingTaskIndex >= 0 ? '任务已更新' : '任务已创建');
    editingTaskIndex = -1;
}

/**
 * 删除任务
 */
function deleteTask(index) {
    const { getSettings } = dependencies;
    const settings = getSettings();
    if (!settings.customTasks || index < 0 || index >= settings.customTasks.length) {
        return;
    }
    
    const task = settings.customTasks[index];
    if (!confirm(`确定要删除任务「${task.name || '未命名'}」吗？`)) {
        return;
    }
    
    settings.customTasks.splice(index, 1);
    saveSettingsCallback();
    renderTaskList();
    showTaskStatus('任务已删除');
}

/**
 * 导出单个任务
 */
function exportTask(index) {
    const { getSettings } = dependencies;
    const settings = getSettings();
    if (!settings.customTasks || index < 0 || index >= settings.customTasks.length) {
        return;
    }
    
    const task = { ...settings.customTasks[index] };
    // 移除内部字段
    delete task.createdAt;
    delete task.updatedAt;
    
    const jsonStr = JSON.stringify(task, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `task_${task.name || 'unnamed'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showTaskStatus('任务已导出');
}

/**
 * 导入任务
 */
function importTasks() {
    const { getSettings, EXT_NAME } = dependencies;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    
    input.onchange = async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        const settings = getSettings();
        if (!settings.customTasks) {
            settings.customTasks = [];
        }
        
        let importedCount = 0;
        
        for (const file of files) {
            try {
                const text = await file.text();
                const task = JSON.parse(text);
                
                // 验证必要字段
                if (!task.name || !task.type) {
                    console.warn(`[${EXT_NAME}] 跳过无效任务文件: ${file.name}`);
                    continue;
                }
                
                // 生成新ID，避免冲突
                task.id = generateTaskId();
                task.createdAt = Date.now();
                task.updatedAt = Date.now();
                
                settings.customTasks.push(task);
                importedCount++;
            } catch (err) {
                console.error(`[${EXT_NAME}] 导入失败: ${file.name}`, err);
            }
        }
        
        if (importedCount > 0) {
            saveSettingsCallback();
            renderTaskList();
            showTaskStatus(`成功导入 ${importedCount} 个任务`);
        } else {
            showTaskStatus('没有可导入的有效任务', true);
        }
    };
    
    input.click();
}

/**
 * 预览任务提示词
 */
async function previewTaskPrompt(index) {
    const { getSettings, getContext, getChatHistory, getWorldInfoContent, power_user } = dependencies;
    const settings = getSettings();
    if (!settings.customTasks || index < 0 || index >= settings.customTasks.length) {
        return;
    }
    
    const task = settings.customTasks[index];
    
    try {
        const ctx = getContext();
        const chat = ctx.chat || [];
        const char = ctx.characters?.[ctx.characterId];
        const description = char?.description || char?.data?.description || '';
        const persona = power_user?.persona_description || '';
        const userName = ctx.name1 || '{{user}}';
        const charName = char?.name || ctx.name2 || '{{char}}';
        const lastMessage = chat.length > 0 ? chat[chat.length - 1]?.mes || '' : '';
        const messageCount = chat.length;
        
        // 获取聊天历史
        let chatHistory;
        if (task.type === 'generate' && task.historyStartLayer != null && task.historyStartLayer !== '') {
            // 使用任务配置的层数范围
            const totalMessages = chat.length;
            let startLayer = parseInt(task.historyStartLayer);
            let endLayer = parseInt(task.historyEndLayer) || totalMessages;
            
            startLayer = Math.max(1, Math.min(startLayer, totalMessages));
            endLayer = Math.max(startLayer, Math.min(endLayer, totalMessages));
            
            const startIndex = startLayer - 1;
            const endIndex = endLayer;
            const selectedMessages = chat.slice(startIndex, endIndex);
            
            // 格式化消息并应用标签处理
            const { extractIncludeTags, removeTaggedContent } = dependencies;
            const lines = selectedMessages.map(msg => {
                const name = msg.is_user ? userName : charName;
                let content = msg.mes || '';
                
                // 应用标签处理
                if (settings.includeTags && settings.includeTags.trim()) {
                    content = extractIncludeTags(content, settings.includeTags);
                    if (settings.applyExcludeAfterInclude && content) {
                        content = removeTaggedContent(content, settings.excludeTags);
                    }
                } else {
                    content = removeTaggedContent(content, settings.excludeTags);
                }
                
                return `${name}: ${content}`;
            });
            chatHistory = lines.join('\n\n');
        } else {
            // 使用全局设置
            chatHistory = getChatHistory(settings.historyCount || 50);
        }
        
        // 获取世界书内容
        const worldInfo = await getWorldInfoContent({ 
            activatedOnly: true,
            startLayer: task.historyStartLayer,
            endLayer: task.historyEndLayer
        });
        
        let htmlContent = '';
        
        if (task.type === 'parallel') {
            // 并行任务：只显示单个提示词
            let prompt = task.prompt || '';
            prompt = prompt
                .replace(/\{\{user\}\}/g, userName)
                .replace(/\{\{char\}\}/g, charName)
                .replace(/\{\{description\}\}/g, description)
                .replace(/\{\{persona\}\}/g, persona)
                .replace(/\{\{worldInfo\}\}/g, worldInfo)
                .replace(/\{\{lastMessage\}\}/g, lastMessage)
                .replace(/\{\{messageCount\}\}/g, String(messageCount));
            
            const positionText = {
                'before': '主提示词之前',
                'after': '主提示词之后',
                'chat': `聊天记录 @Depth ${task.depth ?? 4}`
            }[task.position] || '聊天记录';
            
            const intervalText = task.interval > 0 
                ? `每 ${task.interval} 楼注入一次` 
                : '每次都注入';
            
            htmlContent = `
                <div class="jtw-prompt-info">
                    <div><strong>注入位置:</strong> ${positionText}</div>
                    <div><strong>角色:</strong> ${task.role || 'system'}</div>
                    <div><strong>间隔:</strong> ${intervalText}</div>
                    <div><strong>当前楼层:</strong> ${messageCount}</div>
                    <div><strong>状态:</strong> ${task.enabled ? '✅ 已启用' : '❌ 已禁用'}</div>
                </div>
                <div class="jtw-prompt-message jtw-prompt-system">
                    <div class="jtw-prompt-role">注入内容 (${task.role || 'system'})</div>
                    <div class="jtw-prompt-content">${escapeHtml(prompt)}</div>
                </div>
            `;
        } else {
            // 生成指令任务：显示多条消息
            const replaceVars = (template) => {
                return template
                    .replace(/\{\{user\}\}/g, userName)
                    .replace(/\{\{char\}\}/g, charName)
                    .replace(/\{\{description\}\}/g, description)
                    .replace(/\{\{persona\}\}/g, persona)
                    .replace(/\{\{worldInfo\}\}/g, worldInfo)
                    .replace(/\{\{chatHistory\}\}/g, chatHistory);
            };
            
            const messages = [
                { role: 'user', content: replaceVars(task.promptU1 || '') },
                { role: 'assistant', content: replaceVars(task.promptA1 || '') },
                { role: 'user', content: replaceVars(task.promptU2 || '') },
                { role: 'assistant', content: replaceVars(task.promptA2 || '') }
            ].filter(m => m.content);
            
            htmlContent = messages.map((msg, idx) => {
                const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
                const roleClass = msg.role === 'user' ? 'user' : 'assistant';
                return `
                    <div class="jtw-prompt-message jtw-prompt-${roleClass}">
                        <div class="jtw-prompt-role">${roleLabel} 消息 ${Math.floor(idx / 2) + 1}</div>
                        <div class="jtw-prompt-content">${escapeHtml(msg.content)}</div>
                    </div>
                `;
            }).join('');
        }
        
        // 显示模态框
        const typeLabel = task.type === 'parallel' ? '并行注入' : '生成指令';
        $('#jtw-prompt-preview-title').text(`${typeLabel}预览: ${task.name}`);
        $('#jtw-prompt-preview-content').html(htmlContent);
        $('#jtw-prompt-preview-modal').fadeIn(200);
        
    } catch (e) {
        console.error(`[Custom Tasks] 预览提示词失败:`, e);
        showTaskStatus(`预览失败: ${e.message}`, true);
    }
}

/**
 * 运行任务
 */
async function runTask(index) {
    const { getSettings, getContext, getChatHistory, getWorldInfoContent, callLLMJson, power_user, EXT_NAME } = dependencies;
    
    if (isTaskRunning) {
        showTaskStatus('已有任务正在运行，请等待完成', true);
        return;
    }
    
    const settings = getSettings();
    if (!settings.customTasks || index < 0 || index >= settings.customTasks.length) {
        return;
    }
    
    const task = settings.customTasks[index];
    
    if (task.type === 'parallel') {
        showTaskStatus('并行处理任务暂未实现', true);
        return;
    }
    
    isTaskRunning = true;
    
    // 禁用所有运行按钮
    $('.jtw-task-run').prop('disabled', true);
    showTaskStatus(`正在运行: ${task.name}...`);
    
    try {
        const ctx = getContext();
        const char = ctx.characters?.[ctx.characterId];
        const description = char?.description || char?.data?.description || '';
        const persona = power_user?.persona_description || '';
        const userName = ctx.name1 || '{{user}}';
        const charName = char?.name || ctx.name2 || '{{char}}';
        
        // 获取聊天历史
        let chatHistory;
        if (task.historyStartLayer != null && task.historyStartLayer !== '') {
            // 使用层数范围获取
            const chat = ctx.chat || [];
            const totalMessages = chat.length;
            let startLayer = parseInt(task.historyStartLayer);
            let endLayer = parseInt(task.historyEndLayer) || totalMessages;
            
            startLayer = Math.max(1, Math.min(startLayer, totalMessages));
            endLayer = Math.max(startLayer, Math.min(endLayer, totalMessages));
            
            const startIndex = startLayer - 1;
            const endIndex = endLayer;
            const selectedMessages = chat.slice(startIndex, endIndex);
            
            // 格式化消息并应用标签处理
            const { extractIncludeTags, removeTaggedContent } = dependencies;
            const lines = selectedMessages.map(msg => {
                const name = msg.is_user ? userName : charName;
                let content = msg.mes || '';
                
                // 应用标签处理
                if (settings.includeTags && settings.includeTags.trim()) {
                    content = extractIncludeTags(content, settings.includeTags);
                    if (settings.applyExcludeAfterInclude && content) {
                        content = removeTaggedContent(content, settings.excludeTags);
                    }
                } else {
                    content = removeTaggedContent(content, settings.excludeTags);
                }
                
                return `${name}: ${content}`;
            });
            chatHistory = lines.join('\n\n');
        } else {
            // 使用全局设置
            const historyCount = settings.historyCount ?? 50;
            chatHistory = getChatHistory(historyCount);
        }
        
        // 获取世界书内容
        const worldInfo = await getWorldInfoContent({ 
            activatedOnly: true,
            startLayer: task.historyStartLayer,
            endLayer: task.historyEndLayer
        });
        
        // 构建变量替换函数
        const replaceVars = (template) => {
            return template
                .replace(/\{\{user\}\}/g, userName)
                .replace(/\{\{char\}\}/g, charName)
                .replace(/\{\{description\}\}/g, description)
                .replace(/\{\{persona\}\}/g, persona)
                .replace(/\{\{worldInfo\}\}/g, worldInfo)
                .replace(/\{\{chatHistory\}\}/g, chatHistory);
        };
        
        // 构建消息
        const messages = [
            { role: 'user', content: replaceVars(task.promptU1 || '') },
            { role: 'assistant', content: replaceVars(task.promptA1 || '') },
            { role: 'user', content: replaceVars(task.promptU2 || '') },
            { role: 'assistant', content: replaceVars(task.promptA2 || '') }
        ].filter(m => m.content); // 过滤掉空消息
        
        if (messages.length === 0) {
            showTaskStatus('任务提示词为空', true);
            return;
        }
        
        console.log(`[${EXT_NAME}] 运行任务: ${task.name}`, messages);
        
        // 调用 LLM
        let result = await callLLMJson(messages, true);
        
        if (!result) {
            // 如果不是数组，尝试作为对象处理
            result = await callLLMJson(messages, false);
        }
        
        if (!result) {
            showTaskStatus('未能从AI返回中提取有效数据', true);
            return;
        }
        
        // 显示结果确认弹窗
        showTaskResultModal(task, result);
        showTaskStatus(`提取完成，请确认结果`);
        
    } catch (e) {
        console.error(`[${EXT_NAME}] 任务运行失败:`, e);
        showTaskStatus(`运行失败: ${e.message}`, true);
    } finally {
        isTaskRunning = false;
        $('.jtw-task-run').prop('disabled', false);
    }
}

/**
 * 显示任务结果确认弹窗
 * @param {object} task - 任务对象
 * @param {object|Array} result - AI 返回的结果
 */
function showTaskResultModal(task, result) {
    const { jsonToYaml } = dependencies;
    const isArray = Array.isArray(result);
    
    // 格式化内容时去除世界书属性
    const formatItem = (item) => {
        const cleaned = { ...item };
        delete cleaned.keys;
        delete cleaned.aliases;
        delete cleaned.constant;
        delete cleaned.selective;
        delete cleaned.position;
        delete cleaned.depth;
        delete cleaned.order;
        delete cleaned.excludeRecursion;
        delete cleaned.preventRecursion;
        delete cleaned.keysecondary;
        return jsonToYaml(cleaned, 0);
    };
    
    const content = isArray 
        ? result.map(item => formatItem(item)).join('\n\n')
        : formatItem(result);
    
    // 从结果中提取世界书属性（如果有的话）
    // 优先级：JSON返回的属性 > 任务保存的默认值 > 全局默认值
    const firstItem = isArray ? result[0] : result;
    const taskDefaults = task.worldbookDefaults || {};
    
    const entryName = firstItem?.name || firstItem?.title || taskDefaults.entryName || task.name;
    const entryKeys = firstItem?.keys || firstItem?.aliases || taskDefaults.entryKeys || [];
    const entryConstant = firstItem?.constant ?? taskDefaults.entryConstant ?? false;
    const entryPosition = firstItem?.position ?? taskDefaults.entryPosition ?? 0;
    const entryDepth = firstItem?.depth ?? taskDefaults.entryDepth ?? 4;
    const entryOrder = firstItem?.order ?? taskDefaults.entryOrder ?? 100;
    
    // 填充弹窗
    $('#jtw-task-result-content').val(content);
    $('#jtw-task-result-count').text(isArray ? `提取到 ${result.length} 条数据` : '提取到 1 条数据');
    $('#jtw-task-result-entry-name').val(entryName);
    $('#jtw-task-result-entry-keys').val(Array.isArray(entryKeys) ? entryKeys.join(',') : entryKeys);
    $('#jtw-task-result-entry-constant').prop('checked', entryConstant);
    $('#jtw-task-result-entry-position').val(entryPosition);
    $('#jtw-task-result-entry-depth').val(entryDepth);
    $('#jtw-task-result-entry-order').val(entryOrder);
    
    // 显示/隐藏深度
    if (entryPosition === 4) {
        $('#jtw-task-result-depth-container').show();
    } else {
        $('#jtw-task-result-depth-container').hide();
    }
    
    // 存储原始数据供保存时使用
    $('#jtw-task-result-modal').data('result', result);
    $('#jtw-task-result-modal').data('task', task);
    
    $('#jtw-task-result-modal').fadeIn(200);
}

/**
 * 隐藏任务结果弹窗
 */
function hideTaskResultModal() {
    $('#jtw-task-result-modal').fadeOut(200);
}

/**
 * 保存任务结果到世界书
 */
async function saveTaskResult() {
    const { getSettings, getCharacterWorldbook, loadWorldInfo, saveWorldInfo, jsonToYaml, saveJsonToWorldbook, createWorldInfoEntry } = dependencies;
    
    const $modal = $('#jtw-task-result-modal');
    const result = $modal.data('result');
    const $saveBtn = $('#jtw-task-result-save');
    const $status = $('#jtw-task-result-status');
    
    if (!result) {
        $status.text('没有可保存的数据').removeClass('success').addClass('error').show();
        setTimeout(() => $status.fadeOut(), 3000);
        return;
    }
    
    // 获取用户设置的世界书属性
    const entryName = $('#jtw-task-result-entry-name').val().trim();
    const entryKeys = $('#jtw-task-result-entry-keys').val().trim();
    const entryConstant = $('#jtw-task-result-entry-constant').prop('checked');
    const entryPosition = parseInt($('#jtw-task-result-entry-position').val());
    const entryDepthValue = $('#jtw-task-result-entry-depth').val();
    const entryDepth = entryDepthValue === '' ? 4 : parseInt(entryDepthValue);
    const entryOrderValue = $('#jtw-task-result-entry-order').val();
    const entryOrder = entryOrderValue === '' ? 100 : parseInt(entryOrderValue);
    
    if (!entryName) {
        $status.text('请输入条目名称').removeClass('success').addClass('error').show();
        setTimeout(() => $status.fadeOut(), 3000);
        return;
    }
    
    $saveBtn.prop('disabled', true).text('保存中...');
    
    try {
        const settings = getSettings();
        const isArray = Array.isArray(result);
        const task = $modal.data('task');
        
        // 保存用户的世界书设置到任务对象，作为下次的默认值
        if (task && settings.customTasks) {
            const taskIndex = settings.customTasks.findIndex(t => t.id === task.id);
            if (taskIndex >= 0) {
                settings.customTasks[taskIndex].worldbookDefaults = {
                    entryName,
                    entryKeys,
                    entryConstant,
                    entryPosition,
                    entryDepth,
                    entryOrder
                };
                settings.customTasks[taskIndex].updatedAt = Date.now();
                saveSettingsCallback();
            }
        }
        
        if (isArray && result.length > 0) {
            // 数组结果：追加到条目
            const targetBook = settings.targetWorldbook || getCharacterWorldbook();
            
            if (!targetBook) {
                throw new Error('未找到有效的世界书');
            }
            
            const worldData = await loadWorldInfo(targetBook);
            if (!worldData) {
                throw new Error('无法加载世界书');
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
                }
            }
            
            if (!entry) {
                entry = createWorldInfoEntry(targetBook, worldData);
            }
            
            // 格式化新内容时去除世界书属性
            const cleanItem = (item) => {
                const cleaned = { ...item };
                delete cleaned.keys;
                delete cleaned.aliases;
                delete cleaned.constant;
                delete cleaned.selective;
                delete cleaned.position;
                delete cleaned.depth;
                delete cleaned.order;
                delete cleaned.excludeRecursion;
                delete cleaned.preventRecursion;
                delete cleaned.keysecondary;
                return cleaned;
            };
            const newContent = result.map(item => jsonToYaml(cleanItem(item), 0)).join('\n\n');
            const finalContent = existingContent 
                ? `${existingContent.trim()}\n\n${newContent}\n\n`
                : `${newContent}\n\n`;
            
            // 设置条目属性
            Object.assign(entry, {
                comment: entryName,
                key: entryKeys ? entryKeys.split(',').map(k => k.trim()) : [entryName],
                content: finalContent,
                constant: entryConstant,
                selective: true,
                disable: false,
                position: entryPosition,
                depth: entryPosition === 4 ? entryDepth : undefined,
                order: entryOrder
            });
            
            await saveWorldInfo(targetBook, worldData, true);
            
            $status.text(`成功保存 ${result.length} 条数据到「${entryName}」`).removeClass('error').addClass('success').show();
        } else {
            // 单对象结果
            const saveResult = await saveJsonToWorldbook(result, {
                name: entryName,
                keys: entryKeys ? entryKeys.split(',').map(k => k.trim()) : [entryName],
                constant: entryConstant,
                position: entryPosition,
                depth: entryDepth,
                order: entryOrder
            });
            
            if (saveResult.success) {
                $status.text(`已${saveResult.isUpdate ? '更新' : '保存'}到世界书`).removeClass('error').addClass('success').show();
            } else {
                throw new Error(saveResult.error);
            }
        }
        
        setTimeout(() => {
            hideTaskResultModal();
        }, 1500);
        
    } catch (e) {
        console.error(`[Custom Tasks] 保存任务结果失败:`, e);
        $status.text(`保存失败: ${e.message}`).removeClass('success').addClass('error').show();
    }
    
    $saveBtn.prop('disabled', false).text('保存到世界书');
    setTimeout(() => $status.fadeOut(), 5000);
}

/**
 * 显示任务状态
 */
export function showTaskStatus(message, isError = false) {
    const $status = $('#jtw-task-status');
    $status.text(message)
        .removeClass('success error')
        .addClass(isError ? 'error' : 'success')
        .show();
    
    setTimeout(() => $status.fadeOut(), 5000);
}

/**
 * 渲染自定义任务面板 HTML
 * @returns {string}
 */
export function renderCustomTasksPanel() {
    return `
        <!-- 提示词预览模态框 -->
        <div id="jtw-prompt-preview-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content">
                <div class="jtw-modal-header">
                    <h3 id="jtw-prompt-preview-title">提示词预览</h3>
                    <button id="jtw-close-prompt-preview" class="jtw-modal-close">✕</button>
                </div>
                <div id="jtw-prompt-preview-content" class="jtw-modal-body">
                    <!-- 提示词内容将在这里动态生成 -->
                </div>
            </div>
        </div>
        
        <!-- 任务列表视图 -->
        <div id="jtw-task-list-view">
            <div class="jtw-section">
                <div class="jtw-task-header">
                    <h4>任务列表</h4>
                    <div class="jtw-task-header-buttons">
                        <button id="jtw-import-tasks" class="jtw-btn jtw-btn-small">📥 导入</button>
                        <button id="jtw-add-task" class="jtw-btn jtw-btn-small primary">➕ 新增</button>
                    </div>
                </div>
                <div id="jtw-task-list" class="jtw-task-list">
                    <!-- 任务条目将在这里动态生成 -->
                    <div class="jtw-task-empty">暂无自定义任务，点击「新增」创建</div>
                </div>
            </div>
            <div id="jtw-task-status" class="jtw-status" style="display: none;"></div>
        </div>
        
        <!-- 任务类型选择视图 -->
        <div id="jtw-task-type-view" style="display: none;">
            <div class="jtw-section">
                <h4>选择任务类型</h4>
                <div class="jtw-task-type-options">
                    <button id="jtw-create-generate-task" class="jtw-task-type-btn">
                        <span class="jtw-task-type-icon">📝</span>
                        <span class="jtw-task-type-name">生成指令</span>
                        <span class="jtw-task-type-desc">调用AI生成内容并保存到世界书</span>
                    </button>
                    <button id="jtw-create-parallel-task" class="jtw-task-type-btn">
                        <span class="jtw-task-type-icon">🔀</span>
                        <span class="jtw-task-type-name">并行注入</span>
                        <span class="jtw-task-type-desc">自动将提示词注入到AI对话中</span>
                    </button>
                </div>
                <div style="margin-top: 15px;">
                    <button id="jtw-cancel-type-select" class="jtw-btn">取消</button>
                </div>
            </div>
        </div>
        
        <!-- 任务编辑视图 -->
        <div id="jtw-task-edit-view" style="display: none;">
            <div class="jtw-section">
                <h4 id="jtw-task-edit-title">新建生成指令</h4>
                <div style="margin-bottom: 10px;">
                    <label>指令名称 <span class="jtw-required">*</span></label>
                    <input type="text" id="jtw-task-name" class="jtw-input" placeholder="例如：提取场景信息" />
                </div>
            </div>
            
            <div class="jtw-section">
                <h4>提示词设置</h4>
                <div style="margin-bottom: 10px;">
                    <label>历史消息层数范围</label>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="number" id="jtw-task-history-start" class="jtw-input" placeholder="开始" min="1" style="flex: 1;" />
                        <span>~</span>
                        <input type="number" id="jtw-task-history-end" class="jtw-input" placeholder="结束" min="1" style="flex: 1;" />
                    </div>
                    <div class="jtw-hint">控制 {{chatHistory}} 变量包含的消息范围（留空使用通用设置）</div>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>User 消息 1</label>
                    <textarea id="jtw-task-prompt-u1" class="jtw-input" rows="2" placeholder="系统角色设定..."></textarea>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>Assistant 消息 1</label>
                    <textarea id="jtw-task-prompt-a1" class="jtw-input" rows="2" placeholder="确认理解..."></textarea>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>User 消息 2</label>
                    <textarea id="jtw-task-prompt-u2" class="jtw-input" rows="8" placeholder="包含{{变量}}的主提示词..."></textarea>
                    <div class="jtw-hint">可用变量: {{user}}, {{char}}, {{description}}, {{persona}}, {{worldInfo}}, {{chatHistory}}</div>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>Assistant 消息 2</label>
                    <textarea id="jtw-task-prompt-a2" class="jtw-input" rows="1" placeholder="开始生成..."></textarea>
                </div>
            </div>
            
            <div class="jtw-section">
                <div class="jtw-task-edit-buttons">
                    <button id="jtw-cancel-task" class="jtw-btn">取消</button>
                    <button id="jtw-save-task" class="jtw-btn primary">保存</button>
                </div>
            </div>
        </div>
        
        <!-- 任务结果确认弹窗 -->
        <div id="jtw-task-result-modal" class="jtw-modal" style="display: none;">
            <div class="jtw-modal-content jtw-ce-modal-content">
                <div class="jtw-modal-header">
                    <h3>任务结果确认</h3>
                    <button class="jtw-modal-close" id="jtw-task-result-close">✕</button>
                </div>
                <div class="jtw-modal-body">
                    <div id="jtw-task-result-count" style="margin-bottom: 10px; color: var(--SmartThemeQuoteColor);"></div>
                    <textarea id="jtw-task-result-content" class="jtw-input" rows="10" style="font-family: monospace; font-size: 12px;"></textarea>
                    
                    <div class="jtw-section" style="margin-top: 15px;">
                        <h4>世界书设置</h4>
                        <div style="margin-bottom: 10px;">
                            <label>条目名称 <span class="jtw-required">*</span></label>
                            <input type="text" id="jtw-task-result-entry-name" class="jtw-input" placeholder="条目名称" />
                        </div>
                        <div style="margin-bottom: 10px;">
                            <label>关键词（逗号分隔，留空使用条目名称）</label>
                            <input type="text" id="jtw-task-result-entry-keys" class="jtw-input" placeholder="关键词1,关键词2" />
                        </div>
                        <div class="jtw-checkbox-row" style="margin-bottom: 10px;">
                            <input type="checkbox" id="jtw-task-result-entry-constant" />
                            <label for="jtw-task-result-entry-constant">始终启用（Constant）</label>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <div style="flex: 1;">
                                <label>条目位置</label>
                                <select id="jtw-task-result-entry-position" class="jtw-select">
                                    <option value="0">角色定义之前</option>
                                    <option value="1">角色定义之后</option>
                                    <option value="2">作者注释之前</option>
                                    <option value="3">作者注释之后</option>
                                    <option value="4">@ Depth</option>
                                </select>
                            </div>
                            <div id="jtw-task-result-depth-container" style="flex: 1; display: none;">
                                <label>深度</label>
                                <input type="number" id="jtw-task-result-entry-depth" class="jtw-input" value="4" min="0" max="999" />
                            </div>
                            <div style="flex: 1;">
                                <label>排序</label>
                                <input type="number" id="jtw-task-result-entry-order" class="jtw-input" value="100" min="0" />
                            </div>
                        </div>
                    </div>
                    
                    <div id="jtw-task-result-status" class="jtw-status" style="display: none; margin-top: 10px;"></div>
                </div>
                <div class="jtw-modal-footer">
                    <button id="jtw-task-result-cancel" class="jtw-btn">取消</button>
                    <button id="jtw-task-result-save" class="jtw-btn primary">保存到世界书</button>
                </div>
            </div>
        </div>
        
        <!-- 并行任务编辑视图 -->
        <div id="jtw-parallel-task-edit-view" style="display: none;">
            <div class="jtw-section">
                <h4 id="jtw-parallel-task-edit-title">新建并行注入</h4>
                <div style="margin-bottom: 10px;">
                    <label>任务名称 <span class="jtw-required">*</span></label>
                    <input type="text" id="jtw-parallel-task-name" class="jtw-input" placeholder="例如：场景描写强化" />
                </div>
            </div>
            
            <div class="jtw-section">
                <h4>提示词设置</h4>
                <div style="margin-bottom: 10px;">
                    <label>注入的提示词 <span class="jtw-required">*</span></label>
                    <textarea id="jtw-parallel-task-prompt" class="jtw-input" rows="8" placeholder="输入要注入到AI对话中的提示词..."></textarea>
                    <div class="jtw-hint">支持变量: {{user}}, {{char}}, {{description}}, {{persona}}, {{worldInfo}}, {{lastMessage}}, {{messageCount}}</div>
                </div>
            </div>
            
            <div class="jtw-section">
                <h4>注入设置</h4>
                <div style="margin-bottom: 10px;">
                    <label>注入位置</label>
                    <select id="jtw-parallel-task-position" class="jtw-select">
                        <option value="before">主提示词之前 (Before Main Prompt)</option>
                        <option value="after">主提示词之后 (After Main Prompt)</option>
                        <option value="chat" selected>深度位置 (@ Depth)</option>
                    </select>
                </div>
                <div id="jtw-parallel-depth-container" style="margin-bottom: 10px;">
                    <label>深度值 (Depth)</label>
                    <input type="number" id="jtw-parallel-task-depth" class="jtw-input" value="4" min="0" max="999" />
                    <div class="jtw-hint">注意：此处的深度，是完整提示词的位置（包括预设，请在提示词查看器中检查） - 0为最底层</div>
                </div>
                <div id="jtw-parallel-role-container" style="margin-bottom: 10px;">
                    <label>注入角色 (Role)</label>
                    <select id="jtw-parallel-task-role" class="jtw-select">
                        <option value="system" selected>System</option>
                        <option value="user">User</option>
                        <option value="assistant">Assistant</option>
                    </select>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>间隔注入（每几楼注入一次）</label>
                    <input type="number" id="jtw-parallel-task-interval" class="jtw-input" value="0" min="0" max="100" />
                    <div class="jtw-hint">0=每次都注入，1=每楼，2=每隔一楼，以此类推（根据当前楼层数计算）</div>
                </div>
            </div>
            
            <div class="jtw-section">
                <div class="jtw-task-edit-buttons">
                    <button id="jtw-cancel-parallel-task" class="jtw-btn">取消</button>
                    <button id="jtw-save-parallel-task" class="jtw-btn primary">保存</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 初始化自定义任务事件绑定
 * @param {function} saveSettingsFn - 保存设置回调
 */
export function initTaskEvents(saveSettingsFn) {
    saveSettingsCallback = saveSettingsFn;
    
    // 新增按钮
    $('#jtw-add-task').on('click', function() {
        showTaskTypeView();
    });
    
    // 导入按钮
    $('#jtw-import-tasks').on('click', importTasks);
    
    // 取消类型选择
    $('#jtw-cancel-type-select').on('click', showTaskListView);
    
    // 选择生成指令类型
    $('#jtw-create-generate-task').on('click', function() {
        editingTaskIndex = -1;
        showTaskEditView(createDefaultTask(), true);
    });
    
    // 选择并行处理类型
    $('#jtw-create-parallel-task').on('click', function() {
        editingTaskIndex = -1;
        showParallelTaskEditView(createDefaultParallelTask(), true);
    });
    
    // 并行任务位置变化时显示/隐藏深度和角色输入框
    $('#jtw-parallel-task-position').on('change', function() {
        if ($(this).val() === 'chat') {
            $('#jtw-parallel-depth-container').show();
            $('#jtw-parallel-role-container').show();
        } else {
            $('#jtw-parallel-depth-container').hide();
            $('#jtw-parallel-role-container').hide();
        }
    });
    
    // 取消编辑并行任务
    $('#jtw-cancel-parallel-task').on('click', function() {
        editingTaskIndex = -1;
        showTaskListView();
    });
    
    // 保存并行任务
    $('#jtw-save-parallel-task').on('click', saveParallelTask);
    
    // 并行任务启用/禁用切换
    $('#jtw-task-list').on('change', '.jtw-task-enable', function() {
        const index = parseInt($(this).data('index'));
        const enabled = $(this).prop('checked');
        toggleParallelTask(index, enabled);
        renderTaskList();
    });
    
    // 取消编辑
    $('#jtw-cancel-task').on('click', function() {
        editingTaskIndex = -1;
        showTaskListView();
    });
    
    // 保存任务
    $('#jtw-save-task').on('click', saveTask);
    
    // 任务结果弹窗事件
    $('#jtw-task-result-close, #jtw-task-result-cancel').on('click', hideTaskResultModal);
    $('#jtw-task-result-save').on('click', saveTaskResult);
    
    // 任务结果弹窗位置变化时显示/隐藏深度输入框
    $('#jtw-task-result-entry-position').on('change', function() {
        if (parseInt($(this).val()) === 4) {
            $('#jtw-task-result-depth-container').show();
        } else {
            $('#jtw-task-result-depth-container').hide();
        }
    });
    
    // 点击任务结果弹窗背景关闭
    $('#jtw-task-result-modal').on('click', function(e) {
        if (e.target === this) {
            hideTaskResultModal();
        }
    });
    
    // 任务列表操作按钮（使用事件委托）
    $('#jtw-task-list').on('click', '.jtw-task-run', function() {
        const index = parseInt($(this).data('index'));
        runTask(index);
    });
    
    $('#jtw-task-list').on('click', '.jtw-task-edit', function() {
        const index = parseInt($(this).data('index'));
        const { getSettings } = dependencies;
        const settings = getSettings();
        if (settings.customTasks && settings.customTasks[index]) {
            editingTaskIndex = index;
            const task = settings.customTasks[index];
            if (task.type === 'parallel') {
                showParallelTaskEditView(task, false);
            } else {
                showTaskEditView(task, false);
            }
        }
    });
    
    $('#jtw-task-list').on('click', '.jtw-task-export', function() {
        const index = parseInt($(this).data('index'));
        exportTask(index);
    });
    
    $('#jtw-task-list').on('click', '.jtw-task-delete', function() {
        const index = parseInt($(this).data('index'));
        deleteTask(index);
    });
    
    // 双击任务条目预览提示词（PC端）
    $('#jtw-task-list').on('dblclick', '.jtw-task-item', function() {
        const index = parseInt($(this).data('index'));
        previewTaskPrompt(index);
    });
    
    // 为触屏设备添加长按预览支持
    let touchTimer;
    let touchMoved = false;
    $('#jtw-task-list').on('touchstart', '.jtw-task-item', function(e) {
        const $item = $(this);
        touchMoved = false;
        touchTimer = setTimeout(() => {
            if (!touchMoved) {
                const index = parseInt($item.data('index'));
                previewTaskPrompt(index);
            }
        }, 500); // 长按500ms触发预览
    });
    
    $('#jtw-task-list').on('touchmove', '.jtw-task-item', function() {
        touchMoved = true;
        clearTimeout(touchTimer);
    });
    
    $('#jtw-task-list').on('touchend touchcancel', '.jtw-task-item', function() {
        clearTimeout(touchTimer);
    });
    
    // 关闭预览模态框
    $('#jtw-close-prompt-preview').on('click', function() {
        $('#jtw-prompt-preview-modal').fadeOut(200);
    });
    
    // 点击模态框背景关闭
    $('#jtw-prompt-preview-modal').on('click', function(e) {
        if (e.target === this) {
            $(this).fadeOut(200);
        }
    });
    
    // 初始渲染任务列表
    renderTaskList();
}

/**
 * 处理提示词注入（在发送给AI之前）
 * @param {object} eventData - 事件数据，包含 chat 数组
 */
export async function onChatCompletionPromptReady(eventData) {
    const { getSettings, getContext, getWorldInfoContent, power_user, EXT_NAME } = dependencies;
    
    try {
        const settings = getSettings();
        if (!settings.enabled) return;
        
        // 过滤出已启用的并行任务
        const parallelTasks = (settings.customTasks || []).filter(
            task => task.type === 'parallel' && task.enabled
        );
        
        if (parallelTasks.length === 0) return;
        
        // 跳过 dryRun
        if (eventData.dryRun) return;
        
        const ctx = getContext();
        const chat = ctx.chat || [];
        const messageCount = chat.length;
        
        // 获取变量数据
        const char = ctx.characters?.[ctx.characterId];
        const description = char?.description || char?.data?.description || '';
        const persona = power_user?.persona_description || '';
        const userName = ctx.name1 || '{{user}}';
        const charName = char?.name || ctx.name2 || '{{char}}';
        const lastMessage = chat.length > 0 ? chat[chat.length - 1]?.mes || '' : '';
        
        // 获取世界书内容（缓存避免多次加载）
        let worldInfoCache = null;
        const getWorldInfo = async () => {
            if (worldInfoCache === null) {
                worldInfoCache = await getWorldInfoContent({ activatedOnly: true });
            }
            return worldInfoCache;
        };
        
        for (const task of parallelTasks) {
            // 检查间隔条件
            if (task.interval > 0) {
                // interval=1 表示每楼都注入
                // interval=2 表示每隔一楼注入（即楼层数能被2整除时注入）
                if (messageCount % task.interval !== 0) {
                    console.log(`[${EXT_NAME}] 跳过注入 "${task.name}": 楼层${messageCount} 不满足间隔${task.interval}`);
                    continue;
                }
            }
            
            // 变量替换
            const worldInfo = await getWorldInfo();
            let prompt = task.prompt || '';
            prompt = prompt
                .replace(/\{\{user\}\}/g, userName)
                .replace(/\{\{char\}\}/g, charName)
                .replace(/\{\{description\}\}/g, description)
                .replace(/\{\{persona\}\}/g, persona)
                .replace(/\{\{worldInfo\}\}/g, worldInfo)
                .replace(/\{\{lastMessage\}\}/g, lastMessage)
                .replace(/\{\{messageCount\}\}/g, String(messageCount));
            
            if (!prompt.trim()) continue;
            
            // 根据位置注入
            const position = task.position || 'chat';
            const role = task.role || 'system';
            const depth = task.depth ?? 4;
            
            const messageObj = { role, content: prompt };
            
            switch (position) {
                case 'before':
                    // 在 main prompt 之前插入
                    eventData.chat.unshift(messageObj);
                    console.log(`[${EXT_NAME}] 注入 "${task.name}" 到 main prompt 之前`);
                    break;
                    
                case 'after':
                    // 在 main prompt 之后、chat 之前插入
                    // 找到第一个非系统消息的位置
                    let insertIndex = 0;
                    for (let i = 0; i < eventData.chat.length; i++) {
                        if (eventData.chat[i].role !== 'system') {
                            insertIndex = i;
                            break;
                        }
                        insertIndex = i + 1;
                    }
                    eventData.chat.splice(insertIndex, 0, messageObj);
                    console.log(`[${EXT_NAME}] 注入 "${task.name}" 到 main prompt 之后 (index: ${insertIndex})`);
                    break;
                    
                case 'chat':
                default:
                    // 在聊天记录中根据 depth 插入
                    if (depth === 0) {
                        eventData.chat.push(messageObj);
                    } else {
                        const spliceIndex = Math.max(0, eventData.chat.length - depth);
                        eventData.chat.splice(spliceIndex, 0, messageObj);
                    }
                    console.log(`[${EXT_NAME}] 注入 "${task.name}" 到聊天 @depth ${depth}`);
                    break;
            }
        }
        
    } catch (error) {
        console.error(`[Custom Tasks] 并行任务注入失败:`, error);
    }
}
