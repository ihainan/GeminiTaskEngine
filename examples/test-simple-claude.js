/**
 * TaskEngine test program with Claude Code SDK - Plain text output
 */

import { ClaudeOnlyTaskEngine } from '../src/core/ClaudeOnlyTaskEngine.ts';
import fs from 'fs';
import path from 'path';

// State tracking for plain text output
class OutputState {
  constructor() {
    this.lastTurn = 0;
    this.lastToolCallCount = 0;
    this.toolStates = new Map();
    this.outputedStreams = new Set();
  }

  reset() {
    this.lastTurn = 0;
    this.lastToolCallCount = 0;
    this.toolStates.clear();
    this.outputedStreams.clear();
  }
}

const outputState = new OutputState();

// Plain text output formatter
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
    
    const turnKey = `turn-${status.progress.currentTurn}`;
    if (!outputState.outputedStreams.has(turnKey)) {
      console.log('\n[COMPLETE RESPONSE]:', textContent);
      outputState.outputedStreams.add(turnKey);
      
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
        console.log(`\n🔧 Tool call: ${call.name}`);
        if (call.args && Object.keys(call.args).length > 0) {
          console.log(`   Args: ${JSON.stringify(call.args, null, 2)}`);
        }
        outputState.toolStates.set(call.callId, { status: call.status });
      } else if (lastState.status !== call.status) {
        const duration = call.duration ? ` (${call.duration}ms)` : '';
        
        if (call.status === 'executing') {
          console.log(`   ${call.name} executing...`);
        } else if (call.status === 'completed') {
          console.log(`   ${call.name} completed${duration}`);
          
          if (call.result) {
            if (call.name === 'patch_binary' || call.result.length < 1000) {
              console.log(`   Result [START]:\n${call.result}\n   [END]`);
            } else {
              console.log(`   Result [START]:\n${call.result.slice(0, 150)}...\n   [END]`);
              console.log(`   [Full length: ${call.result.length} characters]`);
            }
          }
          
          if (call.exportPath) {
            console.log(`   Export path: ${call.exportPath}`);
          }
        } else if (call.status === 'error') {
          console.log(`   ${call.name} failed${duration}`);
          if (call.error) {
            console.log(`   Error: ${call.error}`);
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

  // 5. Handle errors
  if (status.sessionState === 'error' && status.finalResult) {
    console.log(`\n❌ Task failed!`);
    if (status.finalResult.error) {
      console.log(`   Error: ${status.finalResult.error}`);
    }
    console.log(`   Summary: ${status.finalResult.summary}`);
  }
}

async function main() {
  console.log('Starting Claude TaskEngine test with plain text output');
  
  // Read system prompt
  let systemPrompt = '';
  const promptPath = path.join(process.cwd(), '..', 'software_scalpel', 'docs', 'Prompt.md');
  try {
    systemPrompt = fs.readFileSync(promptPath, 'utf-8');
    console.log('✅ Successfully loaded system prompt');
  } catch (error) {
    console.warn('⚠️ Cannot load Prompt.md, using default prompt');
  }
  
  outputState.reset();
  
  // Create a simple task strategy for testing
  class TestTaskStrategy {
    getName() {
      return 'TestTaskStrategy';
    }

    calculateProgress(toolCalls, turnCount) {
      return Math.min(turnCount * 12, 95);
    }

    isTaskComplete(toolCalls) {
      return toolCalls.some(call => 
        call.name === 'export_program' && 
        call.status === 'completed'
      );
    }

    getFatalErrorPatterns() {
      return [/(ECONN|ETIMEDOUT|auth|permission|timeout|ECONNREFUSED)/i];
    }

    getWorkflowSteps() {
      return [
        { name: 'import_binary', weight: 20, isRequired: true },
        { name: 'open_program', weight: 30, isRequired: true },
        { name: 'analyze_binary', weight: 40, isRequired: true },
        { name: 'patch_with_data', weight: 80, isRequired: true },
        { name: 'export_program', weight: 100, isRequired: true }
      ];
    }

    processToolResult(toolCall, result) {
      return { shouldContinue: true };
    }

    isValidToolCall(toolName, args) {
      const validTools = ['import_binary', 'open_program', 'analyze_binary', 'list_literals', 'patch_with_data', 'save_program', 'export_program'];
      return validTools.includes(toolName);
    }
  }

  // Create a custom prompt strategy
  class LegacyGhidraPromptStrategy {
    constructor(systemPrompt) {
      this.systemPrompt = systemPrompt || `# === Reverse-Engineering Expert – System Prompt ===
You are "RE-Expert", a senior reverse-engineering engineer who drives a **remote** Ghidra-based MCP service via SSE.
Your task is to fulfill binary-modification requests by patching the target binary (stored on the MCP server) and saving
the result to:

    /data/saved/<original_name>_<YYYYMMDD_HHmmss>.<orig_ext>

────────────────────
Environment rules
────────────────────
1. **Remote-only tooling** All MCP tool calls must be executed on the remote server.
   • Absolutely **no** shell commands, file operations, or other tools may be executed on the local machine.
   • Never inspect, create, rename, edit, or list local files or directories.
2. The target binary is always located at **/data/<filename> on the MCP server**.
   • Do not call \`search_binaries\`; import directly from the /data path.
3. Use **only** the documented MCP tools; follow their signatures exactly.  
   (Key tools: import_binary, open_program, analyze_binary, list_functions, list_all_entry_points,
   decompile_function, patch_binary, save_program, **export_binary**, …)
4. Internet research is allowed unless the user forbids it.
5. No backup is required (MCP has no backup feature).
6. Follow all legal and ethical standards—reject requests that facilitate malware, DRM/EULA violations, etc.

────────────────────
MANDATORY: Create a plan first
────────────────────
**IMPORTANT**: Before using any tools, create a brief plan outlining:
1. What you need to accomplish
2. Which tools you'll use in order
3. Expected outcome

Then proceed with the standard workflow:

────────────────────
Standard workflow
────────────────────
1. **Gather context** Confirm software name, binary filename, and the precise behavioral change desired.
2. **Feasibility check** Outline method, target code areas, and risks; proceed only after user approval.
3. **Import & analyze**
   ➤ import_binary("/data/<filename>")
   ➤ open_program("<filename>")
   ➤ analyze_binary
4. **Plan modification**
   ➤ list_functions / list_all_entry_points — obtain exact symbol names or entry-point addresses  
   ➤ Locate code or data to patch. Produce a concise patch strategy.
5. **Apply patch** 
   ➤ patch_binary(autopad=true, …)
6. **Save & export**
   ➤ save_program  
   ➤ export_binary("/data/saved/<original_name>_<YYYYMMDD_HHmmss>.<orig_ext>")  
   Inform the user what changed and where the new binary is saved.
7. **Iterate** If verification fails, adjust and repeat from step 4.

# === End of Prompt ===`;
    }

    getName() {
      return 'LegacyGhidraPromptStrategy';
    }

    async buildPrompt(request, config) {
      const binaryInfo = {
        name: 'test_binary',
        path: '/data/test_binary',
        architecture: 'x64'
      };

      const userContext = `
# Binary Information
- **Binary Name**: ${binaryInfo.name}
- **Binary Path**: ${binaryInfo.path}
- **Architecture**: ${binaryInfo.architecture}

# User Requirements
${request.description}

**Important**: The binary file is already available at ${binaryInfo.path} on the MCP server. You should directly import it using import_binary("${binaryInfo.path}") and then open it with open_program("${binaryInfo.name}").
`;
      
      return this.systemPrompt + '\\n\\n' + userContext;
    }

    async getSystemPrompt() {
      return this.systemPrompt;
    }

    combinePrompts(systemPrompt, userPrompt) {
      return userPrompt;
    }
  }

  // Create TaskEngine instance with custom strategies
  const engine = new ClaudeOnlyTaskEngine({
    strategy: new TestTaskStrategy(),
    promptStrategy: new LegacyGhidraPromptStrategy(systemPrompt),
    onStatusUpdate: formatPlainStatus,
  });
  
  // Create task request
  const request = {
    sessionId: `claude-test-${Date.now()}`,
    description: 'Please modify the "Hello World" text in the program to "Hello Claude".',
    mcpServerUrl: 'http://127.0.0.1:28080/sse',
    mcpServerName: 'ghidra-agent',
    taskType: 'binary-analysis',
    workingDirectory: process.cwd()
  };
  
  console.log('\n📋 Task Information:');
  console.log(`   User request: ${request.description}`);
  console.log(`   Task type: ${request.taskType}`);
  console.log(`   MCP server: ${request.mcpServerUrl}`);
  console.log(`   Session ID: ${request.sessionId}`);
  console.log('\n' + '='.repeat(80));

  try {
    // Execute task
    const result = await engine.executeTask(request);
    
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 Execution Statistics:');
    console.log(`   Total duration: ${result.metadata.totalDuration}ms`);
    console.log(`   Total turns: ${result.metadata.turnCount}`);
    console.log(`   Tool call count: ${result.metadata.toolCallCount}`);
    console.log(`   Success: ${result.success}`);
    
    console.log('\n🔍 Claude Code Integration Benefits:');
    console.log('   ✅ No Gemini CLI bugs to work around');
    console.log('   ✅ Native MCP server support');
    console.log('   ✅ Stable tool execution');
    console.log('   ✅ Rich ecosystem integration');
    
  } catch (error) {
    console.error('\n💥 Task execution error:', error);
  }
}

// Run test
main().then(() => {
  console.log('\n🏁 Claude TaskEngine test completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('\n💥 Program crashed:', error);
  process.exit(1);
});