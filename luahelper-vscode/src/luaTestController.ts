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
 *
 * 2. Test Debugging Features:
 *    - Uses standard VS Code debug configuration (like thirdparty/adapter.ts)
 *    - No temporary debug scripts or custom debugger integration
 *    - Simple debug configuration with lua type
 *    - Passes test function name via environment variable
 *
 * 3. Configuration Support:
 *    - luahelper.test.testGlob: Pattern to find test files (default: "**\/[tT]est*.lua")
 *    - luahelper.test.testRegex: Pattern to find test functions
 *    - luahelper.test.testEncoding: File encoding (default: "utf8")
 *    - luahelper.test.luaExe: Lua executable path (default: "lua")
 *    - luahelper.test.launchArgs: Custom arguments for Lua execution (default: [])
 *      * Arguments passed before the test file path
 *      * For embedded Lua: ["-a", "-l", "-u"]
 *      * For standard Lua: []
 *    - luahelper.test.decorationRegex: Pattern for parsing error locations
 *    - luahelper.test.stopOnEntry: Whether to stop on entry when debugging
 *
 * Usage:
 *   - Tests are discovered automatically based on file patterns
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
import * as os from "os";
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

    // 测试输出通道初始化
    this.testOutputChannel.appendLine("=== Lua Test Output Channel ===");
    this.testOutputChannel.appendLine(
      "This channel displays test stdout and stderr output"
    );
    this.testOutputChannel.appendLine(
      `Initialized at: ${new Date().toISOString()}`
    );
    this.testOutputChannel.appendLine(
      "=========================================="
    );

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

    // 同时测试测试输出通道
    this.testOutputChannel.appendLine("=== Test Output Channel Test ===");
    this.testOutputChannel.appendLine(
      `Test timestamp: ${new Date().toISOString()}`
    );
    this.testOutputChannel.appendLine(
      "This is where test stdout/stderr will appear"
    );
    this.testOutputChannel.appendLine("=====================================");

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
          testConfig.testEncoding,
          workspaceFolder
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
      return filePath.toLowerCase().includes(pattern.toLowerCase());
    }
  }

  private async parseTestFile(
    filePath: string,
    testRegex: RegExp,
    encoding: string,
    workspaceFolder: vscode.WorkspaceFolder
  ) {
    try {
      const content = fs
        .readFileSync(filePath, { encoding: encoding as any })
        .toString();

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
      // Create debug configuration similar to thirdparty/adapter.ts
      // Use standard lua debug configuration instead of LuaHelper-Debug
      // Build arguments array with custom lua args from launchArgs
      const args = [...testConfig.launchArgs];

      // Add the test file path to the arguments
      args.push(filePath);

      // Print the debug command for debugging
      const commandStr = `${testConfig.luaExe} ${args.join(" ")}`;
      this.log(`[LuaTestController] Debug command: ${commandStr}`);
      this.log(
        `[LuaTestController] Debug environment: TEST_FUNCTION=${testName}`
      );

      const debugConfig: vscode.DebugConfiguration = {
        type: "LuaHelper-Debug",
        request: "launch",
        name: `Debug Test: ${testName}`,
        cwd: workspaceFolder.uri.fsPath,
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
      // Build arguments array with custom lua args from launchArgs
      const args = [...testConfig.launchArgs];

      // Add the test file path to the arguments
      args.push(filePath);

      // Set up environment variables including test function name
      const env = {
        ...process.env,
        TEST_FUNCTION: testName,
      };

      // Print the execution command for debugging
      const commandStr = `${testConfig.luaExe} ${args.join(" ")}`;
      this.log(`[LuaTestController] Executing command: ${commandStr}`);
      this.log(`[LuaTestController] Environment: TEST_FUNCTION=${testName}`);

      // 在测试输出通道中记录测试开始
      this.testOutputChannel.appendLine(
        `\n=== Test Execution: ${testName} ===`
      );
      this.testOutputChannel.appendLine(`File: ${path.basename(filePath)}`);
      this.testOutputChannel.appendLine(`Command: ${commandStr}`);
      this.testOutputChannel.appendLine(`Time: ${new Date().toISOString()}`);
      this.testOutputChannel.appendLine(
        "----------------------------------------"
      );

      // Record command execution for display in VS Code Test UI
      run.appendOutput(`━━━ Test Execution ━━━\r\n`, undefined, test);
      run.appendOutput(`Command: ${commandStr}\r\n`, undefined, test);
      run.appendOutput(
        `Environment: TEST_FUNCTION=${testName}\r\n`,
        undefined,
        test
      );
      run.appendOutput(`━━━━━━━━━━━━━━━━━━━━━━━\r\n`, undefined, test);

      // Execute with custom arguments and environment variables
      const lua = cp.spawnSync(testConfig.luaExe, args, {
        cwd: workspaceFolder.uri.fsPath,
        env: env,
      });

      const duration = Date.now() - startTime;
      const stderr = String(lua.stderr || "");
      const stdout = String(lua.stdout || "");

      // Add debug logging to understand the output
      this.log(`[LuaTestController] Test execution completed for ${testName}`);
      this.log(`[LuaTestController] Exit code: ${lua.status}`);
      this.log(`[LuaTestController] STDOUT:`, stdout);
      this.log(`[LuaTestController] STDERR:`, stderr);

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

      // 输出测试结果到测试通道
      this.testOutputChannel.appendLine(`Exit Code: ${lua.status}`);
      this.testOutputChannel.appendLine(`Duration: ${duration}ms`);
      this.testOutputChannel.appendLine(
        "========================================\n"
      );

      if (stderr.length > 0) {
        this.logError("Failed to execute test file", stderr);
        const cleanStderr = this.formatOutput(stderr);
        run.appendOutput(`━━━ ERROR ━━━\r\n`, undefined, test);
        run.appendOutput(
          `Test execution failed:\r\n${cleanStderr}\r\n`,
          undefined,
          test
        );
        run.appendOutput(`━━━━━━━━━━━━━\r\n`, undefined, test);
        run.failed(test, [new vscode.TestMessage(stderr)], duration);
        return;
      }

      // Check for test passed pattern - look for "Test 'testName' PASSED" format
      // Changed to match the specific pattern: testname.*PASSED
      const passed =
        stdout &&
        stdout.length > 0 &&
        (stdout.match(new RegExp(`Test\\s+'${testName}'\\s+PASSED`, "i")) ||
          stdout.match(new RegExp(`${testName}.*PASSED`, "i")) ||
          stdout.match(/\bOK\b/));

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
      this.log(
        `[LuaTestController] - Final result: ${passed ? "PASSED" : "FAILED"}`
      );

      // 在测试输出通道中记录最终结果
      this.testOutputChannel.appendLine(
        `Result: ${passed ? "✅ PASSED" : "❌ FAILED"}`
      );

      if (passed) {
        this.log(`[LuaTestController] Marking test ${testName} as PASSED`);
        run.appendOutput(`━━━ RESULT ━━━\r\n`, undefined, test);
        run.appendOutput(`✅ Test "${testName}" PASSED\r\n`, undefined, test);
        run.appendOutput(`Duration: ${duration}ms\r\n`, undefined, test);
        run.appendOutput(`━━━━━━━━━━━━━━\r\n`, undefined, test);
        run.passed(test, duration);
      } else {
        // Parse error output for line numbers and messages using decorationRegex
        const messages: vscode.TestMessage[] = [];
        const match = testConfig.decorationRegex.exec(stdout);

        if (match && match[1] && match[2]) {
          const line = Number(match[1]);
          if (Number.isSafeInteger(line)) {
            const message = (match[2] || "")
              .trim()
              .replace(/\r\n/g, "")
              .replace(/\n/g, " ");
            const testMessage = new vscode.TestMessage(message);
            if (test.range && test.uri) {
              testMessage.location = new vscode.Location(
                test.uri,
                new vscode.Position(Math.max(0, line - 1), 0)
              );
            }
            messages.push(testMessage);
          }
        }

        if (messages.length === 0) {
          messages.push(new vscode.TestMessage(stdout || "Test failed"));
        }

        run.appendOutput(`━━━ RESULT ━━━\r\n`, undefined, test);
        run.appendOutput(`❌ Test "${testName}" FAILED\r\n`, undefined, test);
        run.appendOutput(`Duration: ${duration}ms\r\n`, undefined, test);
        run.appendOutput(`━━━━━━━━━━━━━━\r\n`, undefined, test);
        run.failed(test, messages, duration);
      }
    } catch (error) {
      const errorMessage = `Test execution failed: ${error}`;

      // 记录异常到测试输出通道
      this.testOutputChannel.appendLine("=== EXCEPTION ===");
      this.testOutputChannel.appendLine(errorMessage);
      this.testOutputChannel.appendLine("===============");

      run.appendOutput(`━━━ EXCEPTION ━━━\r\n`, undefined, test);
      run.appendOutput(`💥 ${errorMessage}\r\n`, undefined, test);
      run.appendOutput(`━━━━━━━━━━━━━━━━━\r\n`, undefined, test);
      run.errored(test, new vscode.TestMessage(errorMessage));
    }
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

      luaExe: config.get<string>("luaExe") || "/titan/agent/titanagent",

      // Custom lua arguments for embedded lua executables
      launchArgs: config.get<string[]>("launchArgs") || ["-a", "-l", "-u"],

      decorationRegex: config.get<string>("decorationRegex")
        ? new RegExp(config.get<string>("decorationRegex")!, "gm")
        : /\.lua:([1-9][0-9]*):(.*)stack traceback:/gm,

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
      // 适配Qingteng Agent - 拷贝LuaPanda.lua和QtAgentUnit.lua文件到titan agent目录
      let workDir = "";
      if (os.type() === "Windows_NT") {
        workDir = "c:\\program files\\titanagent\\data\\script";
      } else if (os.type() === "Linux") {
        workDir = "/titan/agent/data/script";
      } else {
        // 其他系统暂不处理
        this.log(`[LuaTestController] Unsupported OS type: ${os.type()}`);
        return;
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

      // 拷贝QtAgentUnit.lua文件
      try {
        const qtAgentUnitPath = path.join(workDir, "QtAgentUnit.lua");
        if (!fs.existsSync(qtAgentUnitPath)) {
          const qtAgentUnitContent = fs.readFileSync(
            Tools.getQtAgentUnitPathInExtension()
          );
          fs.writeFileSync(qtAgentUnitPath, qtAgentUnitContent);
          this.log(
            `[LuaTestController] Copied QtAgentUnit.lua to ${qtAgentUnitPath}`
          );
        } else {
          this.log(
            `[LuaTestController] QtAgentUnit.lua already exists at ${qtAgentUnitPath}`
          );
        }
      } catch (error) {
        this.logError(
          `[LuaTestController] Failed to copy QtAgentUnit.lua:`,
          error
        );
      }

      this.filesCopied = true; // 标记已经拷贝过文件
    } catch (error) {
      this.logError(`[LuaTestController] Error in copyRequiredFiles:`, error);
    }
  }

  private formatOutput(output: string): string {
    // 直接返回原始输出，不做任何格式化处理
    return output;
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
