local QtAgentUnit = agent.require("QtAgentUnit")

-- Simple test example for Lua Helper testing
function testAddition()
    assert(1 + 1 == 2, "Addition test failed")
    print("testAddition passed")
end

function testSubtraction()
    assert(5 - 3 == 2, "Subtraction test failed")
    print("testSubtraction passed")
end

function testStringConcatenation()
    local result = "Hello" .. " " .. "World"
    assert(result == "Hello World", "String concatenation test failed")
    print("testStringConcatenation passed")
end

-- This is not a test function
function regularFunction()
    return "not a test"
end

-- Another test
function TestUpperCase()
    local str = string.upper("hello")
    assert(str == "HELLO", "Upper case test failed")
    print("TestUpperCase passed")
end

-- 注册测试用例
QtAgentUnit.RegisterTest("testAddition", testAddition)
QtAgentUnit.RegisterTest("testSubtraction", testSubtraction)
QtAgentUnit.RegisterTest("testStringConcatenation", testStringConcatenation)
QtAgentUnit.RegisterTest("TestUpperCase", TestUpperCase)

-- 启动测试框架，运行环境变量TEST_FUNCTION指定的测试函数或所有已注册的测试
QtAgentUnit.Start()

