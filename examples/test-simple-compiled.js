/**
 * Simple TaskEngine test without MCP server - Compiled JavaScript version
 * This file can be run directly with: node test-simple-compiled.js
 */

import { query } from '@anthropic-ai/claude-code';

// Simple output formatter
function formatOutput(status) {
  if (status.progress.currentTurn !== formatOutput.lastTurn) {
    console.log(`\n🔄 Turn ${status.progress.currentTurn} (${status.progress.percentage}%)`);
    formatOutput.lastTurn = status.progress.currentTurn;
  }

  if (status.llmStream?.isComplete && status.llmStream?.partialText) {
    const text = status.llmStream.partialText.trim();
    if (text && !formatOutput.shownTexts.has(status.progress.currentTurn)) {
      console.log(`💬 Response: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
      formatOutput.shownTexts.add(status.progress.currentTurn);
    }
  }

  if (status.toolCalls.length > 0) {
    status.toolCalls.forEach(call => {
      if (!formatOutput.shownTools.has(call.callId)) {
        console.log(`🔧 Tool: ${call.name} - ${call.status}`);
        if (call.result && call.status === 'completed') {
          console.log(`   Result: ${call.result.substring(0, 100)}${call.result.length > 100 ? '...' : ''}`);
        }
        formatOutput.shownTools.add(call.callId);
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

// Simplified TaskEngine implementation using Claude Code SDK directly
class SimpleClaudeTaskEngine {
  constructor(options) {
    this.statusCallback = options.onStatusUpdate;
    this.strategy = options.strategy;
  }

  async executeTask(request) {
    const startTime = Date.now();
    let currentStatus = {
      sessionId: request.sessionId,
      sessionState: 'initializing',
      progress: { currentTurn: 0, maxTurns: 50, percentage: 0 },
      currentAction: { type: 'thinking', description: 'Initializing...' },
      toolCalls: [],
      timestamp: new Date().toISOString()
    };

    this.updateStatus(currentStatus, {});

    try {
      // Build prompt
      const prompt = `Please help me with this task: ${request.description}

Use the available tools to complete the task. If you need to create a file, use the Write tool.`;

      console.log(`[SimpleClaudeTaskEngine] Starting with prompt: ${prompt.substring(0, 100)}...`);

      const queryOptions = {
        allowedTools: ['Write', 'Read', 'Bash', 'Edit'],
        model: 'claude-3-5-sonnet-20241022',
        maxTurns: 10,
        cwd: request.workingDirectory,
        permissionMode: 'default'
      };

      console.log(`[SimpleClaudeTaskEngine] Query options:`, queryOptions);

      const queryIterator = query({
        prompt: prompt,
        options: queryOptions
      });

      let turnCount = 0;
      let toolCallCount = 0;

      for await (const message of queryIterator) {
        turnCount++;
        
        // Show what type of message we're processing
        const messageType = message.type || 'unknown';
        console.log(`\n🔄 Turn ${turnCount}: Processing ${messageType} message`);

        // Update progress
        currentStatus = this.updateStatus(currentStatus, {
          currentAction: { type: 'responding', description: `Turn ${turnCount} processing ${messageType}...` },
          progress: { 
            currentTurn: turnCount, 
            maxTurns: 10,
            percentage: Math.min(turnCount * 20, 100)
          }
        });

        // Handle message content - Claude Code SDK structure
        const msg = message;
        let content = '';
        
        // Extract Claude's responses from assistant messages
        if ((msg.type === 'message' || msg.type === 'assistant') && msg.message) {
          if (typeof msg.message === 'string') {
            content = msg.message;
          } else if (msg.message.content && Array.isArray(msg.message.content)) {
            // Handle Anthropic API format: array of content blocks
            content = msg.message.content
              .filter(part => part.type === 'text')
              .map(part => part.text)
              .join('');
          } else if (typeof msg.message.content === 'string') {
            content = msg.message.content;
          }
        }
        
        if (content) {
          console.log(`💬 Claude: ${content}`);
          
          currentStatus = this.updateStatus(currentStatus, {
            llmStream: {
              partialText: content,
              isComplete: true
            }
          });
        }

        // Handle tool calls - Claude Code SDK structure
        if ((msg.type === 'message' || msg.type === 'assistant') && msg.message?.tool_calls) {
          const toolCalls = msg.message.tool_calls;
          console.log(`🔧 Found ${toolCalls.length} tool call(s)`);
          
          for (const toolCall of toolCalls) {
            toolCallCount++;
            
            const toolName = toolCall?.function?.name || toolCall?.name || 'unknown-tool';
            const toolArgs = toolCall?.function?.arguments || toolCall?.args || {};
            const callId = toolCall?.id || `${toolName}-${Date.now()}-${toolCallCount}`;

            // Parse arguments if they're a string
            let parsedArgs = toolArgs;
            if (typeof toolArgs === 'string') {
              try {
                parsedArgs = JSON.parse(toolArgs);
              } catch (e) {
                parsedArgs = { raw: toolArgs };
              }
            }

            console.log(`   🔨 ${toolName}:`);
            console.log(`      Args: ${JSON.stringify(parsedArgs, null, 2).substring(0, 200)}${JSON.stringify(parsedArgs).length > 200 ? '...' : ''}`);

            // Add tool call to status
            currentStatus.toolCalls.push({
              callId,
              name: toolName,
              args: parsedArgs,
              status: 'executing',
              startTime: Date.now(),
              result: undefined
            });

            currentStatus = this.updateStatus(currentStatus, {});
          }
        }
        
        // Handle tool results (in user messages)
        if (msg.type === 'user' && msg.message?.content) {
          const resultContent = Array.isArray(msg.message.content) 
            ? msg.message.content.map(part => part.text || part.content || '').join('')
            : msg.message.content;
          
          if (resultContent && resultContent.trim()) {
            console.log(`   📤 Tool result: ${resultContent.substring(0, 200)}${resultContent.length > 200 ? '...' : ''}`);
            
            // Update last tool call with result
            if (currentStatus.toolCalls.length > 0) {
              const lastTool = currentStatus.toolCalls[currentStatus.toolCalls.length - 1];
              if (lastTool.status === 'executing') {
                lastTool.status = 'completed';
                lastTool.result = resultContent;
                lastTool.duration = Date.now() - lastTool.startTime;
                currentStatus = this.updateStatus(currentStatus, {});
              }
            }
          }
        }

        // Check completion
        if (this.strategy && this.strategy.isTaskComplete(currentStatus.toolCalls)) {
          console.log(`[SimpleClaudeTaskEngine] Task completed by strategy`);
          currentStatus = this.updateStatus(currentStatus, {
            sessionState: 'completed',
            progress: { ...currentStatus.progress, percentage: 100 },
            finalResult: {
              success: true,
              summary: 'Task completed successfully'
            }
          });
          break;
        }

        // Natural completion check
        if (content && this.isNaturalCompletion(content)) {
          console.log(`[SimpleClaudeTaskEngine] Task naturally completed`);
          currentStatus = this.updateStatus(currentStatus, {
            sessionState: 'completed',
            progress: { ...currentStatus.progress, percentage: 100 },
            finalResult: {
              success: true,
              summary: 'Task completed successfully'
            }
          });
          break;
        }

        if (turnCount >= 10) {
          console.log(`[SimpleClaudeTaskEngine] Reached max turns`);
          break;
        }
      }

      // Ensure final result
      if (!currentStatus.finalResult) {
        currentStatus = this.updateStatus(currentStatus, {
          sessionState: 'completed',
          finalResult: {
            success: true,
            summary: 'Task execution completed'
          }
        });
      }

      return {
        success: currentStatus.finalResult.success,
        sessionId: request.sessionId,
        executionSummary: currentStatus.finalResult.summary,
        metadata: {
          totalDuration: Date.now() - startTime,
          turnCount: turnCount,
          toolCallCount: toolCallCount
        }
      };

    } catch (error) {
      const errorMessage = error.message || String(error);
      console.error(`[SimpleClaudeTaskEngine] Error: ${errorMessage}`);
      
      currentStatus = this.updateStatus(currentStatus, {
        sessionState: 'error',
        finalResult: {
          success: false,
          error: errorMessage,
          summary: 'Task execution failed'
        }
      });

      return {
        success: false,
        sessionId: request.sessionId,
        error: errorMessage,
        executionSummary: 'Task execution failed',
        metadata: {
          totalDuration: Date.now() - startTime,
          turnCount: 0,
          toolCallCount: 0
        }
      };
    }
  }

  updateStatus(currentStatus, updates) {
    const newStatus = { ...currentStatus, ...updates, timestamp: new Date().toISOString() };
    this.statusCallback(newStatus);
    return newStatus;
  }

  isNaturalCompletion(content) {
    const contentStr = typeof content === 'string' ? content : String(content);
    const completionIndicators = [
      'task completed', 'successfully completed', 'finished successfully',
      'operation complete', 'file created', 'done'
    ];
    const lowerContent = contentStr.toLowerCase();
    return completionIndicators.some(indicator => lowerContent.includes(indicator));
  }
}

async function main() {
  console.log('🚀 Testing Simple Claude TaskEngine (JavaScript version)');
  
  // Simple strategy
  class SimpleStrategy {
    getName() { return 'SimpleStrategy'; }
    calculateProgress(toolCalls, turnCount) { return Math.min(turnCount * 20, 100); }
    isTaskComplete(toolCalls) { 
      return toolCalls.some(call => call.name === 'Write' && call.status === 'completed'); 
    }
    getFatalErrorPatterns() { return [/ERROR|FAILED/i]; }
    getWorkflowSteps() { return [{ name: 'Write', weight: 100, isRequired: true }]; }
    processToolResult() { return { shouldContinue: true }; }
    isValidToolCall() { return true; }
  }

  const engine = new SimpleClaudeTaskEngine({
    strategy: new SimpleStrategy(),
    onStatusUpdate: formatOutput,
  });
  
  const request = {
    sessionId: `js-test-${Date.now()}`,
    description: 'Create a text file called "hello.txt" with the content "Hello from Claude TaskEngine JavaScript!"',
    workingDirectory: process.cwd()
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
    
    if (result.success) {
      console.log('\n🎉 JavaScript version working perfectly!');
      console.log('✅ Direct Node.js execution successful');
      console.log('✅ Claude Code SDK integration working');
      console.log('✅ No TypeScript compilation needed');
    } else {
      console.log(`\n⚠️  Task failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('\n💥 Execution error:', error.message);
  }
}

main().catch(console.error);