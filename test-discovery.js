import { readFileSync } from 'fs';
import { discoverTaskTypes, generateDiscoveryReport } from './src/discovery/index.js';

async function testDiscovery() {
  console.log('Testing Discovery Engine...\n');
  
  // Load test SOUL.md
  const soulContent = readFileSync('./test/fixtures/SOUL.md', 'utf8');
  
  console.log('SOUL.md content preview:');
  console.log(soulContent.substring(0, 500) + '...\n');
  
  // Run discovery
  console.log('Discovering task types...');
  const results = await discoverTaskTypes(soulContent);
  
  // Generate report
  const report = generateDiscoveryReport(results);
  console.log(report);
  
  // Show specific findings
  console.log('\n=== Key Findings ===');
  console.log(`Total tasks found: ${results.totalTasks}`);
  console.log(`Known tasks: ${results.knownTasks.length}`);
  console.log(`Unknown tasks: ${results.unknownTasks.length}`);
  console.log(`New discoveries: ${results.newlyDiscovered.length}`);
  
  if (results.unknownTasks.length > 0) {
    console.log('\nUnknown tasks that need classification:');
    results.unknownTasks.forEach((task, i) => {
      console.log(`${i + 1}. "${task.description}" → ${task.classification.taskType} (confidence: ${task.classification.confidence})`);
    });
  }
}

testDiscovery().catch(console.error);