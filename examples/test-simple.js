/**
 * TaskEngine test with MCP server and TodoWrite functionality
 */

import { TaskEngine } from '../dist/core/TaskEngine.js';
import fs from 'fs';
import path from 'path';

// Event-driven output formatter for MCP server testing
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
    console.log(`Tool: ${tool.name} - executing`);
    
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
        // Always try to stringify objects properly, don't rely on toString() check
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
        console.log(`   ERROR Result (${updates.toolResult.duration}ms): ${resultText}`);
        return;
      }
      
      // Special handling for null errors
      if (result === null && updates.toolResult.status === 'error') {
        console.log(`   ERROR Result (${updates.toolResult.duration}ms): Error returned null`);
        return;
      }
      
    } catch (e) {
      resultText = `[Format Error: ${e.message}]`;
    }
    
    // Truncate long results
    const displayText = resultText.length > 500 ? resultText.substring(0, 500) + '...' : resultText;
    console.log(`   ${status} Result (${updates.toolResult.duration}ms): ${displayText}`);
  }

  // Show result message (final statistics)
  if (updates.resultMessage) {
    const result = updates.resultMessage;
    console.log(`\nExecution Complete:`);
    console.log(`   Duration: ${result.duration}ms (API: ${result.apiDuration}ms)`);
    console.log(`   Turns: ${result.turns} | Cost: $${result.totalCost.toFixed(4)}`);
    console.log(`   Tokens: ${result.usage.inputTokens} in + ${result.usage.outputTokens} out`);
    if (result.permissionDenials > 0) {
      console.log(`   Permission denials: ${result.permissionDenials}`);
    }
  }

  // Show todo updates
  if (updates.todo) {
    console.log(`\nTodo List Updated:`);
    updates.todo.todos.forEach((todo, index) => {
      const statusIcon = {
        'pending': '[ ]',
        'in_progress': '[.]',
        'completed': '[X]'
      }[todo.status] || '[?]';
      console.log(`   ${index + 1}. ${statusIcon} ${todo.content}`);
    });
  }

  // Show completion
  if (updates.completion) {
    if (updates.completion.success) {
      console.log(`\nTask completed! ${updates.completion.summary}`);
    } else {
      console.log(`\nTask failed: ${updates.completion.error || updates.completion.summary}`);
    }
  }
}

async function main() {
  console.log('Testing TaskEngine with MCP Server and TodoWrite');
  
  // Binary analysis prompt strategy with TodoWrite integration
  class BinaryAnalysisPromptStrategy {
    getName() { return 'BinaryAnalysisPromptStrategy'; }
    
    async buildPrompt(request) {
      const systemPrompt = `# === Reverse-Engineering Expert – System Prompt ===
You are "RE-Expert", a senior reverse-engineering engineer who drives a **remote** Ghidra-based MCP service via SSE.
Your task is to fulfill binary-modification requests by patching the target binary (stored on the MCP server) and saving
the result to: /data/saved/<original_name>_<YYYYMMDD_HHmmss>.<orig_ext>

**IMPORTANT**: Use the TodoWrite tool to track your progress throughout the entire workflow. Create a detailed task list at the beginning and update it as you complete each step.

────────────────────
Environment rules
────────────────────
1. **Remote-only tooling** All MCP tool calls must be executed on the remote server.
2. The target binary is always located at **/data/<filename> on the MCP server**.
3. Use **only** the documented MCP tools; follow their signatures exactly.
4. **Always use TodoWrite** to create and manage your task list
5. Max turns available: 200

────────────────────
MANDATORY: Create a plan with TodoWrite first
────────────────────
**IMPORTANT**: Before using any MCP tools, use TodoWrite to create a detailed task list outlining:
1. What you need to accomplish
2. Which MCP tools you'll use in order
3. Expected outcome for each step

Then proceed with the standard workflow while updating your todo list:

────────────────────
Reference workflow (adapt as needed)
────────────────────
1. **Create Todo List** - Use TodoWrite to plan all steps
2. **Import & analyze**
   ➤ import_binary("/data/<filename>")
   ➤ open_program("<filename>")
   ➤ analyze_binary
3. **Plan modification**
   ➤ list_functions / list_all_entry_points
   ➤ Locate code or data to patch (decompile_function, list_literals)
4. **Apply patch** 
   ➤ patch_binary with proper Ghidra assembly syntax
5. **Save & export**
   ➤ save_program  
   ➤ export_binary("/data/saved/<original_name>_<YYYYMMDD_HHmmss>.<orig_ext>")
6. **Update Todo List** - Mark tasks as completed using TodoWrite

Remember to update your todo list after each major step!

# User Requirements
${request.description}

# Binary Information
test_binary: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, BuildID[sha1]=0c76a177b465f87bb7a71b83ee1cda1d0643b3cc, for GNU/Linux 3.2.0, not stripped

**Important**: The binary file is already available as "test_binary" on the MCP server. Start by creating your todo list, then proceed with the analysis.`;
      
      return systemPrompt;
    }
    
    async getSystemPrompt() { return undefined; }
    combinePrompts(system, user) { return user; }
  }
  
  // Strategy without completion check - let Claude Code SDK decide naturally
  class NaturalCompletionStrategy {
    getName() { return 'NaturalCompletionStrategy'; }
    calculateProgress(toolCalls, turnCount) { return Math.min(turnCount * 5, 100); }
    // No isTaskComplete method - let Claude Code SDK naturally complete
    getFatalErrorPatterns() { return [/ERROR|FAILED/i]; }
    getWorkflowSteps() { return [{ name: 'MCP Tools', weight: 100, isRequired: true }]; }
    processToolResult() { return { shouldContinue: true }; }
    isValidToolCall() { return true; }
  }

  const engine = new TaskEngine({
    strategy: new NaturalCompletionStrategy(),
    promptStrategy: new BinaryAnalysisPromptStrategy(),
    onEvent: formatOutput,
  });
  
  const request = {
    sessionId: `mcp-binary-test-${Date.now()}`,
    description: 'Modify the string "Hello World" to "Hello Ghidra" in the test_binary file. Use TodoWrite to track your progress through each step of the binary modification process.',
    workingDirectory: process.cwd(),
    mcpServerUrl: 'http://localhost:28080/sse',
    mcpServerName: 'ghidra-mcp',
    mcpDescription: 'Ghidra SSE MCP Server for Binary Analysis',
    mcpTimeout: 60000,
  };
  
  console.log('\nTask: ' + request.description);
  console.log('Working directory: ' + request.workingDirectory);
  if (request.mcpServerUrl) {
    console.log('MCP Server: ' + request.mcpServerUrl);
  } else {
    console.log('MCP Server: None (testing TodoWrite only)');
  }
  console.log('Session ID: ' + request.sessionId);
  console.log('=' + '='.repeat(80));

  try {
    // Execute task
    const result = await engine.executeTask(request);
    
    console.log('\n' + '='.repeat(80));
    console.log('Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Duration: ${result.metadata.totalDuration}ms`);
    console.log(`   Turns: ${result.metadata.turnCount}`);
    console.log(`   Tool calls: ${result.metadata.toolCallCount}`);
    
    if (result.success) {
      console.log('\nTaskEngine with MCP server working correctly!');
      console.log('- Event-driven architecture functional');
      console.log('- TodoWrite integration operational');
      console.log('- MCP server connection established');
    } else {
      console.log(`\nTask failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('\nTask execution error:', error);
  }
}

// Run test
main().then(() => {
  console.log('\nProgram completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('\nProgram crashed:', error);
  process.exit(1);
});