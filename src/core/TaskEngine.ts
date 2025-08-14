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
  private readonly MAX_TURNS = 200; // Hard limit increased for complex tasks

  constructor(options: TaskEngineOptions) {
    this.statusCallback = options.onStatusUpdate;
    this.configBuilder = options.configBuilder || new DefaultConfigurationBuilder();
    this.promptBuilder = new SimplePromptBuilder(options.promptStrategy);
    this.strategy = options.strategy;
    
    // Fix Gemini CLI retry logic bug
    this.fixGeminiCliRetryBug();
  }
  
  /**
   * Fix the Gemini CLI retry bug where /5\d{2}/ regex incorrectly matches token counts
   * This monkey-patch ensures only actual HTTP 5xx status codes trigger retries
   */
  private fixGeminiCliRetryBug(): void {
    // Since direct module patching is blocked, let's use a different approach
    // We'll monkey-patch the String.prototype.match method temporarily when needed
    console.warn('Applying Gemini CLI retry bug workaround via console interception');
    this.setupConsoleInterception();
    
    // Also try to patch the global String match method more carefully
    try {
      const originalStringMatch = String.prototype.match;
      
      (String.prototype as any).match = function(regexp: RegExp | string): RegExpMatchArray | null {
        // If this is the problematic regex and we're in a retry context
        if (regexp instanceof RegExp && regexp.source === '5\\d{2}') {
          const stack = new Error().stack;
          if (stack && (stack.includes('shouldRetry') || stack.includes('retryWithBackoff') || stack.includes('defaultShouldRetry'))) {
            // For the problematic pattern, use a more precise match
            if (this.includes('token count') && this.includes('400')) {
              // This is a token limit error, don't match as 5xx
              return null;
            }
            // Use word boundary version of the regex to avoid matching token counts
            return originalStringMatch.call(this, /\b5[0-9]{2}\b/);
          }
        }
        
        return originalStringMatch.call(this, regexp as any);
      };
      
      console.log('Applied String.prototype.match patch for retry bug fix');
    } catch (error) {
      console.warn('Failed to patch String.prototype.match, relying on console interception only');
    }
  }
  
  private setupConsoleInterception(): void {
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.error = (...args: any[]) => {
      const message = args[0];
      if (typeof message === 'string' && 
          message.includes('failed with 5xx error') && 
          args[1] && 
          typeof args[1] === 'object') {
        
        // Extract the actual error and check if it's really a 5xx error
        const error = args[1];
        const isActual5xx = this.isActual5xxError(error);
        
        if (!isActual5xx) {
          // This is not a real 5xx error, format it properly
          const cleanMessage = this.formatRetryErrorMessage(message, error);
          originalWarn(cleanMessage); // Use warn instead of error for non-5xx
          return;
        }
      }
      
      // Let real errors through
      originalError(...args);
    };
    
    console.warn = (...args: any[]) => {
      const message = args[0];
      if (typeof message === 'string' && 
          message.includes('failed with') && 
          args[1]) {
        
        // Format retry warnings consistently
        const cleanMessage = this.formatRetryErrorMessage(message, args[1]);
        originalWarn(cleanMessage);
        return;
      }
      
      originalWarn(...args);
    };
  }
  
  private isActual5xxError(error: any): boolean {
    // Check if it's actually a 5xx HTTP status code
    if (error && typeof error === 'object') {
      // Check status property
      if (typeof error.status === 'number' && error.status >= 500 && error.status < 600) {
        return true;
      }
      
      // Check response.status property
      if (error.response && typeof error.response.status === 'number' && 
          error.response.status >= 500 && error.response.status < 600) {
        return true;
      }
      
      // Check for actual HTTP 5xx in error message (not token counts)
      const message = error.message || error.toString();
      // More precise regex: match HTTP status codes, not arbitrary numbers
      if (message && message.match(/\b5[0-9]{2}\b/)) {
        return true;
      }
    }
    
    return false;
  }
  
  private formatRetryErrorMessage(message: string, error: any): string {
    try {
      // Extract structured error information for clean display
      let errorDetails: any = null;
      
      if (error && typeof error === 'object') {
        // Try to extract JSON error
        const errorStr = error.toString();
        const jsonMatch = errorStr.match(/\[(\{.*?\})\]/);
        if (jsonMatch) {
          try {
            const errorArray = JSON.parse(jsonMatch[1]);
            if (errorArray && errorArray.error) {
              errorDetails = errorArray.error;
            }
          } catch (e) {
            // Fallback to direct parsing
            const directMatch = errorStr.match(/\{[\s\S]*?"error"[\s\S]*?\}/);
            if (directMatch) {
              const parsed = JSON.parse(directMatch[0]);
              if (parsed.error) {
                errorDetails = parsed.error;
              }
            }
          }
        }
      }
      
      if (errorDetails) {
        const attemptMatch = message.match(/Attempt (\d+)/);
        const attemptNum = attemptMatch ? attemptMatch[1] : '?';
        
        // Format like Gemini CLI but with correct error categorization
        if (errorDetails.code === 400) {
          return `⚠️  Attempt ${attemptNum}: ${errorDetails.message} (Code: ${errorDetails.code}) - Not retrying 400 errors`;
        } else {
          return `⚠️  Attempt ${attemptNum}: ${errorDetails.message} (Code: ${errorDetails.code}) - retrying...`;
        }
      }
      
      // Fallback to original message but cleaned up
      return message.replace(/\s+GaxiosError:.*$/s, ''); // Remove verbose stack trace
    } catch (e) {
      return message; // If formatting fails, return original
    }
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

        let responseStream;
        try {
          responseStream = await chat.sendMessageStream(
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
        } catch (apiError) {
          // Handle API-level errors (token limits, network issues, etc.)
          const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
          
          // Check if this is a recoverable error that LLM can handle
          if (this.isRecoverableError(errorMessage)) {
            console.log(`Recoverable API error detected: ${errorMessage}`);
            
            // Create error message for LLM to process
            const errorFeedback = this.formatErrorForLLM(errorMessage, turnCount);
            currentMessages = [{
              role: 'user',
              parts: [{ text: errorFeedback }]
            }];
            
            // Update status to show error handling
            this.updateStatus({
              currentAction: { 
                type: 'thinking', 
                description: `Turn ${this.sessionTurnCount} - handling API error...` 
              },
              llmStream: {
                partialText: errorFeedback,
                isComplete: true
              }
            });
            
            // Continue to next iteration to let LLM handle the error
            continue;
          } else {
            // This is a fatal error - rethrow to be caught by outer try-catch
            throw apiError;
          }
        }

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
          console.log(`[TaskEngine] Turn ${this.sessionTurnCount}: No tool calls, checking task completion`);
          
          // Check if task is completed using strategy
          const isCompleted = this.strategy 
            ? this.strategy.isTaskComplete(this.currentStatus.toolCalls)
            : false;
          
          console.log(`[TaskEngine] Strategy completion check: ${isCompleted}`);
          console.log(`[TaskEngine] Current tool calls: ${this.currentStatus.toolCalls.map(tc => `${tc.name}(${tc.status})`).join(', ')}`);
          
          if (isCompleted) {
            // Task truly completed, normal exit
            console.log(`[TaskEngine] Task marked as completed by strategy, exiting loop`);
            this.updateStatus({
              sessionState: 'completed',
              progress: { ...this.currentStatus.progress, percentage: 100 }
            });
            break taskLoop;
          }
          
          // Use GeminiClient's smart continuation mechanism
          console.log(`[TaskEngine] Calling checkNextSpeaker to determine continuation`);
          try {
            this.updateStatus({
              currentAction: { type: 'thinking', description: 'Determining if conversation should continue...' }
            });
            
            const nextSpeakerCheck = await checkNextSpeaker(
              chat,
              geminiClient,
              abortController.signal,
            );
            
            console.log(`[TaskEngine] NextSpeaker result: ${JSON.stringify(nextSpeakerCheck, null, 2)}`);
            
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
      console.log(`[TaskEngine] Caught error in main execution loop: ${errorMessage}`);
      console.log(`[TaskEngine] Error stack: ${error instanceof Error ? error.stack : 'No stack'}`);
      executionError = errorMessage;
      finalSuccess = false;
    } finally {
      // Fully reuse CLI's cleanup logic
      if (isTelemetrySdkInitialized()) {
        await shutdownTelemetry(this.config);
      }
    }

    // Enhanced logging for task completion analysis
    console.log(`[TaskEngine] Task execution completed:`);
    console.log(`  - Final success: ${finalSuccess}`);
    console.log(`  - Execution error: ${executionError || 'None'}`);
    console.log(`  - Turn count: ${this.sessionTurnCount}`);
    console.log(`  - Tool calls: ${this.currentStatus.toolCalls.length}`);
    console.log(`  - Session state: ${this.currentStatus.sessionState}`);
    console.log(`  - Current final result: ${JSON.stringify(this.currentStatus.finalResult, null, 2)}`);
    
    // Check why the task stopped
    if (!finalSuccess && !executionError) {
      console.log(`[TaskEngine] WARNING: Task marked as failed but no error message set`);
    }
    
    if (this.currentStatus.sessionState !== 'completed' && this.currentStatus.sessionState !== 'error') {
      console.log(`[TaskEngine] WARNING: Task stopped with session state: ${this.currentStatus.sessionState}`);
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

    console.log(`[TaskEngine] Returning final result: ${JSON.stringify(finalResult, null, 2)}`);
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

  private isRecoverableError(errorMessage: string): boolean {
    // Define patterns for recoverable errors that LLM can handle
    const recoverablePatterns = [
      /token.*count.*exceeds.*maximum/i,           // Token limit exceeded
      /input.*token.*count.*exceeds/i,             // Input token limit
      /context.*length.*exceeded/i,                // Context length issues
      /request.*too.*large/i,                      // Request size issues
      /rate.*limit.*exceeded/i,                    // Rate limiting (temporary)
      /quota.*exceeded/i,                          // Quota issues (might be temporary)
      /service.*temporarily.*unavailable/i,        // Temporary service issues
      /timeout/i,                                  // Request timeouts
      /network.*error/i,                           // Network connectivity issues
      /connection.*reset/i,                        // Connection issues
      /socket.*hang.*up/i,                         // Socket connection dropped
      /econnreset/i,                               // Connection reset by peer
      /enotfound/i,                                // DNS resolution failures
      /econnrefused/i,                             // Connection refused (may be temporary)
      /etimedout/i,                                // Network timeouts
      /temporary.*failure/i                        // Any temporary failure
    ];
    
    return recoverablePatterns.some(pattern => pattern.test(errorMessage));
  }

  private formatErrorForLLM(errorMessage: string, turnCount: number): string {
    // Match Gemini CLI's concise error format
    if (/token.*count.*exceeds/i.test(errorMessage)) {
      return `✕ [API Error: Token limit exceeded]\n\nConsider using smaller parameters (e.g., maxResults: "50" instead of "0") or processing data in chunks.`;
    } 
    
    if (/rate.*limit|quota.*exceeded/i.test(errorMessage)) {
      return `✕ [API Error: Rate/quota limit exceeded]\n\nTry using fewer API calls or wait before retrying.`;
    } 
    
    if (/timeout|network.*error|connection|socket.*hang.*up|econnreset|enotfound|econnrefused|etimedout/i.test(errorMessage)) {
      return `✕ [Network Error: Connection issue detected]\n\nThis appears to be a temporary network problem. Retrying the same operation...`;
    }
    
    // Extract the core error message for display
    const coreError = errorMessage.replace(/^Error:\s*/i, '').split('\n')[0];
    return `✕ [API Error: ${coreError}]`;
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