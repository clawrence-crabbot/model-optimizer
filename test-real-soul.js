import { discoverTaskTypes, generateDiscoveryReport } from './src/discovery/index.js';

// Real SOUL.md section with "sub-agent coordination"
const realSoulSection = `**Action Task Track (specific routing per tool type):**
- ✅ Browser operations → Gemini 3 Flash
- ✅ Exec commands → Claude Haiku
- ✅ File operations → Gemini 2.5 Flash
- ✅ Web search/fetch → Gemini 3 Flash
- ✅ Process management → Claude Haiku
- ✅ GitHub CLI → Claude Haiku
- ✅ Sub-agent coordination → Claude Haiku
- ✅ Multi-step planning → DeepSeek Reasoner
- ✅ Requirements engineering (discovery, scope, acceptance criteria, NFRs, trade-offs) → DeepSeek Reasoner
- Calendar/email checking → Claude Haiku
- Research and synthesis → Gemini 3 Flash
- Complex problem-solving → DeepSeek Reasoner
- Analysis and breakdowns → DeepSeek Reasoner

**Further escalation:**
- Code changes: Claude Haiku first
- Debugging: Claude Haiku
- Formatting: Claude Haiku
- Summaries: Gemini 3 Flash
- File edits: cheap/simple edits use Gemini 2.5 Flash, higher risk edits use Haiku`;

async function testRealSoul() {
  console.log('Testing Discovery Engine with Real SOUL.md Section\n');
  console.log('Key test: Can it discover "sub-agent coordination"?\n');
  
  const results = await discoverTaskTypes(realSoulSection);
  const report = generateDiscoveryReport(results);
  console.log(report);
  
  // Check specifically for sub-agent coordination
  console.log('\n=== Special Check: Sub-agent Coordination ===');
  const subAgentTask = results.unknownTasks.find(t => 
    t.description.toLowerCase().includes('sub-agent') || 
    t.description.toLowerCase().includes('sub agent')
  );
  
  if (subAgentTask) {
    console.log(`Found: "${subAgentTask.description}"`);
    console.log(`Classified as: ${subAgentTask.classification.taskType}`);
    console.log(`Confidence: ${subAgentTask.classification.confidence}`);
    console.log(`Reasoning: ${subAgentTask.classification.reasoning}`);
    
    // Check if it was added to taxonomy
    const taxonomy = require('./data/taxonomy.json');
    const inTaxonomy = taxonomy.tasks.find(t => 
      t.id === subAgentTask.classification.taskType
    );
    console.log(`Added to taxonomy: ${inTaxonomy ? 'Yes' : 'No'}`);
  } else {
    console.log('Sub-agent coordination not found in unknown tasks');
    console.log('Checking known tasks...');
    const knownSubAgent = results.knownTasks.find(t => 
      t.description.toLowerCase().includes('sub-agent') || 
      t.description.toLowerCase().includes('sub agent')
    );
    if (knownSubAgent) {
      console.log(`Found in known tasks: "${knownSubAgent.description}" → ${knownSubAgent.taskType}`);
    } else {
      console.log('Not found at all! Check extraction logic.');
    }
  }
}

testRealSoul().catch(console.error);