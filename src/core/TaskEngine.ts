/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  ToolRegistry,
  ApprovalMode,
  AuthType,
  shutdownTelemetry,
  isTelemetrySdkInitialized
} from '@google/gemini-cli-core';
// Import checkNextSpeaker from internal path since it's not exported in public API
import { checkNextSpeaker } from '@google/gemini-cli-core/dist/src/utils/nextSpeakerChecker.js';
import type {
  Content,
  FunctionCall,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import { TaskRequest, TaskStatus, TaskResult, TaskEngineOptions, ThoughtSummary } from '../types/types.js';
import type { TaskStrategy, ConfigurationBuilder, PromptStrategy } from '../types/interfaces.js';
import { DefaultConfigurationBuilder, SimplePromptBuilder } from '../builders/index.js';

export class TaskEngine {
  private config!: Config;
  private currentStatus!: TaskStatus;
  private statusCallback: (status: TaskStatus) => void;
  private configBuilder: ConfigurationBuilder;
  private promptBuilder: SimplePromptBuilder;
  private strategy?: TaskStrategy;

  private startTime = 0;
  private sessionTurnCount = 0;
  private readonly MAX_TURNS = 100; // Hard limit from GeminiClient

  constructor(options: TaskEngineOptions) {
    this.statusCallback = options.onStatusUpdate;
    this.configBuilder = options.configBuilder || new DefaultConfigurationBuilder();
    this.promptBuilder = new SimplePromptBuilder(options.promptStrategy);
    this.strategy = options.strategy;
  }

  async executeTask(request: TaskRequest): Promise<TaskResult> {
    this.startTime = Date.now();
    
    // Initialize status
    this.currentStatus = {
      sessionId: request.sessionId,
      sessionState: 'initializing',
      progress: { currentTurn: 0, maxTurns: 50, percentage: 0 },
      currentAction: { type: 'thinking', description: 'Initializing...' },
      toolCalls: [],
      timestamp: new Date().toISOString()
    };
    
    this.updateStatus({});

    try {
      return await this.executeTaskInternal(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateStatus({
        sessionState: 'error',
        finalResult: {
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
          turnCount: this.currentStatus.progress.currentTurn,
          toolCallCount: this.currentStatus.toolCalls.length
        }
      };
    }
  }

  private async executeTaskInternal(request: TaskRequest): Promise<TaskResult> {
    // Helper function to determine if a tool error is fatal
    const isFatalToolError = (msg: string): boolean => {
      if (this.strategy) {
        const patterns = this.strategy.getFatalErrorPatterns();
        return patterns.some(pattern => pattern.test(msg));
      }
      // Default patterns if no strategy
      return /(ECONN|ETIMEDOUT|auth|permission|timeout|ECONNREFUSED)/i.test(msg);
    };

    // 1. Build configuration using configBuilder
    this.config = await this.configBuilder.buildConfiguration(request);
    await this.config.initialize();
    
    // 2. Initialize authentication and client
    await this.config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
    const geminiClient = this.config.getGeminiClient();
    const toolRegistry: ToolRegistry = await this.config.getToolRegistry();
    
    this.updateStatus({
      sessionState: 'running',
      currentAction: { type: 'thinking', description: 'Starting task execution...' }
    });

    // 3. Fully reuse main loop logic from nonInteractiveCli.ts
    const chat = await geminiClient.getChat();
    const abortController = new AbortController();
    const initialPrompt = await this.promptBuilder.buildPrompt(request, this.config);
    let currentMessages: Content[] = [{ 
      role: 'user', 
      parts: [{ text: initialPrompt }] 
    }];
    
    let turnCount = 0;
    let finalSuccess = true;
    let executionError: string | undefined;

    try {
      taskLoop: while (true) {
        turnCount++;
        this.sessionTurnCount++;
        
        // Use GeminiClient-style session management with both soft and hard limits
        const maxSessionTurns = this.config.getMaxSessionTurns();
        if (maxSessionTurns > 0 && this.sessionTurnCount > maxSessionTurns) {
          executionError = 'Reached max session turns for this session.';
          finalSuccess = false;
          break taskLoop;
        }
        
        // Hard limit from GeminiClient to prevent infinite loops
        if (turnCount > this.MAX_TURNS) {
          executionError = `Reached hard turn limit (${this.MAX_TURNS}).`;
          finalSuccess = false;
          break taskLoop;
        }

        // Status update - clear previous turn's llmStream to prevent content leakage
        this.updateStatus({
          currentAction: { type: 'thinking', description: `Turn ${this.sessionTurnCount} thinking...` },
          progress: { 
            currentTurn: this.sessionTurnCount, 
            maxTurns: Math.min(this.config.getMaxSessionTurns() || 50, this.MAX_TURNS),
            percentage: this.calculateProgress() 
          },
          llmStream: undefined  // Clear previous turn's stream content
        });
        
        const functionCalls: FunctionCall[] = [];

        const responseStream = await chat.sendMessageStream(
          {
            message: currentMessages[0]?.parts || [], // Ensure parts are always provided
            config: {
              abortSignal: abortController.signal,
              // Restore tools - they may be necessary for proper response formatting
              tools: [
                { functionDeclarations: toolRegistry.getFunctionDeclarations() },
              ],
              // Allow internal thinking but hide thought output to prevent fragmented text
              thinkingConfig: {
                includeThoughts: false    // Don't include thought summaries in response
                // Keep thinkingBudget at default - model can still think internally
              },
            },
          },
          request.sessionId,
        );

        let hasStreamContent = false;
        let accumulatedText = '';
        
        for await (const resp of responseStream) {
          if (abortController.signal.aborted) {
            executionError = 'Operation cancelled.';
            finalSuccess = false;
            break taskLoop;
          }          
          
          // Follow Gemini CLI pattern: validate response first
          if (!this.isValidResponse(resp)) {
            continue;
          }
          
          // Accumulate text like CLI but send complete content
          const textContent = this.getTextContent(resp);
          if (textContent) {
            hasStreamContent = true;
            accumulatedText += textContent; // Accumulate text across responses
            
            // Send accumulated text for real-time display (but not marked complete yet)
            this.updateStatus({
              currentAction: { type: 'responding', description: `Turn ${this.sessionTurnCount} responding...` },
              llmStream: { 
                partialText: accumulatedText,  // Send complete accumulated text
                isComplete: false
              }
            });
          }
          
          if (resp.functionCalls) {
            functionCalls.push(...resp.functionCalls);
          }
        }

        // Mark stream as completed with full accumulated text
        this.updateStatus({
          currentAction: { 
            type: functionCalls.length > 0 ? 'tool_executing' : 'responding', 
            description: functionCalls.length > 0 
              ? `Turn ${this.sessionTurnCount} executing tools...`
              : `Turn ${this.sessionTurnCount} completed`
          },
          llmStream: hasStreamContent ? {
            partialText: accumulatedText,  // Final complete text
            isComplete: true
          } : undefined,
          // Clear current thought when turn completes
          currentThought: undefined
        });

        if (functionCalls.length > 0) {
          const toolResponseParts: Part[] = [];

          for (const fc of functionCalls) {
            const callId = fc.id ?? `${fc.name}-${Date.now()}`;
            const requestInfo: ToolCallRequestInfo = {
              callId,
              name: fc.name as string,
              args: (fc.args ?? {}) as Record<string, unknown>,
              isClientInitiated: false,
              prompt_id: request.sessionId,
            };

            // Update tool call status
            const toolStartTime = Date.now();
            this.updateToolStatus(callId, {
              name: fc.name as string,
              args: fc.args ?? {},
              status: 'executing',
              startTime: toolStartTime
            });

            const toolResponse = await executeToolCall(
              this.config,
              requestInfo,
              toolRegistry,
              abortController.signal,
            );

            // Fully reuse CLI's error handling logic with LLM feedback for non-fatal errors
            if (toolResponse.error) {
              const isToolNotFound = toolResponse.error.message.includes(
                'not found in registry',
              );
              const errorMsg = `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`;
              
              this.updateToolStatus(callId, {
                status: 'error',
                error: errorMsg,
                duration: Date.now() - toolStartTime
              });

              // Always feedback error to LLM
              toolResponseParts.push({ text: `TOOL_ERROR(${fc.name}): ${errorMsg}` });

              // Check if this is a fatal error that should terminate the task
              const fatal = !isToolNotFound && isFatalToolError(errorMsg);
              if (fatal) {
                executionError = errorMsg;
                finalSuccess = false;
                this.updateStatus({
                  sessionState: 'error',
                  finalResult: {
                    success: false,
                    error: errorMsg,
                    summary: 'Task failed due to fatal tool error'
                  }
                });
                break taskLoop;
              }
              // Non-fatal error: continue to let LLM handle it
              continue;
            } else {
              // Process tool result using strategy if available
              let exportPath: string | undefined;
              let processingResult: any = undefined;
              
              if (this.strategy) {
                const toolCall = {
                  callId,
                  name: fc.name as string,
                  args: fc.args ?? {},
                  status: 'completed' as const,
                  startTime: toolStartTime
                };
                
                processingResult = this.strategy.processToolResult(toolCall, toolResponse);
                
                // Extract any data from strategy processing
                if (processingResult?.extractedData?.exportPath) {
                  exportPath = processingResult.extractedData.exportPath;
                }
                
                // Update final result if strategy provides one
                if (processingResult?.finalResult) {
                  this.updateStatus({
                    finalResult: processingResult.finalResult
                  });
                }
              }

              this.updateToolStatus(callId, {
                status: 'completed',
                duration: Date.now() - toolStartTime,
                exportPath,
                result: toolResponse.resultDisplay ? 
                  (typeof toolResponse.resultDisplay === 'string' 
                    ? toolResponse.resultDisplay 
                    : JSON.stringify(toolResponse.resultDisplay)) : undefined,
                responseParts: Array.isArray(toolResponse.responseParts) 
                  ? toolResponse.responseParts 
                  : [toolResponse.responseParts]
              });
            }

            // Fully reuse CLI's responseParts handling logic
            if (toolResponse.responseParts) {
              const parts = Array.isArray(toolResponse.responseParts)
                ? toolResponse.responseParts
                : [toolResponse.responseParts];
              for (const part of parts) {
                if (typeof part === 'string') {
                  toolResponseParts.push({ text: part });
                } else if (part) {
                  toolResponseParts.push(part);
                }
              }
            }
          }
          currentMessages = [{ role: 'user', parts: toolResponseParts }];
        } else {
          // No tool calls in this turn - use smart continuation mechanism
          
          // Check if task is completed using strategy
          const isCompleted = this.strategy 
            ? this.strategy.isTaskComplete(this.currentStatus.toolCalls)
            : false;
          
          if (isCompleted) {
            // Task truly completed, normal exit
            this.updateStatus({
              sessionState: 'completed',
              progress: { ...this.currentStatus.progress, percentage: 100 }
            });
            break taskLoop;
          }
          
          // Use GeminiClient's smart continuation mechanism
          try {
            this.updateStatus({
              currentAction: { type: 'thinking', description: 'Determining if conversation should continue...' }
            });
            
            const nextSpeakerCheck = await checkNextSpeaker(
              chat,
              geminiClient,
              abortController.signal,
            );
            
            if (nextSpeakerCheck?.next_speaker === 'model') {
              // LLM indicates it should continue - send "Please continue."
              console.log(`Smart continuation: ${nextSpeakerCheck.reasoning}`);
              this.updateStatus({
                currentAction: { type: 'thinking', description: 'Continuing conversation...' }
              });
              
              currentMessages = [{ 
                role: 'user', 
                parts: [{ text: 'Please continue.' }] 
              }];
              continue taskLoop; // Continue the conversation
            } else {
              // LLM indicates user should speak next or unable to determine
              // Since this is a task execution context, treat as completion or failure
              if (nextSpeakerCheck?.reasoning) {
                console.log(`Smart continuation stopped: ${nextSpeakerCheck.reasoning}`);
              }
              
              // Task not explicitly completed
              console.warn('LLM stopped generating but task not completed - marking as failed');
              executionError = 'Task failed: Task was not completed successfully.';
              finalSuccess = false;
              this.updateStatus({
                sessionState: 'error',
                finalResult: {
                  success: false,
                  error: executionError,
                  summary: 'Task failed: Task was not completed successfully'
                }
              });
              break taskLoop;
            }
          } catch (error) {
            // If nextSpeakerCheck fails, fall back to treating as completion failure
            console.warn('NextSpeakerCheck failed:', error);
            console.warn('LLM stopped generating but task not completed - marking as failed');
            executionError = 'Task failed: Task was not completed successfully.';
            finalSuccess = false;
            this.updateStatus({
              sessionState: 'error',
              finalResult: {
                success: false,
                error: executionError,
                summary: 'Task failed: Task was not completed successfully'
              }
            });
            break taskLoop;
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      executionError = errorMessage;
      finalSuccess = false;
    } finally {
      // Fully reuse CLI's cleanup logic
      if (isTelemetrySdkInitialized()) {
        await shutdownTelemetry(this.config);
      }
    }

    // Build final result
    const finalResult: TaskResult = {
      success: finalSuccess,
      sessionId: request.sessionId,
      outputPath: this.currentStatus.finalResult?.outputPath,
      executionSummary: executionError || this.currentStatus.finalResult?.summary || 'Task execution completed',
      error: executionError,
      metadata: {
        totalDuration: Date.now() - this.startTime,
        turnCount: this.sessionTurnCount, // Use sessionTurnCount for consistency
        toolCallCount: this.currentStatus.toolCalls.length
      }
    };

    return finalResult;
  }


  

  private updateStatus(partial: Partial<TaskStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...partial };
    this.currentStatus.timestamp = new Date().toISOString();
    this.statusCallback(this.currentStatus);
  }

  private updateToolStatus(callId: string, update: Partial<TaskStatus['toolCalls'][0]>): void {
    const existingIndex = this.currentStatus.toolCalls.findIndex(call => call.callId === callId);
    
    if (existingIndex >= 0) {
      this.currentStatus.toolCalls[existingIndex] = {
        ...this.currentStatus.toolCalls[existingIndex],
        ...update
      };
    } else {
      this.currentStatus.toolCalls.push({
        callId,
        name: '',
        args: {},
        status: 'pending',
        startTime: Date.now(),
        ...update
      });
    }
    
    this.updateStatus({});
  }

  private calculateProgress(): number {
    // Use strategy for progress calculation if available
    if (this.strategy) {
      return this.strategy.calculateProgress(
        this.currentStatus.toolCalls || [],
        this.currentStatus.progress.currentTurn
      );
    }

    // Fallback: simple turn-based progress
    const maxTurns = this.config?.getMaxSessionTurns() || 50;
    const turnProgress = Math.min((this.currentStatus.progress.currentTurn / maxTurns) * 95, 95);
    
    // Check if task appears completed
    if (this.currentStatus.finalResult?.success) {
      return 100;
    }
    
    return turnProgress;
  }

  private isValidResponse(response: GenerateContentResponse): boolean {
    // Use exact same validation logic as Gemini CLI
    if (response.candidates === undefined || response.candidates.length === 0) {
      return false;
    }
    const content = response.candidates[0]?.content;
    if (content === undefined) {
      return false;
    }
    return this.isValidContent(content);
  }

  private isValidContent(content: Content): boolean {
    // Use same lenient validation as CLI - empty text parts are normal in streaming
    if (content.parts === undefined || content.parts.length === 0) {
      return false;
    }
    // Basic validation - just check parts exist and aren't completely empty objects
    for (const part of content.parts) {
      if (part === undefined || Object.keys(part).length === 0) {
        return false;
      }
    }
    return true;
  }

  private getTextContent(response: GenerateContentResponse): string | null {
    // Use exact same logic as CLI's getResponseText()
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts || candidate.content.parts.length === 0) {
      return null;
    }
    
    // Filter out thoughts like CLI does
    const thoughtPart = candidate.content.parts[0];
    if (thoughtPart?.thought) {
      return null;
    }
    
    // Use CLI's filtering approach: filter truthy text parts then join
    return candidate.content.parts
      .filter((part) => part.text)  // Filters out falsy text (including empty strings)
      .map((part) => part.text)
      .join('');
  }

  // Keep this method for compatibility but it's no longer used in the main flow
  private getResponseContent(response: GenerateContentResponse): {
    textPart: string | null;
    thoughtSummary: ThoughtSummary | null;
  } {
    // This method is now deprecated in favor of the direct processing approach
    // but kept for backward compatibility
    return { textPart: this.getTextContent(response), thoughtSummary: null };
  }

  async abort(): Promise<void> {
    // Note: Since abortController is now a local variable, abort functionality needs redesign
    // Can be implemented through setting flags or other methods
    this.updateStatus({
      sessionState: 'error',
      finalResult: {
        success: false,
        error: 'User cancelled',
        summary: 'Task was actively cancelled by user'
      }
    });
  }
} 