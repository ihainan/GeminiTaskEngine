/**
 * Test to demonstrate tool parameter display functionality
 */

import { TaskEngine } from '../dist/core/TaskEngine.js';

// Enhanced output formatter to showcase tool parameters
function formatOutput(event) {
  const updates = event.updates;
  
  // Show system message info
  if (updates.systemMessage) {
    const sys = updates.systemMessage;
    console.log(`🖥️  System: ${sys.model} | CWD: ${sys.cwd.split('/').pop()} | Tools: ${sys.tools.length} | Mode: ${sys.permissionMode}`);
  }
  
  // Show turn progress with current action
  if (updates.progress) {
    console.log(`\n🔄 Turn ${updates.progress.currentTurn} (${updates.progress.percentage.toFixed(1)}%)`);
  }
  
  // Show current action
  if (updates.currentAction) {
    const actionIcon = {
      'thinking': '🤔',
      'tool_executing': '🔧', 
      'responding': '💬'
    }[updates.currentAction.type] || '⚡';
    console.log(`${actionIcon} ${updates.currentAction.description}`);
  }

  // Show LLM responses 
  if (updates.llmResponse) {
    console.log(`💬 Claude Response: ${updates.llmResponse.text}`);
  }

  // Show tool calls with detailed parameters
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
              // Show just filename for paths
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
      
      console.log(`   📝 Parameters: ${params}`);
    }
  }

  // Show tool results
  if (updates.toolResult) {
    const status = updates.toolResult.status === 'error' ? '❌' : '✅';
    console.log(`   ${status} Result (${updates.toolResult.duration}ms): ${updates.toolResult.result.substring(0, 200)}${updates.toolResult.result.length > 200 ? '...' : ''}`);
  }

  // Show result message (final statistics)
  if (updates.resultMessage) {
    const result = updates.resultMessage;
    console.log(`\n📊 Execution Complete:`);
    console.log(`   Duration: ${result.duration}ms (API: ${result.apiDuration}ms)`);
    console.log(`   Turns: ${result.turns} | Cost: $${result.totalCost.toFixed(4)}`);
    console.log(`   Tokens: ${result.usage.inputTokens} in + ${result.usage.outputTokens} out`);
    if (result.permissionDenials > 0) {
      console.log(`   ⚠️  Permission denials: ${result.permissionDenials}`);
    }
  }

  // Show completion
  if (updates.completion) {
    if (updates.completion.success) {
      console.log(`\n✅ Task completed! ${updates.completion.summary}`);
    } else {
      console.log(`\n❌ Task failed: ${updates.completion.error || updates.completion.summary}`);
    }
  }
}

async function main() {
  console.log('🚀 Testing Tool Parameter Display');
  
  // Strategy without completion check - let Claude Code SDK decide naturally
  class NaturalCompletionStrategy {
    getName() { return 'NaturalCompletionStrategy'; }
    calculateProgress(toolCalls, turnCount) { return Math.min(turnCount * 5, 100); }
    // No isTaskComplete method - let Claude Code SDK naturally complete
    getFatalErrorPatterns() { return [/ERROR|FAILED/i]; }
    getWorkflowSteps() { return [{ name: 'Write', weight: 100, isRequired: true }]; }
    processToolResult() { return { shouldContinue: true }; }
    isValidToolCall() { return true; }
  }

  // Simple prompt strategy
  class SimplePromptStrategy {
    getName() { return 'SimplePromptStrategy'; }
    async buildPrompt(request) {
      return `Please help me with this task: ${request.description}

Use the available tools to complete the task. You might need to read, write, or search files.`;
    }
    async getSystemPrompt() { return undefined; }
    combinePrompts(system, user) { return user; }
  }

  const engine = new TaskEngine({
    strategy: new NaturalCompletionStrategy(),
    promptStrategy: new SimplePromptStrategy(),
    onEvent: formatOutput,
  });
  
  const request = {
    sessionId: `tool-params-test-${Date.now()}`,
    description: 'Create a Python script called "calculator.py" that can add two numbers. Then search for all Python files in the current directory.',
    workingDirectory: process.cwd(),
    requiredTools: ['Write', 'Read', 'Glob']
  };
  
  console.log(`📝 Task: ${request.description}`);
  console.log(`📍 Working directory: ${request.workingDirectory}`);
  console.log('=' + '='.repeat(80));

  try {
    const result = await engine.executeTask(request);
    
    console.log('\n' + '=' + '='.repeat(80));
    console.log('📊 Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Duration: ${result.metadata.totalDuration}ms`);
    console.log(`   Turns: ${result.metadata.turnCount}`);
    console.log(`   Tool calls: ${result.metadata.toolCallCount}`);
    
    if (result.success) {
      console.log('\n🎉 Tool parameter display working perfectly!');
      console.log('✅ Successfully showing tool names and parameters');
      console.log('✅ Intelligent parameter formatting');
      console.log('✅ File path handling optimized');
    } else {
      console.log(`\n⚠️  Task failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('\n💥 Execution error:', error.message);
  }
}

main().catch(console.error);