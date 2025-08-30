/**
 * Task Detection Service - Core RPG Activity Recognition
 *
 * Detects player actions and intentions from natural language messages
 * Triggers appropriate game mechanics and XP calculations
 */

import { BaseService } from '../../services/BaseService';

export interface DetectedTask {
  type: TaskType;
  confidence: number; // 0.0 to 1.0
  details: TaskDetails;
  originalMessage: string;
  timestamp: Date;
}

export interface TaskDetails {
  action?: string;
  target?: string;
  location?: string;
  items?: string[];
  skills?: string[];
  difficulty?: number;
  socialContext?: SocialContext;
}

export interface SocialContext {
  targetCharacter?: string;
  relationship?: string;
  tone?: 'friendly' | 'hostile' | 'neutral' | 'romantic';
  persuasion?: boolean;
}

export type TaskType =
  | 'combat'
  | 'crafting'
  | 'training'
  | 'exploration'
  | 'social'
  | 'magic'
  | 'rest'
  | 'travel'
  | 'trade'
  | 'quest'
  | 'unknown';

export interface TaskPattern {
  type: TaskType;
  regex: RegExp;
  weight: number; // Base confidence weight
  extractors?: {
    action?: RegExp;
    target?: RegExp;
    location?: RegExp;
    items?: RegExp;
    skills?: RegExp;
  };
}

export class TaskDetectionService extends BaseService {
  private patterns: TaskPattern[] = [];
  private contextHistory: DetectedTask[] = [];
  private maxHistorySize = 10;

  constructor() {
    super('TaskDetectionService', { performanceBudget: 10 });
    this.initializePatterns();
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('message:received', this.handleMessageReceived.bind(this));
    this.eventBus.on('combat:ended', this.handleCombatEnded.bind(this));
    this.eventBus.on('task:detected', this.handleTaskDetected.bind(this));

    console.log('[TaskDetection] Initialized with', this.patterns.length, 'detection patterns');
  }

  protected async onShutdown(): Promise<void> {
    this.contextHistory = [];
    console.log('[TaskDetection] Shut down');
  }

  /**
   * Main task detection method
   */
  async detectTasks(message: string): Promise<DetectedTask[]> {
    return this.measureOperation('detectTasks', async () => {
      const normalizedMessage = message.toLowerCase().trim();
      const detectedTasks: DetectedTask[] = [];

      // Check each pattern against the message
      for (const pattern of this.patterns) {
        const match = normalizedMessage.match(pattern.regex);
        if (match) {
          const task = await this.createTaskFromMatch(pattern, match, message);
          if (task.confidence >= 0.3) { // Minimum confidence threshold
            detectedTasks.push(task);
          }
        }
      }

      // Sort by confidence and limit results
      detectedTasks.sort((a, b) => b.confidence - a.confidence);
      const topTasks = detectedTasks.slice(0, 3); // Max 3 tasks per message

      // Add context from recent history
      for (const task of topTasks) {
        this.enhanceWithContext(task);
      }

      // Store in history
      this.contextHistory.unshift(...topTasks);
      this.contextHistory = this.contextHistory.slice(0, this.maxHistorySize);

      // Emit detected tasks
      if (topTasks.length > 0) {
        this.eventBus.emit('tasks:detected', { tasks: topTasks });
      }

      return topTasks;
    });
  }

  /**
   * Get recent task context for better detection
   */
  getRecentContext(): DetectedTask[] {
    return [...this.contextHistory];
  }

  /**
   * Manually trigger task detection for testing
   */
  async testDetection(message: string): Promise<DetectedTask[]> {
    const tasks = await this.detectTasks(message);
    console.log('[TaskDetection] Test results for:', message);
    tasks.forEach(task => {
      console.log(`  ${task.type.toUpperCase()}: ${task.confidence.toFixed(2)} confidence`);
      console.log(`    Details: ${JSON.stringify(task.details)}`);
    });
    return tasks;
  }

  // Private methods

