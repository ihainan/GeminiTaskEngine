/**
 * TaskEngine test program with plain text output (like CLI non-interactive mode)
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

  // 2. Thought processing removed - following CLI non-interactive mode pattern
  // (Thoughts are filtered out at TaskEngine level)

  // DEBUG: 详细流式响应调试 (暂时屏蔽)
  // if (status.llmStream) {
  //   console.log(`[DEBUG] LLM Stream - Turn ${status.progress.currentTurn}:`);
  //   console.log(`  - Text Length: ${status.llmStream.partialText?.length || 0}`);
  //   console.log(`  - Is Complete: ${status.llmStream.isComplete}`);
  //   console.log(`  - First 200 chars: ${JSON.stringify(status.llmStream.partialText?.slice(0, 200))}`);
  // }

  // 3. Handle text streaming - show first complete text only
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

  // 5. Handle tool calls (reuse existing logic)
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
          
          // Show result for completed tools
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

  // 6. Handle final result
  if (status.finalResult && status.sessionState === 'completed') {
    console.log(`\n✅ Task completed!`);
    console.log(`   Success: ${status.finalResult.success}`);
    console.log(`   Summary: ${status.finalResult.summary}`);
    if (status.finalResult.outputPath) {
      console.log(`   Output path: ${status.finalResult.outputPath}`);
    }
  }

  // 7. Handle errors
  if (status.sessionState === 'error' && status.finalResult) {
    console.log(`\n❌ Task failed!`);
    if (status.finalResult.error) {
      console.log(`   Error: ${status.finalResult.error}`);
    }
    console.log(`   Summary: ${status.finalResult.summary}`);
  }
}

async function main() {
  console.log('Starting TaskEngine test with plain text output (like CLI non-interactive mode)');
  
  // Read system prompt
  let systemPrompt = '';
  const promptPath = path.join(process.cwd(), '..', 'software_scalpel', 'docs', 'Prompt.md');
  try {
    systemPrompt = fs.readFileSync(promptPath, 'utf-8');
    console.log('✅ Successfully loaded system prompt');
  } catch (error) {
    console.warn('⚠️ Cannot load Prompt.md, using default prompt');
  }
  
  // Reset output state
  outputState.reset();
  
  // Create a simple task strategy for testing
  class TestTaskStrategy {
    getName() {
      return 'TestTaskStrategy';
    }

    calculateProgress(toolCalls, turnCount) {
      // Simple progress calculation based on turn count
      return Math.min(turnCount * 12, 95);
    }

    isTaskComplete(toolCalls) {
      // Check if export_program was executed successfully
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

  // Create a custom prompt strategy that uses the original PromptBuilder logic
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
7. **Cross-platform symbol rules**
   • Mach-O (macOS): symbols are usually prefixed with an underscore, e.g. \`_main\`.  
   • PE (Windows): names may be decorated (e.g. \`_main@16\`, \`?func@@YAXXZ\`).  
   • When in doubt or for stripped binaries, always use a hex address such as \`0x100003F60\`.

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
1. **Gather context** Confirm software name, binary filename (relative to /data), architecture (if known),
   and the precise behavioral change desired.
2. **Feasibility check** Outline method, target code areas, and risks; proceed only after user approval.
3. **Import & analyze**
   ➤ import_binary("/data/<filename>")
   ➤ open_program("<filename>")
   ➤ analyze_binary
4. **Plan modification**
   ➤ list_functions / list_all_entry_points — obtain exact symbol names or entry-point addresses  
   ➤ Locate code or data to patch (decompile_function, list_literals, call graphs…).
   Produce a concise patch strategy.
5. **Apply patch** 
   ➤ patch_binary(autopad=true, …) — Use proper Ghidra assembly syntax:
     • For instructions: 'mov rax, 1\\nret'
     • For raw bytes/strings: '.byte 0x90,0x90' or '.byte "Hello",0x00'
     • AVOID 'db' (use '.byte' instead)
   ➤ Plus any necessary type or symbol edits.
6. **Save & export**
   ➤ save_program  
   ➤ export_binary("/data/saved/<original_name>_<YYYYMMDD_HHmmss>.<orig_ext>")  
   Inform the user what changed and where the new binary is saved.
7. **Iterate** If verification fails, adjust and repeat from step 4.

────────────────────
Critical error handling
────────────────────
**IMPORTANT**: After EVERY tool call, you MUST:
1. **Check the tool response carefully** for any error indicators:
   • Look for text containing "Error:", "FAILED:", "[Error", "Exception", "ERROR"
   • Check for assembly syntax errors, permission denials, file not found messages
   • Watch for phrases like "operation failed", "could not", "unable to"
2. **If ANY error is detected**:
   • STOP immediately and analyze the specific error message
   • Do NOT proceed to the next step in the workflow
   • Identify the root cause (syntax, parameters, file paths, permissions, etc.)
   • Adjust your approach based on the error type:
     - Assembly syntax errors → Fix assembly code format
     - File path errors → Verify and correct paths
     - Permission errors → Check file access or try alternative approaches
     - API/connection errors → Retry or use alternative methods
3. **Retry with corrections** before moving forward
4. **Only proceed to next steps** after confirming the current tool executed successfully

Remember: A tool may appear "completed" but still contain error messages in its output. Always read the actual response content, not just the completion status.

────────────────────
Interaction style
────────────────────
• Be concise and use bullet points for plans.
• Ask clarifying questions only when essential.
• Never issue local commands or refer to the local file system.

# === End of Prompt ===`;
    }

    getName() {
      return 'LegacyGhidraPromptStrategy';
    }

    async buildPrompt(request, config) {
      // Extract binary info from description using simple pattern matching
      // This is to maintain backward compatibility
      const binaryInfo = this.extractBinaryInfoFromDescription(request.description);
      const userRequest = this.extractUserRequestFromDescription(request.description);

      const userContext = `
# Binary Information
- **Binary Name**: ${binaryInfo.name}
- **Binary Path**: ${binaryInfo.path}${binaryInfo.architecture ? `
- **Architecture**: ${binaryInfo.architecture}` : ''}${binaryInfo.metadata ? `
- **Additional Metadata**: ${JSON.stringify(binaryInfo.metadata, null, 2)}` : ''}

# User Requirements
${userRequest}

**Important**: The binary file is already available at ${binaryInfo.path} on the MCP server. You should directly import it using import_binary("${binaryInfo.path}") and then open it with open_program("${binaryInfo.name}").
`;
      
      return this.systemPrompt + '\\n\\n' + userContext;
    }

    async getSystemPrompt() {
      return this.systemPrompt;
    }

    combinePrompts(systemPrompt, userPrompt) {
      return userPrompt; // System prompt already included
    }

    extractBinaryInfoFromDescription(description) {
      // Simple extraction - for test purposes, use fixed values
      return {
        name: 'test_binary',
        path: '/data/test_binary',
        architecture: 'x64'
      };
    }

    extractUserRequestFromDescription(description) {
      // Extract the actual user request from description
      // Since description is now just the user request, return it directly
      return description;
    }
  }

  // Create TaskEngine instance with custom strategies
  const engine = new TaskEngine({
    strategy: new TestTaskStrategy(),
    promptStrategy: new LegacyGhidraPromptStrategy(systemPrompt),
    onStatusUpdate: formatPlainStatus,
  });
  
  // Create task request with new interface but original content
  const request = {
    sessionId: `structured-test-${Date.now()}`,
    description: 'Please modify the "Hello World" text in the program to "Hello Ghidra".',
    mcpServerUrl: 'http://127.0.0.1:28080/sse',
    mcpServerName: 'ghidra-agent',
    taskType: 'binary-analysis',
    workingDirectory: process.cwd() // Use current directory instead of /tmp/task-engine
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
    
    // Output matches CLI non-interactive mode
    console.log('\n🔍 Plain Text Output Benefits:');
    console.log('   ✅ Clean output like CLI non-interactive mode');
    console.log('   ✅ No thought process clutter');
    console.log('   ✅ Direct text streaming');
    console.log('   ✅ Matches real CLI behavior');
    
  } catch (error) {
    console.error('\n💥 Task execution error:', error);
  }
}

// Run test
main().then(() => {
  console.log('\n🏁 Program completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('\n💥 Program crashed:', error);
  process.exit(1);
});