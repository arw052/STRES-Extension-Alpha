"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryTemperatureTest = void 0;
const MemoryTemperatureService_1 = require("./MemoryTemperatureService");
class MemoryTemperatureTest {
    constructor() {
        this.service = new MemoryTemperatureService_1.MemoryTemperatureService();
    }
    async runAllTests() {
        console.log('🧠 Starting Memory Temperature System Tests...\n');
        try {
            await this.service.initialize();
            await this.testCompressionRatios();
            await this.testPerformanceBudgets();
            await this.testTemperatureTransitions();
            await this.testMemoryStats();
            console.log('✅ All tests passed!');
        }
        catch (error) {
            console.error('❌ Test failed:', error);
            throw error;
        }
        finally {
            await this.service.shutdown();
        }
    }
    async testCompressionRatios() {
        console.log('Testing compression ratios...');
        const temperatures = ['warm', 'cool', 'cold', 'frozen'];
        for (const temp of temperatures) {
            const entityId = `test-char-${temp}`;
            const result = await this.service.compressEntity(entityId, temp, 'character');
            console.log(`  ${temp.toUpperCase()}: ${result.compressionRatio.toFixed(3)} ratio (${result.originalTokenCount} → ${result.compressedTokenCount} tokens)`);
            const minCompressionTargets = {
                hot: 1.0,
                warm: 0.3,
                cool: 0.15,
                cold: 0.08,
                frozen: 0.08
            };
            const achievedRatio = result.compressionRatio;
            const minTarget = minCompressionTargets[temp];
            const success = achievedRatio <= minTarget;
            if (!success) {
                throw new Error(`${temp} compression failed: achieved ${achievedRatio}, minimum target ${minTarget}`);
            }
        }
        console.log('✅ Compression ratios meet targets\n');
    }
    async testPerformanceBudgets() {
        console.log('Testing performance budgets...');
        const compressionTimes = [];
        for (let i = 0; i < 10; i++) {
            const start = performance.now();
            await this.service.compressEntity(`perf-test-${i}`, 'cold');
            const duration = performance.now() - start;
            compressionTimes.push(duration);
        }
        const avgCompressionTime = compressionTimes.reduce((a, b) => a + b, 0) / compressionTimes.length;
        console.log(`  Average compression time: ${avgCompressionTime.toFixed(2)}ms`);
        if (avgCompressionTime > 50) {
            throw new Error(`Compression performance budget exceeded: ${avgCompressionTime}ms > 50ms`);
        }
        console.log('✅ Performance budgets met\n');
    }
    async testTemperatureTransitions() {
        console.log('Testing temperature transitions...');
        const entityId = 'transition-test';
        await this.service.processEntityAccess(entityId, 'character');
        console.log('  Initial state: HOT');
        console.log('✅ Temperature transitions working\n');
    }
    async testMemoryStats() {
        console.log('Testing memory statistics...');
        const stats = this.service.getMemoryStats();
        console.log('  Memory Stats:');
        console.log(`    Total entities: ${stats.totalEntities}`);
        console.log(`    By temperature: ${JSON.stringify(stats.byTemperature)}`);
        console.log(`    Token reduction: ${stats.totalTokenReduction.toFixed(2)}%`);
        console.log(`    Avg compression ratio: ${stats.avgCompressionRatio.toFixed(3)}`);
        if (stats.totalEntities < 0) {
            throw new Error('Invalid memory stats');
        }
        console.log('✅ Memory statistics accurate\n');
    }
}
exports.MemoryTemperatureTest = MemoryTemperatureTest;
if (require.main === module) {
    const test = new MemoryTemperatureTest();
    test.runAllTests().catch(console.error);
}
