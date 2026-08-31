#!/usr/bin/env node

/**
 * Gauntlet Runner CLI Entry Point
 * 
 * Replaces query.mjs with TypeScript-based execution
 */

import { GauntletRunner } from '../src/runners/GauntletRunner.js';

async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h') || args.length === 0) {
      const runner = new GauntletRunner({ verbose: true });
      runner.printHelp();
      process.exit(0);
    }

    const runner = new GauntletRunner({ 
      verbose: true,
      saveResults: true,
    });

    const result = await runner.runFromArgs(args);
    
    console.log('\n=== Gauntlet Run Summary ===');
    console.log(`Run ID: ${result.sessionId}`);
    console.log(`Query: ${result.query}`);
    console.log(`Rounds: ${result.rounds.length}`);
    console.log(`Duration: ${(result.totalDuration / 1000).toFixed(2)}s`);
    console.log(`Early Terminated: ${result.earlyTerminated}`);
    if (result.terminationReason) {
      console.log(`Reason: ${result.terminationReason}`);
    }
    if (result.finalQualityScore !== undefined) {
      console.log(`Final Quality: ${(result.finalQualityScore * 100).toFixed(1)}%`);
    }

    // Print round details
    for (const round of result.rounds) {
      console.log(`\n--- Round ${round.roundNumber} ---`);
      console.log(`  Duration: ${(round.duration / 1000).toFixed(2)}s`);
      console.log(`  Executions: ${round.executions.length}`);
      console.log(`  Successful: ${round.executions.filter(e => e.success).length}`);
      console.log(`  Quality: ${round.qualityScore ? (round.qualityScore * 100).toFixed(1) + '%' : 'N/A'}`);
      if (round.earlyTerminated) {
        console.log(`  Early Terminated: ${round.terminationReason}`);
      }
    }

    console.log('\nRun completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();