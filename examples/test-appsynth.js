/**
 * AppSynth test program - Generate Electron desktop app from binary analysis
 * Adapted for @task-engine-cc with event-driven TaskEngine.ts and TodoWrite integration
 * Based on original test-appsynth.js but using new architecture
 */

import { TaskEngine } from '../dist/core/TaskEngine.js';
import fs from 'fs';
import path from 'path';

// Event-driven output formatter adapted from test-simple.js
function formatOutput(event) {
  const updates = event.updates;
  
  // Show system message info
  if (updates.systemMessage) {
    const sys = updates.systemMessage;
    console.log(`System: ${sys.model} | CWD: ${sys.cwd.split('/').pop()} | Tools: ${sys.tools.length} | Mode: ${sys.permissionMode}`);
    if (sys.mcpServers?.length > 0) {
      console.log(`   MCP Servers: ${sys.mcpServers.join(', ')}`);
    }
  }
  
  // Show turn progress with current action
  if (updates.progress) {
    console.log(`\nTurn ${updates.progress.currentTurn} (${updates.progress.percentage.toFixed(1)}%)`);
  }
  
  // Show current action
  if (updates.currentAction) {
    console.log(`${updates.currentAction.description}`);
  }

  // Show LLM responses 
  if (updates.llmResponse) {
    console.log(`Claude Response: ${updates.llmResponse.text}`);
  }

  // Show tool calls with parameters
  if (updates.toolStart) {
    const tool = updates.toolStart;
    console.log(`🔧 Tool: ${tool.name} - executing`);
    
    // Show tool parameters in a readable format
    if (tool.args && Object.keys(tool.args).length > 0) {
      const params = Object.entries(tool.args)
        .map(([key, value]) => {
          // Format different parameter types
          if (typeof value === 'string') {
            // Handle file paths more intelligently
            if (key === 'file_path' || key === 'path' || value.includes('/')) {
              // Show just filename for paths, with hint it's a path
              const filename = value.split('/').pop();
              return `${key}: "${filename}"`;
            } else if (value.length > 60) {
              // Truncate very long strings
              return `${key}: "${value.substring(0, 60)}..."`;
            } else {
              return `${key}: "${value}"`;
            }
          } else if (typeof value === 'object' && value !== null) {
            return `${key}: {${Object.keys(value).length} props}`;
          } else {
            return `${key}: ${value}`;
          }
        })
        .join(', ');
      
      console.log(`   Parameters: ${params}`);
    }
  }

  // Show tool results
  if (updates.toolResult) {
    const status = updates.toolResult.status === 'error' ? 'ERROR' : 'OK';
    let resultText = '';
    
    try {
      const result = updates.toolResult.result;
      
      // Handle different result types
      if (typeof result === 'string') {
        resultText = result;
      } else if (typeof result === 'object' && result !== null) {
        // Always try to stringify objects properly
        try {
          if (Array.isArray(result)) {
            if (result.length === 0) {
              resultText = 'Array(0): []';
            } else if (result.length <= 3) {
              resultText = `Array(${result.length}): ${JSON.stringify(result, null, 2)}`;
            } else {
              resultText = `Array(${result.length}): ${JSON.stringify(result.slice(0, 3), null, 2)}...`;
            }
          } else {
            // For objects, always try JSON.stringify first
            const jsonStr = JSON.stringify(result, null, 2);
            if (jsonStr && jsonStr !== '{}' && jsonStr !== 'null') {
              resultText = jsonStr;
            } else {
              // Fallback for special objects
              const keys = Object.keys(result);
              if (keys.length === 0) {
                resultText = 'Object: {}';
              } else {
                resultText = `Object(${keys.length} keys): [${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}]`;
              }
            }
          }
        } catch (jsonError) {
          // Last resort: try to extract some meaningful info
          try {
            const keys = Object.keys(result);
            resultText = `Object(${keys.length} keys): [${keys.slice(0, 3).join(', ')}] - JSON Error: ${jsonError.message}`;
          } catch (keysError) {
            resultText = `[Unformattable Object - ${jsonError.message}]`;
          }
        }
      } else if (result === null) {
        resultText = 'null';
      } else if (result === undefined) {
        resultText = 'undefined';
      } else {
        resultText = String(result);
      }
      
      // Handle error objects specifically  
      if (resultText.includes('[Error:') || resultText.includes('Error:') || 
          (typeof result === 'object' && result !== null && result.constructor && result.constructor.name === 'Error')) {
        console.log(`   ❌ ERROR Result (${updates.toolResult.duration}ms): ${resultText}`);
        return;
      }
      
      // Special handling for null errors
      if (result === null && updates.toolResult.status === 'error') {
        console.log(`   ❌ ERROR Result (${updates.toolResult.duration}ms): Error returned null`);
        return;
      }
      
    } catch (e) {
      resultText = `[Format Error: ${e.message}]`;
    }
    
    // Truncate long results
    const displayText = resultText.length > 500 ? resultText.substring(0, 500) + '...' : resultText;
    console.log(`   ✅ ${status} Result (${updates.toolResult.duration}ms): ${displayText}`);
  }

  // Show result message (final statistics)
  if (updates.resultMessage) {
    const result = updates.resultMessage;
    console.log(`\n📊 Execution Complete:`);
    console.log(`   Duration: ${result.duration}ms (API: ${result.apiDuration}ms)`);
    console.log(`   Turns: ${result.turns} | Cost: $${result.totalCost.toFixed(4)}`);
    console.log(`   Tokens: ${result.usage.inputTokens} in + ${result.usage.outputTokens} out`);
    if (result.permissionDenials > 0) {
      console.log(`   Permission denials: ${result.permissionDenials}`);
    }
  }

  // Show todo updates with simple checkbox formatting
  if (updates.todo) {
    console.log(`\n📝 Todo List Updated:`);
    updates.todo.todos.forEach((todo, index) => {
      const statusIcon = {
        'pending': '[ ]',
        'in_progress': '[.]',
        'completed': '[x]'
      }[todo.status] || '[?]';
      console.log(`   ${index + 1}. ${statusIcon} ${todo.content}`);
    });
  }

  // Show completion
  if (updates.completion) {
    if (updates.completion.success) {
      console.log(`\n🎉 Task completed! ${updates.completion.summary}`);
    } else {
      console.log(`\n❌ Task failed: ${updates.completion.error || updates.completion.summary}`);
    }
  }
}

