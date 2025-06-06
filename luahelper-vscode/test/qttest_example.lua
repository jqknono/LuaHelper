-- local QtAgentUnit = require("QtAgentUnit")
local QtAgentUnit = agent.require("QtAgentUnit")

-- Simple test example for Lua Helper testing
function testAddition() QtAgentUnit.Assert(1 + 1 == 2, "Addition test failed") end

function testSubtraction() QtAgentUnit.Assert(5 - 3 == 2, "Subtraction test failed") end

function testStringConcatenation()
    local result = "Hello" .. " " .. "World"
    QtAgentUnit.Assert(result == "Hello World", "String concatenation test failed")
end

-- This is not a test function
function regularFunction() return "not a test" end

-- Another test
function TestUpperCase()
    local str = string.upper("hello")
    QtAgentUnit.Assert(str == "HELLO", "Upper case test failed")
end

function TestQtAgentAssertFailed()
    local success = false
    QtAgentUnit.Assert(success, "Should fail1")
end

function TestAssertFailed()
    local success = false
    assert(success, "Should fail2")
end

-- 注册测试用例
QtAgentUnit.RegisterTest("testAddition", testAddition)
QtAgentUnit.RegisterTest("testSubtraction", testSubtraction)
QtAgentUnit.RegisterTest("testStringConcatenation", testStringConcatenation)
QtAgentUnit.RegisterTest("TestUpperCase", TestUpperCase)
QtAgentUnit.RegisterTest("TestQtAgentAssertFailed", TestQtAgentAssertFailed)
QtAgentUnit.RegisterTest("TestAssertFailed", TestAssertFailed)

-- 启动测试框架，运行环境变量TEST_FUNCTION指定的测试函数或所有已注册的测试
QtAgentUnit.Start()

