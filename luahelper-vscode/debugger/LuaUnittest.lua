-- Qt Agent Unit Test Framework
-- 简单的Lua测试框架，支持从环境变量获取测试函数名并执行测试
-- 颜色支持检测
local function detectColorSupport()
    -- 检查是否被重定向或在非交互式环境
    local term = os.getenv("TERM")
    local colorterm = os.getenv("COLORTERM")
    local noColor = os.getenv("NO_COLOR")

    -- 如果设置了NO_COLOR环境变量，禁用颜色
    if noColor and noColor ~= "" then
        return false
    end

    -- 如果COLORTERM被设置，通常支持颜色
    if colorterm then
        return true
    end

    -- 检查常见的支持颜色的终端
    if term then
        local colorTerms = {
            "xterm",
            "xterm-color",
            "xterm-256color",
            "screen",
            "screen-256color",
            "tmux",
            "tmux-256color",
            "rxvt",
            "ansi",
            "linux",
            "cygwin"
        }
        for _, colorTerm in ipairs(colorTerms) do
            if term:find(colorTerm) then
                return true
            end
        end
    end

    -- 默认情况下，如果无法确定，禁用颜色以避免显示转义序列
    return false
end

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
        DEBUG = {
            prefix = "[DEBUG]",
            color = "\27[36m"
        },
        INFO = {
            prefix = "[INFO]",
            color = "\27[37m"
        },
        SUCCESS = {
            prefix = "[SUCCESS]",
            color = "\27[92m"
        },
        WARNING = {
            prefix = "[WARNING]",
            color = "\27[93m"
        },
        ERROR = {
            prefix = "[ERROR]",
            color = "\27[91m"
        },
        ASSERTION = {
            prefix = "[ASSERT]",
            color = "\27[32m"
        },
        FAILURE = {
            prefix = "[FAIL]",
            color = "\27[31m"
        }
    },

    -- 颜色支持状态
    colorSupported = detectColorSupport()
}

-- 获取当前时间戳
function Logger.getTimestamp() return os.date("[%H:%M:%S]") end

-- 通用日志函数
function Logger.log(level, message, noColor)
    local levelInfo = Logger.LEVELS[level]
    if not levelInfo then
        levelInfo = Logger.LEVELS.INFO
    end

    local timestamp = Logger.getTimestamp()
    -- 如果不支持颜色或明确禁用颜色，则不添加颜色代码
    local shouldUseColor = Logger.colorSupported and not noColor
    local colorStart = shouldUseColor and levelInfo.color or ""
    local colorEnd = shouldUseColor and Logger.COLORS.RESET or ""

    local logMessage = string.format("%s [LuaUnittest] %s%s%s %s", timestamp, colorStart, levelInfo.prefix, colorEnd,
                           message)

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

-- 手动启用/禁用颜色
function Logger.setColorEnabled(enabled) Logger.colorSupported = enabled end

-- 获取颜色支持状态
function Logger.isColorEnabled() return Logger.colorSupported end

-- 分隔线打印
function Logger.separator(char, length)
    char = char or "="
    length = length or 50
    local timestamp = Logger.getTimestamp()
    local separatorLine = string.rep(char, length)
    print(string.format("%s [LuaUnittest] %s", timestamp, separatorLine))
end

-- 空行打印
function Logger.newline()
    local timestamp = Logger.getTimestamp()
    print(string.format("%s [LuaUnittest]", timestamp))
end

-- 输出特殊状态（如OK/FAILED），不添加LuaUnittest标识以保持兼容性
function Logger.status(message) print(message) end

-- 测试框架配置
local TestFramework = {
    passed = 0,
    failed = 0,
    current_test = nil,
    registered_tests = {}, -- 注册的测试用例
    detailed_errors = {} -- 存储详细错误信息
}

-- 获取调用栈信息
local function getCallInfo(level)
    level = level or 3 -- 默认跳过getCallInfo、断言函数和直接调用者
    local info = debug.getinfo(level, "Sl")
    if info then
        local source = info.source
        if source:sub(1, 1) == "@" then
            -- 移除文件路径前的@符号，只保留文件名
            source = source:sub(2)
            local filename = source:match("([^/\\]+)$") or source
            return string.format("%s:%d", filename, info.currentline or 0)
        else
            return string.format("行 %d", info.currentline or 0)
        end
    end
    return "未知位置"
end

