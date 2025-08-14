/**
 * @license
 * Copyright 2025 AIZGC Team
 * SPDX-License-Identifier: MIT
 */

import type { ConfigurationBuilder, ConfigParams, ValidationResult } from '../types/interfaces.js';
import type { TaskRequest } from '../types/types.js';

// Simple configuration object for Claude Code SDK
export interface ClaudeConfig {
  apiKey: string;
  sessionId: string;
  model: string;
  maxTurns: number;
  workingDirectory: string;
  tools: string[];
  mcpServerUrl?: string;
  customOptions?: Record<string, unknown>;
}

/**
 * Configuration builder for Claude Code SDK
 */
export class ClaudeConfigurationBuilder implements ConfigurationBuilder {
  async buildConfiguration(request: TaskRequest): Promise<ClaudeConfig> {
    const baseConfig = this.getBaseConfiguration(request);
    const validation = this.validateConfiguration(baseConfig);
    
    if (!validation.isValid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }
    
    return this.applyTaskSpecificSettings(baseConfig, request);
  }

  validateConfiguration(config: Partial<ConfigParams>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.sessionId) {
      errors.push('sessionId is required');
    }

    if (!config.model) {
      warnings.push('model not specified, using default');
    }

    if (config.maxTurns && config.maxTurns <= 0) {
      errors.push('maxTurns must be positive');
    }

    // ANTHROPIC_API_KEY is optional when using local Claude Code authentication
    if (!process.env.ANTHROPIC_API_KEY) {
      warnings.push('ANTHROPIC_API_KEY not set, will use local Claude Code authentication');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  protected getBaseConfiguration(request: TaskRequest): ConfigParams {
    return {
      sessionId: request.sessionId,
      model: request.model || 'claude-3-5-sonnet-20241022',
      maxTurns: request.maxTurns || 50,
      workingDirectory: request.workingDirectory || process.cwd(),
      approvalMode: 'yolo', // Claude Code equivalent
      customOptions: request.customOptions
    };
  }

  protected applyTaskSpecificSettings(baseConfig: ConfigParams, request: TaskRequest): ClaudeConfig {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY || '', // Empty string allows Claude Code to use local auth
      sessionId: baseConfig.sessionId,
      model: baseConfig.model,
      maxTurns: baseConfig.maxTurns,
      workingDirectory: baseConfig.workingDirectory,
      tools: this.getAvailableTools(request),
      mcpServerUrl: request.mcpServerUrl,
      customOptions: baseConfig.customOptions
    };
  }

  protected getAvailableTools(request: TaskRequest): string[] {
    // Default tool set that maps to Claude Code's built-in tools
    const defaultTools = [
      'Read',      // File reading
      'Write',     // File writing  
      'Bash',      // Command execution
      'Edit',      // File editing
      'Glob',      // File pattern matching
      'Grep'       // Text search
    ];

    // Add task-specific tools if requested
    if (request.requiredTools) {
      return [...new Set([...defaultTools, ...request.requiredTools])];
    }

    return defaultTools;
  }
}