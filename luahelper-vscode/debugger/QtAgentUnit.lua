-- Qt Agent Unit Test Framework
-- 简单的Lua测试框架，支持从环境变量获取测试函数名并执行测试

-- 日志系统配置
local Logger = {
    -- ANSI颜色代码
    COLORS = {
        RESET = "\27[0m",
        RED = "\27[31m",
        GREEN = "\27[32m",
        YELLOW = "\27[33m",
        BLUE = "\27[34m",
        MAGENTA = "\27[35m",
        CYAN = "\27[36m",
        WHITE = "\27[37m",
        BRIGHT_RED = "\27[91m",
        BRIGHT_GREEN = "\27[92m",
        BRIGHT_YELLOW = "\27[93m"
    },
    
    -- 日志级别
    LEVELS = {
        DEBUG = { prefix = "[DEBUG]", color = "\27[36m" },
        INFO = { prefix = "[INFO]", color = "\27[37m" },
        SUCCESS = { prefix = "[SUCCESS]", color = "\27[92m" },
        WARNING = { prefix = "[WARNING]", color = "\27[93m" },
        ERROR = { prefix = "[ERROR]", color = "\27[91m" },
        ASSERTION = { prefix = "[ASSERT]", color = "\27[32m" },
        FAILURE = { prefix = "[FAIL]", color = "\27[31m" }
    }
}

-- 获取当前时间戳
function Logger.getTimestamp()
    return os.date("[%H:%M:%S]")
end

-- 通用日志函数
function Logger.log(level, message, noColor)
    local levelInfo = Logger.LEVELS[level]
    if not levelInfo then
        levelInfo = Logger.LEVELS.INFO
    end
    
    local timestamp = Logger.getTimestamp()
    local colorStart = noColor and "" or levelInfo.color
    local colorEnd = noColor and "" or Logger.COLORS.RESET
    
    local logMessage = string.format("%s %s%s%s %s", 
        timestamp, colorStart, levelInfo.prefix, colorEnd, message)
    
    print(logMessage)
end

-- 便捷日志函数
function Logger.debug(message) Logger.log("DEBUG", message) end
function Logger.info(message) Logger.log("INFO", message) end
function Logger.success(message) Logger.log("SUCCESS", message) end
function Logger.warning(message) Logger.log("WARNING", message) end
function Logger.error(message) Logger.log("ERROR", message) end
function Logger.assertion(message) Logger.log("ASSERTION", message) end
function Logger.failure(message) Logger.log("FAILURE", message) end

-- 分隔线打印
function Logger.separator(char, length)
    char = char or "="
    length = length or 50
    print(string.rep(char, length))
end

-- 测试框架配置
local TestFramework = {
    passed = 0,
    failed = 0,
    current_test = nil,
    registered_tests = {}  -- 注册的测试用例
}

-- 测试注册接口
function RegisterTest(testName, testFunction)
    if type(testName) ~= "string" then
        error("Test name must be a string")
    end
    if type(testFunction) ~= "function" then
        error("Test function must be a function")
    end
    TestFramework.registered_tests[testName] = testFunction
    Logger.info("已注册测试: " .. testName)
end

-- 获取所有已注册的测试
function GetRegisteredTests()
    local testNames = {}
    for name, _ in pairs(TestFramework.registered_tests) do
        table.insert(testNames, name)
    end
    table.sort(testNames) -- 按字母顺序排序
    return testNames
end

-- 断言函数
function AssertEquals(actual, expected, message)
    if actual == expected then
        TestFramework.passed = TestFramework.passed + 1
        Logger.assertion("✓ " .. (message or "断言通过"))
    else
        TestFramework.failed = TestFramework.failed + 1
        local error_msg = string.format("✗ %s: 期望 '%s'，实际得到 '%s'", message or "断言失败",
                              tostring(expected), tostring(actual))
        Logger.failure(error_msg)
        error(error_msg)
    end
end

function AssertTrue(condition, message) 
    AssertEquals(condition, true, message or "期望为真") 
end

function AssertFalse(condition, message) 
    AssertEquals(condition, false, message or "期望为假") 
end

function AssertNotNil(value, message)
    if value ~= nil then
        TestFramework.passed = TestFramework.passed + 1
        Logger.assertion("✓ " .. (message or "值不为空"))
    else
        TestFramework.failed = TestFramework.failed + 1
        local error_msg = message or "期望值不为空"
        Logger.failure("✗ " .. error_msg)
        error(error_msg)
    end
end

