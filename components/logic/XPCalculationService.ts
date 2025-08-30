/**
 * XP Calculation Service - Experience Point and Progression System
 *
 * Calculates XP rewards based on detected tasks and player actions
 * Manages character level progression and skill advancement
 */

import { BaseService } from '../../services/BaseService';
import { DetectedTask, TaskType } from './TaskDetectionService';

export interface XPConfig {
  baseXPValues: Record<TaskType, number>;
  modifiers: XPModifiers;
  levelScaling: LevelScalingConfig;
  skillBonuses: SkillBonuses;
  streakRewards: StreakRewards;
}

export interface XPModifiers {
  firstTimeBonus: number; // 1.5x for first time
  perfectExecutionBonus: number; // 1.3x for perfect success
  barelySucceededBonus: number; // 0.7x for barely succeeded
  partySharedPenalty: number; // 0.8x when shared in party
  difficultyMultiplier: Record<number, number>; // Difficulty level multipliers
  timeBonus: TimeBonus[]; // Bonuses based on completion time
}

export interface LevelScalingConfig {
  baseXPToLevel: number; // Base XP needed for level 2
  scalingFactor: number; // How much XP requirement increases per level
  maxLevel: number;
}

export interface SkillBonuses {
  proficiencyBonus: Record<string, number>; // Skill name -> bonus multiplier
  expertiseBonus: Record<string, number>; // Expert skills get extra
}

export interface StreakRewards {
  enabled: boolean;
  sameTaskMultiplier: number; // 1.1x for same task streak
  differentTaskMultiplier: number; // 1.05x for variety
  maxStreakBonus: number;
}

export interface TimeBonus {
  maxTime: number; // seconds
  multiplier: number;
}

export interface XPReward {
  baseXP: number;
  modifiers: XPModifier[];
  totalXP: number;
  breakdown: XPBreakdown;
  levelUps?: LevelUpInfo[];
}

export interface XPModifier {
  type: string;
  value: number;
  reason: string;
}

export interface XPBreakdown {
  taskType: TaskType;
  baseValue: number;
  difficultyMultiplier: number;
  qualityMultiplier: number;
  skillBonus: number;
  streakBonus: number;
  timeBonus: number;
  finalTotal: number;
}

export interface LevelUpInfo {
  newLevel: number;
  skillPoints: number;
  abilityImprovements: string[];
}

export interface CharacterXP {
  characterId: string;
  currentLevel: number;
  currentXP: number;
  totalXP: number;
  xpToNextLevel: number;
  recentTasks: TaskHistory[];
  streaks: TaskStreaks;
}

export interface TaskHistory {
  taskType: TaskType;
  timestamp: Date;
  xpGained: number;
  quality: number; // 0.0 to 1.0
}

export interface TaskStreaks {
  currentStreak: number;
  longestStreak: number;
  lastTaskType: TaskType | null;
  streakStartTime: Date | null;
}

const DEFAULT_XP_CONFIG: XPConfig = {
  baseXPValues: {
    combat: 50,
    crafting: 25,
    training: 15,
    exploration: 20,
    social: 30,
    magic: 40,
    rest: 5,
    travel: 10,
    trade: 15,
    quest: 100,
    unknown: 0
  },

  modifiers: {
    firstTimeBonus: 1.5,
    perfectExecutionBonus: 1.3,
    barelySucceededBonus: 0.7,
    partySharedPenalty: 0.8,
    difficultyMultiplier: {
      1: 1.0,   // Easy
      2: 1.2,   // Normal
      3: 1.5,   // Hard
      4: 2.0,   // Very Hard
      5: 3.0    // Legendary
    },
    timeBonus: [
      { maxTime: 30, multiplier: 1.5 },   // Fast completion
      { maxTime: 60, multiplier: 1.25 },  // Quick completion
      { maxTime: 120, multiplier: 1.1 }   // Decent completion
    ]
  },

  levelScaling: {
    baseXPToLevel: 1000,
    scalingFactor: 1.2,
    maxLevel: 20
  },

  skillBonuses: {
    proficiencyBonus: {
      'warrior': 1.2,
      'mage': 1.2,
      'rogue': 1.2,
      'cleric': 1.2,
      'craftsman': 1.15,
      'diplomat': 1.1
    },
    expertiseBonus: {
      'master': 1.5,
      'legendary': 2.0
    }
  },

  streakRewards: {
    enabled: true,
    sameTaskMultiplier: 1.1,
    differentTaskMultiplier: 1.05,
    maxStreakBonus: 2.0
  }
};