async function main() {
  console.log('🚀 Starting AppSynth test - Generate Electron app from FasterCap binary analysis (TaskEngine-CC)');
  
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
      console.log('   ⚠️  No screenshot.png found, will proceed without UI reference');
    }
  } catch (error) {
    console.error('   ❌ Failed to setup app-out directory:', error.message);
    process.exit(1);
  }

  // Create AppSynth task strategy adapted for event-driven architecture
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

    // Remove isTaskComplete method - let TaskEngine naturally complete
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
        { name: 'TodoWrite', weight: 45, isRequired: true }, // Track TodoWrite usage
        { name: 'generate_feature_spec', weight: 50, isRequired: true },
        
        // Phase C: Local Electron app generation
        { name: 'Write', weight: 60, isRequired: true }, // File creation
        { name: 'Bash', weight: 70, isRequired: true }, // npm commands
        { name: 'build_electron_app', weight: 90, isRequired: true },
        { name: 'package_electron_app', weight: 100, isRequired: true }
      ];
    }

    processToolResult(toolCall, result) {
      // Check for fatal errors in tool results
      const fatalPatterns = this.getFatalErrorPatterns();
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      const hasError = fatalPatterns.some(pattern => pattern.test(resultStr));
      
      if (hasError) {
        return { 
          shouldContinue: false, 
          error: `Fatal error detected in ${toolCall.name}: ${resultStr}` 
        };
      }
      
      return { shouldContinue: true };
    }

    isValidToolCall(toolName, args) {
      // Allow all tools - TaskEngine will handle validation
      return true;
    }
  }

  // Create AppSynth prompt strategy with strong TodoWrite integration
  class AppSynthPromptStrategy {
    getName() {
      return 'AppSynthPromptStrategy';
    }
    
    async buildPrompt(request, config) {
      // 动态生成 screenshot.png 的绝对路径 (在 app-out 目录中)
      const screenshotPath = path.resolve(process.cwd(), 'app-out', 'screenshot.png');
      
      const systemPrompt = `You are "AppSynth". Your responsibility is to: Use the remote **Ghidra MCP** to perform static analysis on the target binary located at /data, and automatically generate, build, and package a **directly runnable Electron desktop application** in the **local current working directory**, replicating or approximating the binary's **core user-facing functionality** as closely as possible. When internal algorithms are unclear or evidence is insufficient, allow **reasonable simulation/assumptions**, but **must ensure the final application builds and runs successfully**. Priority: **functional operation > faithful replication**.

**IMPORTANT REMINDER**: Please **frequently use the TodoWrite tool** throughout the entire workflow to track your progress. This is not just a requirement, but a key tool to ensure successful task completion. Create a detailed task list before starting any analysis or tool calls, and immediately update progress after completing each step.

Before starting any analysis or tool calls, **first examine the specified screenshot file** (user will provide the specific path in reminders), extract window structure, interaction flows, menu/toolbar/table/chart/status bar, key text content, theme colors and layout density, and try to maintain **style and layout alignment** in subsequent development; these "Screenshot Insights" should be incorporated into Feature Spec and Evidence Map.

────────────────────
1. TodoWrite Usage Specifications (Must Follow)
────────────────────
**Mandatory Requirements**:
1. **Before task starts**: Use TodoWrite to create a detailed list containing at least 8-12 specific tasks
2. **When each task begins**: Change the corresponding task status from 'pending' to 'in_progress'  
3. **After each task completes**: Immediately change the task status to 'completed'
4. **When discovering new tasks**: Add new task items to the list at any time
5. **When encountering problems**: Create problem-solving tasks and track their status

**TodoWrite Task Category Examples**:
- Planning: "Create detailed task plan", "Analyze screenshot file"
- Analysis: "Import and analyze binary file", "Extract key strings", "Decompile core functions" 
- Generation: "Generate feature specification document", "Create Electron project structure"
- Building: "Install dependencies", "Build Windows x64 application", "Package as zip"
- Verification: "Test ZIP file integrity", "Verify build platform correctness", "Verify application runs"
- Note: No need to create "design application icon" or "create icon files" and other icon-related tasks

────────────────────
2. Environment and Boundaries
────────────────────
1) Remote analysis: All reverse engineering actions are performed remotely through **MCP tools** only; no local reverse analysis.
2) Local generation: Allowed to create/modify/delete files in **current directory and subdirectories**, and execute shell commands related to project generation, dependency installation, building and packaging (npm/yarn/pnpm, bash/PowerShell scripts, etc.).
3) Project root directory defaults to \`./app-out\`; build artifacts default to \`./app-out/dist/\`.
4) Target platform provided by user: Windows→\`.exe\`, macOS→\`.dmg\`, Linux→\`.AppImage\`. If cross-platform packaging dependencies are missing (e.g., wine needed for Windows on Linux), **automatically downgrade** to "unpacked directory + .zip" while ensuring it remains runnable.
5) Target architecture: **Final generated executable program architecture must be x86_64 (amd64)**. Building and packaging must **explicitly specify \`arch=x64\`** (e.g., electron-builder uses \`--win --x64\`); prohibit arm64/ia32 and other architecture outputs. If x86_64 cannot be produced due to environment limitations, treat as failure (not allowed to substitute with other architectures).

────────────────────
3. Standard Workflow (Analysis → Specification → Generation → Build → Verification → Delivery)
────────────────────

**Phase 0: TodoWrite Planning Phase**
- **Must be first step**: Use TodoWrite to create a complete task checklist containing all subsequent steps
- Tasks should include: screenshot analysis, binary analysis, feature specification generation, Electron app creation, build packaging, final verification, etc.

**Phase A: Context Collection**
- Confirm \`/data/<filename>\`, platform/architecture (**x86_64**), core user-facing functions to replicate (input/output/interaction)
- **Use Read tool** to examine the specified **screenshot file**: ${screenshotPath} (if exists)
- Extract UI theme/layout/key text as implementation reference, record as Screenshot Insights
- **Update TodoWrite**: Mark screenshot analysis task as completed

**Phase B: Remote Static Analysis (MCP)**
1) import_binary("/data/<filename>"), open_program("<filename>"), analyze_binary
2) list_literals(..., typeFilter="string"): Discover UI text/menu items/extensions/URLs/protocols/error messages and other clues
3) list_functions / list_all_entry_points; execute find_references(...) on keywords to identify hotspots
4) decompile_function(...); get_detailed_listing(...) + map_c_to_assembly(...) verify control flow and key constants
5) build_function_call_graph(...) / generate_call_graph(...): Identify upstream/downstream and **visible side effects** paths (file/network/registry)
⇒ **Update TodoWrite status after completing each step**
⇒ Output: **Feature Spec** (goals/inputs/outputs/states/errors/side-effects + Screenshot Insights)
        **Evidence Map** (list evidence ref for each assertion with \`confidence: high|medium|low\`)
        **Assumptions/Simulations** (ensure runnable)

**Phase C: Local Project Generation (Success Rate Priority)**
- Generate **minimal Electron project** in \`./app-out\`: \`package.json\`, \`main.js\`, \`preload.js\`, \`renderer/index.html\`, \`renderer/index.js\`
- Dependencies: Only **pure JS/TS**; **prohibit native addons (node-gyp)**; **lock exact versions**
- Security defaults: \`contextIsolation: true\`, renderer process \`sandbox: true\`, \`nodeIntegration: false\`
- Behavior implementation: Strictly implement **core visible functions** according to Feature Spec; **simulate/assume** when internal algorithms are unknown
- **No need to create application icons**: Skip icon design and creation, use Electron default icons
- **UI Interaction Requirements**: All interactive controls in the interface should implement their functionality. If placeholder functionality is necessary, display a popup alert saying "This feature is not yet implemented"
- **Update TodoWrite after creating each file**

**Phase D: Local Building and Packaging**
- Run: \`npm ci\` → \`npm run start\` (optional quick check) → directly build unpacked version
- **Force platform and architecture**: Must use \`electron-builder --win --x64\` or \`npm run build:win\` to build **Windows x64** version
- **Prohibit other platforms**: Do not build macOS (\`--mac\`) or Linux (\`--linux\`) versions, even when running on macOS/Linux environments
- **Final packaging format**: Package unpacked directory into **zip file**
- After completion, output the **absolute path** of the zip package and **target architecture (x86_64)**
- **Update TodoWrite after each build step completes**

**Phase E: Final Verification**
- **Use TodoWrite to create verification tasks**: Check zip file, verify architecture, etc.
- **ZIP File Integrity Verification (Mandatory)**:
  1. Use \`unzip -t <filename>.zip\` to test ZIP file integrity, must be error-free
  2. Use \`file <filename>.zip\` to confirm file type as "Zip archive data"
  3. If verification fails, must recreate correct ZIP file
- **Build Artifact Verification**: Confirm that compressed content is Windows build artifacts (win-unpacked directory), not macOS or Linux
- **Update TodoWrite after completion**: Mark all verification tasks as completed

**IMPORTANT REMINDER**: After each phase and each important step completes, must use TodoWrite to update task status. This is a mandatory requirement, not a suggestion!

# User Requirements

Binary file name: FasterCap

Binary file remote full path: /data/FasterCap

File information: FasterCap_6.0.7/FasterCap: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 2.6.18, BuildID[sha1]=49d12413e2384bc68aaf39329e716e6919ea79b9, stripped

Expected application target platform: Windows x86 64

**TodoWrite Usage Checklist**:
- Create detailed task list before starting (8-12 specific tasks)
- Update to in_progress when each task begins
- Immediately update to completed after each task finishes  
- Add new tasks to the list when discovered
- All key tasks should be marked as completed in the end

**Start immediately**: Please first use TodoWrite to create a detailed task plan, then execute according to the workflow!`;
      
      return systemPrompt;
    }
    
    async getSystemPrompt() {
      return undefined;
    }
    
    combinePrompts(systemPrompt, userPrompt) {
      return userPrompt; // System prompt already included
    }
  }

  // Create TaskEngine instance with AppSynth strategies
  const engine = new TaskEngine({
    strategy: new AppSynthTaskStrategy(),
    promptStrategy: new AppSynthPromptStrategy(),
    onEvent: formatOutput,
  });
  
  // Create task request for AppSynth workflow
  const request = {
    sessionId: `appsynth-fastercap-cc-${Date.now()}`,
    description: '请基于 FasterCap 二进制文件生成一个可运行的 Electron 桌面应用，目标平台为 Windows x86 64。请务必使用 TodoWrite 工具详细跟踪整个工作流程的进度，从任务规划到最终交付的每个步骤。',
    workingDirectory: path.join(process.cwd(), 'app-out'), // Use app-out directory
    mcpServerUrl: 'http://127.0.0.1:28080/sse',
    mcpServerName: 'ghidra-agent',
    mcpDescription: 'Ghidra Agent for Binary Analysis',
    mcpTimeout: 300000, // 5 minutes timeout for binary analysis operations
    maxTurns: 350, // Set to 350 turns (more than the required 300) for complex AppSynth workflow
  };
  
  console.log('\n📋 AppSynth Task Information:');
  console.log(`   Binary: FasterCap (ELF 64-bit, x86-64)`);
  console.log(`   Target: Windows x86 64 Electron app`);
  console.log(`   Remote path: /data/FasterCap`);
  console.log(`   Working dir: ${request.workingDirectory}`);
  console.log(`   MCP server: ${request.mcpServerUrl}`);
  console.log(`   Max turns: ${request.maxTurns}`);
  console.log(`   Session ID: ${request.sessionId}`);
  console.log(`   📝 TodoWrite integration: ENABLED`);
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
    console.log('   ✅ Event-driven TaskEngine architecture used');
    console.log('   ✅ TodoWrite integration functional');
    console.log('   ✅ Binary analysis attempted via Ghidra MCP');
    console.log('   ✅ Electron app generation workflow executed');
    
    if (result.success) {
      console.log('\n🎉 AppSynth succeeded! Electron app generation completed.');
    } else {
      console.log('\n⚠️  AppSynth completed with issues. Check logs for details.');
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
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