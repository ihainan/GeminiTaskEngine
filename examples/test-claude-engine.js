/**
 * Simple test for ClaudeTaskEngine concept validation
 */

import { query } from '@anthropic-ai/claude-code';

console.log('🔧 Testing Claude Code SDK integration...');

// Test basic query functionality
async function testBasicQuery() {
  try {
    console.log('📝 Testing basic query...');
    
    const queryIterator = query({
      prompt: 'List the files in the current directory using ls',
      options: {
        allowedTools: ['Bash', 'Read', 'LS'],
        maxTurns: 3,
        permissionMode: 'default'
      }
    });

    let turnCount = 0;
    for await (const message of queryIterator) {
      turnCount++;
      console.log(`📨 Turn ${turnCount}: Received message type: ${message.type || 'unknown'}`);
      
      if (message.content) {
        console.log(`💬 Content: ${message.content.substring(0, 200)}...`);
      }
      
      if (message.toolCalls) {
        console.log(`🛠️  Tool calls: ${message.toolCalls.length}`);
        for (const tool of message.toolCalls) {
          console.log(`   - ${tool.name}: ${JSON.stringify(tool.args).substring(0, 100)}`);
        }
      }
      
      // Limit test to 3 turns
      if (turnCount >= 3) {
        console.log('🔄 Stopping test after 3 turns');
        break;
      }
    }
    
    console.log('✅ Basic query test completed successfully');
    return true;
  } catch (error) {
    console.error('❌ Basic query test failed:', error.message);
    return false;
  }
}

// Test with task-like structure
async function testTaskLikeQuery() {
  try {
    console.log('📋 Testing task-like query...');
    
    const taskPrompt = `
Task: Create a simple text file with hello world content

Requirements:
1. Create a file named "test-output.txt"
2. Write "Hello from Claude Task Engine!" to the file
3. Verify the file was created successfully

Please complete this task step by step.
`;

    const queryIterator = query({
      prompt: taskPrompt,
      options: {
        allowedTools: ['Write', 'Read', 'Bash'],
        maxTurns: 5,
        permissionMode: 'default'
      }
    });

    let turnCount = 0;
    let taskCompleted = false;
    const toolCalls = [];

    for await (const message of queryIterator) {
      turnCount++;
      console.log(`📨 Task Turn ${turnCount}:`);
      
      if (message.content) {
        console.log(`💭 Thinking: ${message.content.substring(0, 150)}...`);
      }
      
      if (message.toolCalls) {
        for (const tool of message.toolCalls) {
          console.log(`🔧 Tool: ${tool.name} - ${JSON.stringify(tool.args).substring(0, 100)}`);
          toolCalls.push(tool);
          
          // Check if this looks like task completion
          if (tool.name === 'Write' && tool.args?.file_path?.includes('test-output.txt')) {
            console.log('✨ Detected file creation - task may be completing!');
          }
        }
      }
      
      // Check for task completion patterns
      if (message.content && 
          (message.content.includes('completed') || 
           message.content.includes('successfully') ||
           message.content.includes('done'))) {
        console.log('🎉 Task appears to be completed based on content!');
        taskCompleted = true;
      }
      
      // Limit test
      if (turnCount >= 5 || taskCompleted) {
        console.log(`🏁 Stopping task test after ${turnCount} turns`);
        break;
      }
    }
    
    console.log(`📊 Task Test Summary:`);
    console.log(`   - Turns: ${turnCount}`);
    console.log(`   - Tool calls: ${toolCalls.length}`);
    console.log(`   - Completed: ${taskCompleted}`);
    
    return { success: true, turnCount, toolCalls: toolCalls.length, completed: taskCompleted };
  } catch (error) {
    console.error('❌ Task-like query test failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Claude Code SDK validation tests...\n');
  
  // Check environment
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ℹ️  No ANTHROPIC_API_KEY set, will use local Claude Code authentication');
  } else {
    console.log('ℹ️  Using provided ANTHROPIC_API_KEY');
  }
  
  const results = {
    basicQuery: await testBasicQuery(),
    taskQuery: await testTaskLikeQuery()
  };
  
  console.log('\n📋 Test Results Summary:');
  console.log(`   - Basic Query: ${results.basicQuery ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`   - Task Query: ${results.taskQuery.success ? '✅ PASSED' : '❌ FAILED'}`);
  
  if (results.taskQuery.success) {
    console.log(`   - Task completed: ${results.taskQuery.completed ? '🎉 YES' : '⏳ NO'}`);
    console.log(`   - Tool calls made: ${results.taskQuery.toolCalls}`);
    console.log(`   - Turns taken: ${results.taskQuery.turnCount}`);
  }
  
  const allPassed = results.basicQuery && results.taskQuery.success;
  console.log(`\n🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (allPassed) {
    console.log('🚀 Claude Code SDK integration is working! Ready for TaskEngine integration.');
  } else {
    console.log('🔧 Need to fix issues before proceeding with TaskEngine integration.');
  }
  
  process.exit(allPassed ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('💥 Test runner crashed:', error);
  process.exit(1);
});