export class XPCalculationService extends BaseService {
  private config: XPConfig;
  private characterXP: Map<string, CharacterXP> = new Map();

  constructor(config: Partial<XPConfig> = {}) {
    super('XPCalculationService', { performanceBudget: 20 });
    this.config = { ...DEFAULT_XP_CONFIG, ...config };
  }

  protected async onInitialize(): Promise<void> {
    // Register event listeners
    this.eventBus.on('task:detected', this.handleTaskDetected.bind(this));
    this.eventBus.on('character:loaded', this.handleCharacterLoaded.bind(this));
    this.eventBus.on('combat:ended', this.handleCombatEnded.bind(this));

    console.log('[XPCalculation] Initialized XP system');
  }

  protected async onShutdown(): Promise<void> {
    // Save all character XP data
    await this.persistAllXPData();
    this.characterXP.clear();
    console.log('[XPCalculation] Shut down');
  }

  /**
   * Calculate XP reward for a detected task
   */
  async calculateXP(task: DetectedTask, characterId: string): Promise<XPReward> {
    return this.measureOperation('calculateXP', async () => {
      const character = await this.getOrLoadCharacterXP(characterId);

      // Calculate base XP
      const baseXP = this.config.baseXPValues[task.type] || 0;

      // Apply modifiers
      const modifiers = await this.calculateModifiers(task, character);

      // Calculate total XP
      let totalXP = baseXP;
      for (const modifier of modifiers) {
        totalXP *= modifier.value;
      }

      // Round to nearest integer
      totalXP = Math.round(totalXP);

      // Create breakdown
      const breakdown = this.createBreakdown(task, baseXP, modifiers, totalXP);

      const reward: XPReward = {
        baseXP,
        modifiers,
        totalXP,
        breakdown
      };

      // Check for level ups
      const levelUps = await this.checkLevelUps(character, totalXP);
      if (levelUps.length > 0) {
        reward.levelUps = levelUps;
      }

      // Update character XP
      await this.applyXP(character, totalXP, task);

      // Emit XP gained event
      this.eventBus.emit('xp:gained', {
        characterId,
        reward,
        newTotalXP: character.totalXP + totalXP,
        newLevel: character.currentLevel
      });

      return reward;
    });
  }

  /**
   * Get current XP status for a character
   */
  getCharacterXP(characterId: string): CharacterXP | null {
    return this.characterXP.get(characterId) || null;
  }

  /**
   * Get XP required for next level
   */
  getXPForNextLevel(currentLevel: number): number {
    if (currentLevel >= this.config.levelScaling.maxLevel) {
      return 0; // Max level reached
    }

    const baseXP = this.config.levelScaling.baseXPToLevel;
    const scaling = this.config.levelScaling.scalingFactor;

    // XP needed = baseXP * (scaling ^ (level - 1))
    return Math.round(baseXP * Math.pow(scaling, currentLevel - 1));
  }

  /**
   * Preview XP calculation without applying it
   */
  async previewXP(task: DetectedTask, characterId: string): Promise<XPReward> {
    const character = await this.getOrLoadCharacterXP(characterId);
    return this.calculateXP(task, characterId);
  }

  // Private methods

