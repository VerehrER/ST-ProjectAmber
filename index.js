/**
 * JSON to Worldbook Extension
 * 从 AI 输出中提取 JSON 数据并保存到世界书
 */

import { extension_settings, getContext } from "../../../extensions.js";
import { eventSource, event_types, saveSettingsDebounced } from "../../../../script.js";
import { 
    loadWorldInfo, 
    saveWorldInfo, 
    world_names, 
    world_info,
    METADATA_KEY 
} from "../../../world-info.js";

const EXT_NAME = "json-to-worldbook";
const EXT_ID = "JsonToWorldbook";

// 默认设置
const defaultSettings = {
    enabled: true,
    autoExtract: false,        // 是否自动从每条消息中提取
    targetWorldbook: "",       // 目标世界书名称（空则使用角色卡绑定的）
    entryPosition: 0,          // 条目插入位置
    entryOrder: 100,           // 条目排序
    lastExtractedJson: null,   // 上次提取的 JSON
};

// ==================== JSON 解析工具 ==================== 

/**
 * 修复常见的 JSON 语法问题
 */
function fixJson(s) {
    if (!s || typeof s !== 'string') return s;

    let r = s.trim()
        .replace(/[""]/g, '"').replace(/['']/g, "'")
        .replace(/"([^"']+)'[\s]*:/g, '"$1":')
        .replace(/'([^"']+)"[\s]*:/g, '"$1":')
        .replace(/:[\s]*'([^']*)'[\s]*([,}\]])/g, ':"$1"$2')
        .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
        .replace(/,[\s\n]*([}\]])/g, '$1')
        .replace(/:\s*undefined\b/g, ': null')
        .replace(/:\s*NaN\b/g, ': null');

    // 补全未闭合的括号
    let braces = 0, brackets = 0, inStr = false, esc = false;
    for (const c of r) {
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (!inStr) {
            if (c === '{') braces++; else if (c === '}') braces--;
            if (c === '[') brackets++; else if (c === ']') brackets--;
        }
    }
    while (braces-- > 0) r += '}';
    while (brackets-- > 0) r += ']';
    return r;
}

/**
 * 从文本中提取 JSON
 * @param {string|object} input - 输入文本或对象
 * @param {boolean} isArray - 是否期望返回数组
 * @returns {object|array|null}
 */
function extractJson(input, isArray = false) {
    if (!input) return null;

    // 处理已经是对象的输入
    if (typeof input === 'object' && input !== null) {
        if (isArray && Array.isArray(input)) return input;
        if (!isArray && !Array.isArray(input)) {
            const content = input.choices?.[0]?.message?.content
                ?? input.content ?? input.reasoning_content;
            if (content != null) return extractJson(String(content).trim(), isArray);
            if (!input.choices) return input;
        }
        return null;
    }

    const str = String(input).trim()
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\r\n?/g, '\n');
    if (!str) return null;

    const tryParse = s => { try { return JSON.parse(s); } catch { return null; } };
    const ok = (o, arr) => o != null && (arr ? Array.isArray(o) : typeof o === 'object' && !Array.isArray(o));

    // 直接尝试解析
    let r = tryParse(str);
    if (ok(r, isArray)) return r;

    // 扫描所有 {...} 或 [...] 结构
    const open = isArray ? '[' : '{';
    const candidates = [];

    for (let i = 0; i < str.length; i++) {
        if (str[i] !== open) continue;

        let depth = 0, inString = false, esc = false;
        for (let j = i; j < str.length; j++) {
            const c = str[j];
            if (esc) { esc = false; continue; }
            if (c === '\\' && inString) { esc = true; continue; }
            if (c === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (c === '{' || c === '[') depth++;
            else if (c === '}' || c === ']') depth--;
            if (depth === 0) {
                candidates.push({ start: i, end: j, text: str.slice(i, j + 1) });
                i = j;
                break;
            }
        }
    }

    // 按长度排序（大的优先）
    candidates.sort((a, b) => b.text.length - a.text.length);

    // 尝试解析每个候选
    for (const { text } of candidates) {
        r = tryParse(text);
        if (ok(r, isArray)) return r;

        const fixed = fixJson(text);
        r = tryParse(fixed);
        if (ok(r, isArray)) return r;
    }

    // 最后尝试：取第一个 { 到最后一个 } 之间的内容
    if (!isArray) {
        const firstBrace = str.indexOf('{');
        const lastBrace = str.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            const chunk = str.slice(firstBrace, lastBrace + 1);
            r = tryParse(chunk) || tryParse(fixJson(chunk));
            if (ok(r, isArray)) return r;
        }
    }

    return null;
}

// ==================== 世界书操作 ====================

/**
 * 获取角色卡绑定的主世界书
 */
function getCharacterWorldbook() {
    const ctx = getContext();
    const char = ctx.characters?.[ctx.characterId];
    if (!char) return null;
    
    const primary = char.data?.extensions?.world;
    if (primary && world_names?.includes(primary)) {
        return primary;
    }
    return null;
}

/**
 * 获取可用的世界书列表
 */
