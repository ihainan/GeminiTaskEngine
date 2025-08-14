/**
 * Test TaskEngine with no strategy to verify natural completion
 * This test runs TaskEngine without any strategy to see if Claude Code SDK
 * naturally completes tasks when no isTaskComplete method is provided.
 */

import { TaskEngine } from '../dist/core/TaskEngine.js';

// Simple output formatter
function formatOutput(status) {
  if (status.progress.currentTurn !== formatOutput.lastTurn) {
    console.log(`\n🔄 Turn ${status.progress.currentTurn} (${status.progress.percentage}%)`);
    formatOutput.lastTurn = status.progress.currentTurn;
  }

  if (status.llmStream?.isComplete && status.llmStream?.partialText) {
    const text = status.llmStream.partialText.trim();
    if (text && text !== '[object Object]' && !formatOutput.shownTexts.has(status.progress.currentTurn)) {
      console.log(`💬 Claude Response: ${text.substring(0, 500)}${text.length > 500 ? '...' : ''}`);
      formatOutput.shownTexts.add(status.progress.currentTurn);
    }
  }

  if (status.toolCalls.length > 0) {
    status.toolCalls.forEach(call => {
      if (!formatOutput.shownTools.has(call.callId)) {
        console.log(`🔧 Tool: ${call.name} - ${call.status}`);
        formatOutput.shownTools.add(call.callId);
      }
      // Always check for updated results (tool might have been updated)
      if (call.result && call.status === 'completed' && !formatOutput.shownResults.has(call.callId)) {
        console.log(`   Result: ${call.result.substring(0, 100)}${call.result.length > 100 ? '...' : ''}`);
        formatOutput.shownResults.add(call.callId);
      }
    });
  }
}

// Initialize static properties for formatter
formatOutput.lastTurn = -1;
formatOutput.shownTexts = new Set();
formatOutput.shownTools = new Set();
formatOutput.shownResults = new Set();

async function testNaturalCompletionNoStrategy() {
  console.log('🧪 Testing TaskEngine natural completion (no strategy)...\n');

  const taskEngine = new TaskEngine({
    model: 'claude-3-5-sonnet-20241022',
    maxTurns: 10,
    workingDirectory: process.cwd(),
    sessionId: `test-no-strategy-${Date.now()}`,
    approvalMode: 'auto',
    onStatusUpdate: formatOutput
  });

  // No strategy provided - TaskEngine should rely on Claude Code SDK natural completion
  
  const request = {
    sessionId: `test-no-strategy-${Date.now()}`,
    name: 'Natural Completion Test',
    description: 'Test natural completion without strategy',
    prompt: 'List the files in the current directory using ls command',
    type: 'assistant'
  };

  try {
    console.log('📋 Starting task without strategy...');
    const result = await taskEngine.executeTask(request);
    
    console.log('\n✅ Task completed naturally!');
    console.log(`📊 Final status: ${result.status}`);
    console.log(`🔄 Turns taken: ${result.turnCount}`);
    console.log(`⏱️  Duration: ${result.duration}ms`);
    console.log(`🛠️  Tool calls: ${result.toolCallsCount}`);
    
    if (result.error) {
      console.log(`❌ Error: ${result.error}`);
    }
    
    if (result.result) {
      console.log(`📝 Result preview: ${result.result.substring(0, 200)}...`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testNaturalCompletionNoStrategy().catch(console.error);