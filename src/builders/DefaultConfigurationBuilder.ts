/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  MCPServerConfig,
  ApprovalMode,
  IdeClient
} from '@google/gemini-cli-core';
import type { ConfigurationBuilder, ConfigParams, ValidationResult } from '../types/interfaces.js';
import type { TaskRequest } from '../types/types.js';

/**
 * Default configuration builder with optional MCP support
 */
export class DefaultConfigurationBuilder implements ConfigurationBuilder {
  async buildConfiguration(request: TaskRequest): Promise<Config> {
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

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  protected getBaseConfiguration(request: TaskRequest): ConfigParams {
    return {
      sessionId: request.sessionId,
      model: request.model || 'gemini-2.5-flash',
      maxTurns: request.maxTurns || 50,
      workingDirectory: request.workingDirectory || process.cwd(),
      approvalMode: ApprovalMode.YOLO,
      mcpServerConfig: this.buildMCPConfig(request)
    };
  }

  protected buildMCPConfig(request: TaskRequest): MCPServerConfig | undefined {
    // Support SSE-based MCP servers
    if (request.mcpServerUrl) {
      return new MCPServerConfig(
        undefined, undefined, undefined, undefined,
        request.mcpServerUrl,
        undefined, undefined, undefined,
        request.mcpTimeout || 60000,
        true,
        request.mcpDescription || 'Task Agent'
      );
    }
    
    // Support process-based MCP servers
    if (request.mcpServerCommand) {
      return new MCPServerConfig(
        request.mcpServerCommand,
        request.mcpServerArgs || [],
        request.mcpServerEnv,
        request.mcpServerCwd,
        undefined, undefined, undefined, undefined,
        request.mcpTimeout || 60000,
        true,
        request.mcpDescription || 'Task Agent'
      );
    }

    // No MCP configuration provided - use built-in tools only
    return undefined;
  }

  protected applyTaskSpecificSettings(baseConfig: ConfigParams, request: TaskRequest): Config {
    const configData: any = {
      sessionId: baseConfig.sessionId,
      targetDir: baseConfig.workingDirectory,
      debugMode: false,
      model: baseConfig.model,
      cwd: baseConfig.workingDirectory,
      approvalMode: baseConfig.approvalMode,
      maxSessionTurns: baseConfig.maxTurns,
      ideClient: IdeClient.getInstance(),
      summarizeToolOutput: {},
    };

    // Only add MCP servers if configuration is provided
    if (baseConfig.mcpServerConfig) {
      const serverName = request.mcpServerName || 'default-mcp-server';
      configData.mcpServers = {
        [serverName]: baseConfig.mcpServerConfig
      };
    }

    return new Config(configData);
  }
}