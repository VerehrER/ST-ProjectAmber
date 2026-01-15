# Project Amber

一个 SillyTavern 扩展，用于从 AI 输出中提取 JSON 数据并保存到世界书。
目前仅此功能。

## 功能

- 🔍 **智能 JSON 提取**：从 AI 回复中自动识别并提取 JSON 数据
- 📚 **世界书保存**：将提取的 JSON 数据保存为世界书条目
- ⚙️ **灵活配置**：支持自定义目标世界书、条目位置和排序
- 🤖 **自动模式**：可选择自动从每条 AI 消息中提取

## 安装

1. 打开 SillyTavern
2. 进入 **Extensions** 面板
3. 点击 **Install Extension**
4. 输入此仓库的 URL：
   ```
   https://github.com/Pratendent/ST-ProjectAmber
   ```
5. 点击安装

## 使用方法

### 手动提取

1. 让 AI 生成包含 JSON 的回复
2. 在扩展面板中点击 **"从最后一条消息提取"**
3. 预览提取的 JSON 数据
4. 点击 **"保存到世界书"**

### 自动提取

1. 启用 **"自动提取（每条AI消息）"** 选项
2. AI 每次回复后会自动检测 JSON
3. 检测到 JSON 时会显示预览
4. 手动点击保存按钮确认写入

## 支持的 JSON 格式

扩展会尝试从文本中提取各种格式的 JSON：

```json
// 对象格式
{
    "name": "角色名",
    "description": "描述",
    "attributes": {
        "strength": 10
    }
}

// 数组格式
[
    { "name": "角色1", "info": "信息1" },
    { "name": "角色2", "info": "信息2" }
]
```

扩展会自动修复常见的 JSON 语法错误，如：
- 不规范的引号（中文引号等）
- 缺失的引号
- 尾随逗号
- 未闭合的括号

## 许可证

MIT License

## 致谢

参考了 [LittleWhiteBox](https://github.com/RT15548/LittleWhiteBox) 项目的实现。