  private initializePatterns(): void {
    this.patterns = [
      // Combat patterns
      {
        type: 'combat',
        regex: /\b(attacks?|fights?|battles?|combats?|strikes?|hits?|kills?|defeats?)\b.*\b(the\s+)?(\w+)/i,
        weight: 0.9,
        extractors: {
          action: /\b(attacks?|fights?|battles?|combats?|strikes?|hits?|kills?|defeats?)\b/i,
          target: /\b(the\s+)?(\w+)$/i
        }
      },
      {
        type: 'combat',
        regex: /\b(rolls?\s+(?:for\s+)?initiative|initiative\s+roll)/i,
        weight: 0.95
      },
      {
        type: 'combat',
        regex: /\b(uses?|casts?|performs?)\s+(?:a\s+)?(?:weapon|spell|ability)/i,
        weight: 0.8
      },

      // Crafting patterns
      {
        type: 'crafting',
        regex: /\b(?:starts?|begins?|makes?|creates?|forges?|crafts?|builds?)\s+(?:a\s+)?(\w+)/i,
        weight: 0.85,
        extractors: {
          action: /\b(?:starts?|begins?|makes?|creates?|forges?|crafts?|builds?)\b/i,
          target: /\b(?:a\s+)?(\w+)$/i
        }
      },
      {
        type: 'crafting',
        regex: /\b(?:gathers?|collects?|mines?|harvests?)\s+(?:materials?|resources?|ingredients?)/i,
        weight: 0.75
      },

      // Training patterns
      {
        type: 'training',
        regex: /\b(?:practices?|trains?|studies?|learns?|improves?)\s+(?:my\s+)?(\w+)/i,
        weight: 0.8,
        extractors: {
          action: /\b(?:practices?|trains?|studies?|learns?|improves?)\b/i,
          skills: /\b(?:my\s+)?(\w+)$/i
        }
      },
      {
        type: 'training',
        regex: /\b(?:works\s+out|exercises?|meditates?|focuses?)\b/i,
        weight: 0.7
      },

      // Exploration patterns
      {
        type: 'exploration',
        regex: /\b(?:explores?|searches?|investigates?|looks?\s+(?:around|for))\b/i,
        weight: 0.8
      },
      {
        type: 'exploration',
        regex: /\b(?:enters?|goes?\s+(?:to|into)|travels?\s+(?:to|through))\s+(?:the\s+)?(\w+)/i,
        weight: 0.75,
        extractors: {
          action: /\b(?:enters?|goes?|travels?)\b/i,
          location: /\b(?:the\s+)?(\w+)$/i
        }
      },

      // Social patterns
      {
        type: 'social',
        regex: /\b(?:talks?\s+(?:to|with)|speaks?\s+(?:to|with)|converses?\s+(?:with))\s+(?:the\s+)?(\w+)/i,
        weight: 0.8,
        extractors: {
          action: /\b(?:talks?|speaks?|converses?)\b/i,
          target: /\b(?:the\s+)?(\w+)$/i
        }
      },
      {
        type: 'social',
        regex: /\b(?:persuades?|convinces?|intimidates?|bluffs?|diplomacy)\b/i,
        weight: 0.85
      },
      {
        type: 'social',
        regex: /\b(?:flirts?\s+(?:with)|courts?|romances?)\s+(?:the\s+)?(\w+)/i,
        weight: 0.9,
        extractors: {
          action: /\b(?:flirts?|courts?|romances?)\b/i,
          target: /\b(?:the\s+)?(\w+)$/i
        }
      },

      // Magic patterns
      {
        type: 'magic',
        regex: /\b(?:casts?|uses?|performs?|channels?)\s+(?:a\s+)?(?:spell|magic|enchantment)/i,
        weight: 0.85
      },
      {
        type: 'magic',
        regex: /\b(?:summons?|conjures?|evokes?|invokes?)\s+(?:a\s+)?(\w+)/i,
        weight: 0.8,
        extractors: {
          action: /\b(?:summons?|conjures?|evokes?|invokes?)\b/i,
          target: /\b(?:a\s+)?(\w+)$/i
        }
      },

      // Rest patterns
      {
        type: 'rest',
        regex: /\b(?:rests?|sleeps?|takes?\s+a\s+break|recovers?|heals?)\b/i,
        weight: 0.7
      },

      // Travel patterns
      {
        type: 'travel',
        regex: /\b(?:travels?|journeys?|heads?|moves?)\s+(?:to|toward|towards)\s+(?:the\s+)?(\w+)/i,
        weight: 0.75,
        extractors: {
          action: /\b(?:travels?|journeys?|heads?|moves?)\b/i,
          location: /\b(?:the\s+)?(\w+)$/i
        }
      },

      // Trade patterns
      {
        type: 'trade',
        regex: /\b(?:buys?|sells?|trades?|barters?|purchases?)\s+(?:a\s+)?(\w+)/i,
        weight: 0.8,
        extractors: {
          action: /\b(?:buys?|sells?|trades?|barters?|purchases?)\b/i,
          items: /\b(?:a\s+)?(\w+)$/i
        }
      },

      // Quest patterns
      {
        type: 'quest',
        regex: /\b(?:accepts?|takes?|starts?|begins?)\s+(?:the\s+)?(?:quest|mission|task|job)/i,
        weight: 0.9
      },
      {
        type: 'quest',
        regex: /\b(?:completes?|finishes?|accomplishes?)\s+(?:the\s+)?(?:quest|mission|objective)/i,
        weight: 0.9
      }
    ];
  }