-- 格式化值，提供更好的输出显示
local function formatValue(value)
    local valueType = type(value)
    if valueType == "string" then
        return string.format('"%s"', value)
    elseif valueType == "nil" then
        return "nil"
    elseif valueType == "boolean" then
        return tostring(value)
    elseif valueType == "number" then
        return tostring(value)
    elseif valueType == "table" then
        -- 简单的表格式化
        local items = {}
        local count = 0
        for k, v in pairs(value) do
            count = count + 1
            if count > 3 then -- 限制显示前3个元素
                table.insert(items, "...")
                break
            end
            table.insert(items, string.format("%s=%s", tostring(k), formatValue(v)))
        end
        return "{" .. table.concat(items, ", ") .. "}"
    else
        return string.format("<%s: %s>", valueType, tostring(value))
    end
end

-- 添加详细错误信息
local function addDetailedError(errorInfo) table.insert(TestFramework.detailed_errors, errorInfo) end

-- 测试注册接口
function RegisterTest(testName, testFunction)
    if type(testName) ~= "string" then
        Logger.error("Test name must be a string")
        return false
    end
    if type(testFunction) ~= "function" then
        Logger.error("Must be a function, testName: " .. testName)
        return false
    end
    TestFramework.registered_tests[testName] = testFunction
    Logger.info("已注册测试: " .. testName)
    return true
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

-- 改进的断言函数
function Assert(condition, message)
    local callInfo = getCallInfo()
    if condition == true then
        TestFramework.passed = TestFramework.passed + 1
        Logger.assertion("✓ " .. (message or "期望为真") .. " [" .. callInfo .. "]")
    else
        TestFramework.failed = TestFramework.failed + 1
        local error_msg = string.format("✗ %s", message or "期望为真")
        local detailed_msg = string.format("位置: %s", callInfo)

        Logger.failure(error_msg)
        Logger.failure("  " .. detailed_msg:gsub("\n", "\n  "))

        addDetailedError({
            test = TestFramework.current_test or "未知测试",
            type = "Assert",
            message = message or "期望为真",
            expected = true,
            actual = condition,
            location = callInfo
        })
    end
end

-- 获取完整的堆栈跟踪信息
local function getStackTrace()
    local trace = {}
    local level = 1
    while true do
        local info = debug.getinfo(level, "Snl")
        if not info then
            break
        end

        if info.what ~= "C" then
            local source = info.source
            if source:sub(1, 1) == "@" then
                source = source:sub(2)
                local filename = source:match("([^/\\]+)$") or source
                table.insert(trace, string.format("  在 %s:%d (%s)", filename, info.currentline or 0,
                    info.name or "匿名函数"))
            else
                table.insert(trace,
                    string.format("  在 行 %d (%s)", info.currentline or 0, info.name or "匿名函数"))
            end
        end
        level = level + 1
    end
    return trace
end

-- 运行单个测试函数
function RunTest(testName)
    Logger.info("🚀 开始执行测试: " .. testName)
    TestFramework.current_test = testName
    TestFramework.passed = 0
    TestFramework.failed = 0
    TestFramework.detailed_errors = {} -- 重置错误信息

    -- 检查测试函数是否存在于注册列表中
    local testFunction = TestFramework.registered_tests[testName]
    if not testFunction then
        -- 如果没有在注册列表中，尝试从全局环境查找
        testFunction = _G[testName]
    end

    if type(testFunction) ~= "function" then
        Logger.error("测试函数 '" .. testName .. "' 未找到或不是函数")
        Logger.error("可用的注册测试: " .. table.concat(GetRegisteredTests(), ", "))
        return false
    end

    -- 执行测试函数，使用pcall来捕获任何错误
    local success, error_message = pcall(testFunction)

    if success then
        -- 测试函数执行成功，检查断言结果
        if TestFramework.failed == 0 then
            Logger.success("测试 '" .. testName .. "' 通过 (" .. TestFramework.passed .. " 个断言)")
            return true
        else
            Logger.failure("测试 '" .. testName .. "' 失败 (" .. TestFramework.failed .. " 个失败, " ..
                               TestFramework.passed .. " 个通过)")

            -- 打印详细错误总结
            if #TestFramework.detailed_errors > 0 then
                Logger.separator("-", 40)
                Logger.failure("详细错误信息:")
                for i, errorInfo in ipairs(TestFramework.detailed_errors) do
                    Logger.failure(string.format("%d. %s (%s)", i, errorInfo.message, errorInfo.location))
                end
                Logger.separator("-", 40)
            end
            return false
        end
    else
        -- 测试函数执行时发生异常
        Logger.error("测试 '" .. testName .. "' 执行异常:")
        Logger.error("错误信息: " .. tostring(error_message))

        -- 解析异常消息，提取位置和错误信息
        local location = "测试函数执行时"
        local actualMessage = tostring(error_message)
        
        -- 尝试从错误消息中提取文件位置信息
        -- 格式通常是: filepath:line: message
        local filepath, line, message = string.match(actualMessage, "([^:]+):(%d+): (.+)")
        if filepath and line and message then
            -- 提取文件名（去掉路径）
            local filename = filepath:match("([^/\\]+)$") or filepath
            location = filename .. ":" .. line
            actualMessage = message
        end

        -- 添加异常信息到详细错误列表
        addDetailedError({
            test = testName,
            type = "Exception", 
            message = actualMessage,
            expected = "正常执行",
            actual = "异常",
            location = location
        })

        -- 打印堆栈跟踪
        Logger.error("堆栈跟踪:")
        local trace = getStackTrace()
        for _, line in ipairs(trace) do
            Logger.error(line)
        end

        TestFramework.failed = TestFramework.failed + 1
        return false
    end
