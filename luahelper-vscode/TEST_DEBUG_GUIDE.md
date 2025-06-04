# Lua Test Debugging with LuaHelper

LuaHelper 扩展现在支持调试 Lua 测试用例，使开发者能够逐步调试测试代码，检查变量状态，并快速定位测试失败的原因。

## 功能特性

- ✅ 测试发现：自动发现符合命名模式的测试文件和测试函数
- ✅ 测试运行：运行单个测试或批量测试
- ✅ 测试调试：使用 LuaPanda 调试器逐步调试测试
- ✅ 错误定位：在测试失败时自动设置断点
- ✅ 变量检查：在调试过程中检查变量状态

## 测试文件模式

### 测试文件命名
默认情况下，扩展会查找以下模式的文件：
- `**/[tT]est*.lua` (例如：`test.lua`, `Test.lua`, `testExample.lua`)

### 测试函数命名
测试函数应该以 `test` 或 `Test` 开头：
```lua
-- 这些都会被识别为测试函数
function testBasicMath()
    assert(2 + 2 == 4)
end

function TestStringOperations()
    assert(string.len("hello") == 5)
end

function MyClass:testMethod()
    assert(self.value == 42)
end
```

## 如何使用

### 1. 运行测试
- 在测试视图中点击测试项旁的 "Run" 按钮 ▶️
- 或者使用命令面板：`Lua Helper: Run Test`

### 2. 调试测试
- 在测试视图中点击测试项旁的 "Debug" 按钮 🐛
- 或者使用命令面板：`Lua Helper: Debug Test`
- 扩展会自动：
  1. 创建临时调试脚本
  2. 启动 LuaPanda 调试器
  3. 在测试函数入口设置断点
  4. 在测试失败时设置断点

### 3. 调试过程中的功能
- **单步执行**：逐行执行代码
- **变量检查**：查看局部变量和全局变量的值
- **堆栈跟踪**：查看函数调用堆栈
- **断点设置**：在关键位置设置断点
- **表达式求值**：在调试控制台中求值表达式

## 配置选项

在 VS Code 设置中可以配置以下选项：

```json
{
  "luahelper.test.luaExe": "lua",                    // Lua 可执行文件路径
  "luahelper.test.testGlob": "**/[tT]est*.lua",      // 测试文件模式
  "luahelper.test.testRegex": "^\\s*function\\s+(?:\\w*:)?(?<test>[tT]est\\w*)\\(\\)(?:.*)$", // 测试函数正则
  "luahelper.test.debugPort": 8818,                 // 调试端口号
  "luahelper.test.stopOnEntry": true,               // 在入口处停止
  "luahelper.test.logpanel": false,                 // 显示日志面板
  "luahelper.test.logfile": ""                      // 日志文件路径
}
```

## 示例测试文件

```lua
-- example.test.lua
function testMathOperations()
    local a = 10
    local b = 5
    
    -- 测试加法
    assert(a + b == 15, "Addition failed")
    
    -- 测试减法
    assert(a - b == 5, "Subtraction failed")
    
    print("Math operations test passed")
end

function testTableManipulation()
    local items = {"apple", "banana"}
    
    -- 添加元素
    table.insert(items, "orange")
    assert(#items == 3, "Should have 3 items")
    
    -- 检查内容
    assert(items[3] == "orange", "Last item should be orange")
    
    print("Table manipulation test passed")
end

-- 故意失败的测试，用于演示调试
function testIntentionalFailure()
    local x = 10
    assert(x == 20, "This will fail and trigger debugger")
end
```

## 调试最佳实践

1. **设置断点**：在测试函数开始和关键位置设置断点
2. **检查变量**：使用变量视图查看当前状态
3. **单步执行**：使用 F10 (step over) 和 F11 (step into) 逐步执行
4. **使用调试控制台**：在调试控制台中输入 Lua 表达式来检查状态
5. **分析堆栈**：查看调用堆栈了解执行路径

## 故障排除

### 调试器无法连接
- 确保端口 8818 (或配置的端口) 未被占用
- 检查防火墙设置
- 确认 Lua 可执行文件路径正确

### 测试未被发现
- 检查文件命名是否符合模式
- 检查测试函数命名是否以 `test` 或 `Test` 开头
- 验证文件编码是否为 UTF-8

### 调试时无法设置断点
- 确认 LuaPanda 调试器正确加载
- 检查文件路径是否正确
- 验证 Lua 语法是否正确

## 支持的 Lua 版本

- Lua 5.1+
- LuaJIT
- 其他兼容 Lua 5.1 的实现

需要确保目标 Lua 环境支持 `require`、`pcall` 和基本的标准库函数。