  private async createTaskFromMatch(
    pattern: TaskPattern,
    match: RegExpMatchArray,
    originalMessage: string
  ): Promise<DetectedTask> {
    const confidence = this.calculateConfidence(pattern, match, originalMessage);

    const details: TaskDetails = {};
    if (pattern.extractors) {
      details.action = this.extractFromRegex(pattern.extractors.action, originalMessage);
      details.target = this.extractFromRegex(pattern.extractors.target, originalMessage);
      details.location = this.extractFromRegex(pattern.extractors.location, originalMessage);

      if (pattern.extractors.items) {
        const items = this.extractFromRegex(pattern.extractors.items, originalMessage);
        details.items = items ? [items] : [];
      }

      if (pattern.extractors.skills) {
        const skills = this.extractFromRegex(pattern.extractors.skills, originalMessage);
        details.skills = skills ? [skills] : [];
      }
    }

    // Add social context for social tasks
    if (pattern.type === 'social') {
      details.socialContext = this.extractSocialContext(originalMessage);
    }

    // Estimate difficulty based on keywords
    details.difficulty = this.estimateDifficulty(originalMessage);

    return {
      type: pattern.type,
      confidence,
      details,
      originalMessage,
      timestamp: new Date()
    };
  }

  private calculateConfidence(pattern: TaskPattern, match: RegExpMatchArray, message: string): number {
    let confidence = pattern.weight;

    // Boost confidence for longer matches (more specific)
    if (match[0].length > 10) {
      confidence += 0.1;
    }

    // Boost confidence for multiple matching keywords
    const keywords = pattern.regex.source.split('|').filter(k => k.length > 3);
    const keywordMatches = keywords.filter(keyword =>
      new RegExp(keyword, 'i').test(message)
    ).length;
    confidence += (keywordMatches - 1) * 0.05;

    // Cap at 1.0
    return Math.min(confidence, 1.0);
  }

  private extractFromRegex(regex: RegExp | undefined, text: string): string | undefined {
    if (!regex) return undefined;
    const match = text.match(regex);
    return match ? match[1] || match[0] : undefined;
  }

  private extractSocialContext(message: string): SocialContext {
    const context: SocialContext = {};

    // Detect tone
    if (/\b(loves?|adores?|cherishes?|cares?\s+about)\b/i.test(message)) {
      context.tone = 'romantic';
    } else if (/\b(hates?|despises?|attacks?|fights?)\b/i.test(message)) {
      context.tone = 'hostile';
    } else if (/\b(friends?|allies?|helps?|assists?)\b/i.test(message)) {
      context.tone = 'friendly';
    } else {
      context.tone = 'neutral';
    }

    // Detect persuasion
    context.persuasion = /\b(persuades?|convinces?|intimidates?|bluffs?|diplomacy)\b/i.test(message);

    return context;
  }

  private estimateDifficulty(message: string): number {
    let difficulty = 1; // Base difficulty

    // Boost difficulty for challenging keywords
    if (/\b(difficult|hard|tough|dangerous|risky)\b/i.test(message)) difficulty += 1;
    if (/\b(epic|legendary|master|expert)\b/i.test(message)) difficulty += 1;
    if (/\b(boss|elite|champion|guardian)\b/i.test(message)) difficulty += 2;

    return Math.min(difficulty, 5); // Cap at 5
  }

  private enhanceWithContext(task: DetectedTask): void {
    // Look for related tasks in recent history
    const relatedTasks = this.contextHistory.filter(t =>
      t.type === task.type &&
      (Date.now() - t.timestamp.getTime()) < 300000 // Within 5 minutes
    );

    if (relatedTasks.length > 0) {
      // Increase confidence for repeated similar tasks
      task.confidence = Math.min(task.confidence + 0.1, 1.0);
    }
  }

  // Event handlers

  private async handleMessageReceived(data: { message: string; characterId?: string }): Promise<void> {
    try {
      const tasks = await this.detectTasks(data.message);

      // Emit individual task events for other services
      for (const task of tasks) {
        this.eventBus.emit('task:detected', {
          task,
          characterId: data.characterId
        });
      }
    } catch (error) {
      console.error('[TaskDetection] Error processing message:', error);
    }
  }

  private async handleCombatEnded(data: { results: any }): Promise<void> {
    // Clear combat-related context after combat ends
    this.contextHistory = this.contextHistory.filter(task => task.type !== 'combat');
  }

  private async handleTaskDetected(data: { task: DetectedTask; characterId?: string }): Promise<void> {
    // Could trigger XP calculation, achievement checks, etc.
    // For now, just log for debugging
    if (this.config.debugMode) {
      console.log(`[TaskDetection] Detected: ${data.task.type} (${data.task.confidence.toFixed(2)})`);
    }
  }
}

// Global instance
export const taskDetectionService = new TaskDetectionService();
