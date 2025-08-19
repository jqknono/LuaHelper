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
import * as crypto from "crypto";

export class LuaTestController {
  private testController: vscode.TestController;
  private watchedFiles = new Map<string, vscode.FileSystemWatcher>();
  private context: vscode.ExtensionContext;
  private copiedDirs: Set<string> = new Set(); // 已复制文件的目录集合
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
    this.outputChannel.appendLine(
      `Test message at: ${new Date().toISOString()}`
    );

    // 使用更标准的方式获取配置，无需依赖特定工作区文件夹
    const testConfig = vscode.workspace.getConfiguration("luahelper.test");
    this.outputChannel.appendLine(
      `LogPanel config: ${testConfig.get<boolean>("logPanel", true)}`
    );

    // 显示输出面板
    this.outputChannel.show();

    vscode.window.showInformationMessage(
      "Test messages sent to both output channels"
    );
  }

  private async debugTestCommand(test?: vscode.TestItem) {
    if (!test) {
      this.logError("No test selected for debugging");
      return;
    }

    await this.startDebugSession(test);
  }

  private async runTestCommand(test?: vscode.TestItem) {
    if (!test) {
      this.logError("No test selected for running");
      return;
    }

    // Create a test run request for the specific test
    const request = new vscode.TestRunRequest([test]);
    await this.runTests(request, new vscode.CancellationTokenSource().token);
  }

  private async discoverTests() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      this.logError("No workspace folders found");
      return;
    }

    // Clear existing tests
    this.testController.items.replace([]);

    for (const folder of workspaceFolders) {
      await this.discoverTestsInFolder(folder);
    }
  }

  private async discoverTestsInFolder(workspaceFolder: vscode.WorkspaceFolder) {
    const testConfig = vscode.workspace.getConfiguration("luahelper.test");

    // Debug logging
    this.log(
      `[LuaTestController] Discovering tests in ${workspaceFolder.name} with pattern: ${testConfig.testGlob}`
    );

    const files = await this.findTestFiles(
      workspaceFolder.uri.fsPath,
      testConfig.testGlob
    );
    this.log(
      `[LuaTestController] Found ${files.length} test files:`,
      files.map((f) => path.relative(workspaceFolder.uri.fsPath, f))
    );

    const testRegexConfig = testConfig.get<string>("testRegex");
    const testRegex = new RegExp(testRegexConfig, "gm");
    for (const file of files) {
      const testEncoding = testConfig.get<string>("testEncoding") || "utf8";
      await this.parseTestFile(file, testRegex, testEncoding);
    }
  }

  private async findTestFiles(
    rootPath: string,
    pattern: string
  ): Promise<string[]> {
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

    // Fallback to manual file search with glob pattern matching
    const files: string[] = [];

    const search = (dir: string, relativePath: string = "") => {
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
    };

    search(rootPath);
    return files;
  }

  private matchesGlobPattern(filePath: string, pattern: string): boolean {
    // Use proper glob pattern matching with minimatch
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
  }

  private async parseTestFile(
    filePath: string,
    testRegex: RegExp,
    encoding: string
  ) {
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
  }

  private setupFileWatcher() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      this.logError("No workspace folders found");
      return;
    }

    for (const folder of workspaceFolders) {
      const testGlob = vscode.workspace
        .getConfiguration("luahelper.test")
        .get("testGlob") as string;

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, testGlob)
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

    const testQueue: vscode.TestItem[] = [];

    // 收集要运行的测试项
    if (request.include) {
      request.include.forEach((test) => {
        if (test.children && test.children.size > 0) {
          // 如果选择的是文件级别的测试项，添加所有子测试
          test.children.forEach((child) => testQueue.push(child));
        } else {
          // 如果选择的是单个测试，直接添加
          testQueue.push(test);
        }
      });
    } else {
      // 如果没有指定测试，运行所有测试
      this.testController.items.forEach((test) => {
        if (test.children && test.children.size > 0) {
          test.children.forEach((child) => testQueue.push(child));
        } else {
          testQueue.push(test);
        }
      });
    }

    this.log(`[LuaTestController] 准备运行 ${testQueue.length} 个测试`);

    // 依次运行每个测试
    for (let i = 0; i < testQueue.length; i++) {
      const test = testQueue[i];

      // 检查是否取消
      if (cancellation.isCancellationRequested) {
        this.log(
          `[LuaTestController] 测试运行被取消，停止在第 ${i + 1} 个测试`
        );
        break;
      }

      // 跳过文件级别的测试项（应该已经在收集阶段过滤了，但双重检查）
      if (test.children && test.children.size > 0) {
        continue;
      }

      this.log(
        `[LuaTestController] 开始运行测试 ${i + 1}/${testQueue.length}: ${
          test.label
        }`
      );
      run.started(test);

      await this.runSingleTest(test, run);
      this.log(
        `[LuaTestController] 完成测试 ${i + 1}/${testQueue.length}: ${
          test.label
        }`
      );
    }

    this.log(
      `[LuaTestController] 所有测试运行完成，共处理 ${testQueue.length} 个测试`
    );
    run.end();
  }

  private async debugTests(
    request: vscode.TestRunRequest,
    cancellation: vscode.CancellationToken
  ) {
    const run = this.testController.createTestRun(request);

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
      this.logError("No tests to debug");
      return;
    }

    const firstTest = testQueue[0];

    // Start debugging session for the first test
    await this.startDebugSession(firstTest);

    // Mark all tests as started for UI feedback
    for (const test of testQueue) {
      run.started(test);
    }

    run.end();
  }

  private async startDebugSession(test: vscode.TestItem): Promise<void> {
    const [filePath, testName] = test.id.split("::");

    if (!testName || !test.uri) {
      this.logError("Invalid test item", { test });
      return;
    }

    const testConfig = vscode.workspace.getConfiguration("luahelper.test");

    // 直接使用原始文件路径
    let targetFilePath = filePath;
    let workingDirectory = testConfig.get<string>("workdir");

    // Create debug configuration similar to thirdparty/adapter.ts
    // Use standard lua debug configuration instead of LuaHelper-Debug
    // Build arguments array with custom lua args from launchArgs
    const args = [...testConfig.launchArgs];

    // Add the test file path to the arguments (使用双引号包围路径以处理空格)
    args.push(`"${targetFilePath}"`);

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
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const success = await vscode.debug.startDebugging(
      workspaceFolder,
      debugConfig
    );

    if (!success) {
      vscode.window.showErrorMessage(
        `Failed to start debug session for test: ${testName}`
      );
    }
  }

  private async runSingleTest(
    test: vscode.TestItem,
    run: vscode.TestRun
  ): Promise<void> {
    const [filePath, testName] = test.id.split("::");

    if (!testName || !test.uri) {
      this.logError("Invalid test item", { test });
      return;
    }

    const startTime = Date.now();

    // 解析固定工作目录（来自配置）并记录
    const rawWorkDirCfg = vscode.workspace.getConfiguration("luahelper.test").get("workdir") as string;
    const fixedWorkDir = this.resolvePathVariables(rawWorkDirCfg);
    this.log(`[LuaTestController] FixedWorkdir(raw): ${rawWorkDirCfg}`);
    this.log(`[LuaTestController] FixedWorkdir(resolved): ${fixedWorkDir}`);

    // 使用测试文件的父目录作为运行时工作目录
    const workDir = path.dirname(filePath);
    this.log(`[LuaTestController] RuntimeWorkdir(from test file): ${workDir}`);

    // 对关键文件做存在性与 MD5 校验
    const calcFileHash = (p: string): string => {
      try {
        const buf = fs.readFileSync(p);
        return crypto.createHash("md5").update(buf).digest("hex");
      } catch {
        return "<MISSING>";
      }
    };

    const extLuaUnittest = Tools.getLuaUnittestPathInExtension();
    const extLuaPanda = Tools.getLuaPandaPathInExtension();
    const extLuaUnittestHash = calcFileHash(extLuaUnittest);
    const extLuaPandaHash = calcFileHash(extLuaPanda);
    this.log(`[LuaTestController] Ext LuaUnittest.lua: ${extLuaUnittest} md5=${extLuaUnittestHash}`);
    this.log(`[LuaTestController] Ext LuaPanda.lua    : ${extLuaPanda} md5=${extLuaPandaHash}`);

    const fixedLuaUnittest = path.join(fixedWorkDir || "", "LuaUnittest.lua");
    const fixedLuaPanda = path.join(fixedWorkDir || "", "LuaPanda.lua");
    const fixedLuaUnittestHash = fixedWorkDir ? calcFileHash(fixedLuaUnittest) : "<N/A>";
    const fixedLuaPandaHash = fixedWorkDir ? calcFileHash(fixedLuaPanda) : "<N/A>";
    this.log(`[LuaTestController] Fixed LuaUnittest.lua: ${fixedLuaUnittest} md5=${fixedLuaUnittestHash}`);
    this.log(`[LuaTestController] Fixed LuaPanda.lua    : ${fixedLuaPanda} md5=${fixedLuaPandaHash}`);

    const runtimeLuaUnittest = path.join(workDir, "LuaUnittest.lua");
    const runtimeLuaPanda = path.join(workDir, "LuaPanda.lua");
    const runtimeLuaUnittestHash = calcFileHash(runtimeLuaUnittest);
    const runtimeLuaPandaHash = calcFileHash(runtimeLuaPanda);
    this.log(`[LuaTestController] Runtime LuaUnittest.lua: ${runtimeLuaUnittest} md5=${runtimeLuaUnittestHash}`);
    this.log(`[LuaTestController] Runtime LuaPanda.lua    : ${runtimeLuaPanda} md5=${runtimeLuaPandaHash}`);

    // 对比来源哈希与 runtime/fixed 哈希，帮助定位未替换问题
    if (runtimeLuaUnittestHash !== "<MISSING>" && runtimeLuaUnittestHash !== extLuaUnittestHash) {
      this.logError(
        `[LuaTestController] RUNTIME_MISMATCH: LuaUnittest.lua runtime md5 ${runtimeLuaUnittestHash} != ext md5 ${extLuaUnittestHash}`
      );
    }
    if (fixedWorkDir && fixedLuaUnittestHash !== "<MISSING>" && fixedLuaUnittestHash !== extLuaUnittestHash) {
      this.logError(
        `[LuaTestController] FIXEDDIR_MISMATCH: LuaUnittest.lua fixed md5 ${fixedLuaUnittestHash} != ext md5 ${extLuaUnittestHash}`
      );
    }

    // 读取配置（保留以便其它参数使用）
    const testConfig = vscode.workspace.getConfiguration("luahelper.test");
    const luaExe = testConfig.get<string>("luaExe") || "";
    const launchArgs = testConfig.get<string[]>("launchArgs") || ["-a", "-l", "-u"];

    // Build arguments array with custom lua args from launchArgs
    const args = [...launchArgs];

    // Add the test file path to the arguments（注意：spawnSync 的 args 不需要手动加引号）
    args.push(filePath);

    // Set up environment variables including test function name
    const env = {
      ...process.env,
      TEST_FUNCTION: testName,
    };

    // Print the execution command for debugging
    const commandStr = `${luaExe} ${args.join(" ")}`;
    this.log(`[LuaTestController] Executing command: ${commandStr}`);
    this.log(`[LuaTestController] Working directory: ${workDir}`);
    this.log(`[LuaTestController] Environment: TEST_FUNCTION=${testName}`);
    this.log(`[LuaTestController] Args(JSON): ${JSON.stringify(args)}`);

    // 运行前置检查：目标文件存在性、大小、前 256 字节预览
    const targetExists = fs.existsSync(filePath);
    this.log(`[LuaTestController] Target file exists: ${targetExists} -> ${filePath}`);
    if (targetExists) {
      try {
        const stat = fs.statSync(filePath);
        this.log(`[LuaTestController] Target file size: ${stat.size} bytes`);
        const fd = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(256);
        const read = fs.readSync(fd, buf, 0, 256, 0);
        fs.closeSync(fd);
        this.log(
          `[LuaTestController] Target head(<=256B):\n${buf.toString("utf8", 0, Math.max(0, read))}`
        );
      } catch (e) {
        this.logError(`[LuaTestController] Failed to stat/read target file`, e);
      }
    } else {
      // 列表工作目录，便于诊断路径错误
      try {
        const files = fs.readdirSync(workDir);
        this.log(
          `[LuaTestController] List workDir (${workDir}) files(${files.length}): ${files
            .slice(0, 50)
            .join(", ")}`
        );
      } catch (e) {
        this.logError(`[LuaTestController] Failed to list workDir ${workDir}`, e);
      }
    }

    // 在执行前，尝试同步最新的 LuaUnittest.lua/LuaPanda.lua 到 fixed 与 runtime 目录
    const syncFileIfNeeded = (srcPath: string, dstPath: string, label: string) => {
      try {
        const srcBuf = fs.readFileSync(srcPath);
        const srcHash = crypto.createHash("md5").update(srcBuf).digest("hex");
        let dstHash = "<MISSING>";
        let need = true;
        try {
          const dstBuf = fs.readFileSync(dstPath);
          dstHash = crypto.createHash("md5").update(dstBuf).digest("hex");
          need = dstHash !== srcHash;
        } catch {
          need = true;
        }
        this.log(`[LuaTestController] SyncCheck ${label}: src(${srcHash}) -> dst(${dstHash}) need=${need}`);
        if (need) {
          fs.mkdirSync(path.dirname(dstPath), { recursive: true });
          fs.writeFileSync(dstPath, srcBuf);
          this.log(`[LuaTestController] Synced ${label} to ${dstPath}`);
        }
      } catch (e) {
        this.logError(`[LuaTestController] Sync ${label} failed -> ${dstPath}`, e);
      }
    };

    if (fixedWorkDir) {
      syncFileIfNeeded(extLuaUnittest, fixedLuaUnittest, "LuaUnittest.lua (fixed)");
      syncFileIfNeeded(extLuaPanda, fixedLuaPanda, "LuaPanda.lua (fixed)");
    }
    syncFileIfNeeded(extLuaUnittest, runtimeLuaUnittest, "LuaUnittest.lua (runtime)");
    syncFileIfNeeded(extLuaPanda, runtimeLuaPanda, "LuaPanda.lua (runtime)");

    // Execute with custom arguments and environment variables
    const lua = cp.spawnSync(luaExe, args, {
      cwd: workDir,
      env: env,
      encoding: "utf8", // 确保正确的编码
      timeout: 30000, // 30秒超时
    });

    const duration = Date.now() - startTime;

    const stderr = String(lua.stderr || "");
    const stdout = String(lua.stdout || "");
    const exitCode = lua.status;
    const signal = lua.signal;

    this.log(
      `[LuaTestController] stdout length: ${stdout.length}, head(1000):\n${stdout.substring(
        0,
        1000
      )}`
    );
    this.log(
      `[LuaTestController] stderr length: ${stderr.length}, head(1000):\n${stderr.substring(
        0,
        1000
      )}`
    );

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

    // 通过检测自定义标记判断是否通过
    const beginMarker = new RegExp(`TEST_BEGIN\\s+${this.escapeRegExp(testName)}`, "i");
    const endMarker = new RegExp(`TEST_END\\s+${this.escapeRegExp(testName)}`, "i");
    const beginFound = !!stdout.match(beginMarker);
    const endFound = !!stdout.match(endMarker);

    const passed = beginFound && endFound;

    // 若需要提供更丰富的失败信息，可继续解析 stdout/stderr，但不影响通过判定
    const explicitFailure =
      stdout &&
      stdout.length > 0 &&
      (stdout.match(/\bFAILED\b/) ||
        stdout.match(/assertion.*failed/i) ||
        stdout.match(/test.*failed/i));

    this.log(`[LuaTestController] Test result evaluation for ${testName}:`);
    const escapedName = this.escapeRegExp(testName);
    const beginPattern = `TEST_BEGIN\\s+${escapedName}`;
    const endPattern = `TEST_END\\s+${escapedName}`;
    this.log(`[LuaTestController] - Marker regex (BEGIN): ${beginPattern}`);
    this.log(`[LuaTestController] - Marker regex (END)  : ${endPattern}`);
    this.log(`[LuaTestController] - Found TEST_BEGIN: ${beginFound}`);
    this.log(`[LuaTestController] - Found TEST_END  : ${endFound}`);
    this.log(`[LuaTestController] - Contains 'FAILED' keywords: ${!!explicitFailure}`);
    this.log(`[LuaTestController] - Exit Code      : ${exitCode}`);
    this.log(`[LuaTestController] - strictMarkers  : ${testConfig.get<boolean>("strictMarkers", true)}`);

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
      const failureMessages = this.parseErrorMessages(stdout, test, run);

      // 组装详细失败原因
      const reasons: string[] = [];
      if (!beginFound) reasons.push("TEST_BEGIN 标记缺失");
      if (!endFound) reasons.push("TEST_END 标记缺失");
      if (explicitFailure) reasons.push("stdout 检测到 FAILED/断言失败 关键字");
      if (stderr && stderr.toLowerCase().includes("read lua script empty")) {
        reasons.push("引擎报错: read lua script empty (可能是脚本路径/权限/参数格式问题)");
      }
      if (exitCode !== 0 && exitCode !== 1) reasons.push(`退出码: ${exitCode}`);

      if (failureMessages.length === 0) {
        // 创建通用失败消息，包含文件路径和行号信息
        let failureReason = reasons.length > 0 ? reasons.join("; ") : "未知原因";

        // 获取测试文件路径
        const testFilePath = test.uri?.fsPath || filePath;
        const relativePath = path.relative(workDir, testFilePath);

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
        `❌ Test "${testName}" FAILED (${duration}ms) 原因: ${reasons.join(", ")}\r\n`,
        undefined,
        test
      );
      // 追加上下文，便于定位
      run.appendOutput(`WorkDir: ${workDir}\r\n`, undefined, test);
      run.appendOutput(`Args(JSON): ${JSON.stringify(args)}\r\n`, undefined, test);
      run.appendOutput(`STDERR(head1000):\r\n${stderr.substring(0, 1000)}\r\n`, undefined, test);
      run.appendOutput(`STDOUT(head1000):\r\n${stdout.substring(0, 1000)}\r\n`, undefined, test);
      run.failed(test, failureMessages, duration);
    }
  }

  /**
   * 解析错误消息，尝试提取错误位置和详细信息
   * 只关注stdout，忽略stderr
   */
  private parseErrorMessages(
    stdout: string,
    test: vscode.TestItem,
    run: vscode.TestRun
  ): vscode.TestMessage[] {
    const messages: vscode.TestMessage[] = [];
    const workDir = vscode.workspace
      .getConfiguration("luahelper.test")
      .get("workdir") as string;

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
              // 使用工作目录来构建文件路径
              const fullPath = path.join(workDir, filename);
              errorFileUri = vscode.Uri.file(fullPath);
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
            const relativePath = path.relative(workDir, testFilePath);
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
            const relativePath = path.relative(workDir, testFilePath);

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

  // 解析 VS Code 风格路径变量：${config:key}、${env:VAR}、${workspaceFolder}
  private resolvePathVariables(inputPath: string): string {
    if (!inputPath) return inputPath;
    let result = inputPath;
    try {
      // ${config:key}
      result = result.replace(/\$\{config:([^}]+)\}/g, (_m, key) => {
        try {
          const v = vscode.workspace.getConfiguration().get<string>(String(key).trim());
          return v ? v : "";
        } catch {
          return "";
        }
      });
      // ${env:VAR}
      result = result.replace(/\$\{env:([^}]+)\}/g, (_m, key) => {
        return process.env[String(key).trim()] || "";
      });
      // ${workspaceFolder}
      const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : "";
      result = result.replace(/\$\{workspaceFolder\}/g, ws);
    } catch {
      // ignore
    }
    return result;
  }

  /**
   * 拷贝调试所需的文件到指定目录
   * 参考 initProcess 的实现逻辑
   */
  private copyRequiredFiles(): void {
    // 从配置读取固定工作目录，并解析变量
    const rawWorkDir = vscode.workspace.getConfiguration("luahelper.test").get("workdir") as string;
    const workDir = this.resolvePathVariables(rawWorkDir);

    this.log(`[LuaTestController] Workdir(raw): ${rawWorkDir}`);
    this.log(`[LuaTestController] Workdir(resolved): ${workDir}`);

    if (!workDir || workDir.trim() === "") {
      this.logError("Workdir is empty. Please set luahelper.test.workdir");
      return;
    }

    // 不再提前返回：每次都进行 md5 比对与必要时覆盖，确保最新版本

    // 拷贝LuaPanda.lua和LuaUnittest.lua文件到配置的工作目录
    if (!workDir) {
      return;
    }

    // 创建目录（如果不存在）
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
      this.log(`[LuaTestController] Created directory: ${workDir}`);
    }

    // 计算文件哈希的辅助函数
    const calcHash = (buffer: Buffer): string => {
      return crypto.createHash("md5").update(buffer).digest("hex");
    };

    // -------- LuaPanda.lua --------
    const luaPandaPath = path.join(workDir, "LuaPanda.lua");
    const luaPandaSrcPath = Tools.getLuaPandaPathInExtension();
    const luaPandaSrc = fs.readFileSync(luaPandaSrcPath);

    let shouldCopyLuaPanda = true;
    if (fs.existsSync(luaPandaPath)) {
      try {
        const luaPandaDst = fs.readFileSync(luaPandaPath);
        const srcHash = calcHash(luaPandaSrc);
        const dstHash = calcHash(luaPandaDst);
        this.log(`[LuaTestController] LuaPanda.lua hash comparison -> src(${srcHash}) vs dst(${dstHash})`);
        shouldCopyLuaPanda = srcHash !== dstHash;
        if (!shouldCopyLuaPanda) {
          this.log(`[LuaTestController] LuaPanda.lua up-to-date at ${luaPandaPath}`);
        }
      } catch (e) {
        this.logError("Failed to read existing LuaPanda.lua, will overwrite", e);
      }
    }

    if (shouldCopyLuaPanda) {
      this.log(`[LuaTestController] Overwriting LuaPanda.lua (hash changed)`);
      fs.writeFileSync(luaPandaPath, luaPandaSrc);
      this.log(`[LuaTestController] Copied LuaPanda.lua to ${luaPandaPath}`);
    }

    // -------- LuaUnittest.lua --------
    const luaUnittestPath = path.join(workDir, "LuaUnittest.lua");
    const luaUnittestSrcPath = Tools.getLuaUnittestPathInExtension();
    const luaUnittestSrc = fs.readFileSync(luaUnittestSrcPath);

    let shouldCopyLuaUnittest = true;
    if (fs.existsSync(luaUnittestPath)) {
      try {
        const luaUnittestDst = fs.readFileSync(luaUnittestPath);
        const srcHash = calcHash(luaUnittestSrc);
        const dstHash = calcHash(luaUnittestDst);
        this.log(`[LuaTestController] LuaUnittest.lua hash comparison -> src(${srcHash}) vs dst(${dstHash})`);
        shouldCopyLuaUnittest = srcHash !== dstHash;
        if (!shouldCopyLuaUnittest) {
          this.log(`[LuaTestController] LuaUnittest.lua up-to-date at ${luaUnittestPath}`);
        }
      } catch (e) {
        this.logError("Failed to read existing LuaUnittest.lua, will overwrite", e);
      }
    }

    if (shouldCopyLuaUnittest) {
      this.log(`[LuaTestController] Overwriting LuaUnittest.lua (hash changed)`);
      fs.writeFileSync(luaUnittestPath, luaUnittestSrc);
      this.log(`[LuaTestController] Copied LuaUnittest.lua to ${luaUnittestPath}`);
    }

    this.copiedDirs.add(workDir); // 记录已复制目录（仅用于去重日志）
  }

  /**
   * 记录诊断日志到控制台和输出面板（如果启用）
   */
  private log(message: string, ...args: any[]): void {
    // 始终记录到控制台
    console.log(message, ...args);

    // 检查是否应该写入输出面板
    let shouldLogToPanel = false;
    // 直接从配置中获取logPanel设置
    const config = vscode.workspace.getConfiguration("luahelper.test");
    shouldLogToPanel = config.get<boolean>("logPanel") || true;

    // 如果启用了logpanel，则写入输出面板
    if (shouldLogToPanel) {
      const ts = new Date().toISOString();
      const fullMessage =
        args.length > 0 ? `${message} ${args.join(" ")}` : message;
      this.outputChannel.appendLine(`[${ts}] [LOG] ${fullMessage}`);
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
    // 直接从配置中获取logPanel设置
    const config = vscode.workspace.getConfiguration("luahelper.test");
    shouldLogToPanel = config.get<boolean>("logPanel") || true;

    // 如果启用了logpanel，则写入输出面板
    if (shouldLogToPanel) {
      const ts = new Date().toISOString();
      const fullMessage =
        args.length > 0
          ? `ERROR: ${message} ${args.join(" ")}`
          : `ERROR: ${message}`;
      this.outputChannel.appendLine(`[${ts}] [ERROR] ${fullMessage}`);
    }
  }

  // 正则转义工具，避免测试名中的特殊字符破坏匹配
  private escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  dispose() {
    this.watchedFiles.forEach((watcher) => watcher.dispose());
    this.testController.dispose();
    this.outputChannel.dispose(); // 清理诊断日志输出面板
    this.testOutputChannel.dispose(); // 清理测试输出面板
  }
}
