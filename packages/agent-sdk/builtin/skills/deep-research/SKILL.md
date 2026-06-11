---
name: deep-research
description: Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report
context: fork
---

Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.

BEFORE invoking the workflow, check if the question is specific enough to research directly — if underspecified (e.g., "what car to buy" without budget/use-case/region), ask 2-3 clarifying questions to narrow scope. Then pass the refined question as args, weaving the answers in.

1. Call the Workflow tool with the following script, passing the user's question as the `args` parameter:

```
export const meta = {
  name: 'deep-research',
  description: 'Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report',
  phases: [
    { title: 'Scope', detail: 'decompose question into 5 search angles' },
    { title: 'Search', detail: '5 parallel web searches, one per angle' },
    { title: 'Fetch', detail: 'URL-dedup, fetch top 15 sources, extract falsifiable claims' },
    { title: 'Verify', detail: '3-vote adversarial verification per claim' },
    { title: 'Synthesize', detail: 'merge semantic dupes, rank by confidence, cite sources' },
  ],
}

const question = args

phase('Scope')
const angles = await agent(
  'Decompose this research question into exactly 5 distinct search angles that together provide comprehensive coverage: "' + question + '"\n\nReturn a JSON array of 5 short angle labels. Example: ["overview and background", "technical details and specifications", "recent developments and news", "alternative perspectives and criticisms", "practical implications and case studies"]',
  { label: 'scope', phase: 'Scope' }
)
const angleList = (() => {
  try {
    const match = String(angles).match(/\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) : ['overview', 'technical details', 'recent developments', 'alternative perspectives', 'practical implications']
  } catch { return ['overview', 'technical details', 'recent developments', 'alternative perspectives', 'practical implications'] }
})()

phase('Search')
const searches = await parallel(angleList.map(angle => () =>
  agent('Web search for: "' + question + '" — focus on ' + angle + '. Return all relevant URLs and key findings.', {
    label: 'search:' + angle,
    phase: 'Search'
  })
))

phase('Fetch')
const allUrls = searches.filter(Boolean).flatMap(r => {
  if (typeof r !== 'string') return []
  return r.split('\n').filter(l => l.trim().startsWith('http') || l.trim().startsWith('- http'))
}).map(u => u.replace(/^-\s*/, '').trim())
const sources = [...new Set(allUrls)].slice(0, 15)
const fetched = await pipeline(sources.length > 0 ? sources : ['No specific URLs found — synthesize from search results'], source =>
  agent('Fetch and extract key falsifiable claims from: ' + source + '. For each claim, note the source URL and whether it is supported by evidence. Return each claim as a separate bullet.', {
    label: 'fetch:' + String(source).slice(0, 30),
    phase: 'Fetch'
  })
)

phase('Verify')
const claimsText = fetched.filter(Boolean).join('\n')
const claimLines = claimsText.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•') || l.trim().startsWith('*'))
const claimsToVerify = claimLines.length > 0 ? claimLines : [claimsText]
const verified = await parallel(claimsToVerify.slice(0, 12).map((claim, i) => () =>
  parallel([0, 1, 2].map(voteIdx => () =>
    agent('You are a skeptical fact-checker (vote ' + (voteIdx + 1) + '/3). For the following claim, search for evidence that REFUTES it. Claim: "' + claim + '"\n\nIf you find strong evidence against it, respond REFUTED with the counter-evidence. If the claim holds up, respond CONFIRMED. Be rigorous — only refute if you find direct contradictory evidence.', {
      label: 'verify:claim' + i + ':vote' + voteIdx,
      phase: 'Verify'
    })
  ))
))
const verifiedClaims = verified.flatMap((votes, i) => {
  if (!Array.isArray(votes)) return []
  const refutes = votes.filter(v => String(v).toUpperCase().includes('REFUTED')).length
  return refutes >= 2 ? [] : [{ claim: claimsToVerify[i], status: refutes === 0 ? 'confirmed' : 'contested', votes }]
})

phase('Synthesize')
const confirmedClaims = verifiedClaims.filter(c => c.status === 'confirmed').map(c => c.claim).join('\n')
const contestedClaims = verifiedClaims.filter(c => c.status === 'contested').map(c => c.claim + ' (contested)').join('\n')
const report = await agent(
  'Synthesize a comprehensive cited report answering: "' + question + '".\n\nConfirmed claims:\n' + (confirmedClaims || 'None') + '\n\nContested claims (include with caveat):\n' + (contestedClaims || 'None') + '\n\nMerge semantic duplicates. Rank findings by confidence level. Include: 1) Executive summary 2) Key findings with citations, ranked by confidence 3) Contested findings (with caveats) 4) Areas of uncertainty 5) Conclusion.',
  { label: 'synthesize', phase: 'Synthesize' }
)

return report
```

2. After the workflow starts, inform the user that deep research is running and they can use /workflows to monitor progress.
