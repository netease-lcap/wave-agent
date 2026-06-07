---
name: deep-research
description: Investigate a question across many sources with cross-checking
context: fork
---

Investigate the user's question using a multi-phase workflow with cross-checking.

1. Call the Workflow tool with the following script, replacing QUESTION with the user's question:

```
export const meta = {
  name: 'deep-research',
  description: 'Investigate a question across many sources with cross-checking',
  phases: [
    { title: 'Search', detail: 'fan out web searches across angles' },
    { title: 'Fetch', detail: 'deep-read each source' },
    { title: 'Verify', detail: 'cross-check and vote on claims' },
    { title: 'Synthesize', detail: 'produce cited report' },
  ],
}

const question = args

phase('Search')
const angles = ['overview', 'technical details', 'recent developments', 'alternative perspectives']
const searches = await parallel(angles.map(angle => () =>
  agent('Web search for: "' + question + '" — focus on ' + angle + '. Return all relevant URLs and key findings.', {
    label: 'search:' + angle,
    phase: 'Search'
  })
))

phase('Fetch')
const sources = searches.filter(Boolean).flatMap(r => {
  if (typeof r !== 'string') return []
  return r.split('\n').filter(l => l.trim().startsWith('http') || l.trim().startsWith('- http'))
}).slice(0, 20)
const fetched = await pipeline(sources.length > 0 ? sources : ['No specific URLs found — synthesize from search results'], source =>
  agent('Fetch and extract key claims from: ' + source + '. For each claim, note the source URL or context.', {
    label: 'fetch:' + String(source).slice(0, 30),
    phase: 'Fetch'
  })
)

phase('Verify')
const claimsText = fetched.filter(Boolean).join('\n')
const verified = await agent(
  'Review these research findings about: "' + question + '"\n\n' + claimsText + '\n\nCross-check claims for consistency. Flag any contradictions or unsupported assertions. Return a list of confirmed claims with their sources.',
  { label: 'verify', phase: 'Verify' }
)

phase('Synthesize')
const report = await agent(
  'Synthesize a comprehensive cited report answering: "' + question + '". Use the following verified findings:\n\n' + (verified || claimsText) + '\n\nInclude: 1) Executive summary 2) Key findings with citations 3) Areas of uncertainty 4) Conclusion. Filter out any claims that were refuted during verification.',
  { label: 'synthesize', phase: 'Synthesize' }
)

return report
```

Pass the user's question as the `args` parameter to the Workflow tool.

2. After the workflow starts, inform the user that deep research is running and they can use /workflows to monitor progress.
