/**
 * @license
 * Copyright 2025 AIZGC Team
 * SPDX-License-Identifier: MIT
 */

import { query } from '@anthropic-ai/claude-code';
import { TaskRequest, TaskStatus, TaskResult, TaskEngineOptions } from '../types/types.js';
import type { TaskStrategy, ConfigurationBuilder, PromptStrategy } from '../types/claude-interfaces.js';
import { TaskStatusEvent, TaskEventCallback } from '../types/events.js';
import { ClaudeConfigurationBuilder } from '../builders/ClaudeConfigurationBuilder.js';
import { SimplePromptBuilder } from '../builders/SimplePromptBuilder.js';

export class TaskEngine {
  private eventCallback: TaskEventCallback;
  private configBuilder: ConfigurationBuilder;
  private promptBuilder: SimplePromptBuilder;
  private strategy?: TaskStrategy;

  private startTime = 0;
  private sessionTurnCount = 0;
  private currentSessionId = '';
  private readonly MAX_TURNS = 200;

  // Track tools for result processing
  private pendingTools: Map<string, { name: string; startTime: number }> = new Map();

  constructor(options: TaskEngineOptions) {
    this.eventCallback = options.onEvent;
    this.configBuilder = options.configBuilder || new ClaudeConfigurationBuilder();
    this.promptBuilder = new SimplePromptBuilder(options.promptStrategy);
    this.strategy = options.strategy;
  }