function getAvailableWorldbooks() {
    return Array.isArray(world_names) ? world_names.slice() : [];
}

/**
 * 将 JSON 对象转换为 YAML 格式字符串
 */
function jsonToYaml(data, indent = 0) {
    const sp = ' '.repeat(indent);
    if (data === null || data === undefined) return '';
    if (typeof data !== 'object') return String(data);
    if (Array.isArray(data)) {
        return data.map(item => typeof item === 'object' && item !== null
            ? `${sp}- ${jsonToYaml(item, indent + 2).trimStart()}`
            : `${sp}- ${item}`
        ).join('\n');
    }
    return Object.entries(data).map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value) && !value.length) return `${sp}${key}: []`;
            if (!Array.isArray(value) && !Object.keys(value).length) return `${sp}${key}: {}`;
            return `${sp}${key}:\n${jsonToYaml(value, indent + 2)}`;
        }
        return `${sp}${key}: ${value}`;
    }).join('\n');
}

/**
 * 保存 JSON 数据到世界书
 * @param {object} jsonData - 要保存的 JSON 数据
 * @param {object} options - 选项
 * @returns {Promise<{success: boolean, uid?: string, error?: string}>}
 */
async function saveJsonToWorldbook(jsonData, options = {}) {
    try {
        const settings = getSettings();
        
        // 确定目标世界书
        let targetBook = options.worldbook || settings.targetWorldbook;
        if (!targetBook) {
            targetBook = getCharacterWorldbook();
        }
        
        if (!targetBook || !world_names?.includes(targetBook)) {
            return { success: false, error: "未找到有效的世界书，请先绑定或选择世界书" };
        }

        // 加载世界书
        const worldData = await loadWorldInfo(targetBook);
        if (!worldData) {
            return { success: false, error: `无法加载世界书: ${targetBook}` };
        }

        // 动态导入创建条目函数
        const { createWorldInfoEntry } = await import("../../../world-info.js");
        
        // 创建新条目
        const entry = createWorldInfoEntry(targetBook, worldData);
        if (!entry) {
            return { success: false, error: "创建世界书条目失败" };
        }

        // 确定条目名称和关键词
        const entryName = options.name || jsonData.name || jsonData.title || `JSON Entry ${Date.now()}`;
        const keys = options.keys || jsonData.aliases || jsonData.keys || [entryName];

        // 设置条目属性
        Object.assign(entry, {
            key: Array.isArray(keys) ? keys : [keys],
            comment: entryName,
            content: options.asJson ? JSON.stringify(jsonData, null, 2) : jsonToYaml(jsonData),
            constant: options.constant ?? false,
            selective: options.selective ?? true,
            disable: options.disable ?? false,
            position: options.position ?? settings.entryPosition ?? 0,
            order: options.order ?? settings.entryOrder ?? 100,
        });

        // 保存世界书
        await saveWorldInfo(targetBook, worldData, true);

        console.log(`[${EXT_NAME}] 条目已保存到 ${targetBook}, UID: ${entry.uid}`);
        
        return { success: true, uid: String(entry.uid), worldbook: targetBook };
    } catch (e) {
        console.error(`[${EXT_NAME}] 保存失败:`, e);
        return { success: false, error: e.message };
    }
}

// ==================== 设置管理 ====================

function getSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = { ...defaultSettings };
    }
    return extension_settings[EXT_ID];
}

function saveSettings() {
    saveSettingsDebounced();
}

// ==================== UI ====================

function createSettingsUI() {
    const settingsHtml = `
    <div id="json-to-worldbook-panel" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>JSON to Worldbook</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="jtw-section">
                    <h4>基本设置</h4>
                    <div class="jtw-checkbox-row">
                        <input type="checkbox" id="jtw-enabled" />
                        <label for="jtw-enabled">启用扩展</label>
                    </div>
                    <div class="jtw-checkbox-row">
                        <input type="checkbox" id="jtw-auto-extract" />
                        <label for="jtw-auto-extract">自动提取（每条AI消息）</label>
                    </div>
                </div>
                
                <div class="jtw-section">
                    <h4>世界书设置</h4>
                    <label>目标世界书（留空使用角色卡绑定的）</label>
                    <select id="jtw-target-worldbook" class="jtw-select">
                        <option value="">-- 使用角色卡世界书 --</option>
                    </select>
                    <div style="margin-top: 10px;">
                        <label>条目位置</label>
                        <select id="jtw-entry-position" class="jtw-select">
                            <option value="0">Before Char Defs (0)</option>
                            <option value="1">After Char Defs (1)</option>
                            <option value="2">Top of AN (2)</option>
                            <option value="3">Bottom of AN (3)</option>
                            <option value="4">@ Depth (4)</option>
                        </select>
                    </div>
                    <div style="margin-top: 10px;">
                        <label>排序优先级</label>
                        <input type="number" id="jtw-entry-order" class="jtw-input" value="100" min="0" />
                    </div>
                </div>
                
                <div class="jtw-section">
                    <h4>手动操作</h4>
                    <button id="jtw-extract-last" class="jtw-btn">从最后一条消息提取</button>
                    <button id="jtw-save-to-wb" class="jtw-btn primary" disabled>保存到世界书</button>
                    <div id="jtw-status" class="jtw-status" style="display: none;"></div>
                    <div id="jtw-json-preview" class="jtw-json-preview" style="display: none;"></div>
                </div>
            </div>
        </div>
    </div>`;

    $('#extensions_settings2').append(settingsHtml);

    // 绑定事件
    const settings = getSettings();

    $('#jtw-enabled').prop('checked', settings.enabled).on('change', function() {
        settings.enabled = $(this).prop('checked');
        saveSettings();
    });

    $('#jtw-auto-extract').prop('checked', settings.autoExtract).on('change', function() {
        settings.autoExtract = $(this).prop('checked');
        saveSettings();
    });

    // 填充世界书下拉列表
    updateWorldbookSelect();

    $('#jtw-target-worldbook').val(settings.targetWorldbook).on('change', function() {
        settings.targetWorldbook = $(this).val();
        saveSettings();
    });

    $('#jtw-entry-position').val(settings.entryPosition).on('change', function() {
        settings.entryPosition = parseInt($(this).val());
        saveSettings();
    });

    $('#jtw-entry-order').val(settings.entryOrder).on('change', function() {
        settings.entryOrder = parseInt($(this).val()) || 100;
        saveSettings();
    });

    // 手动提取按钮
    $('#jtw-extract-last').on('click', extractFromLastMessage);
    
    // 保存按钮
    $('#jtw-save-to-wb').on('click', saveExtractedJson);
}

