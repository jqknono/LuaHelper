# Unit Test Framework

这是一个简单的 Lua 测试框架，支持通过环境变量指定测试函数。

## 功能特性

- ✅ 通过环境变量`TEST_FUNCTION`获取要执行的测试函数名
- ✅ 提供简单的断言函数库（Assert）
- ✅ 详细的测试结果输出和错误信息
- ✅ 与 VS Code LuaTestController 完美集成
- ✅ 支持测试成功/失败的准确判断

## 使用方法

### 1. 编写测试函数

在`qttest_example.lua`文件中添加测试函数，函数名必须以`test`开头：

```lua
function testMyFeature()
    print("Testing my feature")
    LuaUnittest.Assert(myFunction(1, 2) == 3, "myFunction should return 3")
    LuaUnittest.Assert(myCondition(), "myCondition should be true")
end
```

### 2. 运行测试

#### 命令行运行

```bash
TEST_FUNCTION=testMyFeature lua qt_agent_unit.lua
```

#### 与嵌入式 Lua 可执行文件运行

```bash
TEST_FUNCTION=testMyFeature /path/to/your/embedded-lua.exe -a -l -u qt_agent_unit.lua
```

#### 在 VS Code 中运行

1. 确保已配置`luahelper.test.launchArgs`
2. 使用 VS Code 的测试发现功能
3. 点击测试函数旁的运行按钮

## 断言函数

### assertEquals(actual, expected, message)

检查两个值是否相等

```lua
assertEquals(1 + 1, 2, "Basic math test")
```

### assertTrue(condition, message)

检查条件是否为 true

```lua
assertTrue(value > 0, "Value should be positive")
```

### assertFalse(condition, message)

检查条件是否为 false

```lua
assertFalse(value < 0, "Value should not be negative")
```

### assertNotNil(value, message)

检查值是否不为 nil

```lua
assertNotNil(myObject, "Object should exist")
```

### assertNil(value, message)

检查值是否为 nil

```lua
assertNil(undefinedVariable, "Should be nil")
```

## 测试结果

### 成功输出

```
Unit Test Framework
=============================
Test function: testExample

Running test: testExample
This is an example test
  ✓ Basic math should work
  ✓ True should be true
Test 'testExample' PASSED (2 assertions)

OK
```

### 失败输出

```
Unit Test Framework
=============================
Test function: testFailureExample

Running test: testFailureExample
This test is designed to fail
  ✗ This will fail: Expected '3', but got '2'
Test 'testFailureExample' FAILED with error: ...

FAILED
```

## 示例测试

文件中已包含以下示例测试：

- `testExample()` - 基本功能测试
- `testMath()` - 数学运算测试
- `testStrings()` - 字符串操作测试
- `testFailureExample()` - 失败测试示例

## 集成配置

在 VS Code 的 settings.json 中配置：

```json
{
  "luahelper.test.luaExe": "/path/to/your/lua-executable",
  "luahelper.test.launchArgs": ["-a", "-l", "-u"],
  "luahelper.test.testGlob": "**/qt_agent_unit.lua"
}
```

## 错误处理

框架会处理以下错误情况：

1. 未设置 TEST_FUNCTION 环境变量
2. 指定的测试函数不存在
3. 测试函数执行过程中的异常
4. 断言失败

所有错误都会输出详细信息并返回非零退出码。
