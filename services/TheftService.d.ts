/**
 * Theft Service - Manages Theft Mechanics and Security Systems
 *
 * Critical innovation: Realistic theft system with detection mechanics,
 * security countermeasures, and meaningful consequences that create
 * strategic gameplay around guild resource protection.
 */
import { BaseService } from './BaseService';
import { TheftConsequence } from '../../src/types';
export interface TheftConfig {
    enabled: boolean;
    baseDetectionChance: number;
    securityMultiplier: number;
    skillImportance: number;
    alarmCooldown: number;
    bountySystemEnabled: boolean;
    reputationImpactEnabled: boolean;
}
export interface SecurityMeasure {
    id: string;
    name: string;
    type: 'alarm' | 'trap' | 'guard' | 'magical' | 'mechanical';
    detectionChance: number;
    triggerChance: number;
    severity: number;
    cost: number;
    description: string;
    effects: TheftConsequence[];
}
export interface TheftResult {
    success: boolean;
    detected: boolean;
    stolenItems: Array<{
        itemId: string;
        quantity: number;
    }>;
    consequences: TheftConsequence[];
    detectionMethod?: string;
    stolenValue: number;
}
export interface Bounty {
    id: string;
    thiefId: string;
    storageId: string;
    amount: number;
    reason: string;
    postedBy: string;
    expiresAt: Date;
    claimed: boolean;
}
export declare class TheftService extends BaseService {
    private config;
    private securityMeasures;
    private activeAlarms;
    private bounties;
    constructor(config?: Partial<TheftConfig>);
    protected onInitialize(): Promise<void>;
    protected onShutdown(): Promise<void>;
    /**
     * Attempt theft from guild storage
     */
    attemptTheft(thiefId: string, storageId: string, targetItems: Array<{
        itemId: string;
        quantity: number;
    }>, thiefSkill?: number): Promise<TheftResult>;
    /**
     * Install security measure on storage
     */
    installSecurityMeasure(storageId: string, measureId: string, installerId: string): Promise<{
        success: boolean;
        measure: SecurityMeasure;
        cost: number;
    }>;
    /**
     * Post bounty for thief
     */
    postBounty(thiefId: string, storageId: string, amount: number, posterId: string, reason: string): Promise<Bounty>;
    /**
     * Claim bounty
     */
    claimBounty(bountyId: string, claimantId: string): Promise<{
        success: boolean;
        amount: number;
        bounty: Bounty;
    }>;
    /**
     * Get security status for storage
     */
    getSecurityStatus(storageId: string): Promise<{
        securityLevel: number;
        activeMeasures: SecurityMeasure[];
        recentBreaches: number;
        alarmCooldownRemaining: number;
        vulnerabilityScore: number;
    }>;
    /**
     * Get available security measures
     */
    getAvailableSecurityMeasures(): SecurityMeasure[];
    /**
     * Get active bounties
     */
    getActiveBounties(storageId?: string): Bounty[];
    private calculateTheftSuccessChance;
    private calculateDetectionChance;
    private processSuccessfulTheft;
    private calculateStolenValue;
    private generateTheftConsequences;
    private triggerSecurityMeasures;
    private createTheftTransaction;
    private isAlarmOnCooldown;
    private setAlarmCooldown;
    private getAlarmCooldownRemaining;
    private getGuildStorage;
    private getSecurityMeasure;
    private initializeSecurityMeasures;
    private handleTheftAttempt;
    private handleAlarmTriggered;
    private handleBountyPosted;
    private handleBountyClaimed;
}
export declare const theftService: TheftService;
//# sourceMappingURL=TheftService.d.ts.map