/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TaskRequest {
  sessionId: string;
  description: string;        // Task description with all context included
  
  // MCP Configuration (Optional)
  mcpServerUrl?: string;                    // SSE-based MCP server
  mcpServerCommand?: string;                // Process-based MCP server
  mcpServerArgs?: string[];                 // Arguments for process-based server
  mcpServerEnv?: Record<string, string>;    // Environment variables
  mcpServerCwd?: string;                    // Working directory for server process
  mcpServerName?: string;                   // Server identifier
  mcpTimeout?: number;                      // Connection timeout
  mcpDescription?: string;                  // Server description
  
  // Prompt Configuration
  customPrompt?: string;                    // External prompt (highest priority)
  taskType?: string;                        // Task type for prompt selection
  
  // Execution Configuration
  model?: string;                           // LLM model to use
  maxTurns?: number;                        // Maximum conversation turns
  workingDirectory?: string;                // Working directory
}

export interface TaskStatus {
  sessionId: string;
  sessionState: 'initializing' | 'running' | 'completed' | 'error';
  progress: {
    currentTurn: number;      // Current conversation turn
    maxTurns: number;         // Maximum turn limit
    percentage: number;       // Progress percentage (0-100)
  };
  
  currentAction: {
    type: 'thinking' | 'tool_executing' | 'responding';
    description: string;      // Current step description
  };
  
  llmStream?: {
    partialText: string;      // LLM real-time output text
    isComplete: boolean;
    streamFragment?: boolean; // True for individual streaming fragments
  };
  
  // Structured thought (replaces thinkingText and isThinking)
  currentThought?: ThoughtSummary;
  
  toolCalls: Array<{
    callId: string;
    name: string;             // Tool name
    args: Record<string, unknown>;
    status: 'pending' | 'executing' | 'completed' | 'error';
    startTime: number;
    duration?: number;        // milliseconds
    result?: string;          // Tool execution result
    error?: string;
    exportPath?: string;      // Output path for tools that export files
    responseParts?: any[];    // Store complete response parts (consistent with CLI)
  }>;
  
  finalResult?: {
    success: boolean;
    outputPath?: string;      // Output file path (generic)
    summary: string;          // Execution summary
    error?: string;
  };
  
  timestamp: string;
}

export interface TaskResult {
  success: boolean;
  sessionId: string;
  outputPath?: string;        // Output file path (generic)
  executionSummary: string;   // Execution process summary
  error?: string;
  metadata: {
    totalDuration: number;    // Total execution time
    turnCount: number;        // Total turn count
    toolCallCount: number;    // Tool call count
  };
}

// Structured thought summary (based on Gemini CLI design)
export interface ThoughtSummary {
  subject: string;        // Thought subject (extracted from **subject**)
  description: string;    // Thought description (remaining text)
}

export interface TaskEngineOptions {
  strategy?: any;             // TaskStrategy - using any to avoid circular imports
  configBuilder?: any;       // ConfigurationBuilder
  promptStrategy?: any;      // PromptStrategy
  pluginManager?: any;       // PluginManager
  onStatusUpdate: (status: TaskStatus) => void;
  
  // Legacy support
  mcpServerName?: string;     // MCP server name
  systemPrompt?: string;      // Custom system prompt
} 