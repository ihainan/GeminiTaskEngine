/**
 * Test to observe Claude Code SDK's natural completion behavior
 */

import { TaskEngine } from '../src/core/TaskEngine.ts';

// Simple output formatter that shows everything
function formatOutput(status) {
  if (status.progress.currentTurn !== formatOutput.lastTurn) {
    console.log(`\n🔄 Turn ${status.progress.currentTurn} (${status.progress.percentage}%)`);
    formatOutput.lastTurn = status.progress.currentTurn;
  }

  if (status.llmStream?.isComplete && status.llmStream?.partialText) {
    const text = status.llmStream.partialText.trim();
    if (text && text !== '[object Object]' && !formatOutput.shownTexts.has(status.progress.currentTurn)) {
      console.log(`💬 Claude: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
      formatOutput.shownTexts.add(status.progress.currentTurn);
    }
  }

  if (status.toolCalls.length > 0) {
    status.toolCalls.forEach(call => {
      if (!formatOutput.shownTools.has(call.callId)) {
        console.log(`🔧 Tool: ${call.name} - ${call.status}`);
        formatOutput.shownTools.add(call.callId);
      }
      if (call.result && call.status === 'completed' && !formatOutput.shownResults.has(call.callId)) {
        console.log(`   Result: ${call.result.substring(0, 100)}${call.result.length > 100 ? '...' : ''}`);
        formatOutput.shownResults.add(call.callId);
      }
    });
  }

  if (status.sessionState === 'completed') {
    console.log(`\n✅ Task completed! ${status.finalResult?.summary || ''}`);
  } else if (status.sessionState === 'error') {
    console.log(`\n❌ Task failed: ${status.finalResult?.error || 'Unknown error'}`);
  }
}

formatOutput.lastTurn = 0;
formatOutput.shownTexts = new Set();
formatOutput.shownTools = new Set();
formatOutput.shownResults = new Set();

async function main() {
  console.log('🚀 Testing Claude Code SDK Natural Completion');
  
  // NO STRATEGY - let Claude Code SDK decide when to stop
  class NoOpStrategy {
    getName() { return 'NoOpStrategy'; }
    calculateProgress(toolCalls, turnCount) { return Math.min(turnCount * 10, 90); }
    isTaskComplete(toolCalls) { 
      // Never complete by strategy - let Claude Code SDK decide
      return false; 
    }
    getFatalErrorPatterns() { return []; }
    getWorkflowSteps() { return []; }
    processToolResult() { return { shouldContinue: true }; }
    isValidToolCall() { return true; }
  }

  // Simple prompt strategy
  class SimplePromptStrategy {
    getName() { return 'SimplePromptStrategy'; }
    async buildPrompt(request) {
      return `Please help me with this task: ${request.description}

Use the available tools to complete the task. When you're done, please clearly indicate that the task is finished.`;
    }
    async getSystemPrompt() { return undefined; }
    combinePrompts(system, user) { return user; }
  }

  const engine = new TaskEngine({
    strategy: new NoOpStrategy(),
    promptStrategy: new SimplePromptStrategy(),
    onStatusUpdate: formatOutput,
  });
  
  const request = {
    sessionId: `natural-test-${Date.now()}`,
    description: 'Create a text file called "test.txt" with the content "Hello World!" and then read it back to verify.',
    workingDirectory: process.cwd(),
    requiredTools: ['Write', 'Read'],
    maxTurns: 20  // Higher limit to see natural completion
  };
  
  console.log(`📝 Task: ${request.description}`);
  console.log(`📍 Working directory: ${request.workingDirectory}`);
  console.log('=' + '='.repeat(60));

  try {
    const result = await engine.executeTask(request);
    
    console.log('\n' + '=' + '='.repeat(60));
    console.log('📊 Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Duration: ${result.metadata.totalDuration}ms`);
    console.log(`   Turns: ${result.metadata.turnCount}`);
    console.log(`   Tool calls: ${result.metadata.toolCallCount}`);
    console.log(`   Summary: ${result.executionSummary}`);
    
    if (result.success) {
      console.log('\n🎯 Observed Claude Code SDK natural completion behavior!');
    } else {
      console.log(`\n⚠️  Task failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('\n💥 Execution error:', error.message);
  }
}

main().catch(console.error);