end

-- 运行多个测试函数
function RunAllTests(testNames)
    local totalPassed = 0
    local totalFailed = 0
    local passedTests = {}
    local failedTests = {}
    local allDetailedErrors = {} -- 收集所有测试的详细错误信息

    Logger.info("🔄 开始运行 " .. #testNames .. " 个已注册测试: " .. table.concat(testNames, ", "))
    Logger.newline()

    for _, testName in ipairs(testNames) do
        local success = RunTest(testName)
        if success then
            table.insert(passedTests, testName)
            totalPassed = totalPassed + 1
        else
            table.insert(failedTests, testName)
            totalFailed = totalFailed + 1

            -- 收集本次测试的详细错误信息
            for _, errorInfo in ipairs(TestFramework.detailed_errors) do
                table.insert(allDetailedErrors, errorInfo)
            end
        end
        Logger.newline() -- 添加空行分隔不同测试
    end

    -- 输出详细总结
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

        -- 显示所有详细错误信息
        if #allDetailedErrors > 0 then
            Logger.newline()
            Logger.separator("=", 60)
            Logger.failure("🔍 所有错误详情:")
            Logger.separator("-", 60)

            local currentTest = ""
            for i, errorInfo in ipairs(allDetailedErrors) do
                if errorInfo.test ~= currentTest then
                    if currentTest ~= "" then
                        Logger.newline() -- 在测试之间添加空行
                    end
                    currentTest = errorInfo.test
                    Logger.failure("测试: " .. currentTest)
                end

                Logger.failure(string.format("  %d. %s (%s)", i, errorInfo.message, errorInfo.location))
            end
            Logger.separator("=", 60)
        end
    end

    return totalFailed == 0
end

-- 主测试启动器
function Start()
    -- 获取环境变量中的测试函数名
    local testFunctionName = os.getenv("TEST_FUNCTION")
    Logger.debug("TEST_FUNCTION: " .. (testFunctionName or "nil"))
    Logger.debug("颜色支持状态: " .. (Logger.isColorEnabled() and "已启用" or "已禁用"))

    Logger.separator("=", 60)
    Logger.info("🧪 Qt Agent 单元测试框架")
    Logger.separator("=", 60)

    local overallSuccess = false

    if not testFunctionName or testFunctionName == "" then
        -- 没有指定测试函数，运行所有已注册的测试
        Logger.info("未指定特定测试函数，运行所有已注册的测试...")
        Logger.newline()

        local registeredTests = GetRegisteredTests()
        if #registeredTests == 0 then
            Logger.error("错误: 没有已注册的测试函数。请使用 RegisterTest() 注册测试函数。")
            Logger.status("FAILED")
            return
        end

        overallSuccess = RunAllTests(registeredTests)

        Logger.newline()
        if overallSuccess then
            Logger.success("🎉 所有测试通过!")
            Logger.status("OK") -- 这是LuaTestController期望的成功标识
        else
            Logger.failure("💥 测试失败!")
            Logger.status("FAILED")
            -- 不再调用os.exit(1)，而是让程序正常结束
        end
    else
        -- 运行指定的测试函数
        Logger.info("🎯 指定测试函数: " .. testFunctionName)
        Logger.newline()

        overallSuccess = RunTest(testFunctionName)

        Logger.newline()
        if overallSuccess then
            Logger.success("🎉 测试通过!")
            Logger.status("OK") -- 这是LuaTestController期望的成功标识
        else
            Logger.failure("💥 测试失败!")
            Logger.status("FAILED")
            -- 不再调用os.exit(1)，而是让程序正常结束
        end
    end
end

return {
    Start = Start,
    RegisterTest = RegisterTest,
    GetRegisteredTests = GetRegisteredTests,
    Assert = Assert,
    Logger = Logger -- 导出日志系统供外部使用
}
