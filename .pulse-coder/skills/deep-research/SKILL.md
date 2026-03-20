---
name: deep-research
description: Conduct high-quality multi-round research with explicit evidence tracking, source scoring, and synthesis.
version: 2.0.0
author: Pulse Coder Team
---

# Deep Research Skill

This skill is for serious research tasks where shallow summaries are not enough.
Use it to build evidence-backed conclusions through iterative search, extraction, and validation.

## When to Use

Use deep-research when you need to:
- Build a reliable understanding of a complex topic.
- Compare multiple approaches, vendors, or technical designs.
- Validate claims with primary sources and recent updates.
- Produce decision-ready output instead of a generic summary.

Do not use deep-research for simple factual lookups that need only 1-2 queries.

## Research Quality Bar

Always optimize for:
- Coverage: enough breadth to avoid tunnel vision.
- Depth: enough source detail to avoid summary-only output.
- Verifiability: each key claim can be traced to sources.
- Freshness: prefer recent material when recency matters.
- Actionability: conclusions include practical implications.

## Required Workflow

### 0) Frame the task first
Before searching, identify:
- Goal: what decision or understanding is needed.
- Scope: topic boundaries, region, timeframe, language.
- Output shape: comparison, recommendation, landscape, etc.

If critical constraints are missing, ask one concise clarification question.

### 1) Search in rounds (default 6-10 rounds)
Run iterative rounds and avoid repeating near-identical queries.

Per round, briefly track:
- Query used
- Intent of this query
- New findings (what changed vs prior rounds)
- Open gaps to resolve next

Suggested progression:
- Rounds 1-2: landscape and terminology
- Rounds 3-6: focused deep dives by subtopic
- Rounds 7-10: cross-checking, edge cases, and updates

If the user explicitly asks for very broad coverage (for example 30+ or 50+ rounds),
use batching by subtopic and still maintain dedup and evidence quality.

### 2) Source selection and scoring (required)
For important claims, prefer sources in this order:
1. Official docs, standards, maintainers, first-party publications
2. Reputable technical analyses with concrete evidence
3. Community posts only as supplementary context

For each key source, judge quickly on:
- Authority (official or expert)
- Recency (is date still relevant)
- Evidence density (examples, data, implementation detail)
- Bias risk (marketing-only or unsupported claims)

### 3) Extract beyond snippets when needed
Search snippets are often insufficient.
When a source is important but ambiguous, read/extract fuller content before concluding.

### 4) Cross-validate before final claims
Before finalizing, verify critical points across multiple independent sources.
Explicitly flag:
- Consensus points
- Conflicts or disputed claims
- Unknowns that remain unresolved

### 5) Stop criteria
Stop when all are true:
- Core questions are answered
- Major contradictions are addressed
- Additional rounds produce low novelty

Otherwise continue with targeted rounds.

## Query Strategy Guidelines

Use query patterns such as:
- "<topic> official documentation"
- "<topic> architecture tradeoffs"
- "<topic> benchmark OR case study"
- "<topic> limitations OR failure modes"
- "<topic> 2025 OR 2026 update"

Avoid low-value repetition:
- Do not run semantically duplicate queries unless testing source drift.
- Do not over-index on one domain unless it is primary documentation.

## Output Format (Required)

Return results in this structure:

**Overview**
- Research objective and scope
- 3-6 key takeaways

**Detailed Findings**
- Grouped by subtopic
- Include concrete facts, not only opinions
- Attach source links to important claims

**Evidence Matrix**
- Claim
- Confidence (high/medium/low)
- Supporting sources (2+ when possible)
- Notes on caveats or conflicts

**Comparison and Trade-offs** (when applicable)
- Option A/B/C with pros, cons, and fit scenarios

**Recommendations** (when applicable)
- Clear, prioritized actions
- Short rationale for each action

**Gaps and Open Questions**
- What is still uncertain
- What to verify next if deeper research is needed

**Sources**
- Group links by primary vs secondary
- Prefer clean, non-duplicate URLs

## Style and Reliability Rules

- Be explicit about uncertainty; do not fake confidence.
- Distinguish facts from interpretation.
- Do not present a single-source claim as settled truth.
- If evidence is weak, say so and recommend next checks.

## Optional Post-Research Follow-up

After delivering research, optionally ask one follow-up question only when useful:
- "Do you want me to generate a frontend static webpage for this research summary?"

If user says yes:
- Detect available frontend and deployment skills at runtime.
- Build a readable static page with:
  - concise overview
  - expandable details (for example via <details>)
  - sources with links
- Return deployment details: site_id, path, URL, local verify result.

If user says no:
- End cleanly, and mention webpage generation can be requested later.
