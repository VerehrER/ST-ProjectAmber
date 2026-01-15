/**
 * Project Amber Extension
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
import { oai_settings, getChatCompletionModel, chat_completion_sources } from "../../../openai.js";
import { ChatCompletionService } from "../../../custom-request.js";
import { power_user } from "../../../power-user.js";

const EXT_NAME = "Project Amber";
const EXT_ID = "JsonToWorldbook";

// 默认设置
const defaultSettings = {
    enabled: true,
    autoExtract: false,        // 是否自动从每条消息中提取
    targetWorldbook: "",       // 目标世界书名称（空则使用角色卡绑定的）
    entryPosition: 0,          // 条目插入位置
    entryOrder: 100,           // 条目排序
    depth: 4,                  // @ Depth 的深度值
    lastExtractedJson: null,   // 上次提取的 JSON
    // 自定义任务列表
    customTasks: [],           // 自定义任务条目数组
    // 角色列表提取设置
    extractModel: "",          // 自定义模型名称（留空使用当前模型）
    includeTags: "",           // 仅包括的标签列表（留空则不限制）
    applyExcludeAfterInclude: false,  // 提取包括标签后是否再执行排除处理
    excludeTags: "summary,safety",  // 要排除的标签列表
    thoughtTags: "think,thinking,thought",  // 思维链标签（会处理孤立闭合标签）
    aggressiveThoughtRemoval: false,  // 激进删除思维链：直接删除最后一个闭合标签前的所有内容
    historyCount: 50,          // 发送的历史消息数量
    characterListPosition: 0,  // 角色列表条目位置
    characterListOrder: 100,   // 角色列表条目排序
    characterListDepth: 4,     // 角色列表 @ Depth 的深度值
    characterListName: "出场角色列表",  // 角色列表世界书条目名称
    // 角色提取提示词
    promptU1: "你是TRPG数据整理助手。从剧情文本中提取{{user}}遇到的所有角色/NPC，整理为JSON数组。",
    promptA1: "明白。请提供【世界观】和【剧情经历】，我将提取角色并以JSON数组输出。",
    promptU2: `**1. 世界观：**
<world_info>
{{description}}
{{worldInfo}}
玩家角色：{{user}}
{{persona}}
</world_info>

**2. {{user}}经历：**
<chat_history>
{{chatHistory}}
</chat_history>

### 输出要求

1. 返回一个合法 JSON 数组，使用标准 JSON 语法（键名和字符串都用半角双引号 "）
2. 只提取有具体称呼的新角色，不包括{{user}}自己和<world_info>中已经存在设定信息的角色。
3. 文本内容中如需使用引号，请使用单引号或中文引号「」或“”，不要使用半角双引号 "
4. 如果没有新角色返回 []

模板: [{
  "name": "角色名",
  "intro": "外貌特征与身份的详细描述",
  "background": "角色生平与背景。解释由于什么过去导致了现在的性格，以及他为什么会出现在当前场景中。",
  "persona": {
    "keywords": ["性格关键词1", "性格关键词2", "性格关键词3"],
    "speaking_style": "说话的语气、语速、口癖（如喜欢用'嗯'、'那个'）等。对待主角的态度（尊敬、喜爱、蔑视、恐惧等）。"
  }
}]`,
    promptA2: "了解，开始生成JSON:",

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

// ==================== 角色列表提取 ====================

/**
 * 仅提取指定标签内的内容，删除其他所有内容
 * @param {string} text - 输入文本
 * @param {string} tagsString - 逗号分隔的标签列表
 * @returns {string}
 */
function extractIncludeTags(text, tagsString) {
    if (!text || !tagsString) return text;
    
    const tags = tagsString.split(',').map(t => t.trim()).filter(t => t);
    if (tags.length === 0) return text;
    
    let extractedContent = [];
    
    for (const tag of tags) {
        // 匹配所有 <tag>...</tag> 格式的内容
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
            extractedContent.push(match[1].trim());
        }
    }
    
    // 如果没有找到任何匹配，返回空字符串
    if (extractedContent.length === 0) return '';
    
    return extractedContent.join('\n\n');
}

/**
 * 根据设置中的标签列表，从文本中移除指定标签的内容
 * @param {string} text - 输入文本
 * @param {string} tagsString - 逗号分隔的标签列表
 * @returns {string}
 */
