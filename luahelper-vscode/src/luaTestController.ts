/*
 * LuaTestController - Test Runner and Debugger for Lua Tests
 *
 * This implementation is based on thirdparty/tests.ts and thirdparty/adapter.ts to provide:
 *
 * 1. Test Running Features:
 *    - Direct execution without temporary files (like thirdparty/tests.ts)
 *    - Uses spawnSync(luaExe, launchArgs + filePath) for test execution with configurable arguments
 *    - Supports embedded Lua executables with custom command line arguments
 *    - Uses environment variable TEST_FUNCTION to pass test function name to Lua script
 *    - Checks for "OK" pattern in output to determine test pass/fail
 *    - Supports error parsing with line number detection
 *    - Configurable test patterns and encoding
 *    - Prints execution command for debugging purposes
 *    - Only recognizes files containing require("LuaUnittest") as test files
 *
 * 2. Test Debugging Features:
 *    - Uses standard VS Code debug configuration (like thirdparty/adapter.ts)
 *    - No temporary debug scripts or custom debugger integration
 *    - Simple debug configuration with lua type
 *    - Passes test function name via environment variable
 *
 * 3. Configuration Support:
 *    - luahelper.test.testGlob: Pattern to find test files (default: "**\/*.lua")
 *    - luahelper.test.testRegex: Pattern to find test functions
 *    - luahelper.test.testEncoding: File encoding (default: "utf8")
 *    - luahelper.test.luaExe: Lua executable path (default: "lua")
 *    - luahelper.test.launchArgs: Custom arguments for Lua execution (default: [])
 *      * Arguments passed before the test file path
 *      * For embedded Lua: ["-a", "-l", "-u"]
 *      * For standard Lua: []
 *    - luahelper.test.stopOnEntry: Whether to stop on entry when debugging
 *
 * Usage:
 *   - Tests are discovered automatically based on file patterns and LuaUnittest requirement
 *   - Test files must contain require("LuaUnittest") to be recognized
 *   - Test functions should start with "test" or "Test"
 *   - Use VS Code native testing UI to run or debug tests
 *   - Test function name is passed via TEST_FUNCTION environment variable
 *   - Configure launchArgs for embedded Lua executables:
 *     "luahelper.test.launchArgs": ["-a", "-l", "-u"]
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { minimatch } from "glob";
import { Tools } from "./common/tools";

export class LuaTestController {
  private testController: vscode.TestController;
  private watchedFiles = new Map<string, vscode.FileSystemWatcher>();
  private context: vscode.ExtensionContext;
  private filesCopied: boolean = false; // 标记是否已经拷贝过文件
  private outputChannel: vscode.OutputChannel; // 添加输出面板
  private testOutputChannel: vscode.OutputChannel; // 专门用于测试输出的通道

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.testController = vscode.tests.createTestController(
      "luahelper-tests",
      "Lua Tests"
    );
    context.subscriptions.push(this.testController);

    // 创建诊断日志输出面板
    this.outputChannel = vscode.window.createOutputChannel(
      "LuaHelper Test Controller"
    );
    context.subscriptions.push(this.outputChannel);

    // 创建专门的测试输出面板
    this.testOutputChannel = vscode.window.createOutputChannel(
      "LuaHelper Test Output"
    );
    context.subscriptions.push(this.testOutputChannel);

    // 初始化日志，总是显示
    this.outputChannel.appendLine("=== LuaTestController Initialized ===");
    this.outputChannel.appendLine(`Time: ${new Date().toISOString()}`);

    // 设置扩展路径供Tools使用
    Tools.SetVSCodeExtensionPath(context.extensionPath);

    this.testController.refreshHandler = () => this.discoverTests();

    // Create both run and debug profiles
    this.testController.createRunProfile(
      "Run Tests",
      vscode.TestRunProfileKind.Run,
      this.runTests.bind(this),
      true
    );

    this.testController.createRunProfile(
      "Debug Tests",
      vscode.TestRunProfileKind.Debug,
      this.debugTests.bind(this),
      true
    );

    // Register commands
    this.registerCommands();

    // Initial discovery
    this.discoverTests();

    // Watch for changes
    this.setupFileWatcher();
  }

  private registerCommands() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "luahelper.test.debugTest",
        this.debugTestCommand.bind(this)
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "luahelper.test.runTest",
        this.runTestCommand.bind(this)
      )
    );

    // 添加测试输出面板的命令
    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "luahelper.test.testOutput",
        this.testOutputCommand.bind(this)
      )
    );
  }

  private async testOutputCommand() {
    // 测试输出面板功能
    this.outputChannel.appendLine("=== Output Panel Test ===");
    this.outputChannel.appendLine(
      `Test message at: ${new Date().toISOString()}`
    );

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const testConfig = this.getTestConfig(workspaceFolder);
      this.outputChannel.appendLine(`LogPanel config: ${testConfig.logPanel}`);
    } else {
      this.outputChannel.appendLine("No workspace folder found");
    }

    // 显示输出面板
    this.outputChannel.show();

    vscode.window.showInformationMessage(
      "Test messages sent to both output channels"
    );
  }

  private async debugTestCommand(test?: vscode.TestItem) {
    if (!test) {
      vscode.window.showWarningMessage("No test selected for debugging");
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    await this.startDebugSession(test, workspaceFolder);
  }

  private async runTestCommand(test?: vscode.TestItem) {
    if (!test) {
      vscode.window.showWarningMessage("No test selected for running");
      return;
    }

    // Create a test run request for the specific test
    const request = new vscode.TestRunRequest([test]);
    await this.runTests(request, new vscode.CancellationTokenSource().token);
  }

  private async discoverTests() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    // Clear existing tests
    this.testController.items.replace([]);

    for (const folder of workspaceFolders) {
      await this.discoverTestsInFolder(folder);
    }
  }

  private async discoverTestsInFolder(workspaceFolder: vscode.WorkspaceFolder) {
    const testConfig = this.getTestConfig(workspaceFolder);

    // Debug logging
    this.log(
      `[LuaTestController] Discovering tests in ${workspaceFolder.name} with pattern: ${testConfig.testGlob}`
    );

    try {
      const files = await this.findTestFiles(
        workspaceFolder.uri.fsPath,
        testConfig.testGlob
      );
      this.log(
        `[LuaTestController] Found ${files.length} test files:`,
        files.map((f) => path.relative(workspaceFolder.uri.fsPath, f))
      );

      for (const file of files) {
        await this.parseTestFile(
          file,
          testConfig.testRegex,
          testConfig.testEncoding
        );
      }
    } catch (error) {
      this.logError(`[LuaTestController] Error discovering tests:`, error);
      // Ignore error and continue
    }
  }

  private async findTestFiles(
    rootPath: string,
    pattern: string
  ): Promise<string[]> {
    try {
      // Use VS Code's workspace.findFiles which properly handles glob patterns
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(rootPath)
      );
      if (workspaceFolder) {
        const relativePattern = new vscode.RelativePattern(
          workspaceFolder,
          pattern
        );
        const files = await vscode.workspace.findFiles(relativePattern);
        return files.map((file) => file.fsPath);
      }
    } catch (error) {
      this.logWarn(
        `[LuaTestController] Error using workspace.findFiles, falling back to manual search:`,
        error
      );
    }

    // Fallback to manual file search with glob pattern matching
    const files: string[] = [];

    const search = (dir: string, relativePath: string = "") => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativeFilePath = path
            .join(relativePath, entry.name)
            .replace(/\\/g, "/");

          if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            entry.name !== "node_modules"
          ) {
            search(fullPath, relativeFilePath);
          } else if (
            entry.isFile() &&
            this.matchesGlobPattern(relativeFilePath, pattern)
          ) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore directories we can't read
      }
    };

    search(rootPath);
    return files;
  }

  private matchesGlobPattern(filePath: string, pattern: string): boolean {
    // Use proper glob pattern matching with minimatch
    try {
      const matches = minimatch(filePath, pattern, {
        matchBase: true,
        nocase: true, // case insensitive matching
      });

      // Debug logging for pattern matching
      if (
        process.env.NODE_ENV === "development" ||
        vscode.workspace.getConfiguration("luahelper.test").get("debug")
      ) {
        this.log(
          `[LuaTestController] Glob Pattern: ${pattern} -> File: ${filePath} -> Match: ${matches}`
        );
      }

      return matches;
    } catch (error) {
      // If glob pattern matching fails, fall back to simple string matching
      this.logWarn(
        `[LuaTestController] Invalid glob pattern: ${pattern}`,
        error
      );
      return filePath.includes(pattern);
    }
  }

  private async parseTestFile(
    filePath: string,
    testRegex: RegExp,
    encoding: string
  ) {
    try {
      const content = fs
        .readFileSync(filePath, { encoding: encoding as any })
        .toString();

      // 检查文件是否包含 require("LuaUnittest")，如果没有则不识别为测试文件
      const hasLuaUnittestRequire =
        content.includes('require("LuaUnittest")') ||
        content.includes("require('LuaUnittest')") ||
        content.includes("require([[LuaUnittest]])");

      if (!hasLuaUnittestRequire) {
        this.log(
          `[LuaTestController] Skipping file ${filePath} - no LuaUnittest require found`
        );
        return;
      }

      const fileUri = vscode.Uri.file(filePath);

      // Create file-level test item
      const fileItem = this.testController.createTestItem(
        filePath,
        path.basename(filePath),
        fileUri
      );
      fileItem.canResolveChildren = true;

      const lines = content.split(/\r?\n/);

      // Parse test functions line by line for better accuracy
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = testRegex.exec(line);

        if (match && match[1]) {
          const testName = match[1];

          // Create test item
          const testItem = this.testController.createTestItem(
            `${filePath}::${testName}`,
            testName,
            fileUri
          );

          testItem.range = new vscode.Range(
            new vscode.Position(i, 0),
            new vscode.Position(i, line.length)
          );

          fileItem.children.add(testItem);
        }

        // Reset regex for next iteration
        testRegex.lastIndex = 0;
      }

      if (fileItem.children.size > 0) {
        this.testController.items.add(fileItem);

        // 当发现测试用例时，拷贝必要的调试文件
        this.log(
          `[LuaTestController] Found ${fileItem.children.size} test(s) in ${filePath}, copying required files...`
        );
        this.copyRequiredFiles();
      } else {
        this.log(
          `[LuaTestController] File ${filePath} has LuaUnittest require but no test functions found`
        );
      }
    } catch (error) {
      // Ignore file parsing errors - log to output channel instead
      vscode.window.showErrorMessage(
        `Error parsing test file ${filePath}: ${error}`
      );
    }
  }

  private setupFileWatcher() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    for (const folder of workspaceFolders) {
      const testConfig = this.getTestConfig(folder);

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, testConfig.testGlob)
      );

      watcher.onDidCreate(() => this.discoverTests());
      watcher.onDidChange(() => this.discoverTests());
      watcher.onDidDelete(() => this.discoverTests());

      this.watchedFiles.set(folder.uri.fsPath, watcher);
    }
  }

  private async runTests(
    request: vscode.TestRunRequest,
    cancellation: vscode.CancellationToken
  ) {
    const run = this.testController.createTestRun(request);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      run.end();
      return;
    }

    // Use the new config helper method
    const testConfig = this.getTestConfig(workspaceFolder);

    const testQueue: vscode.TestItem[] = [];

    if (request.include) {
      request.include.forEach((test) => {
        testQueue.push(test);
        if (test.children) {
          test.children.forEach((child) => testQueue.push(child));
        }
      });
    } else {
      this.testController.items.forEach((test) => {
        testQueue.push(test);
        if (test.children) {
          test.children.forEach((child) => testQueue.push(child));
        }
      });
    }

    for (const test of testQueue) {
      if (cancellation.isCancellationRequested) {
        break;
      }

      if (test.children && test.children.size > 0) {
        // Skip file-level items, we'll run individual tests
        continue;
      }

      run.started(test);

      try {
        await this.runSingleTest(test, run, testConfig, workspaceFolder);
      } catch (error) {
        const errorMessage = `Test execution failed: ${error}`;
        run.appendOutput(`━━━ EXCEPTION ━━━\r\n`, undefined, test);
        run.appendOutput(`💥 ${errorMessage}\r\n`, undefined, test);
        run.appendOutput(`━━━━━━━━━━━━━━━━━\r\n`, undefined, test);
        run.errored(test, new vscode.TestMessage(errorMessage));
      }
    }

    run.end();
  }

  private async debugTests(
    request: vscode.TestRunRequest,
    cancellation: vscode.CancellationToken
  ) {
    const run = this.testController.createTestRun(request);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      run.end();
      return;
    }

    let testQueue: vscode.TestItem[] = [];

    if (request.include) {
      request.include.forEach((test) => {
        if (test.children && test.children.size > 0) {
          test.children.forEach((child) => testQueue.push(child));
        } else {
          testQueue.push(test);
        }
      });
    } else {
      this.testController.items.forEach((test) => {
        if (test.children && test.children.size > 0) {
          test.children.forEach((child) => testQueue.push(child));
        } else {
          testQueue.push(test);
        }
      });
    }

    // For debug mode, we only debug one test at a time
    if (testQueue.length === 0) {
      run.end();
      return;
    }

    const firstTest = testQueue[0];

    // Start debugging session for the first test
    await this.startDebugSession(firstTest, workspaceFolder);

    // Mark all tests as started for UI feedback
    for (const test of testQueue) {
      run.started(test);
    }

    run.end();
  }

  private async startDebugSession(
    test: vscode.TestItem,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<void> {
    const [filePath, testName] = test.id.split("::");

    if (!testName || !test.uri) {
      return;
    }

    const testConfig = this.getTestConfig(workspaceFolder);

    try {
      // 直接使用原始文件路径
      let targetFilePath = filePath;
      let workingDirectory = workspaceFolder.uri.fsPath; // 使用工作区目录作为工作目录

      // Create debug configuration similar to thirdparty/adapter.ts
      // Use standard lua debug configuration instead of LuaHelper-Debug
      // Build arguments array with custom lua args from launchArgs
      const args = [...testConfig.launchArgs];

      // Add the test file path to the arguments
      args.push(targetFilePath);

      // Print the debug command for debugging
      const commandStr = `${testConfig.luaExe} ${args.join(" ")}`;
      this.log(`[LuaTestController] Debug command: ${commandStr}`);
      this.log(
        `[LuaTestController] Debug working directory: ${workingDirectory}`
      );
      this.log(
        `[LuaTestController] Debug environment: TEST_FUNCTION=${testName}`
      );

      const debugConfig: vscode.DebugConfiguration = {
        type: "LuaHelper-Debug",
        request: "launch",
        name: `Debug Test: ${testName}`,
        cwd: workingDirectory,
        luaFileExtension: "lua",
        connectionPort: testConfig.debugPort,
        stopOnEntry: testConfig.stopOnEntry,
        autoPathMode: false,
        program: testConfig.luaExe,
        args: args,
        env: {
          ...process.env,
          TEST_FUNCTION: testName,
        },
        console: "internalConsole",
      };

      // Start debugging session
      const success = await vscode.debug.startDebugging(
        
        workspaceFolder,
        debugConfig
      );

      if (!success) {
        vscode.window.showErrorMessage(
          `Failed to start debug session for test: ${testName}`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error starting debug session: ${error}`);
    }
  }

  private async runSingleTest(
    test: vscode.TestItem,
    run: vscode.TestRun,
    testConfig: any,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<void> {
    const [filePath, testName] = test.id.split("::");

    if (!testName || !test.uri) {
      return;
    }

    const startTime = Date.now();

    try {
      // 直接使用原始文件路径
      let targetFilePath = filePath;
      let workingDirectory = workspaceFolder.uri.fsPath;

      // Build arguments array with custom lua args from launchArgs
      const args = [...testConfig.launchArgs];

      // Add the test file path to the arguments
      args.push(targetFilePath);

      // Set up environment variables including test function name
      const env = {
        ...process.env,
        TEST_FUNCTION: testName,
      };

      // Print the execution command for debugging
      const commandStr = `${testConfig.luaExe} ${args.join(" ")}`;
      this.log(`[LuaTestController] Executing command: ${commandStr}`);
      this.log(`[LuaTestController] Working directory: ${workingDirectory}`);
      this.log(`[LuaTestController] Environment: TEST_FUNCTION=${testName}`);

      // Execute with custom arguments and environment variables
      const lua = cp.spawnSync(testConfig.luaExe, args, {
        cwd: workingDirectory,
        env: env,
        encoding: "utf8", // 确保正确的编码
        timeout: 30000, // 30秒超时
      });

      const duration = Date.now() - startTime;
      const stderr = String(lua.stderr || "");
      const stdout = String(lua.stdout || "");
      const exitCode = lua.status;
      const signal = lua.signal;

      // Add debug logging to understand the output
      this.log(`[LuaTestController] Test execution completed for ${testName}`);
      this.log(`[LuaTestController] Exit code: ${exitCode}`);
      this.log(`[LuaTestController] Signal: ${signal}`);

      // 将stdout和stderr输出到专门的测试输出通道
      if (stdout.length > 0) {
        this.testOutputChannel.appendLine("=== STDOUT ===");
        this.testOutputChannel.appendLine(stdout);
        this.testOutputChannel.appendLine("============");
      }

      if (stderr.length > 0) {
        this.testOutputChannel.appendLine("=== STDERR ===");
        this.testOutputChannel.appendLine(stderr);
        this.testOutputChannel.appendLine("============");
      }

      // Enhanced error handling - 区分系统错误和测试失败
      // 只有严重的系统错误（如信号终止）才被视为系统错误
      const hasSevereSystemError = signal !== null && signal !== "SIGCHLD";

      if (hasSevereSystemError) {
        this.logError("Test execution terminated by system signal", {
          exitCode,
          signal,
          stderr: stderr.substring(0, 500), // 限制日志长度
          stdout: stdout.substring(0, 500),
        });

        // 仅输出错误信息到test result窗口
        run.appendOutput(`━━━ SYSTEM ERROR ━━━\r\n`, undefined, test);
        run.appendOutput(`Signal: ${signal}\r\n`, undefined, test);
        run.appendOutput(`Exit Code: ${exitCode}\r\n`, undefined, test);

        if (stderr.length > 0) {
          run.appendOutput(`STDERR:\r\n${stderr}\r\n`, undefined, test);
        }

        // 创建系统错误消息
        const systemError = new vscode.TestMessage(
          `Test process terminated by system signal: ${signal}\nExit Code: ${exitCode}\n\nThis may indicate a severe error in the test or Lua runtime.`
        );

        run.errored(test, [systemError], duration);
        return;
      }

      // Check for test passed pattern - 基于输出内容判断测试结果
      const passed =
        stdout &&
        stdout.length > 0 &&
        (stdout.match(new RegExp(`Test\\s+'${testName}'\\s+PASSED`, "i")) ||
          stdout.match(new RegExp(`${testName}.*PASSED`, "i")) ||
          stdout.match(/\bOK\b/));

      // Check for explicit failure patterns
      const explicitFailure =
        stdout &&
        stdout.length > 0 &&
        (stdout.match(/\bFAILED\b/) ||
          stdout.match(/assertion.*failed/i) ||
          stdout.match(/test.*failed/i));

      this.log(`[LuaTestController] Test result evaluation for ${testName}:`);
      this.log(
        `[LuaTestController] - Pattern "Test '${testName}' PASSED": ${!!stdout.match(
          new RegExp(`Test\\s+'${testName}'\\s+PASSED`, "i")
        )}`
      );
      this.log(
        `[LuaTestController] - Pattern "${testName}.*PASSED": ${!!stdout.match(
          new RegExp(`${testName}.*PASSED`, "i")
        )}`
      );
      this.log(
        `[LuaTestController] - Contains 'OK': ${!!stdout.match(/\bOK\b/)}`
      );
      this.log(`[LuaTestController] - Contains 'FAILED': ${!!explicitFailure}`);
      this.log(`[LuaTestController] - Exit Code: ${exitCode}`);
      this.log(
        `[LuaTestController] - Final result: ${passed ? "PASSED" : "FAILED"}`
      );

      if (passed) {
        this.log(`[LuaTestController] Marking test ${testName} as PASSED`);
        // 测试通过时只显示简单的成功信息
        run.appendOutput(
          `✅ Test "${testName}" PASSED (${duration}ms)\r\n`,
          undefined,
          test
        );
        run.passed(test, duration);
      } else {
        // 测试未通过 - 仅输出error和fail相关信息到test result窗口
        const failureMessages = this.parseErrorMessages(
          stdout,
          test,
          workspaceFolder,
          run
        );

        if (failureMessages.length === 0) {
          // 创建通用失败消息，包含文件路径和行号信息
          let failureReason = "No 'PASSED' or 'OK' pattern found in output";
          if (explicitFailure) {
            failureReason = "Test explicitly marked as FAILED";
          } else if (exitCode !== 0 && exitCode !== 1) {
            failureReason = `Unexpected exit code: ${exitCode}`;
          }

          // 获取测试文件路径
          const testFilePath = test.uri?.fsPath || filePath;
          const relativePath = path.relative(
            workspaceFolder.uri.fsPath,
            testFilePath
          );

          // 创建包含文件路径和行号的错误消息
          const genericFailure = new vscode.TestMessage(
            `测试失败: ${testName}\n文件: ${relativePath}\n原因: ${failureReason}`
          );

          // 如果测试项有位置信息，设置错误位置
          if (test.range && test.uri) {
            genericFailure.location = new vscode.Location(
              test.uri,
              test.range.start
            );
          }

          failureMessages.push(genericFailure);
        }

        // 只输出失败结果和错误信息
        run.appendOutput(
          `❌ Test "${testName}" FAILED (${duration}ms)\r\n`,
          undefined,
          test
        );
        run.failed(test, failureMessages, duration);
      }
    } catch (error) {
      const errorMessage = `Test execution failed: ${error}`;
      run.appendOutput(`💥 ${errorMessage}\r\n`, undefined, test);
      run.errored(test, new vscode.TestMessage(errorMessage));
    }
  }

  /**
   * 解析错误消息，尝试提取错误位置和详细信息
   * 只关注stdout，忽略stderr
   */
  private parseErrorMessages(
    stdout: string,
    test: vscode.TestItem,
    workspaceFolder: vscode.WorkspaceFolder,
    run: vscode.TestRun
  ): vscode.TestMessage[] {
    const messages: vscode.TestMessage[] = [];

    this.log(
      `[LuaTestController] Parsing stdout for errors in file ${test.uri?.fsPath}`
    );

    // 只输出LuaUnittest的ERROR和FAIL日志到test results面板
    const qtAgentErrorLogs = stdout.match(
      /\[[\d:]+\]\s*\[LuaUnittest\]\s*\[(ERROR|FAIL|FAILURE)\]\s*(.+)/gm
    );
    if (qtAgentErrorLogs && qtAgentErrorLogs.length > 0) {
      run.appendOutput(`━━━ Error Details ━━━\r\n`, undefined, test);
      for (const log of qtAgentErrorLogs) {
        run.appendOutput(`${log}\r\n`, undefined, test);
      }
      run.appendOutput(`━━━━━━━━━━━━━━━━━━━━━\r\n`, undefined, test);
    }

    // Parse LuaUnittest.lua ERROR and FAIL messages
    const qtErrorRegex =
      /\[[\d:]+\]\s*\[LuaUnittest\]\s*\[(ERROR|FAIL|FAILURE)\]\s*(.+)/gm;
    let qtMatch;
    while ((qtMatch = qtErrorRegex.exec(stdout)) !== null) {
      const logLevel = qtMatch[1].trim();
      const message = qtMatch[2].trim();

      if (message && message.length > 0) {
        // Try to extract location information from the message
        const locationMatch = message.match(/\[([^:\s]+\.lua):(\d+)\]/);

        if (locationMatch) {
          const filename = locationMatch[1].trim();
          const lineNumber = Number(locationMatch[2]);

          if (Number.isSafeInteger(lineNumber) && lineNumber > 0) {
            // Create detailed error message with filename, line number and original message
            const testMessage = new vscode.TestMessage(
              `错误位置: ${filename} 第${lineNumber}行\n错误级别: ${logLevel}\n原始信息: ${message}`
            );

            // Determine the file URI
            let errorFileUri: vscode.Uri;
            if (path.isAbsolute(filename)) {
              errorFileUri = vscode.Uri.file(filename);
            } else {
              errorFileUri = vscode.Uri.joinPath(workspaceFolder.uri, filename);
              if (!fs.existsSync(errorFileUri.fsPath) && test.uri) {
                errorFileUri = test.uri;
              }
            }

            testMessage.location = new vscode.Location(
              errorFileUri,
              new vscode.Position(Math.max(0, lineNumber - 1), 0)
            );

            messages.push(testMessage);
            this.log(
              `[LuaTestController] Found LuaUnittest error with location: ${filename}:${lineNumber}, message: ${message}`
            );
          }
        }
      }
    }

    // If no specific errors found, look for general error and fail patterns
    if (messages.length === 0) {
      const fullOutput = stdout.trim();
      if (fullOutput.length > 0) {
        this.log(
          `[LuaTestController] No specific errors found, looking for general error patterns`
        );

        // 只查找包含error或fail关键词的行
        const lines = fullOutput
          .split("\n")
          .filter((line) => line.trim().length > 0);
        const errorLines = lines.filter(
          (line) =>
            line.toLowerCase().includes("error") ||
            line.toLowerCase().includes("fail") ||
            line.toLowerCase().includes("assertion")
        );

        if (errorLines.length == 0) {
          // 没有找到明确的错误信息，创建包含位置信息的失败消息
          const testFilePath = test.uri?.fsPath;
          if (testFilePath) {
            const relativePath = path.relative(
              workspaceFolder.uri.fsPath,
              testFilePath
            );
            const failureMessage = new vscode.TestMessage(
              `测试失败，无具体错误信息\n文件: ${relativePath}\n测试函数: ${test.label}`
            );

            // 如果测试项有位置信息，设置错误位置
            if (test.range && test.uri) {
              failureMessage.location = new vscode.Location(
                test.uri,
                test.range.start
              );
            }

            messages.push(failureMessage);
          } else {
            // 如果没有文件路径信息，使用原来的简单消息
            messages.push(
              new vscode.TestMessage(
                "Test failed with no specific error message"
              )
            );
          }
        } else {
          // 找到了包含错误关键词的行，创建包含位置信息的错误消息
          const testFilePath = test.uri?.fsPath;
          if (testFilePath) {
            const relativePath = path.relative(
              workspaceFolder.uri.fsPath,
              testFilePath
            );

            // 将所有错误行合并为一个消息
            const errorText = errorLines.join("\n");
            const failureMessage = new vscode.TestMessage(
              `测试失败:\n文件: ${relativePath}\n测试函数: ${test.label}\n错误信息:\n${errorText}`
            );

            // 如果测试项有位置信息，设置错误位置
            if (test.range && test.uri) {
              failureMessage.location = new vscode.Location(
                test.uri,
                test.range.start
              );
            }

            messages.push(failureMessage);
          } else {
            // 如果没有文件路径信息，使用错误行内容创建消息
            const errorText = errorLines.join("\n");
            messages.push(
              new vscode.TestMessage(`Test failed with errors:\n${errorText}`)
            );
          }
        }
      }
    }

    this.log(
      `[LuaTestController] Parsed ${messages.length} error messages from stdout`
    );
    return messages;
  }

  /**
   * Supports custom Lua executable with configurable arguments and environment variables
   */
  private getTestConfig(workspaceFolder: vscode.WorkspaceFolder) {
    const config = vscode.workspace.getConfiguration("luahelper.test");

    return {
      testGlob: config.get<string>("testGlob") || "**/qttest*.lua",
      testRegex: config.get<string>("testRegex")
        ? new RegExp(config.get<string>("testRegex")!, "gm")
        : /^\s*function\s+(?:[a-zA-Z][a-zA-Z0-9]*:)?([tT]est[a-zA-Z0-9]*)\(\)(?:.*)$/gm,
      testEncoding: config.get<string>("testEncoding") || "utf8",

      luaExe: config.get<string>("luaExe") || "",

      // Custom lua arguments for embedded lua executables
      launchArgs: config.get<string[]>("launchArgs") || ["-a", "-l", "-u"],

      // Debug settings (for standard lua debugger)
      stopOnEntry: config.get<boolean>("stopOnEntry") || false,

      // Debug Port
      debugPort: config.get<number>("debugPort") || 8818,

      // Log Panel设置
      logPanel: config.get<boolean>("logPanel") || true,
    };
  }

  /**
   * 拷贝调试所需的文件到指定目录
   * 参考 initProcess 的实现逻辑
   */
  private copyRequiredFiles(): void {
    if (this.filesCopied) {
      return; // 如果已经拷贝过文件，则直接返回
    }

    try {
      // 适配Qingteng Agent - 拷贝LuaPanda.lua和LuaUnittest.lua文件到titan agent目录
      let workDir = "";
      
      // 从配置中读取Qingteng Agent工作目录
      const qingtengConfig = vscode.workspace.getConfiguration("luahelper.qingteng");
      const configuredWorkDir = qingtengConfig.get<string>("workdir");
      
      if (configuredWorkDir && configuredWorkDir.trim() !== "") {
        workDir = configuredWorkDir.trim();
      }

      // 创建目录（如果不存在）
      if (!fs.existsSync(workDir)) {
        try {
          fs.mkdirSync(workDir, { recursive: true });
          this.log(`[LuaTestController] Created directory: ${workDir}`);
        } catch (error) {
          this.logError(
            `[LuaTestController] Failed to create directory ${workDir}:`,
            error
          );
          return;
        }
      }

      // 拷贝LuaPanda.lua文件
      try {
        const luaPandaPath = path.join(workDir, "LuaPanda.lua");
        if (!fs.existsSync(luaPandaPath)) {
          const luaPandaContent = fs.readFileSync(
            Tools.getLuaPandaPathInExtension()
          );
          fs.writeFileSync(luaPandaPath, luaPandaContent);
          this.log(
            `[LuaTestController] Copied LuaPanda.lua to ${luaPandaPath}`
          );
        } else {
          this.log(
            `[LuaTestController] LuaPanda.lua already exists at ${luaPandaPath}`
          );
        }
      } catch (error) {
        this.logError(
          `[LuaTestController] Failed to copy LuaPanda.lua:`,
          error
        );
      }

      // 拷贝LuaUnittest.lua文件
      try {
        const LuaUnittestPath = path.join(workDir, "LuaUnittest.lua");
        if (!fs.existsSync(LuaUnittestPath)) {
          const LuaUnittestContent = fs.readFileSync(
            Tools.getLuaUnittestPathInExtension()
          );
          fs.writeFileSync(LuaUnittestPath, LuaUnittestContent);
          this.log(
            `[LuaTestController] Copied LuaUnittest.lua to ${LuaUnittestPath}`
          );
        } else {
          this.log(
            `[LuaTestController] LuaUnittest.lua already exists at ${LuaUnittestPath}`
          );
        }
      } catch (error) {
        this.logError(
          `[LuaTestController] Failed to copy LuaUnittest.lua:`,
          error
        );
      }

      this.filesCopied = true; // 标记已经拷贝过文件
    } catch (error) {
      this.logError(`[LuaTestController] Error in copyRequiredFiles:`, error);
    }
  }

  /**
   * 记录诊断日志到控制台和输出面板（如果启用）
   */
  private log(message: string, ...args: any[]): void {
    // 始终记录到控制台
    console.log(message, ...args);

    // 检查是否应该写入输出面板
    let shouldLogToPanel = false;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const testConfig = this.getTestConfig(workspaceFolder);
      shouldLogToPanel = testConfig.logPanel;
    }

    // 如果启用了logpanel，则写入输出面板
    if (shouldLogToPanel) {
      const fullMessage =
        args.length > 0 ? `${message} ${args.join(" ")}` : message;
      this.outputChannel.appendLine(`[LOG] ${fullMessage}`);
    }
  }

  /**
   * 记录错误日志到控制台和输出面板（如果启用）
   */
  private logError(message: string, ...args: any[]): void {
    // 始终记录到控制台
    console.error(message, ...args);

    // 检查是否应该写入输出面板
    let shouldLogToPanel = false;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const testConfig = this.getTestConfig(workspaceFolder);
      shouldLogToPanel = testConfig.logPanel;
    }

    // 如果启用了logpanel，则写入输出面板
    if (shouldLogToPanel) {
      const fullMessage =
        args.length > 0
          ? `ERROR: ${message} ${args.join(" ")}`
          : `ERROR: ${message}`;
      this.outputChannel.appendLine(`[ERROR] ${fullMessage}`);
    }
  }

  /**
   * 记录警告日志到控制台和输出面板（如果启用）
   */
  private logWarn(message: string, ...args: any[]): void {
    // 始终记录到控制台
    console.warn(message, ...args);

    // 检查是否应该写入输出面板
    let shouldLogToPanel = false;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const testConfig = this.getTestConfig(workspaceFolder);
      shouldLogToPanel = testConfig.logPanel;
    }

    // 如果启用了logpanel，则写入输出面板
    if (shouldLogToPanel) {
      const fullMessage =
        args.length > 0
          ? `WARN: ${message} ${args.join(" ")}`
          : `WARN: ${message}`;
      this.outputChannel.appendLine(`[WARN] ${fullMessage}`);
    }
  }

  dispose() {
    this.watchedFiles.forEach((watcher) => watcher.dispose());
    this.testController.dispose();
    this.outputChannel.dispose(); // 清理诊断日志输出面板
    this.testOutputChannel.dispose(); // 清理测试输出面板
  }
}