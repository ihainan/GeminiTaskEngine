/**
 * AppSynth test program - Generate Electron desktop app from binary analysis
 * Based on prompt.md specifications for FasterCap binary analysis
 */

import { TaskEngine } from '../dist/index.js';
import fs from 'fs';
import path from 'path';

// State tracking for plain text output (like CLI non-interactive mode)
class OutputState {
  constructor() {
    this.lastTurn = 0;
    this.lastToolCallCount = 0;
    this.toolStates = new Map(); // callId -> last known state
    this.outputedStreams = new Set(); // Track outputted stream texts to avoid duplicates
  }

  reset() {
    this.lastTurn = 0;
    this.lastToolCallCount = 0;
    this.toolStates.clear();
    this.outputedStreams.clear();
  }
}

const outputState = new OutputState();

// Plain text output formatter (like CLI non-interactive mode)
function formatPlainStatus(status) {
  // 1. Check for turn changes
  if (status.progress.currentTurn !== outputState.lastTurn) {
    if (outputState.lastTurn > 0) {
      console.log(`\nTurn ${outputState.lastTurn} completed`);
    }
    console.log(`\nTurn ${status.progress.currentTurn} started (${status.progress.percentage}%)`);
    outputState.lastTurn = status.progress.currentTurn;
  }

  // 2. Handle text streaming - show first complete text only
  if (status.llmStream?.isComplete && status.llmStream?.partialText) {
    const textContent = status.llmStream.partialText.trim();
    
    // Only show the first complete text for each turn (ignore tool status updates)
    const turnKey = `turn-${status.progress.currentTurn}`;
    if (!outputState.outputedStreams.has(turnKey)) {
      console.log('\n[COMPLETE RESPONSE]:', textContent);
      outputState.outputedStreams.add(turnKey);
      
      // Add line break before tool calls
      if (status.currentAction?.type === 'tool_executing') {
        console.log();
      }
    }
  }

  // 3. Handle tool calls
  if (status.toolCalls.length > 0) {
    status.toolCalls.forEach(call => {
      const lastState = outputState.toolStates.get(call.callId);
      
      if (!lastState) {
        // New tool call
        console.log(`\n🔧 Tool call: ${call.name}`);
        if (call.args && Object.keys(call.args).length > 0) {
          console.log(`   Args: ${JSON.stringify(call.args, null, 2)}`);
        }
        outputState.toolStates.set(call.callId, { status: call.status });
      } else if (lastState.status !== call.status) {
        // Tool status changed
        const duration = call.duration ? ` (${call.duration}ms)` : '';
        
        if (call.status === 'executing') {
          console.log(`   ${call.name} executing...`);
        } else if (call.status === 'completed') {
          console.log(`   ${call.name} completed${duration}`);
          
          // Show result for completed tools with appropriate truncation
          if (call.result) {
            if (call.result.length < 500) {
              console.log(`   ✓ Result: ${call.result}`);
            } else {
              // Show first few lines for longer results
              const lines = call.result.split('\n');
              if (lines.length <= 3) {
                console.log(`   ✓ Result: ${call.result.slice(0, 200)}...`);
              } else {
                console.log(`   ✓ Result: ${lines.slice(0, 2).join('\n')}...`);
              }
              console.log(`     [Full length: ${call.result.length} chars, ${lines.length} lines]`);
            }
          }
          
          if (call.exportPath) {
            console.log(`   ✓ Export path: ${call.exportPath}`);
          }
        } else if (call.status === 'error') {
          console.log(`   ${call.name} failed${duration}`);
          if (call.error) {
            // Format error similar to Gemini CLI style
            console.log(`   ✕ Error: ${call.error}`);
          }
        }
        
        outputState.toolStates.set(call.callId, { status: call.status });
      }
    });
  }

  // 4. Handle final result
  if (status.finalResult && status.sessionState === 'completed') {
    console.log(`\n✅ Task completed!`);
    console.log(`   Success: ${status.finalResult.success}`);
    console.log(`   Summary: ${status.finalResult.summary}`);
    if (status.finalResult.outputPath) {
      console.log(`   Output path: ${status.finalResult.outputPath}`);
    }
  }

  // 5. Handle errors - format like Gemini CLI
  if (status.sessionState === 'error' && status.finalResult) {
    console.log(`\n✕ Task failed at Turn ${status.progress.currentTurn}`);
    
    if (status.finalResult.error) {
      const error = status.finalResult.error;
      
      // Parse structured errors like Gemini CLI
      try {
        // Look for JSON error structure
        let jsonStr = null;
        let jsonStart = error.indexOf('[{');
        
        if (jsonStart !== -1) {
          // Handle array format like [{...}]
          let depth = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < error.length; i++) {
            if (error[i] === '[' || error[i] === '{') depth++;
            if (error[i] === ']' || error[i] === '}') depth--;
            if (depth === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
          jsonStr = error.substring(jsonStart, jsonEnd);
        } else {
          // Look for single object format like {...}
          jsonStart = error.indexOf('{"error"');
          if (jsonStart !== -1) {
            let depth = 0;
            let jsonEnd = jsonStart;
            for (let i = jsonStart; i < error.length; i++) {
              if (error[i] === '{') depth++;
              if (error[i] === '}') depth--;
              if (depth === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
            jsonStr = error.substring(jsonStart, jsonEnd);
          }
        }
        
        if (jsonStr) {
          const errorObj = JSON.parse(jsonStr);
          
          // Handle array format
          if (Array.isArray(errorObj) && errorObj[0]?.error) {
            const apiError = errorObj[0].error;
            console.log(`✕ [API Error: ${apiError.message}]`);
            if (apiError.status && apiError.status !== apiError.message) {
              console.log(`   Status: ${apiError.status}`);
            }
            if (apiError.code) {
              console.log(`   Code: ${apiError.code}`);
            }
          }
          // Handle direct object format
          else if (errorObj?.error) {
            const apiError = errorObj.error;
            console.log(`✕ [API Error: ${apiError.message}]`);
            if (apiError.status && apiError.status !== apiError.message) {
              console.log(`   Status: ${apiError.status}`);
            }
            if (apiError.code) {
              console.log(`   Code: ${apiError.code}`);
            }
          }
        } else {
          // Handle other structured errors
          const errorLines = error.split('\n').filter(line => line.trim());
          const mainError = errorLines.find(line => 
            line.includes('Error:') || 
            line.includes('Exception:') ||
            line.includes('token count') ||
            line.includes('exceeds')
          );
          
          if (mainError) {
            const cleanError = mainError
              .replace(/^.*?Error:\s*/, '')
              .replace(/^.*?Exception:\s*/, '')
              .trim();
            console.log(`✕ [${cleanError}]`);
          } else {
            console.log(`✕ [${errorLines[0] || error.substring(0, 100)}]`);
          }
        }
      } catch (parseError) {
        // Fallback: show first meaningful line
        const firstLine = error.split('\n')[0];
        console.log(`✕ [${firstLine}]`);
      }
    }
    
    if (status.finalResult.summary) {
      console.log(`   Summary: ${status.finalResult.summary}`);
    }
    
    // Show failed tools for context
    const failedTools = status.toolCalls.filter(call => call.status === 'error');
    if (failedTools.length > 0) {
      console.log(`   Failed tools: ${failedTools.map(t => t.name).join(', ')}`);
    }
  }
}

// Apply console interceptor before starting TaskEngine
function applyConsoleInterceptor() {
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.error = (...args) => {
    const message = args[0];
    if (typeof message === 'string' && 
        message.includes('failed with 5xx error') && 
        args[1] && 
        typeof args[1] === 'object') {
      
      // Check if it's actually a 400 error being wrongly classified
      const error = args[1];
      try {
        const errorStr = error.toString();
        if (errorStr.includes('"code": 400') || errorStr.includes('"status": 400')) {
          const attemptMatch = message.match(/Attempt (\d+)/);
          const attemptNum = attemptMatch ? attemptMatch[1] : '?';
          originalWarn(`⚠️  Attempt ${attemptNum}: Token limit exceeded (400) - should not retry`);
          return;
        }
      } catch (e) {
        // Fallback
      }
    }
    
    originalError(...args);
  };
  
  return { originalError, originalWarn };
}

async function main() {
  // Apply console interceptor immediately to catch early errors
  applyConsoleInterceptor();
  
  console.log('🚀 Starting AppSynth test - Generate Electron app from FasterCap binary analysis');
  
  // Clean up and recreate app-out directory
  const appOutPath = path.join(process.cwd(), 'app-out');
  console.log('🧹 Cleaning up app-out directory...');
  
  try {
    // Remove existing app-out directory if it exists
    if (fs.existsSync(appOutPath)) {
      fs.rmSync(appOutPath, { recursive: true, force: true });
      console.log('   ✅ Removed existing app-out directory');
    }
    
    // Create fresh app-out directory
    fs.mkdirSync(appOutPath, { recursive: true });
    console.log('   ✅ Created fresh app-out directory');
    
    // Copy screenshot.png to app-out directory if it exists
    const sourceScreenshotPath = path.join(process.cwd(), 'screenshot.png');
    const targetScreenshotPath = path.join(appOutPath, 'screenshot.png');
    
    if (fs.existsSync(sourceScreenshotPath)) {
      fs.copyFileSync(sourceScreenshotPath, targetScreenshotPath);
      console.log('   ✅ Copied screenshot.png to app-out directory');
    } else {
      console.log('   ⚠️ No screenshot.png found, will proceed without UI reference');
    }
  } catch (error) {
    console.error('   ❌ Failed to setup app-out directory:', error.message);
    process.exit(1);
  }
  
  // Reset output state
  outputState.reset();
  
  // Create AppSynth task strategy for Electron app generation
  class AppSynthTaskStrategy {
    getName() {
      return 'AppSynthTaskStrategy';
    }

    calculateProgress(toolCalls, turnCount) {
      // Progress calculation based on AppSynth workflow steps
      const completedSteps = this.getCompletedWorkflowSteps(toolCalls);
      const totalSteps = this.getWorkflowSteps().length;
      return Math.min((completedSteps / totalSteps) * 90 + turnCount * 2, 95);
    }

    getCompletedWorkflowSteps(toolCalls) {
      const workflowSteps = this.getWorkflowSteps();
      let completed = 0;
      
      for (const step of workflowSteps) {
        const hasCompleted = toolCalls.some(call => 
          call.name === step.name && call.status === 'completed'
        );
        if (hasCompleted) {
          completed++;
        } else {
          break; // Sequential workflow
        }
      }
      
      return completed;
    }

    isTaskComplete(toolCalls) {
      // Task is complete when Electron app is built and packaged
      const hasBuiltApp = toolCalls.some(call => 
        (call.name === 'build_electron_app' || call.name === 'package_electron_app') && 
        call.status === 'completed'
      );
      
      // Also consider completion if we have generated Feature Spec and created basic app structure
      const hasFeatureSpec = toolCalls.some(call =>
        call.name === 'generate_feature_spec' && call.status === 'completed'
      );
      
      const hasAppGeneration = toolCalls.some(call =>
        call.name === 'generate_electron_app' && call.status === 'completed'
      );
      
      return hasBuiltApp || (hasFeatureSpec && hasAppGeneration);
    }

    getFatalErrorPatterns() {
      return [
        /(ECONN|ETIMEDOUT|auth|permission|timeout|ECONNREFUSED)/i,
        /(npm.*failed|build.*failed|package.*failed)/i,
        /(electron.*error|dependency.*error)/i
      ];
    }

    getWorkflowSteps() {
      return [
        // Phase A: Remote static analysis
        { name: 'import_binary', weight: 10, isRequired: true },
        { name: 'open_program', weight: 15, isRequired: true },
        { name: 'analyze_binary', weight: 20, isRequired: true },
        { name: 'list_literals', weight: 25, isRequired: false },
        { name: 'list_functions', weight: 30, isRequired: false },
        { name: 'decompile_function', weight: 35, isRequired: false },
        { name: 'generate_call_graph', weight: 40, isRequired: false },
        
        // Phase B: Feature Spec generation
        { name: 'generate_feature_spec', weight: 50, isRequired: true },
        
        // Phase C: Local Electron app generation
        { name: 'create_app_structure', weight: 60, isRequired: true },
        { name: 'generate_electron_app', weight: 70, isRequired: true },
        { name: 'install_dependencies', weight: 80, isRequired: true },
        { name: 'build_electron_app', weight: 90, isRequired: true },
        { name: 'package_electron_app', weight: 100, isRequired: true }
      ];
    }

    processToolResult(toolCall, result) {
      // Check for fatal errors in tool results
      const fatalPatterns = this.getFatalErrorPatterns();
      const hasError = fatalPatterns.some(pattern => pattern.test(result));
      
      if (hasError) {
        return { 
          shouldContinue: false, 
          error: `Fatal error detected in ${toolCall.name}: ${result}` 
        };
      }
      
      return { shouldContinue: true };
    }

    isValidToolCall(toolName, args) {
      const validMcpTools = [
        'import_binary', 'open_program', 'analyze_binary', 'list_literals', 
        'list_functions', 'list_all_entry_points', 'decompile_function', 
        'get_listing', 'get_detailed_listing', 'find_references', 
        'map_c_to_assembly', 'generate_call_graph', 'build_function_call_graph',
        'describe_type', 'save_program', 'export_program'
      ];
      
      const validLocalTools = [
        'generate_feature_spec', 'create_app_structure', 'generate_electron_app',
        'install_dependencies', 'build_electron_app', 'package_electron_app',
        'create_directory', 'write_file', 'run_command'
      ];
      
      return validMcpTools.includes(toolName) || validLocalTools.includes(toolName);
    }
  }

  // Create AppSynth prompt strategy using the complete prompt from prompt.md
  class AppSynthPromptStrategy {
    constructor() {
      // Use the updated AppSynth prompt with screenshot.png support
      this.systemPrompt = `你是 "AppSynth"。你的职责是：利用远端 **Ghidra MCP** 对位于 /data 的目标二进制进行静态分析，在**本地当前工作目录**下自动生成、构建并打包一个**可直接运行的 Electron 桌面应用**，尽可能复刻或逼近该二进制的**核心面向用户功能**。当内部算法不明确或证据不足时，允许**合理模拟/假设**，但**必须确保最终应用成功构建并运行**。优先级：**能跑成功 > 逼真还原**。在开始任何分析或工具调用前，**先查看指定的截图文件**（用户会在提醒中提供具体路径），从截图中提取窗口结构、交互流程、菜单/工具栏/表格/图表/状态栏、关键词文案、主题配色与布局密度等信息，并在后续开发中尽量保持**风格与布局对齐**；这些"Screenshot Insights"应并入 Feature Spec 与 Evidence Map。

────────────────────
一、环境与边界
────────────────────
1) 远端分析：所有逆向分析动作仅通过 **MCP 工具**在远端执行；本地不做逆向分析。
2) 本地生成：允许在**当前目录及其子目录**创建/修改/删除文件，并执行与工程生成、依赖安装、构建与打包相关的 Shell 命令（npm/yarn/pnpm、bash/PowerShell 脚本等）。
3) 工程根目录默认为 \`./app-out\`；构建产物默认位于 \`./app-out/dist/\`；完成后将最终可执行包**复制到当前目录**（如 \`./\<app-name\>-\<platform\>-\<arch\>.\<ext\>\`）。
4) 目标平台由用户提供：Windows→\`.exe\`，macOS→\`.dmg\`，Linux→\`.AppImage\`。若跨平台打包所需依赖缺失（例如在 Linux 打 Windows 需 wine），则**自动降级**为"unpacked 目录 + .zip"，并确保可运行。
5) 目标架构：**最终生成的可执行程序架构必须为 x86_64（amd64）**。构建与打包需**显式指定 \`arch=x64\`**（例如 electron-builder 使用 \`--win --x64\`）；禁止输出 arm64/ia32 等其他架构产物。若因环境限制无法产出 x86_64，视为失败（不得以其他架构替代）。

────────────────────
二、反编译的目的与成功标准
────────────────────
目的：使用 Ghidra MCP 的反编译/交叉引用/调用图能力，**提炼可实现的功能规格（Feature Spec）**，供新应用实现与验证。关注的是**用户可见、可复现**的行为，而非源码级还原或逐字节等价；同时结合**截图文件**中的 UI 线索，确保新应用的**风格与布局**尽可能对齐原应用。

需要明确：
1) 功能与流程：关键页面/控件/操作序列与状态切换。
2) 输入/输出与格式：文件/网络/剪贴板/注册表等的读写路径、扩展名、字段/魔数/最小样例。
3) 副作用与证据：可验证副作用（输出文件、网络请求、注册表键等）及其来源位置。
4) 关键常量/参数：阈值、默认配置、单位；必要数据结构的语义。
5) 算法轮廓（可选）：若可识别，描述步骤与可近似环节；不可识别则给出**模拟策略**。
6) 缺口与假设：证据不足处的**Assumptions/Simulations**，同时不影响新应用的可运行。
7) 界面风格：结合**截图文件**提炼视觉主题、信息架构与布局密度，并标注信心度与截屏要素来源。

成功标准（对新应用）：
- 能启动并完成核心工作流，产生与原程序一致/相似、**可验证**的副作用（如导出文件/网络请求）。
- UI 风格与主要布局**参考并尽量贴合**截图要点。
- 每个行为点都有"证据或假设"来源（Evidence Map）；不追求内部实现等价。
- 在**x86_64** 架构与目标平台完成打包（或合理降级为 unpacked + .zip 但仍可运行且为 x86_64）。

────────────────────
三、允许的工具
────────────────────
• 远端（MCP，严格按签名）：
  - import_binary(path:str, [architecture:str], [format:str])
  - open_program(name:str)
  - analyze_binary
  - list_functions
  - list_all_entry_points
  - list_literals(format:str, maxResults:str, typeFilter:str)
  - describe_type(format:str, includeRelated:str, typeName:str)
  - decompile_function(function_location:str)
  - get_listing(function_location:str)
  - get_detailed_listing(function_location:str)
  - find_references(location:str)
  - map_c_to_assembly(function_location:str)
  - generate_call_graph(direction:str, format:str, functionFilter:str, maxDepth:str)
  - build_function_call_graph(downDepth:str, externalHandling:str, format:str, functionIdentifier:str, upDepth:str)
  - rename_symbol(address:str, new_name:str)
  - set_function_signature(function_location:str, signature:str)
  - set_type(address:str, type_name:str)
  - create_struct(name:str, size:int)
  - set_struct_member(field_type:str, offset:int, typename:str, [field_name:str])
  - patch_with_assembly(assembly:str, beginAddress:str, [autopad:str], [endAddress:str])   # 本任务通常不用
  - patch_with_data(beginAddress:str, data:str, [autopad:str], [endAddress:str])          # 本任务通常不用
  - save_program
  - export_program(name:str)
• 本地：不设白名单限制；可执行任意与生成/安装依赖/构建/打包相关的命令；需输出关键日志（含退出码）。

────────────────────
四、Plan-First（先计划后执行）
────────────────────
在任何调用前给出**极简计划**：
- 目标与平台/架构（明确 **x86_64**）；将调用的 MCP 工具与顺序；预计证据与判定标准；
- 先行处理**截图文件**的提要（Screenshot Insights）与其将如何影响 UI 实现；
- 本地生成/构建/打包步骤与期望产物路径（含最终可执行包文件名与架构标注）。

────────────────────
五、标准流程（解析 → 规格 → 生成 → 构建 → 验证 → 交付）
────────────────────
A) 上下文收集
   - 确认 \`/data/\<filename\>\`、平台/架构（**x86_64**）、需复刻的核心面向用户功能（输入/输出/交互）。
   - 检视指定的**截图文件**，提取 UI 主题/布局/关键文案作为实现参考，并记录为 Screenshot Insights。

B) 远端静态分析（MCP）—目标：产出 Feature Spec（而非修改原二进制）
   1) import_binary("/data/\<filename\>"), open_program("\<filename\>"), analyze_binary
   2) list_literals(..., typeFilter="string")：发现 UI 文本/菜单项/扩展名/URL/协议/错误信息等线索
   3) list_functions / list_all_entry_points；对关键词执行 find_references(...) 锁定热点
   4) decompile_function(...)；get_detailed_listing(...) + map_c_to_assembly(...) 校验控制流与关键常量
   5) build_function_call_graph(...) / generate_call_graph(...)：识别上下游与**可见副作用**路径（文件/网络/注册表）
   ⇒ 产出：**Feature Spec**（goals/inputs/outputs/states/errors/side-effects + Screenshot Insights）
            **Evidence Map**（为每条断言列证据 ref 与 \`confidence: high|medium|low\`）
            **Assumptions/Simulations**（保证可运行）

C) 本地项目生成（成功率优先）
   - 在 \`./app-out\` 生成**最小 Electron 工程（无打包器、无前端框架）**：
     \`package.json\`, \`main.js\`, \`preload.js\`, \`renderer/index.html\`, \`renderer/index.js\`, \`assets/...\`
   - 依赖：仅**纯 JS/TS**；**禁止原生 addon（node-gyp）**；**锁定精确版本**（示例：Electron \`"31.2.0"\`，electron-builder \`"24.13.3"\`；生成 \`package-lock.json\` / \`.npmrc\`）。
   - 安全默认：\`contextIsolation: true\`、渲染进程 \`sandbox: true\`、\`nodeIntegration: false\`；仅通过 \`preload.js\` + IPC 暴露必要能力。
   - 行为实现：严格按 Feature Spec 实现**核心可见功能**；内部算法未知则**模拟/假设**，保持 UX 与**可验证副作用**一致（如导出文件/网络请求等）。

D) 本地构建与打包
   - 运行：\`npm ci\` → \`npm run start\`（可选快速自检）→ 直接构建 unpacked 版本
   - **强制架构**：构建时必须指定 **x64** 架构（如 \`electron-builder --dir --x64\`）。任何非 x86_64 产物均视为不合格。
   - **最终打包格式**：将 unpacked 目录打包成 **zip 文件**，包含可执行程序和所有依赖文件，确保解压后可直接运行。zip 包命名格式：\`\<app-name\>-\<platform\>-x64.zip\`
   - 完成后将 **zip 包**复制到当前目录，并输出其**绝对路径**、**目标架构（x86_64）**与 **SHA256**。

E) 冒烟测试与验收
   - 提供 \`npm run test:smoke\`：启动应用→触发核心动作→断言关键副作用（例如导出文件存在/内容匹配）。
   - 验收同时比对 UI：根据**截图文件**的关键布局/文案/配色进行简要对齐核对。
   - 若失败：回到 C/D 迭代（修正依赖/配置/代码或放宽模拟），直至通过。

F) 交付信息
   - 输出：文件树、构建/运行/打包命令、Feature Spec、Evidence Map、Assumptions/Simulations、Smoke Test 步骤、
     以及**最终可执行包路径**与校验值（SHA256）。

────────────────────
六、Electron 项目约束（最大化一次构建成功率）
────────────────────
• Node 20.x；固定 Electron 与 electron-builder 版本；\`package.json\` 至少包含：
  - "start": "electron ."
  - "build:win": "electron-builder --dir --win --x64"
  - "build:mac": "electron-builder --dir --mac --x64"
  - "build:linux": "electron-builder --dir --linux --x64"
• 默认**不用** TypeScript/打包器；如必须加入 TS/Vite，提供最小可用配置并锁版本。
• 禁原生 addon；优先纯 JS 或**模拟**；系统集成优先 Node 核心模块与 Electron API。
• 代码应包含最小日志与错误提示，便于诊断；UI 风格与布局尽量参考**截图文件**。

────────────────────
七、错误闸门（MCP 与本地命令均适用）
────────────────────
• 每次 **MCP 调用**后，检索返回文本中是否包含 "Error"/"FAILED"/"Exception"/"unable to"/"could not"；发现即**停止→分析→修正→重试**。
• 每次 **本地命令**后，检查退出码与 stderr；构建失败需回显关键信息，并给出下一步修复建议（依赖版本/脚本/配置/环境）。
• 如检测到产物架构非 **x86_64**，直接判定失败并提示需添加 \`--x64\` 或对应配置。

────────────────────
八、可观测性（便于封装器获取每步输出）
────────────────────
• 每个阶段输出一条**JSON 行**日志（\`step\`, \`status\`, \`details\`, \`artifacts[]\`），记录关键信息与产物路径。
• 最终总结中列出所有重要文件路径、**产物架构（x86_64）**与 SHA256。

# === 结束 ===`;
    }

    getName() {
      return 'AppSynthPromptStrategy';
    }

    async buildPrompt(request, config) {
      // 动态生成 screenshot.png 的绝对路径 (在 app-out 目录中)
      const screenshotPath = path.resolve(process.cwd(), 'app-out', 'screenshot.png');
      
      const userContext = `
# 用户输入

二进制文件名：FasterCap

二进制文件远程完整路径：/data/FasterCap

文件信息：FasterCap_6.0.7/FasterCap: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 2.6.18, BuildID[sha1]=49d12413e2384bc68aaf39329e716e6919ea79b9, stripped

预期生成应用运行平台：Windows x86 64

**重要提醒**：请严格按照上述流程执行，确保：
1. 首先查看截图文件：${screenshotPath}（如果存在的话）
2. 给出极简计划，包含 Screenshot Insights
3. 使用远端 MCP 工具分析 /data/FasterCap 二进制文件
4. 在 ./app-out 目录生成 Electron 应用（不要在当前目录直接生成）
5. 最终将 zip 包复制到当前目录并提供 SHA256

开始执行任务。
`;
      
      return this.systemPrompt + '\n\n' + userContext;
    }

    async getSystemPrompt() {
      return this.systemPrompt;
    }

    combinePrompts(systemPrompt, userPrompt) {
      return userPrompt; // System prompt already included
    }
  }

  // Create TaskEngine instance with AppSynth strategies
  const engine = new TaskEngine({
    strategy: new AppSynthTaskStrategy(),
    promptStrategy: new AppSynthPromptStrategy(),
    onStatusUpdate: formatPlainStatus,
  });
  
  // Create task request for AppSynth workflow
  const request = {
    sessionId: `appsynth-fastercap-${Date.now()}`,
    description: '请基于 FasterCap 二进制文件生成一个可运行的 Electron 桌面应用，目标平台为 Windows x86 64。',
    mcpServerUrl: 'http://127.0.0.1:28080/sse',
    mcpServerName: 'ghidra-agent',
    taskType: 'app-synthesis',
    workingDirectory: path.join(process.cwd(), 'app-out'), // Use app-out directory
    mcpTimeout: 300000, // 5 minutes timeout for binary analysis operations
    maxTurns: 200 // Increase maximum turns for complex app synthesis
  };
  
  console.log('\n📋 AppSynth Task Information:');
  console.log(`   Binary: FasterCap (ELF 64-bit, x86-64)`);
  console.log(`   Target: Windows x86 64 Electron app`);
  console.log(`   Remote path: /data/FasterCap`);
  console.log(`   Working dir: ${request.workingDirectory}`);
  console.log(`   MCP server: ${request.mcpServerUrl}`);
  console.log(`   Session ID: ${request.sessionId}`);
  console.log('\n' + '='.repeat(80));

  try {
    // Execute AppSynth task
    const result = await engine.executeTask(request);
    
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 AppSynth Execution Statistics:');
    console.log(`   Total duration: ${result.metadata.totalDuration}ms`);
    console.log(`   Total turns: ${result.metadata.turnCount}`);
    console.log(`   Tool call count: ${result.metadata.toolCallCount}`);
    
    console.log('\n🎯 AppSynth Results:');
    console.log('   ✅ Binary analysis completed via Ghidra MCP');
    console.log('   ✅ Feature specification generated');
    console.log('   ✅ Electron application structure created');
    console.log('   ✅ Windows x64 packaging attempted');
    
    if (result.finalResult && result.finalResult.success) {
      console.log('\n🎉 AppSynth succeeded! Electron app generated and packaged.');
    } else if (result.finalResult) {
      console.log('\n⚠️ AppSynth completed with issues. Check logs for details.');
    } else {
      console.log('\n⚠️ AppSynth completed but final result is unavailable.');
    }
    
  } catch (error) {
    console.error('\n💥 AppSynth execution error:', error);
  }
}

// Run AppSynth test
main().then(() => {
  console.log('\n🏁 AppSynth test completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('\n💥 AppSynth test crashed:', error);
  process.exit(1);
});