function AssertNil(value, message)
    if value == nil then
        TestFramework.passed = TestFramework.passed + 1
        Logger.assertion("✓ " .. (message or "值为空"))
    else
        TestFramework.failed = TestFramework.failed + 1
        local error_msg = string.format("%s: 期望为空，实际得到 '%s'", message or "期望为空", tostring(value))
        Logger.failure("✗ " .. error_msg)
        error(error_msg)
    end
end

-- 运行单个测试函数
function RunTest(testName)
    Logger.info("🚀 开始执行测试: " .. testName)
    TestFramework.current_test = testName
    TestFramework.passed = 0
    TestFramework.failed = 0
    
    -- 检查测试函数是否存在于注册列表中
    local testFunction = TestFramework.registered_tests[testName]
    if not testFunction then
        -- 如果没有在注册列表中，尝试从全局环境查找
        testFunction = _G[testName]
    end
    
    if type(testFunction) ~= "function" then
        Logger.error("测试函数 '" .. testName .. "' 未找到或不是函数")
        return false
    end
    
    -- 执行测试函数
    local success, error_message = pcall(testFunction)
    
    if success then
        if TestFramework.failed == 0 then
            Logger.success("测试 '" .. testName .. "' 通过 (" .. TestFramework.passed .. " 个断言)")
            return true
        else
            Logger.failure("测试 '" .. testName .. "' 失败 (" .. TestFramework.failed .. " 个失败, " ..
                      TestFramework.passed .. " 个通过)")
            return false
        end
    else
        Logger.error("测试 '" .. testName .. "' 执行异常: " .. tostring(error_message))
        return false
    end
end

-- 运行多个测试函数
function RunAllTests(testNames)
    local totalPassed = 0
    local totalFailed = 0
    local passedTests = {}
    local failedTests = {}
    
    Logger.info("🔄 开始运行 " .. #testNames .. " 个已注册测试: " .. table.concat(testNames, ", "))
    print("")
    
    for _, testName in ipairs(testNames) do
        local success = RunTest(testName)
        if success then
            table.insert(passedTests, testName)
            totalPassed = totalPassed + 1
        else
            table.insert(failedTests, testName)
            totalFailed = totalFailed + 1
        end
        print("") -- 添加空行分隔不同测试
    end
    
    -- 输出总结
    Logger.separator("=", 60)
    Logger.info("📊 测试总结:")
    Logger.success("✅ 通过: " .. totalPassed .. " 个测试")
    if #passedTests > 0 then
        for _, testName in ipairs(passedTests) do
            Logger.success("  - " .. testName)
        end
    end
    
    if totalFailed > 0 then
        Logger.failure("❌ 失败: " .. totalFailed .. " 个测试")
        for _, testName in ipairs(failedTests) do
            Logger.failure("  - " .. testName)
        end
    end
    
    return totalFailed == 0
end

-- 主测试启动器
function Start()
    -- 获取环境变量中的测试函数名
    local testFunctionName = os.getenv("TEST_FUNCTION")
    Logger.debug("TEST_FUNCTION: " .. (testFunctionName or "nil"))
    
    Logger.separator("=", 60)
    Logger.info("🧪 Qt Agent 单元测试框架")
    Logger.separator("=", 60)
    
    if not testFunctionName or testFunctionName == "" then
        -- 没有指定测试函数，运行所有已注册的测试
        Logger.info("未指定特定测试函数，运行所有已注册的测试...")
        print("")
        
        local registeredTests = GetRegisteredTests()
        if #registeredTests == 0 then
            Logger.error("错误: 没有已注册的测试函数。请使用 RegisterTest() 注册测试函数。")
            return
        end
        
        local success = RunAllTests(registeredTests)
        
        print("")
        if success then
            Logger.success("🎉 所有测试通过!")
            print("OK") -- 这是LuaTestController期望的成功标识
        else
            Logger.failure("💥 测试失败!")
            print("FAILED")
            os.exit(1) -- 非零退出码表示测试失败
        end
    else
        -- 运行指定的测试函数
        Logger.info("🎯 指定测试函数: " .. testFunctionName)
        print("")
        
        local success = RunTest(testFunctionName)
        
        print("")
        if success then
            Logger.success("🎉 测试通过!")
            print("OK") -- 这是LuaTestController期望的成功标识
        else
            Logger.failure("💥 测试失败!")
            print("FAILED")
            os.exit(1) -- 非零退出码表示测试失败
        end
    end
end

return {
    Start = Start,
    RegisterTest = RegisterTest,
    GetRegisteredTests = GetRegisteredTests,
    AssertEquals = AssertEquals,
    AssertTrue = AssertTrue,
    AssertFalse = AssertFalse,
    AssertNotNil = AssertNotNil,
    AssertNil = AssertNil,
    Logger = Logger  -- 导出日志系统供外部使用
}
