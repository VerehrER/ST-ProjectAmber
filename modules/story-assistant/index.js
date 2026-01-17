/**
 * 故事助手管理器
 * 管理所有内嵌功能模块的注册和渲染
 */

// 功能模块注册表
const registeredModules = new Map();

// 依赖对象
let dependencies = null;

/**
 * 初始化故事助手管理器
 * @param {object} deps - 依赖对象
 */
export function initStoryAssistant(deps) {
    dependencies = deps;
}

/**
 * 注册功能模块
 * @param {object} module - 模块对象
 */
export function registerModule(module) {
    if (!module || !module.getModuleInfo) {
        console.error('[故事助手] 无效的模块');
        return;
    }
    
    const info = module.getModuleInfo();
    if (!info.id) {
        console.error('[故事助手] 模块缺少ID');
        return;
    }
    
    // 初始化模块依赖
    if (module.init && dependencies) {
        module.init(dependencies);
    }
    
    registeredModules.set(info.id, {
        ...info,
        module
    });
    
    console.log(`[故事助手] 注册模块: ${info.name} (${info.id})`);
}

/**
 * 获取所有已注册的模块
 * @returns {Array}
 */
export function getRegisteredModules() {
    return Array.from(registeredModules.values());
}

/**
 * 获取指定模块
 * @param {string} id - 模块ID
 * @returns {object|null}
 */
export function getModule(id) {
    return registeredModules.get(id)?.module || null;
}

/**
 * 渲染功能列表
 * @returns {string}
 */
export function renderFeatureList() {
    const modules = getRegisteredModules();
    
    if (modules.length === 0) {
        return '<div class="jtw-assistant-empty">暂无可用的功能模块</div>';
    }
    
    const items = modules.map(info => `
        <div class="jtw-assistant-item" data-module-id="${info.id}">
            <div class="jtw-assistant-item-icon">${info.icon || '📦'}</div>
            <div class="jtw-assistant-item-info">
                <div class="jtw-assistant-item-name">${escapeHtml(info.name)}</div>
                <div class="jtw-assistant-item-desc">${escapeHtml(info.description || '')}</div>
            </div>
            <div class="jtw-assistant-item-arrow">→</div>
        </div>
    `).join('');
    
    return items;
}

/**
 * 渲染故事助手页面 HTML
 * @returns {string}
 */
export function renderStoryAssistantPanel() {
    // 收集所有模块的设置面板
    let settingsPanels = '';
    for (const [id, info] of registeredModules) {
        if (info.module.renderSettingsPanel) {
            settingsPanels += info.module.renderSettingsPanel();
        }
    }
    
    return `
        <!-- 故事助手功能列表 -->
        <div id="jtw-assistant-list-view">
            <div class="jtw-section">
                <h4>功能列表</h4>
                <div id="jtw-assistant-list" class="jtw-assistant-list">
                    ${renderFeatureList()}
                </div>
            </div>
            <div id="jtw-assistant-status" class="jtw-status" style="display: none;"></div>
        </div>
        
        <!-- 各功能模块的设置面板 -->
        ${settingsPanels}
    `;
}

/**
 * 初始化故事助手事件绑定
 * @param {function} saveSettings - 保存设置回调
 */
export function initStoryAssistantEvents(saveSettings) {
    // 点击功能项进入设置或触发自定义行为
    $('#jtw-assistant-list').on('click', '.jtw-assistant-item', function() {
        const moduleId = $(this).data('module-id');
        const moduleData = registeredModules.get(moduleId);
        
        // 如果模块定义了 onModuleClick 方法，先调用它
        if (moduleData?.module?.onModuleClick) {
            const result = moduleData.module.onModuleClick();
            // 如果返回 false，则不执行默认的面板切换
            if (result === false) {
                return;
            }
        }
        
        // 默认行为：显示模块设置面板
        showModuleSettings(moduleId);
    });
    
    // 返回按钮
    $('#story-assistant').on('click', '.jtw-assistant-back-btn', function() {
        showFeatureList();
    });
    
    // 初始化各模块的事件
    for (const [id, info] of registeredModules) {
        if (info.module.initSettingsEvents) {
            info.module.initSettingsEvents(saveSettings);
        }
    }
}

/**
 * 显示功能列表视图
 */
export function showFeatureList() {
    $('#jtw-assistant-list-view').show();
    $('.jtw-assistant-feature-content').hide();
    
    // 刷新列表
    $('#jtw-assistant-list').html(renderFeatureList());
}

/**
 * 显示模块设置面板
 * @param {string} moduleId - 模块ID
 */
export function showModuleSettings(moduleId) {
    $('#jtw-assistant-list-view').hide();
    $('.jtw-assistant-feature-content').hide();
    
    // 显示对应模块的设置面板
    const settingsId = `#jtw-${moduleId}-settings`;
    $(settingsId).show();
}

/**
 * 显示状态消息
 * @param {string} message - 消息内容
 * @param {boolean} isError - 是否是错误消息
 */
export function showAssistantStatus(message, isError = false) {
    const $status = $('#jtw-assistant-status');
    $status.text(message)
        .removeClass('success error')
        .addClass(isError ? 'error' : 'success')
        .show();
    
    setTimeout(() => $status.fadeOut(), 5000);
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
 * 刷新功能列表（当模块注册变化后）
 */
export function refreshFeatureList() {
    if ($('#jtw-assistant-list-view').is(':visible')) {
        $('#jtw-assistant-list').html(renderFeatureList());
    }
}
