# LuaHelper 测试功能使用指南

## 概述

LuaHelper VSCode插件现在支持自动发现和运行Lua测试文件。此功能与VSCode的内置测试框架集成，提供了便捷的测试体验。

## 配置选项

在VSCode设置中，你可以配置以下选项：

### 基本配置

- **luahelper.test.luaExe**: Lua可执行文件路径 (默认: "lua")
- **luahelper.test.testGlob**: 用于查找测试文件的Glob模式 (默认: "**/[tT]est*.lua")
- **luahelper.test.testRegex**: 用于查找测试函数的正则表达式
- **luahelper.test.testEncoding**: 测试文件编码，默认为 `"utf8"`

### 高级配置

- **luahelper.test.logpanel**: 是否启用日志输出面板，默认为 `true`
- **luahelper.test.logfile**: 写入诊断日志的文件路径
- **luahelper.test.launchArgs**: 测试执行的启动参数 (数组)

## 测试文件命名规范

测试文件应该遵循以下命名规范：

- 文件名必须包含 "test" 或 "Test"
- 推荐使用 `.test.lua` 后缀
- 例如：`example.test.lua`, `math.test.lua`, `TestUtils.lua`

## 测试函数命名规范

测试函数会被自动发现，需要遵循以下命名规范：

```lua
-- 基本测试函数
function testBasicFunction()
    assert(condition, "错误消息")
end

-- 大写Test开头
function TestSomething()
    assert(condition, "错误消息")
end

-- 带有数字和下划线
function test_with_underscores()
    assert(condition, "错误消息")
end

function test123WithNumbers()
    assert(condition, "错误消息")
end

-- 类方法风格
function MyClass:testMethod()
    assert(condition, "错误消息")
end
```

## 测试文件示例

### 基本测试示例

```lua
-- example.test.lua

function testAddition()
    assert(1 + 1 == 2, "Addition test failed")
    print("testAddition passed")
end

function testStringOperations()
    local str = "Hello World"
    assert(string.len(str) == 11, "String length test failed")
    print("testStringOperations passed")
end

-- 预期失败的测试
function testExpectedFailure()
    assert(false, "This test demonstrates failure handling")
end
```

### 高级测试示例

```lua
-- advanced.test.lua

-- 测试类方法
local TestClass = {}

function TestClass:testMethodSyntax()
    assert(self ~= nil, "Self should not be nil")
    print("TestClass:testMethodSyntax passed")
end

-- 测试数学函数
function testMathFunctions()
    assert(math.abs(-5) == 5, "Absolute value test failed")
    assert(math.max(1, 2, 3) == 3, "Max function test failed")
    print("testMathFunctions passed")
end

-- 测试表操作
function testTableOperations()
    local t = {1, 2, 3}
    assert(#t == 3, "Table length test failed")
    
    table.insert(t, 4)
    assert(#t == 4, "Table insert test failed")
    print("testTableOperations passed")
end
```

## 使用方法

### 1. 发现测试

1. 打开VSCode中的测试面板 (Ctrl+Shift+T)
2. 测试控制器会自动扫描工作区中的测试文件
3. 测试函数会以树形结构显示

### 2. 运行测试

1. 在测试面板中点击单个测试旁边的运行按钮
2. 或者点击文件级别的运行按钮来运行文件中的所有测试
3. 或者使用"运行所有测试"按钮运行所有测试

### 3. 查看结果

- 测试结果会显示在测试面板中
- 失败的测试会显示错误消息
- 如果启用了日志面板，详细输出会显示在输出面板中

## 故障排除

### 测试没有被发现

1. 检查文件名是否符合命名规范
2. 检查测试函数名是否以 "test" 或 "Test" 开头
3. 确保文件编码设置正确
4. 检查testGlob配置是否正确

### 测试运行失败

1. 检查Lua可执行文件路径是否正确
2. 确保测试文件语法正确
3. 检查启动参数配置
4. 查看输出面板中的详细错误信息

### 性能问题

1. 如果有大量测试文件，可以调整testGlob模式来限制扫描范围
2. 考虑将测试文件组织到特定目录中

## 最佳实践

1. **组织测试文件**: 将测试文件放在专门的test目录中
2. **命名一致性**: 使用一致的命名规范
3. **独立测试**: 确保测试函数之间相互独立
4. **清晰断言**: 使用清晰的错误消息
5. **适当分组**: 将相关测试放在同一个文件中

## 示例配置

在VSCode的settings.json中添加：

```json
{
    "luahelper.test.luaExe": "/usr/local/bin/lua",
    "luahelper.test.testGlob": "**/test/**/*.lua",
    "luahelper.test.logpanel": true,
    "luahelper.test.launchArgs": ["-a", "-l", "-u"]
}
```

这个配置示例：
- 指定了自定义的Lua执行路径
- 限制测试发现只在test目录中
- 启用日志面板输出
- 添加了busted测试框架的加载参数