function removeTaggedContent(text, tagsString) {
    if (!text) return text;
    
    let result = text;
    const settings = getSettings();
        
    // 1. 独立处理思维链标签（处理孤立闭合标签）
    const thoughtTagsStr = settings.thoughtTags || 'think,thinking,thought';
    const thoughtTags = thoughtTagsStr.split(',').map(t => t.trim()).filter(t => t);
    
    for (const tag of thoughtTags) {
        if (settings.aggressiveThoughtRemoval) {
            // 激进模式：找到最后一个闭合标签，删除它之前的所有内容
            const lastCloseRegex = new RegExp(`^[\\s\\S]*<\\/${tag}>`, 'i');
            if (lastCloseRegex.test(result)) {
                result = result.replace(lastCloseRegex, '');
            }
        } else {
            // 标准模式：先删除完整配对的思维链标签
            const pairRegex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
            result = result.replace(pairRegex, '');
            
            // 然后处理孤立闭合标签
            const closeTagRegex = new RegExp(`<\\/${tag}>`, 'i');
            const openTagRegex = new RegExp(`<${tag}[^>]*>`, 'i');
            
            // 如果存在闭合标签但不存在开启标签，说明是跨消息的思维链
            if (closeTagRegex.test(result) && !openTagRegex.test(result)) {
                // 删除从开头到闭合标签（包括闭合标签）的所有内容
                const deleteRegex = new RegExp(`^[\\s\\S]*?<\\/${tag}>`, 'i');
                result = result.replace(deleteRegex, '');
            }
        }
    }
    
    // 2. 处理排除标签列表（删除完整配对的标签内容）
    if (tagsString) {
        const tags = tagsString.split(',').map(t => t.trim()).filter(t => t);
        for (const tag of tags) {
            const pairRegex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
            result = result.replace(pairRegex, '');
        }
    }
    
    return result.trim();
}

/**
 * 获取角色卡的世界书内容
 * @returns {Promise<string>}
 */
async function getWorldInfoContent() {
    try {
        const targetBook = getCharacterWorldbook();
        if (!targetBook) return '';
        
        const worldData = await loadWorldInfo(targetBook);
        if (!worldData?.entries) return '';
        
        // 获取所有启用的条目
        const entriesArray = Object.values(worldData.entries);
        const activeEntries = entriesArray.filter(e => 
            e && !e.disable && e.content
        );
        
        if (activeEntries.length === 0) return '';
        
        // 格式化为文本
        const lines = activeEntries.map(e => {
            const keys = Array.isArray(e.key) ? e.key.join(', ') : e.key;
            const title = e.comment || keys || '未命名条目';
            return `[${title}]\n${e.content}`;
        });
        
        return '\n\n' + lines.join('\n\n');
    } catch (e) {
        console.error(`[${EXT_NAME}] 获取世界书内容失败:`, e);
        return '';
    }
}

/**
 * 获取聊天历史并进行预处理
 * @param {number} count - 获取的消息数量
 * @returns {string}
 */
