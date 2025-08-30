"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskDetectionService = exports.TaskDetectionService = void 0;
const BaseService_1 = require("../../services/BaseService");
class TaskDetectionService extends BaseService_1.BaseService {
    constructor() {
        super('TaskDetectionService', { performanceBudget: 10 });
        this.patterns = [];
        this.contextHistory = [];
        this.maxHistorySize = 10;
        this.initializePatterns();
    }
    async onInitialize() {
        this.eventBus.on('message:received', this.handleMessageReceived.bind(this));
        this.eventBus.on('combat:ended', this.handleCombatEnded.bind(this));
        this.eventBus.on('task:detected', this.handleTaskDetected.bind(this));
        console.log('[TaskDetection] Initialized with', this.patterns.length, 'detection patterns');
    }
    async onShutdown() {
        this.contextHistory = [];
        console.log('[TaskDetection] Shut down');
    }
    async detectTasks(message) {
        return this.measureOperation('detectTasks', async () => {
            const normalizedMessage = message.toLowerCase().trim();
            const detectedTasks = [];
            for (const pattern of this.patterns) {
                const match = normalizedMessage.match(pattern.regex);
                if (match) {
                    const task = await this.createTaskFromMatch(pattern, match, message);
                    if (task.confidence >= 0.3) {
                        detectedTasks.push(task);
                    }
                }
            }
            detectedTasks.sort((a, b) => b.confidence - a.confidence);
            const topTasks = detectedTasks.slice(0, 3);
            for (const task of topTasks) {
                this.enhanceWithContext(task);
            }
            this.contextHistory.unshift(...topTasks);
            this.contextHistory = this.contextHistory.slice(0, this.maxHistorySize);
            if (topTasks.length > 0) {
                this.eventBus.emit('tasks:detected', { tasks: topTasks });
            }
            return topTasks;
        });
    }
    getRecentContext() {
        return [...this.contextHistory];
    }
    async testDetection(message) {
        const tasks = await this.detectTasks(message);
        console.log('[TaskDetection] Test results for:', message);
        tasks.forEach(task => {
            console.log(`  ${task.type.toUpperCase()}: ${task.confidence.toFixed(2)} confidence`);
            console.log(`    Details: ${JSON.stringify(task.details)}`);
        });
        return tasks;
    }
    initializePatterns() {
        this.patterns = [
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
            {
                type: 'rest',
                regex: /\b(?:rests?|sleeps?|takes?\s+a\s+break|recovers?|heals?)\b/i,
                weight: 0.7
            },
            {
                type: 'travel',
                regex: /\b(?:travels?|journeys?|heads?|moves?)\s+(?:to|toward|towards)\s+(?:the\s+)?(\w+)/i,
                weight: 0.75,
                extractors: {
                    action: /\b(?:travels?|journeys?|heads?|moves?)\b/i,
                    location: /\b(?:the\s+)?(\w+)$/i
                }
            },
            {
                type: 'trade',
                regex: /\b(?:buys?|sells?|trades?|barters?|purchases?)\s+(?:a\s+)?(\w+)/i,
                weight: 0.8,
                extractors: {
                    action: /\b(?:buys?|sells?|trades?|barters?|purchases?)\b/i,
                    items: /\b(?:a\s+)?(\w+)$/i
                }
            },
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
    async createTaskFromMatch(pattern, match, originalMessage) {
        const confidence = this.calculateConfidence(pattern, match, originalMessage);
        const details = {};
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
        if (pattern.type === 'social') {
            details.socialContext = this.extractSocialContext(originalMessage);
        }
        details.difficulty = this.estimateDifficulty(originalMessage);
        return {
            type: pattern.type,
            confidence,
            details,
            originalMessage,
            timestamp: new Date()
        };
    }
    calculateConfidence(pattern, match, message) {
        let confidence = pattern.weight;
        if (match[0].length > 10) {
            confidence += 0.1;
        }
        const keywords = pattern.regex.source.split('|').filter(k => k.length > 3);
        const keywordMatches = keywords.filter(keyword => new RegExp(keyword, 'i').test(message)).length;
        confidence += (keywordMatches - 1) * 0.05;
        return Math.min(confidence, 1.0);
    }
    extractFromRegex(regex, text) {
        if (!regex)
            return undefined;
        const match = text.match(regex);
        return match ? match[1] || match[0] : undefined;
    }
    extractSocialContext(message) {
        const context = {};
        if (/\b(loves?|adores?|cherishes?|cares?\s+about)\b/i.test(message)) {
            context.tone = 'romantic';
        }
        else if (/\b(hates?|despises?|attacks?|fights?)\b/i.test(message)) {
            context.tone = 'hostile';
        }
        else if (/\b(friends?|allies?|helps?|assists?)\b/i.test(message)) {
            context.tone = 'friendly';
        }
        else {
            context.tone = 'neutral';
        }
        context.persuasion = /\b(persuades?|convinces?|intimidates?|bluffs?|diplomacy)\b/i.test(message);
        return context;
    }
    estimateDifficulty(message) {
        let difficulty = 1;
        if (/\b(difficult|hard|tough|dangerous|risky)\b/i.test(message))
            difficulty += 1;
        if (/\b(epic|legendary|master|expert)\b/i.test(message))
            difficulty += 1;
        if (/\b(boss|elite|champion|guardian)\b/i.test(message))
            difficulty += 2;
        return Math.min(difficulty, 5);
    }
    enhanceWithContext(task) {
        const relatedTasks = this.contextHistory.filter(t => t.type === task.type &&
            (Date.now() - t.timestamp.getTime()) < 300000);
        if (relatedTasks.length > 0) {
            task.confidence = Math.min(task.confidence + 0.1, 1.0);
        }
    }
    async handleMessageReceived(data) {
        try {
            const tasks = await this.detectTasks(data.message);
            for (const task of tasks) {
                this.eventBus.emit('task:detected', {
                    task,
                    characterId: data.characterId
                });
            }
        }
        catch (error) {
            console.error('[TaskDetection] Error processing message:', error);
        }
    }
    async handleCombatEnded(data) {
        this.contextHistory = this.contextHistory.filter(task => task.type !== 'combat');
    }
    async handleTaskDetected(data) {
        if (this.config.debugMode) {
            console.log(`[TaskDetection] Detected: ${data.task.type} (${data.task.confidence.toFixed(2)})`);
        }
    }
}
exports.TaskDetectionService = TaskDetectionService;
exports.taskDetectionService = new TaskDetectionService();