function updateWorldbookSelect() {
    const $select = $('#jtw-target-worldbook');
    const currentVal = $select.val();
    $select.find('option:not(:first)').remove();
    
    getAvailableWorldbooks().forEach(name => {
        $select.append(`<option value="${name}">${name}</option>`);
    });
    
    if (currentVal) {
        $select.val(currentVal);
    }
}

function showStatus(message, isError = false) {
    const $status = $('#jtw-status');
    $status.text(message)
        .removeClass('success error')
        .addClass(isError ? 'error' : 'success')
        .show();
    
    setTimeout(() => $status.fadeOut(), 5000);
}

function showJsonPreview(json) {
    const $preview = $('#jtw-json-preview');
    if (json) {
        $preview.text(JSON.stringify(json, null, 2)).show();
        $('#jtw-save-to-wb').prop('disabled', false);
    } else {
        $preview.hide();
        $('#jtw-save-to-wb').prop('disabled', true);
    }
}

// ==================== 核心功能 ====================

/**
 * 从最后一条 AI 消息中提取 JSON
 */
function extractFromLastMessage() {
    const ctx = getContext();
    const chat = ctx.chat;
    
    if (!chat || chat.length === 0) {
        showStatus("没有聊天记录", true);
        return null;
    }

    // 找到最后一条 AI 消息
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg.is_user && msg.mes) {
            const json = extractJson(msg.mes);
            if (json) {
                const settings = getSettings();
                settings.lastExtractedJson = json;
                saveSettings();
                
                showStatus("成功提取 JSON 数据");
                showJsonPreview(json);
                return json;
            }
        }
    }

    showStatus("未能从消息中提取到有效的 JSON", true);
    showJsonPreview(null);
    return null;
}

/**
 * 保存已提取的 JSON 到世界书
 */
async function saveExtractedJson() {
    const settings = getSettings();
    const json = settings.lastExtractedJson;
    
    if (!json) {
        showStatus("没有可保存的 JSON 数据", true);
        return;
    }

    const result = await saveJsonToWorldbook(json);
    
    if (result.success) {
        showStatus(`已保存到 ${result.worldbook} (UID: ${result.uid})`);
        settings.lastExtractedJson = null;
        showJsonPreview(null);
        saveSettings();
    } else {
        showStatus(result.error, true);
    }
}

/**
 * 处理新消息（自动提取模式）
 */
function onMessageReceived(mesId) {
    const settings = getSettings();
    if (!settings.enabled || !settings.autoExtract) return;

    const ctx = getContext();
    const msg = ctx.chat?.[mesId];
    
    if (!msg || msg.is_user) return;

    const json = extractJson(msg.mes);
    if (json) {
        console.log(`[${EXT_NAME}] 自动提取到 JSON:`, json);
        settings.lastExtractedJson = json;
        saveSettings();
        showJsonPreview(json);
        showStatus("自动提取到 JSON 数据，点击保存按钮写入世界书");
    }
}

// ==================== 导出 API ====================

// 供其他扩展或脚本使用
window.JsonToWorldbook = {
    extractJson,
    saveJsonToWorldbook,
    getAvailableWorldbooks,
    getCharacterWorldbook,
};

// ==================== 初始化 ====================

jQuery(async () => {
    console.log(`[${EXT_NAME}] 初始化...`);
    
    // 创建设置界面
    createSettingsUI();
    
    // 监听消息事件
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    
    // 监听角色切换，更新世界书列表
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(updateWorldbookSelect, 500);
    });

    console.log(`[${EXT_NAME}] 初始化完成`);
});