function getChatHistory(count) {
    const ctx = getContext();
    const chat = ctx.chat || [];
    const settings = getSettings();
    
    const recentMessages = chat.slice(-count);
    const lines = recentMessages.map(msg => {
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
    
    return lines.join('\n\n');
}

/**
 * 构建角色提取的消息
 * @param {object} vars - 变量对象
 * @returns {Array}
 */
function buildExtractCharactersMessages(vars) {
    const settings = getSettings();
    const prompts = {
        u1: settings.promptU1,
        a1: settings.promptA1,
        u2: settings.promptU2,
        a2: settings.promptA2
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
 * 调用 LLM API
 * @param {Array} messages - 消息数组
 * @returns {Promise<string>}
 */
async function callLLM(messages) {
    const settings = getSettings();
    
    // 获取当前 API 源
    const source = oai_settings?.chat_completion_source;
    if (!source) {
        throw new Error('未配置 API，请先在酒馆中配置 API');
    }
    
    // 获取模型
    const model = settings.extractModel?.trim() || getChatCompletionModel();
    if (!model) {
        throw new Error('未检测到模型，请在设置中指定模型或在酒馆中选择模型');
    }
    
    console.log(`[${EXT_NAME}] 调用 LLM: source=${source}, model=${model}`);
    
    // 构建请求体
    const body = {
        stream: false,
        messages,
        model,
        chat_completion_source: source,
        max_tokens: oai_settings?.openai_max_tokens || 4096,
        temperature: oai_settings?.temp_openai ?? 0.7,
    };
    
    // 处理代理设置
    const PROXY_SUPPORTED = new Set([
        chat_completion_sources.OPENAI,
        chat_completion_sources.CLAUDE,
        chat_completion_sources.MAKERSUITE,
        chat_completion_sources.DEEPSEEK,
    ]);
    
    if (PROXY_SUPPORTED.has(source) && oai_settings?.reverse_proxy) {
        body.reverse_proxy = String(oai_settings.reverse_proxy).replace(/\/?$/, '');
        if (oai_settings?.proxy_password) {
            body.proxy_password = String(oai_settings.proxy_password);
        }
    }
    
    if (source === chat_completion_sources.CUSTOM) {
        if (oai_settings?.custom_url) {
            body.custom_url = String(oai_settings.custom_url);
        }
        if (oai_settings?.custom_include_headers) {
            body.custom_include_headers = oai_settings.custom_include_headers;
        }
        if (oai_settings?.custom_include_body) {
            body.custom_include_body = oai_settings.custom_include_body;
        }
        if (oai_settings?.custom_exclude_body) {
            body.custom_exclude_body = oai_settings.custom_exclude_body;
        }
    }
    
    // 发送请求
    const payload = ChatCompletionService.createRequestData(body);
    const response = await ChatCompletionService.sendRequest(payload, false);
    
    // 解析响应
    let result = '';
    if (response && typeof response === 'object') {
        const msg = response?.choices?.[0]?.message;
        result = String(
            msg?.content ??
            msg?.reasoning_content ??
            response?.choices?.[0]?.text ??
            response?.content ??
            response?.reasoning_content ??
            ''
        );
    } else {
        result = String(response ?? '');
    }
    
    return result;
}

/**
 * 调用 LLM 并解析 JSON 结果
 * @param {Array} messages - 消息数组
 * @param {boolean} isArray - 是否期望返回数组
 * @returns {Promise<object|array|null>}
 */
async function callLLMJson(messages, isArray = false) {
    try {
        const result = await callLLM(messages);
        console.log(`[${EXT_NAME}] LLM 返回:`, result.slice(0, 500));
        
        const parsed = extractJson(result, isArray);
        if (parsed) {
            console.log(`[${EXT_NAME}] 解析成功:`, parsed);
            return parsed;
        }
        
        console.warn(`[${EXT_NAME}] JSON 解析失败`);
        return null;
    } catch (e) {
        console.error(`[${EXT_NAME}] LLM 调用失败:`, e);
        throw e;
    }
}

/**
 * 获取已存在的角色列表（从世界书）
 * @returns {Promise<Array>}
 */
async function getExistingCharacters() {
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
        console.error(`[${EXT_NAME}] 获取已有角色失败:`, e);
        return [];
    }
}

/**
 * 保存角色列表到世界书（追加模式）
 * @param {Array} characters - 角色列表
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function saveCharacterListToWorldbook(characters) {
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
                console.log(`[${EXT_NAME}] 找到已有条目，将追加内容`);
            }
        }

        // 如果不存在，创建新条目
        if (!entry) {
            const { createWorldInfoEntry } = await import("../../../world-info.js");
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

        console.log(`[${EXT_NAME}] 角色列表已保存到 ${targetBook}, UID: ${entry.uid}`);
        
        return { success: true, uid: String(entry.uid), worldbook: targetBook, count: characters.length };
    } catch (e) {
        console.error(`[${EXT_NAME}] 保存角色列表失败:`, e);
        return { success: false, error: e.message };
    }
}

/**
 * 执行角色列表提取
 */
async function extractCharacterList() {
    const settings = getSettings();
    const ctx = getContext();
    
    showStatus("正在提取角色列表...");
    $('#jtw-extract-characters').prop('disabled', true);
    
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
        
        console.log(`[${EXT_NAME}] 开始提取角色...`);
        
        // 调用 LLM
        const result = await callLLMJson(messages, true);
        
        if (!result || !Array.isArray(result)) {
            showStatus("未能提取到角色数据", true);
            return;
        }
        
        if (result.length === 0) {
            showStatus("没有发现新角色");
            return;
        }
        
        // 过滤掉已存在的角色
        const newCharacters = result.filter(c => 
            c.name && !existingNames.some(en => 
                en.toLowerCase() === c.name.toLowerCase()
            )
        );
        
        if (newCharacters.length === 0) {
            showStatus("没有发现新角色（所有角色已存在）");
            return;
        }
        
        console.log(`[${EXT_NAME}] 发现 ${newCharacters.length} 个新角色:`, newCharacters);
        
        // 保存到世界书
        const saveResult = await saveCharacterListToWorldbook(newCharacters);
        
        if (saveResult.success) {
            showStatus(`成功添加 ${saveResult.count} 个角色到「出场角色列表」`);
        } else {
            showStatus(saveResult.error, true);
        }
        
    } catch (e) {
        console.error(`[${EXT_NAME}] 提取角色失败:`, e);
        showStatus(`提取失败: ${e.message}`, true);
    } finally {
        $('#jtw-extract-characters').prop('disabled', false);
    }
}

// ==================== 自定义任务功能 ====================

// 当前运行状态
let isTaskRunning = false;
// 当前编辑的任务索引（-1表示新建）
let editingTaskIndex = -1;

/**
 * 生成唯一ID
 */
function generateTaskId() {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 创建默认任务对象
 */
function createDefaultTask() {
    return {
        id: generateTaskId(),
        type: 'generate',  // 'generate' 或 'parallel'
        name: '',
        promptU1: '',
        promptA1: '',
        promptU2: '',
        promptA2: '',
        entryTitle: '',
        entryKeys: '',
        entryConstant: false,
        entryPosition: 0,
        entryDepth: 4,
        entryOrder: 100,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/**
 * 渲染任务列表
 */
function renderTaskList() {
    const settings = getSettings();
    const tasks = settings.customTasks || [];
    const $list = $('#jtw-task-list');
    
    if (tasks.length === 0) {
        $list.html('<div class="jtw-task-empty">暂无自定义任务，点击「新增」创建</div>');
        return;
    }
    
    const items = tasks.map((task, index) => {
        const typeIcon = task.type === 'parallel' ? '🔀' : '📝';
        const typeName = task.type === 'parallel' ? '并行处理' : '生成指令';
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
    }).join('');
    
    $list.html(items);
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
 * 显示任务列表视图
 */
function showTaskListView() {
    $('#jtw-task-list-view').show();
    $('#jtw-task-type-view').hide();
    $('#jtw-task-edit-view').hide();
    renderTaskList();
}

/**
 * 显示任务类型选择视图
 */
function showTaskTypeView() {
    $('#jtw-task-list-view').hide();
    $('#jtw-task-type-view').show();
    $('#jtw-task-edit-view').hide();
}

/**
 * 显示任务编辑视图
 */
function showTaskEditView(task, isNew = true) {
    $('#jtw-task-list-view').hide();
    $('#jtw-task-type-view').hide();
    $('#jtw-task-edit-view').show();
    
    // 设置标题
    $('#jtw-task-edit-title').text(isNew ? '新建生成指令' : '编辑生成指令');
    
    // 填充表单
    $('#jtw-task-name').val(task.name || '');
    $('#jtw-task-prompt-u1').val(task.promptU1 || '');
    $('#jtw-task-prompt-a1').val(task.promptA1 || '');
    $('#jtw-task-prompt-u2').val(task.promptU2 || '');
    $('#jtw-task-prompt-a2').val(task.promptA2 || '');
    $('#jtw-task-entry-title').val(task.entryTitle || '');
    $('#jtw-task-entry-keys').val(task.entryKeys || '');
    $('#jtw-task-entry-constant').prop('checked', task.entryConstant || false);
    $('#jtw-task-entry-position').val(task.entryPosition || 0);
    $('#jtw-task-entry-depth').val(task.entryDepth || 4);
    $('#jtw-task-entry-order').val(task.entryOrder || 100);
    
    // 显示/隐藏深度输入框
    if (parseInt($('#jtw-task-entry-position').val()) === 4) {
        $('#jtw-task-depth-container').show();
    } else {
        $('#jtw-task-depth-container').hide();
    }
}

/**
 * 从表单获取任务数据
 */
function getTaskFromForm() {
    return {
        name: $('#jtw-task-name').val().trim(),
        promptU1: $('#jtw-task-prompt-u1').val(),
        promptA1: $('#jtw-task-prompt-a1').val(),
        promptU2: $('#jtw-task-prompt-u2').val(),
        promptA2: $('#jtw-task-prompt-a2').val(),
        entryTitle: $('#jtw-task-entry-title').val().trim(),
        entryKeys: $('#jtw-task-entry-keys').val().trim(),
        entryConstant: $('#jtw-task-entry-constant').prop('checked'),
        entryPosition: parseInt($('#jtw-task-entry-position').val()),
        entryDepth: parseInt($('#jtw-task-entry-depth').val()) || 4,
        entryOrder: parseInt($('#jtw-task-entry-order').val()) || 100
    };
}

/**
 * 保存任务
 */
function saveTask() {
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
    if (!formData.entryTitle) {
        showTaskStatus('请输入条目标题', true);
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
    
    saveSettings();
    showTaskListView();
    showTaskStatus(editingTaskIndex >= 0 ? '任务已更新' : '任务已创建');
    editingTaskIndex = -1;
}

/**
 * 删除任务
 */
function deleteTask(index) {
    const settings = getSettings();
    if (!settings.customTasks || index < 0 || index >= settings.customTasks.length) {
        return;
    }
    
    const task = settings.customTasks[index];
    if (!confirm(`确定要删除任务「${task.name || '未命名'}」吗？`)) {
        return;
    }
    
    settings.customTasks.splice(index, 1);
    saveSettings();
    renderTaskList();
    showTaskStatus('任务已删除');
}

/**
 * 导出单个任务
 */
function exportTask(index) {
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
            saveSettings();
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
    const settings = getSettings();
    if (!settings.customTasks || index < 0 || index >= settings.customTasks.length) {
        return;
    }
    
    const task = settings.customTasks[index];
    
    try {
        const ctx = getContext();
        const char = ctx.characters?.[ctx.characterId];
        const description = char?.description || char?.data?.description || '';
        const persona = power_user?.persona_description || '';
        const userName = ctx.name1 || '{{user}}';
        const charName = char?.name || ctx.name2 || '{{char}}';
        
        // 获取聊天历史
        const chatHistory = getChatHistory(settings.historyCount || 50);
        
        // 获取世界书内容
        const worldInfo = await getWorldInfoContent();
        
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
        ].filter(m => m.content);
        
        // 构建HTML内容
        const htmlContent = messages.map((msg, idx) => {
            const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
            const roleClass = msg.role === 'user' ? 'user' : 'assistant';
            return `
                <div class="jtw-prompt-message jtw-prompt-${roleClass}">
                    <div class="jtw-prompt-role">${roleLabel} 消息 ${Math.floor(idx / 2) + 1}</div>
                    <div class="jtw-prompt-content">${escapeHtml(msg.content)}</div>
                </div>
            `;
        }).join('');
        
        // 显示模态框
        $('#jtw-prompt-preview-title').text(`提示词预览: ${task.name}`);
        $('#jtw-prompt-preview-content').html(htmlContent);
        $('#jtw-prompt-preview-modal').fadeIn(200);
        
    } catch (e) {
        console.error(`[${EXT_NAME}] 预览提示词失败:`, e);
        showTaskStatus(`预览失败: ${e.message}`, true);
    }
}

/**
 * 运行任务
 */
async function runTask(index) {
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
        
        // 获取聊天历史（使用通用设置）
        const chatHistory = getChatHistory(settings.historyCount || 50);
        
        // 获取世界书内容
        const worldInfo = await getWorldInfoContent();
        
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
        const result = await callLLMJson(messages, true);
        
        if (!result) {
            // 如果不是数组，尝试作为对象处理
            const objResult = await callLLMJson(messages, false);
            if (objResult) {
                // 保存单个对象到世界书
                const saveResult = await saveJsonToWorldbook(objResult, {
                    name: task.entryTitle,
                    keys: task.entryKeys ? task.entryKeys.split(',').map(k => k.trim()) : [task.entryTitle],
                    constant: task.entryConstant,
                    position: task.entryPosition,
                    depth: task.entryDepth,
                    order: task.entryOrder
                });
                
                if (saveResult.success) {
                    showTaskStatus(`任务完成: 已${saveResult.isUpdate ? '更新' : '保存'}到世界书`);
                } else {
                    showTaskStatus(`保存失败: ${saveResult.error}`, true);
                }
            } else {
                showTaskStatus('未能从AI返回中提取有效数据', true);
            }
            return;
        }
        
        // 处理数组结果
        if (Array.isArray(result) && result.length > 0) {
            // 使用类似角色列表的保存逻辑
            const targetBook = settings.targetWorldbook || getCharacterWorldbook();
            
            if (!targetBook) {
                showTaskStatus('未找到有效的世界书', true);
                return;
            }
            
            // 加载世界书
            const worldData = await loadWorldInfo(targetBook);
            if (!worldData) {
                showTaskStatus('无法加载世界书', true);
                return;
            }
            
            // 查找或创建条目
            let entry = null;
            let existingContent = '';
            
            if (worldData.entries && typeof worldData.entries === 'object') {
                const entriesArray = Object.values(worldData.entries);
                const existingEntry = entriesArray.find(e => e && e.comment === task.entryTitle);
                if (existingEntry) {
                    entry = existingEntry;
                    existingContent = entry.content || '';
                }
            }
            
            if (!entry) {
                const { createWorldInfoEntry } = await import("../../../world-info.js");
                entry = createWorldInfoEntry(targetBook, worldData);
            }
            
            // 格式化新内容
            const newContent = result.map(item => jsonToYaml(item, 0)).join('\n\n');
            const finalContent = existingContent 
                ? `${existingContent.trim()}\n\n${newContent}\n\n`
                : `${newContent}\n\n`;
            
            // 设置条目属性
            Object.assign(entry, {
                comment: task.entryTitle,
                key: task.entryKeys ? task.entryKeys.split(',').map(k => k.trim()) : [task.entryTitle],
                content: finalContent,
                constant: task.entryConstant,
                selective: true,
                disable: false,
                position: task.entryPosition,
                depth: task.entryPosition === 4 ? task.entryDepth : undefined,
                order: task.entryOrder
            });
            
            await saveWorldInfo(targetBook, worldData, true);
            showTaskStatus(`任务完成: 已添加 ${result.length} 个条目到「${task.entryTitle}」`);
        } else {
            showTaskStatus('AI返回了空数据', true);
        }
        
    } catch (e) {
        console.error(`[${EXT_NAME}] 任务运行失败:`, e);
        showTaskStatus(`运行失败: ${e.message}`, true);
    } finally {
        isTaskRunning = false;
        $('.jtw-task-run').prop('disabled', false);
    }
}

/**
 * 显示任务状态
 */
function showTaskStatus(message, isError = false) {
    const $status = $('#jtw-task-status');
    $status.text(message)
        .removeClass('success error')
        .addClass(isError ? 'error' : 'success')
        .show();
    
    setTimeout(() => $status.fadeOut(), 5000);
}

/**
 * 初始化自定义任务事件绑定
 */
function initTaskEvents() {
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
    
    // 选择并行处理类型（暂时禁用）
    $('#jtw-create-parallel-task').on('click', function() {
        showTaskStatus('并行处理功能即将推出', true);
    });
    
    // 取消编辑
    $('#jtw-cancel-task').on('click', function() {
        editingTaskIndex = -1;
        showTaskListView();
    });
    
    // 保存任务
    $('#jtw-save-task').on('click', saveTask);
    
    // 条目位置变化时显示/隐藏深度输入框
    $('#jtw-task-entry-position').on('change', function() {
        if (parseInt($(this).val()) === 4) {
            $('#jtw-task-depth-container').show();
        } else {
            $('#jtw-task-depth-container').hide();
        }
    });
    
    // 任务列表操作按钮（使用事件委托）
    $('#jtw-task-list').on('click', '.jtw-task-run', function() {
        const index = parseInt($(this).data('index'));
        runTask(index);
    });
    
    $('#jtw-task-list').on('click', '.jtw-task-edit', function() {
        const index = parseInt($(this).data('index'));
        const settings = getSettings();
        if (settings.customTasks && settings.customTasks[index]) {
            editingTaskIndex = index;
            showTaskEditView(settings.customTasks[index], false);
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
    
    // 双击任务条目预览提示词
    $('#jtw-task-list').on('dblclick', '.jtw-task-item', function() {
        const index = parseInt($(this).data('index'));
        previewTaskPrompt(index);
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

        // 确定条目名称和关键词
        const entryName = options.name || jsonData.name || jsonData.title || `JSON Entry ${Date.now()}`;
        const keys = options.keys || jsonData.aliases || jsonData.keys || [entryName];

        // 检查是否存在同名条目
        let entry = null;
        let isUpdate = false;
        
        if (worldData.entries && typeof worldData.entries === 'object') {
            const entriesArray = Object.values(worldData.entries);
            const existingEntry = entriesArray.find(e => e && e.comment === entryName);
            if (existingEntry) {
                entry = existingEntry;
                isUpdate = true;
                console.log(`[${EXT_NAME}] 找到同名条目，将进行更新: ${entryName} (UID: ${entry.uid})`);
            }
        }

        // 如果不存在，创建新条目
        if (!entry) {
            const { createWorldInfoEntry } = await import("../../../world-info.js");
            entry = createWorldInfoEntry(targetBook, worldData);
            if (!entry) {
                return { success: false, error: "创建世界书条目失败" };
            }
        }

        // 准备内容数据（删除 keys、aliases 和世界书设置字段，避免在内容中重复）
        const contentData = { ...jsonData };
        delete contentData.keys;
        delete contentData.aliases;
        delete contentData.constant;
        delete contentData.selective;
        delete contentData.position;
        delete contentData.depth;
        delete contentData.order;
        delete contentData.excludeRecursion;
        delete contentData.preventRecursion;
        delete contentData.keysecondary;

        // 设置条目属性（优先级：jsonData > options > settings > 默认值）
        const position = jsonData.position ?? options.position ?? settings.entryPosition ?? 0;
        const entryConfig = {
            key: Array.isArray(keys) ? keys : [keys],
            comment: entryName,
            content: (options.asJson ? JSON.stringify(contentData, null, 2) : jsonToYaml(contentData)) + '\n\n',
            constant: jsonData.constant ?? options.constant ?? false,
            selective: jsonData.selective ?? options.selective ?? true,
            disable: options.disable ?? false,
            position: position,
            order: jsonData.order ?? options.order ?? settings.entryOrder ?? 100,
        };
        
        // depth 只在 position=4 时设置
        if (position === 4) {
            entryConfig.depth = jsonData.depth ?? options.depth ?? settings.depth ?? 4;
        }
        
        // 设置递归相关属性（如果 JSON 中有定义）
        if (jsonData.excludeRecursion !== undefined) {
            entryConfig.excludeRecursion = jsonData.excludeRecursion;
        }
        if (jsonData.preventRecursion !== undefined) {
            entryConfig.preventRecursion = jsonData.preventRecursion;
        } else {
            entryConfig.preventRecursion = true; // 默认启用
        }
        
        // 次要关键词（SillyTavern 使用 keysecondary 字段）
        if (jsonData.keysecondary !== undefined) {
            entryConfig.keysecondary = Array.isArray(jsonData.keysecondary) 
                ? jsonData.keysecondary 
                : [jsonData.keysecondary];
        }
        
        Object.assign(entry, entryConfig);

        // 保存世界书
        await saveWorldInfo(targetBook, worldData, true);

        console.log(`[${EXT_NAME}] 条目已${isUpdate ? '更新' : '保存'}到 ${targetBook}, UID: ${entry.uid}`);
        
        return { success: true, uid: String(entry.uid), worldbook: targetBook, isUpdate };
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
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Project Amber</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" id="json-to-worldbook-panel">
            <!-- 标签页导航 -->
            <div class="jtw-tabs">
                <button class="jtw-tab active" data-tab="json-extract">JSON提取</button>
                <button class="jtw-tab" data-tab="character-list">角色列表</button>
                <button class="jtw-tab" data-tab="custom-tasks">自定义任务</button>
                <button class="jtw-tab" data-tab="common-settings">⚙️</button>
            </div>
            
            <!-- JSON提取页面 -->
            <div class="jtw-tab-content active" id="json-extract">
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
                            <option value="0">角色定义之前</option>
                            <option value="1">角色定义之后</option>
                            <option value="2">作者注释之前</option>
                            <option value="3">作者注释之后</option>
                            <option value="4">@ Depth</option>
                        </select>
                    </div>
                    <div id="jtw-depth-container" style="margin-top: 10px; display: none;">
                        <label>深度值 (Depth)</label>
                        <input type="number" id="jtw-depth" class="jtw-input" value="4" min="0" max="999" />
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
            
            <!-- 角色列表页面 -->
            <div class="jtw-tab-content" id="character-list">
                <div class="jtw-section">
                    <h4>角色列表设置</h4>
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
                </div>
            </div>
            
            <!-- 自定义任务页面 -->
            <div class="jtw-tab-content" id="custom-tasks">
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
                            <button id="jtw-create-parallel-task" class="jtw-task-type-btn" disabled>
                                <span class="jtw-task-type-icon">🔀</span>
                                <span class="jtw-task-type-name">并行处理</span>
                                <span class="jtw-task-type-desc">同时执行多个子任务（即将推出）</span>
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
                        <h4>世界书设置</h4>
                        <div style="margin-bottom: 10px;">
                            <label>条目标题（用于判断创建或更新）<span class="jtw-required">*</span></label>
                            <input type="text" id="jtw-task-entry-title" class="jtw-input" placeholder="例如：场景信息" />
                        </div>
                        <div style="margin-bottom: 10px;">
                            <label>关键词（逗号分隔，留空使用标题）</label>
                            <input type="text" id="jtw-task-entry-keys" class="jtw-input" placeholder="关键词1,关键词2" />
                        </div>
                        <div class="jtw-checkbox-row" style="margin-bottom: 10px;">
                            <input type="checkbox" id="jtw-task-entry-constant" />
                            <label for="jtw-task-entry-constant">始终启用（Constant）</label>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <label>条目位置</label>
                            <select id="jtw-task-entry-position" class="jtw-select">
                                <option value="0">角色定义之前</option>
                                <option value="1">角色定义之后</option>
                                <option value="2">作者注释之前</option>
                                <option value="3">作者注释之后</option>
                                <option value="4">@ Depth</option>
                            </select>
                        </div>
                        <div id="jtw-task-depth-container" style="margin-bottom: 10px; display: none;">
                            <label>深度值 (Depth)</label>
                            <input type="number" id="jtw-task-entry-depth" class="jtw-input" value="4" min="0" max="999" />
                        </div>
                        <div style="margin-bottom: 10px;">
                            <label>排序优先级</label>
                            <input type="number" id="jtw-task-entry-order" class="jtw-input" value="100" min="0" />
                        </div>
                    </div>
                    
                    <div class="jtw-section">
                        <div class="jtw-task-edit-buttons">
                            <button id="jtw-cancel-task" class="jtw-btn">取消</button>
                            <button id="jtw-save-task" class="jtw-btn primary">保存</button>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 通用设置页面 -->
            <div class="jtw-tab-content" id="common-settings">
                <div class="jtw-section">
                    <h4>模型设置</h4>
                    <div style="margin-bottom: 10px;">
                        <label>使用模型（留空使用当前模型）</label>
                        <input type="text" id="jtw-extract-model" class="jtw-input" placeholder="留空使用当前模型" />
                    </div>
                </div>
                
                <div class="jtw-section">
                    <h4>提取设置</h4>
                    <div style="margin-bottom: 10px;">
                        <label>历史消息数量</label>
                        <input type="number" id="jtw-history-count" class="jtw-input" value="50" min="10" max="200" />
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label>仅包括标签（逗号分隔）</label>
                        <input type="text" id="jtw-include-tags" class="jtw-input" placeholder="main_plot" />
                        <div class="jtw-hint">只提取这些标签内的内容，留空则不限制</div>
                    </div>
                    <div class="jtw-checkbox-row" style="margin-bottom: 10px;">
                        <input type="checkbox" id="jtw-apply-exclude-after-include" />
                        <label for="jtw-apply-exclude-after-include">提取包括标签后再执行排除处理</label>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label>排除的标签（逗号分隔）</label>
                        <input type="text" id="jtw-exclude-tags" class="jtw-input" placeholder="think,summary,safety" />
                        <div class="jtw-hint">这些标签内的文本会在发送前被移除</div>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label>思维链标签（逗号分隔）</label>
                        <input type="text" id="jtw-thought-tags" class="jtw-input" placeholder="think,thinking,thought" />
                        <div class="jtw-hint">思维链标签会特殊处理：如果只存在闭合标签（如&lt;/think&gt;），会删除从开头到闭合标签的所有内容</div>
                    </div>
                    <div class="jtw-checkbox-row" style="margin-bottom: 10px;">
                        <input type="checkbox" id="jtw-aggressive-thought-removal" />
                        <label for="jtw-aggressive-thought-removal">激进删除思维链</label>
                        <div class="jtw-hint" style="margin-left: 24px;">勾选后，直接删除最后一个思维链闭合标签之前的所有内容，不检查是否有对应的开启标签</div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    $('#extensions_settings2').append(settingsHtml);

    // 标签页切换
    $('.jtw-tab').on('click', function() {
        const tab = $(this).data('tab');
        $('.jtw-tab').removeClass('active');
        $('.jtw-tab-content').removeClass('active');
        $(this).addClass('active');
        $(`#${tab}`).addClass('active');
    });

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
        // 显示/隐藏深度输入框
        if (settings.entryPosition === 4) {
            $('#jtw-depth-container').show();
        } else {
            $('#jtw-depth-container').hide();
        }
        saveSettings();
    });
    
    // 初始化深度输入框显示状态
    if (settings.entryPosition === 4) {
        $('#jtw-depth-container').show();
    }
    
    $('#jtw-depth').val(settings.depth || 4).on('change', function() {
        settings.depth = parseInt($(this).val()) || 4;
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
    
    // 通用设置 - 模型设置
    $('#jtw-extract-model').val(settings.extractModel || '').on('change', function() {
        settings.extractModel = $(this).val();
        saveSettings();
    });
    
    $('#jtw-history-count').val(settings.historyCount || 50).on('change', function() {
        settings.historyCount = parseInt($(this).val()) || 50;
        saveSettings();
    });
    
    $('#jtw-include-tags').val(settings.includeTags || '').on('change', function() {
        settings.includeTags = $(this).val();
        saveSettings();
    });
    
    $('#jtw-apply-exclude-after-include').prop('checked', settings.applyExcludeAfterInclude || false).on('change', function() {
        settings.applyExcludeAfterInclude = $(this).prop('checked');
        saveSettings();
    });
    
    $('#jtw-exclude-tags').val(settings.excludeTags || '').on('change', function() {
        settings.excludeTags = $(this).val();
        saveSettings();
    });
    
    $('#jtw-thought-tags').val(settings.thoughtTags || 'think,thinking,thought').on('change', function() {
        settings.thoughtTags = $(this).val();
        saveSettings();
    });
    
    $('#jtw-aggressive-thought-removal').prop('checked', settings.aggressiveThoughtRemoval || false).on('change', function() {
        settings.aggressiveThoughtRemoval = $(this).prop('checked');
        saveSettings();
    });
    
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
    $('#jtw-extract-characters').on('click', extractCharacterList);
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
        showStatus(`已${result.isUpdate ? '更新' : '保存'}到 ${result.worldbook} (UID: ${result.uid})`);
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
    extractCharacterList,
};

// ==================== 初始化 ====================

jQuery(async () => {
    console.log(`[${EXT_NAME}] 初始化...`);
    
    // 创建设置界面
    createSettingsUI();
    
    // 初始化自定义任务事件
    initTaskEvents();
    
    // 监听消息事件
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    
    // 监听角色切换，更新世界书列表
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(updateWorldbookSelect, 500);
    });

    console.log(`[${EXT_NAME}] 初始化完成`);
});
