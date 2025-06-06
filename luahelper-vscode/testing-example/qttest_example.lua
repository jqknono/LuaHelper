-- local LuaUnittest = require("LuaUnittest")
local LuaUnittest = agent.require("LuaUnittest")

-- Simple test example for Lua Helper testing
function testAddition() LuaUnittest.Assert(1 + 1 == 2, "Addition test failed") end

function testSubtraction() LuaUnittest.Assert(5 - 3 == 2, "Subtraction test failed") end

function testStringConcatenation()
    local result = "Hello" .. " " .. "World"
    LuaUnittest.Assert(result == "Hello World", "String concatenation test failed")
end

-- This is not a test function
function regularFunction() return "not a test" end

-- Another test
function TestUpperCase()
    local str = string.upper("hello")
    LuaUnittest.Assert(str == "HELLO", "Upper case test failed")
end

function TestQtAgentAssertFailed()
    local success = false
    LuaUnittest.Assert(success, "Should fail1")
end

function TestAssertFailed()
    local success = false
    assert(success, "Should fail2")
end

-- 注册测试用例
LuaUnittest.RegisterTest("testAddition", testAddition)
LuaUnittest.RegisterTest("testSubtraction", testSubtraction)
LuaUnittest.RegisterTest("testStringConcatenation", testStringConcatenation)
LuaUnittest.RegisterTest("TestUpperCase", TestUpperCase)
LuaUnittest.RegisterTest("TestQtAgentAssertFailed", TestQtAgentAssertFailed)
LuaUnittest.RegisterTest("TestAssertFailed", TestAssertFailed)

-- 启动测试框架，运行环境变量TEST_FUNCTION指定的测试函数或所有已注册的测试
LuaUnittest.Start()