  private async calculateModifiers(task: DetectedTask, character: CharacterXP): Promise<XPModifier[]> {
    const modifiers: XPModifier[] = [];

    // Difficulty multiplier
    const difficulty = task.details.difficulty || 1;
    const diffMultiplier = this.config.modifiers.difficultyMultiplier[difficulty] || 1.0;
    modifiers.push({
      type: 'difficulty',
      value: diffMultiplier,
      reason: `Difficulty level ${difficulty}`
    });

    // Quality multiplier (based on task confidence and success)
    const qualityMultiplier = this.calculateQualityMultiplier(task);
    modifiers.push({
      type: 'quality',
      value: qualityMultiplier,
      reason: `Task execution quality (${(task.confidence * 100).toFixed(0)}% confidence)`
    });

    // Skill bonus (if applicable)
    const skillBonus = await this.calculateSkillBonus(task, character);
    if (skillBonus > 1.0) {
      modifiers.push({
        type: 'skill',
        value: skillBonus,
        reason: 'Character skill proficiency'
      });
    }

    // Streak bonus
    const streakBonus = this.calculateStreakBonus(character);
    if (streakBonus > 1.0) {
      modifiers.push({
        type: 'streak',
        value: streakBonus,
        reason: 'Task completion streak'
      });
    }

    // Time bonus (if time data available)
    const timeBonus = this.calculateTimeBonus(task);
    if (timeBonus > 1.0) {
      modifiers.push({
        type: 'time',
        value: timeBonus,
        reason: 'Fast completion'
      });
    }

    return modifiers;
  }

  private calculateQualityMultiplier(task: DetectedTask): number {
    let multiplier = 1.0;

    // Base multiplier from task confidence
    multiplier *= task.confidence;

    // Adjust based on task type and context
    if (task.details.socialContext) {
      if (task.details.socialContext.tone === 'friendly') {
        multiplier *= 1.1; // Social bonus
      } else if (task.details.socialContext.tone === 'hostile') {
        multiplier *= 0.9; // Hostile penalty
      }
    }

    // Clamp between 0.5 and 2.0
    return Math.max(0.5, Math.min(2.0, multiplier));
  }

  private async calculateSkillBonus(task: DetectedTask, character: CharacterXP): Promise<number> {
    // This would normally check character skills from database
    // For now, return a basic skill bonus based on task type and level
    const skillMultipliers: Record<TaskType, number> = {
      combat: 1.2,
      crafting: 1.15,
      training: 1.1,
      exploration: 1.05,
      social: 1.1,
      magic: 1.25,
      rest: 1.0,
      travel: 1.0,
      trade: 1.1,
      quest: 1.3,
      unknown: 1.0
    };

    const baseMultiplier = skillMultipliers[task.type] || 1.0;

    // Level-based bonus
    const levelBonus = 1 + (character.currentLevel - 1) * 0.05;

    return baseMultiplier * levelBonus;
  }

  private calculateStreakBonus(character: CharacterXP): number {
    if (!this.config.streakRewards.enabled) return 1.0;

    const streaks = character.streaks;
    if (streaks.currentStreak < 2) return 1.0;

    // Different multipliers for same vs different task streaks
    const multiplier = streaks.currentStreak >= 5 ?
      this.config.streakRewards.sameTaskMultiplier :
      this.config.streakRewards.differentTaskMultiplier;

    // Apply streak bonus with diminishing returns
    const streakBonus = Math.pow(multiplier, Math.min(streaks.currentStreak, 10));

    return Math.min(streakBonus, this.config.streakRewards.maxStreakBonus);
  }

  private calculateTimeBonus(task: DetectedTask): number {
    // This would normally use actual timing data
    // For now, return 1.0 (no bonus)
    return 1.0;
  }

  private createBreakdown(
    task: DetectedTask,
    baseXP: number,
    modifiers: XPModifier[],
    totalXP: number
  ): XPBreakdown {
    return {
      taskType: task.type,
      baseValue: baseXP,
      difficultyMultiplier: modifiers.find(m => m.type === 'difficulty')?.value || 1.0,
      qualityMultiplier: modifiers.find(m => m.type === 'quality')?.value || 1.0,
      skillBonus: modifiers.find(m => m.type === 'skill')?.value || 1.0,
      streakBonus: modifiers.find(m => m.type === 'streak')?.value || 1.0,
      timeBonus: modifiers.find(m => m.type === 'time')?.value || 1.0,
      finalTotal: totalXP
    };
  }

