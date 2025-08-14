/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskRequest } from '../types/types.js';
import type { PromptStrategy } from '../types/claude-interfaces.js';

/**
 * Simple prompt builder that uses external prompts or falls back to task description
 */
export class SimplePromptBuilder {
  private strategy?: PromptStrategy;

  constructor(strategy?: PromptStrategy) {
    this.strategy = strategy;
  }

  async buildPrompt(request: TaskRequest, config?: any): Promise<string> {
    // Use strategy if provided
    if (this.strategy) {
      return this.strategy.buildPrompt(request, config);
    }

    // Priority 1: Use external prompt if provided
    if (request.customPrompt) {
      const systemPrompt = await this.getSystemPrompt(config);
      return this.combinePrompts(systemPrompt, request.customPrompt);
    }

    // Priority 2: Use CLI system prompt + task description
    const systemPrompt = await this.getSystemPrompt(config);
    return this.combinePrompts(systemPrompt, request.description);
  }

  setStrategy(strategy: PromptStrategy): void {
    this.strategy = strategy;
  }

  private async getSystemPrompt(config?: any): Promise<string | undefined> {
    if (!config) {
      return undefined;
    }

    // CLI system prompt integration can be added later if needed
    // For now, use the default generic prompt
    
    return undefined;
  }

  private combinePrompts(systemPrompt: string | undefined, userPrompt: string): string {
    if (!systemPrompt) {
      return userPrompt;
    }
    
    return `${systemPrompt}\n\n## Task Request\n\n${userPrompt}`;
  }
}