  async executeTask(request: TaskRequest): Promise<TaskResult> {
    this.startTime = Date.now();
    this.currentSessionId = request.sessionId;
    
    // Send initialization event
    this.emitEvent({
      progress: { currentTurn: 0, maxTurns: 50, percentage: 0 },
      currentAction: { type: 'thinking', description: 'Starting task execution...' }
    });

    try {
      return await this.executeTaskInternal(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Send error completion event
      this.emitEvent({
        completion: {
          success: false,
          error: errorMessage,
          summary: 'Task execution failed: ' + errorMessage
        }
      });
      
      return {
        success: false,
        sessionId: request.sessionId,
        error: errorMessage,
        executionSummary: 'Error occurred during execution',
        metadata: {
          totalDuration: Date.now() - this.startTime,
          turnCount: this.sessionTurnCount,
          toolCallCount: 0 // TODO: track this in event-driven mode
        }
      };
    }
  }

  private async executeTaskInternal(request: TaskRequest): Promise<TaskResult> {
    // Send task start event
    // this.emitEvent({
    //   currentAction: { type: 'thinking', description: 'Starting task execution...' }
    // });

    // Build the initial prompt
    const config = await this.configBuilder.buildConfiguration(request);
    const initialPrompt = await this.promptBuilder.buildPrompt(request, config);
    
    let turnCount = 0;
    let finalSuccess = true;
    let executionError: string | undefined;

    try {
      // Configure MCP servers for Claude Code
      const mcpServers = this.configureMCPServers(request);
      
      // Use Claude Code SDK query function
      const queryOptions: any = {
        model: config.model,
        maxTurns: config.maxTurns,
        cwd: config.workingDirectory,
        permissionMode: 'bypassPermissions' as const // Allow all tools without user prompts
      };

      // Only add allowedTools if client explicitly specifies tools
      if (config.tools && config.tools.length > 0) {
        queryOptions.allowedTools = config.tools;
      }
      // If config.tools is undefined/empty, Claude Code SDK will allow all tools

      // Add API key only if explicitly provided
      if (config.apiKey && config.apiKey.trim()) {
        queryOptions.anthropicApiKey = config.apiKey;
      }
      // Otherwise Claude Code SDK will use local authentication

      // Add MCP servers if configured
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        queryOptions.mcpServers = mcpServers;
      }

      // console.log(`[TaskEngine] Starting query with prompt length: ${initialPrompt.length}`);
      // console.log(`[TaskEngine] Query options:`, { 
      //   ...queryOptions, 
      //   mcpServers: mcpServers ? `${Object.keys(mcpServers).length} server(s)` : 'none' 
      // });
      
      const queryIterator = query({
        prompt: initialPrompt,
        options: queryOptions
      });
      
      for await (const message of queryIterator) {
        turnCount++;
        this.sessionTurnCount++;
        
        // Cast message to any to work with SDK's dynamic message format
        const msg = message as any;
        
        // Show what type of message we're processing
        const messageType = msg.type || 'unknown';
        // console.log(`\n🔄 Turn ${this.sessionTurnCount}: Processing ${messageType} message`);
        
        // Check turn limits
        if (this.sessionTurnCount > this.MAX_TURNS) {
          executionError = `Reached hard turn limit (${this.MAX_TURNS}).`;
          finalSuccess = false;
          break;
        }

        // Determine action type more accurately
        let actionType: 'thinking' | 'tool_executing' | 'responding' = 'thinking';
        let actionDescription = `Turn ${this.sessionTurnCount} processing...`;
        
        if (msg.type === 'assistant' || msg.type === 'message') {
          // Check if this assistant message has text content
          const hasTextContent = msg.message?.content && Array.isArray(msg.message.content) 
            ? msg.message.content.some((block: any) => block.type === 'text' && block.text?.trim())
            : false;
          
          // Check if this assistant message has tool calls
          const hasToolCalls = msg.message?.content && Array.isArray(msg.message.content)
            ? msg.message.content.some((block: any) => block.type === 'tool_use')
            : false;
            
          if (hasTextContent && hasToolCalls) {
            actionType = 'responding';
            actionDescription = `Turn ${this.sessionTurnCount} responding with tools...`;
          } else if (hasTextContent) {
            actionType = 'responding'; 
            actionDescription = `Turn ${this.sessionTurnCount} responding...`;
          } else if (hasToolCalls) {
            actionType = 'tool_executing';
            actionDescription = `Turn ${this.sessionTurnCount} executing tools...`;
          }
        } else {
          const hasContent = msg.content || msg.text || msg.message;
          if (hasContent) {
            actionType = 'responding';
            actionDescription = `Turn ${this.sessionTurnCount} responding...`;
          }
        }

        // Send progress and action update event
        this.emitEvent({
          currentAction: { 
            type: actionType, 
            description: actionDescription
          },
          progress: { 
            currentTurn: this.sessionTurnCount, 
            maxTurns: this.MAX_TURNS,
            percentage: this.calculateProgress() 
          }
        });

        // Handle different message types
        if (msg.type === 'system') {
          this.handleSystemMessage(msg);
        } else if (msg.type === 'result') {
          this.handleResultMessage(msg);
        } else {
          this.handleClaudeMessage(msg);
        }

        // Handle tool calls - Claude Code SDK structure
        // console.log(`   🔍 Checking for tool calls in ${msg.type} message...`);
        if (msg.message) {
          // console.log(`   📦 Message object keys: [${Object.keys(msg.message).join(', ')}]`);
          if (msg.message.tool_calls) {
            // console.log(`   🎯 tool_calls found: ${msg.message.tool_calls.length}`);
          } else {
            // console.log(`   ❌ No tool_calls property in message`);
          }
          
          // Check if content contains tool_use blocks (Anthropic API format)
          if (msg.message.content && Array.isArray(msg.message.content)) {
            // console.log(`   📋 Content blocks: ${msg.message.content.length}`);
            msg.message.content.forEach((block: any, i: number) => {
              // console.log(`      Block ${i}: type=${block.type}, keys=[${Object.keys(block).join(', ')}]`);
              if (block.type === 'tool_use') {
                // console.log(`         🔧 TOOL USE: ${block.name} with input: ${JSON.stringify(block.input).substring(0, 100)}`);
              }
            });
          }
        } else {
          // console.log(`   ❌ No message property in ${msg.type}`);
        }
        
        // Handle tool calls - Anthropic API format (in content blocks)
        if ((msg.type === 'assistant' || msg.type === 'message') && msg.message?.content && Array.isArray(msg.message.content)) {
          const toolUseBlocks = msg.message.content.filter((block: any) => block.type === 'tool_use');
          if (toolUseBlocks.length > 0) {
            // console.log(`🔧 Found ${toolUseBlocks.length} tool call(s)`);
            
            for (const toolCall of toolUseBlocks) {
              // Check if this is a TodoWrite tool call
              if (toolCall.name === 'TodoWrite') {
                this.handleTodoWrite(toolCall);
              } else {
                this.handleToolCall(toolCall);
              }
            }
          }
        }
        
        // Handle tool results (in user messages)
        if (msg.type === 'user' && msg.message?.content) {
          const resultContent = Array.isArray(msg.message.content) 
            ? msg.message.content.map((part: any) => part.text || part.content || '').join('')
            : msg.message.content;
          
          if (resultContent && resultContent.trim()) {
            // Find the most recent pending tool
            const pendingEntries = Array.from(this.pendingTools.entries());
            if (pendingEntries.length > 0) {
              const [toolId, toolInfo] = pendingEntries[pendingEntries.length - 1];
              
              // Send tool result event
              this.emitEvent({
                toolResult: {
                  id: toolId,
                  result: resultContent,
                  status: resultContent.includes('error') ? 'error' : 'completed',
                  duration: Date.now() - toolInfo.startTime
                }
              });
              
              // Remove from pending
              this.pendingTools.delete(toolId);
            }
          }
        }

        // TODO: Implement strategy-based completion check in event-driven mode
        // For now, we rely on Claude Code SDK's natural completion

        // Check for natural completion indicators
        let messageContent = '';
        if ((msg.type === 'assistant' || msg.type === 'message') && msg.message?.content && Array.isArray(msg.message.content)) {
          messageContent = msg.message.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join('');
        }
        
        if (messageContent && this.isNaturalCompletion(messageContent)) {
          console.log(`[TaskEngine] Natural completion detected in message: "${messageContent.substring(0, 100)}"`);
          this.emitEvent({
            completion: {
              success: true,
              summary: 'Task completed successfully'
            }
          });
          finalSuccess = true;
          break;
        }
      }
      
      console.log(`[TaskEngine] Query iterator naturally completed after ${turnCount} turns`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // console.log(`[TaskEngine] Caught error in main execution loop: ${errorMessage}`);
      executionError = errorMessage;
      finalSuccess = false;
    }

    // Send final completion event
    if (finalSuccess && !executionError) {
      this.emitEvent({
        completion: {
          success: true,
          summary: 'Task execution completed'
        }
      });
    }

    // Build final result
    const finalResult: TaskResult = {
      success: finalSuccess,
      sessionId: request.sessionId,
      outputPath: undefined, // TODO: Track output path in event-driven mode
      executionSummary: executionError || 'Task execution completed',
      error: executionError,
      metadata: {
        totalDuration: Date.now() - this.startTime,
        turnCount: this.sessionTurnCount,
        toolCallCount: this.pendingTools.size // Number of tools processed
      }
    };

    // console.log(`[TaskEngine] Returning final result: ${JSON.stringify(finalResult, null, 2)}`);
    return finalResult;
  }

  private configureMCPServers(request: TaskRequest): Record<string, any> | undefined {
    if (!request.mcpServerUrl) {
      return undefined;
    }

    const serverName = request.mcpServerName || 'default-mcp-server';
    return {
      [serverName]: {
        type: 'sse', // SSE transport type for Server-Sent Events
        url: request.mcpServerUrl,
        description: request.mcpDescription || 'Task MCP Server',
        timeout: request.mcpTimeout || 60000
      }
    };
  }

  private isNaturalCompletion(content: any): boolean {
    const completionIndicators = [
      'task completed',
      'successfully completed',
      'finished successfully',
      'operation complete',
      'export_program completed',
      'export_binary completed',
      'save_program completed'
    ];
    
    const contentStr = typeof content === 'string' ? content : String(content);
    const lowerContent = contentStr.toLowerCase();
    return completionIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private handleSystemMessage(message: any): void {
    // Extract system message information
    const systemInfo = {
      model: message.model || 'unknown',
      cwd: message.cwd || 'unknown',
      sessionId: message.session_id || this.currentSessionId,
      tools: message.tools || [],
      mcpServers: message.mcp_servers ? Object.keys(message.mcp_servers) : undefined,
      permissionMode: message.permissionMode || 'unknown'
    };

    this.emitEvent({
      systemMessage: systemInfo
    });
  }

  private handleResultMessage(message: any): void {
    // Extract result message information
    const resultInfo = {
      duration: message.duration_ms || 0,
      apiDuration: message.duration_api_ms || 0,
      turns: message.num_turns || 0,
      totalCost: message.total_cost_usd || 0,
      usage: {
        inputTokens: message.usage?.input_tokens || 0,
        outputTokens: message.usage?.output_tokens || 0
      },
      permissionDenials: message.permission_denials || 0
    };

    this.emitEvent({
      resultMessage: resultInfo
    });
  }

  private handleClaudeMessage(message: any): void {
    let content = '';
    
    // Claude Code SDK message structure: type: 'assistant' messages contain actual Claude responses
    if ((message.type === 'assistant' || message.type === 'message') && message.message) {
      if (message.message.content && Array.isArray(message.message.content)) {
        // Anthropic API format: array of content blocks
        content = message.message.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join('');
      } else if (typeof message.message.content === 'string') {
        content = message.message.content;
      } else if (typeof message.message === 'string') {
        content = message.message;
      }
    }
    
    if (content && content.trim()) {
      // Send LLM response event
      this.emitEvent({
        llmResponse: {
          text: content,
          isComplete: true
        }
      });
    }
  }

  private handleToolCall(toolCall: any): void {
    // Anthropic API tool call structure: {type: 'tool_use', id: '...', name: '...', input: {...}}
    const toolName = toolCall?.name || 'unknown-tool';
    const toolArgs = toolCall?.input || {};
    const toolId = toolCall?.id || `${toolName}-${Date.now()}`;
    
    // console.log(`   🔨 ${toolName}:`);
    // console.log(`      ID: ${toolId}`);
    // console.log(`      Input: ${JSON.stringify(toolArgs, null, 2).substring(0, 200)}${JSON.stringify(toolArgs).length > 200 ? '...' : ''}`);
    
    const callId = toolId;
    const startTime = Date.now();

    // Track this tool for result processing
    this.pendingTools.set(toolId, { name: toolName, startTime });
    
    // Send tool start event
    this.emitEvent({
      toolStart: {
        id: toolId,
        name: toolName,
        args: toolArgs
      }
    });

    // Process tool result if available
    if (toolCall.result) {
      // Process tool result using strategy if available
      if (this.strategy) {
        const processingResult = this.strategy.processToolResult({
          callId,
          name: toolCall.name,
          args: toolCall.args || {},
          status: 'completed',
          startTime
        }, {
          resultDisplay: toolCall.result
        });

        // TODO: Handle strategy processing result in event-driven mode
        // For now, we skip strategy-specific processing
      }

      // Send immediate tool result event
      this.emitEvent({
        toolResult: {
          id: toolId,
          result: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
          status: 'completed',
          duration: Date.now() - startTime
        }
      });
    }
  }


  private handleTodoWrite(toolCall: any): void {
    // Also handle it as a regular tool call for tracking
    this.handleToolCall(toolCall);
        
    // Extract todo list from TodoWrite tool call
    const toolArgs = toolCall?.input || {};
    const todos = toolArgs.todos || [];
    
    // Send todo update event
    this.emitEvent({
      todo: {
        todos: todos
      }
    });
  }

  private calculateProgress(): number {
    // Simple turn-based progress calculation
    return Math.min((this.sessionTurnCount / this.MAX_TURNS) * 95, 95);
  }

  async abort(): Promise<void> {
    this.emitEvent({
      completion: {
        success: false,
        error: 'User cancelled',
        summary: 'Task was actively cancelled by user'
      }
    });
  }

  /**
   * Emit a composite event with multiple updates
   */
  private emitEvent(updates: TaskStatusEvent['updates']): void {
    const event: TaskStatusEvent = {
      turn: this.sessionTurnCount,
      timestamp: new Date().toISOString(),
      sessionId: this.currentSessionId,
      updates
    };
    
    this.eventCallback(event);
  }
}