  private async checkLevelUps(character: CharacterXP, xpGained: number): Promise<LevelUpInfo[]> {
    const levelUps: LevelUpInfo[] = [];
    let remainingXP = character.currentXP + xpGained;
    let currentLevel = character.currentLevel;

    while (currentLevel < this.config.levelScaling.maxLevel) {
      const xpForNext = this.getXPForNextLevel(currentLevel);

      if (remainingXP >= xpForNext) {
        remainingXP -= xpForNext;
        currentLevel++;

        levelUps.push({
          newLevel: currentLevel,
          skillPoints: 2, // Standard skill points per level
          abilityImprovements: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
            .slice(0, currentLevel % 4 + 1) // More improvements at higher levels
        });
      } else {
        break;
      }
    }

    return levelUps;
  }

  private async applyXP(character: CharacterXP, xpGained: number, task: DetectedTask): Promise<void> {
    // Update XP totals
    character.totalXP += xpGained;
    character.currentXP += xpGained;

    // Check for level up
    while (character.currentXP >= character.xpToNextLevel && character.currentLevel < this.config.levelScaling.maxLevel) {
      character.currentXP -= character.xpToNextLevel;
      character.currentLevel++;
      character.xpToNextLevel = this.getXPForNextLevel(character.currentLevel);
    }

    // Update task history
    character.recentTasks.unshift({
      taskType: task.type,
      timestamp: new Date(),
      xpGained,
      quality: task.confidence
    });

    // Keep only recent history
    character.recentTasks = character.recentTasks.slice(0, 20);

    // Update streaks
    this.updateStreaks(character, task);

    // Persist changes
    await this.persistCharacterXP(character);
  }

  private updateStreaks(character: CharacterXP, task: DetectedTask): void {
    const streaks = character.streaks;
    const now = new Date();

    if (streaks.lastTaskType === task.type) {
      // Same task type - continue streak
      streaks.currentStreak++;
    } else {
      // Different task type - start new streak
      streaks.currentStreak = 1;
      streaks.lastTaskType = task.type;
      streaks.streakStartTime = now;
    }

    streaks.longestStreak = Math.max(streaks.longestStreak, streaks.currentStreak);
  }

  private async getOrLoadCharacterXP(characterId: string): Promise<CharacterXP> {
    let character = this.characterXP.get(characterId);

    if (!character) {
      // Load from database (simulated for now)
      character = await this.loadCharacterXPFromDatabase(characterId);
      this.characterXP.set(characterId, character);
    }

    return character;
  }

  private async loadCharacterXPFromDatabase(characterId: string): Promise<CharacterXP> {
    // This would connect to actual database
    return {
      characterId,
      currentLevel: 1,
      currentXP: 0,
      totalXP: 0,
      xpToNextLevel: this.getXPForNextLevel(1),
      recentTasks: [],
      streaks: {
        currentStreak: 0,
        longestStreak: 0,
        lastTaskType: null,
        streakStartTime: null
      }
    };
  }

  private async persistCharacterXP(character: CharacterXP): Promise<void> {
    // This would save to database
    this.characterXP.set(character.id, character);
  }

  private async persistAllXPData(): Promise<void> {
    // Save all character XP data to database
    // Implementation would go here
  }

  // Event handlers

  private async handleTaskDetected(data: { task: DetectedTask; characterId?: string }): Promise<void> {
    if (data.characterId) {
      try {
        const reward = await this.calculateXP(data.task, data.characterId);

        if (this.config.debugMode) {
          console.log(`[XPCalculation] Awarded ${reward.totalXP} XP for ${data.task.type}`);
        }
      } catch (error) {
        console.error('[XPCalculation] Error calculating XP:', error);
      }
    }
  }

  private async handleCharacterLoaded(data: { characterId: string; character: any }): Promise<void> {
    // Pre-load XP data when character is loaded
    await this.getOrLoadCharacterXP(data.characterId);
  }

  private async handleCombatEnded(data: { results: any; characterId: string }): Promise<void> {
    // Combat-specific XP calculation could be enhanced here
    // For now, rely on task detection
  }
}

// Global instance
export const xpCalculationService = new XPCalculationService();
