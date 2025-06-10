# test Agent 工作目录配置化改进

## 修改概述

将适配 test Agent 的代码从硬编码路径改为可配置方式，支持通过 VS Code 设置来自定义工作目录。

## 新增配置项

### luahelper.test.workdir

- **类型**: `string`
- **默认值**: `""` (空字符串)
- **作用域**: `resource`
- **描述**: 青藤 Agent 适配的工作目录路径

**配置说明**:
- 如果设置为空字符串（默认），将使用操作系统特定的默认路径：
  - Linux: `/titan/agent/data/script`
  - Windows: `c:\program files\titanagent\data\script`
- 如果设置了自定义路径，将使用指定的路径

## 修改的文件

### 1. package.json
- 添加了新的配置项 `luahelper.test.workdir`
- 包含完整的配置定义（类型、默认值、描述等）

### 2. package.nls.json
- 添加了英文版本的配置项描述

### 3. package.nls.zh-cn.json  
- 添加了中文版本的配置项描述

### 4. src/debug/luaDebug.ts
- 修改 `initProcess` 方法中的硬编码路径
- 添加从配置读取工作目录的逻辑
- 保留原有的默认路径作为后备方案

### 5. src/luaTestController.ts
- 修改 `copyRequiredFiles` 方法中的硬编码路径  
- 添加从配置读取工作目录的逻辑
- 保留原有的默认路径作为后备方案

## 使用方法

### 在 VS Code 设置中配置

1. 打开 VS Code 设置 (Ctrl/Cmd + ,)
2. 搜索 "luahelper.test.workdir"
3. 设置自定义的工作目录路径，例如：
   - `/custom/path/to/agent/script`
   - `D:\MyAgent\data\script`

### 在 settings.json 中配置

```json
{
    "luahelper.test.workdir": "/custom/path/to/agent/script"
}
```

### 工作区特定配置

在工作区的 `.vscode/settings.json` 中：

```json
{
    "luahelper.test.workdir": "/project/specific/agent/path"
}
```

## 向后兼容性

- 如果不设置此配置项（或设置为空），行为与之前完全相同
- 现有的配置和代码无需任何修改即可继续正常工作
- 只有在需要自定义路径时才需要设置此配置项

## 代码示例

修改后的核心逻辑：

```typescript
// 从配置中读取test Agent工作目录
const testConfig = vscode.workspace.getConfiguration("luahelper.test");
const configuredWorkDir = testConfig.get<string>("workdir");

if (configuredWorkDir && configuredWorkDir.trim() !== "") {
    workDir = configuredWorkDir.trim();
} else {
    // 使用默认路径作为后备方案
    if (os.type() === "Windows_NT") {
        workDir = "c:\\program files\\titanagent\\data\\script";
    } else if (os.type() === "Linux") {
        workDir = "/titan/agent/data/script";
    }
}
```

## 受影响的功能

1. **调试功能**: 在调试 Lua 文件时，LuaPanda.lua 和 LuaUnittest.lua 文件会被拷贝到配置的目录
2. **测试功能**: 在运行测试时，所需的文件会被拷贝到配置的目录

## 注意事项

- 确保配置的目录路径存在或者程序有权限创建该目录
- 路径可以是绝对路径或相对路径
- 在多平台环境中，建议使用适合当前操作系统的路径格式 