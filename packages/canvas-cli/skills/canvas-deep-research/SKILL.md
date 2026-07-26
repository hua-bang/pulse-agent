---
name: canvas-deep-research
description: Source-backed, representation-aware research workflow for Pulse Canvas bootstrapping, due diligence, technical/product/market landscape analysis, current-state research, and canvas tasks that need reliable evidence before artifact creation. Use when canvas-bootstrap or canvas-frame-research needs a research brief with sources, uncertainty, and justified candidates for cards, mindmaps, interactive HTML, images, or spatial relationships.
---

# Canvas Deep Research

Produce evidence-backed research briefs with explicit scope, source quality, uncertainty, and a reusable handoff for downstream artifacts such as reports, plans, or canvas workspaces.

## Operating Modes

- If the user directly requests research and has not provided scope or depth, ask for the missing scope and a depth choice before searching.
- If a parent skill supplies an approved scope, depth, and plan, proceed without re-asking the user.
- Use the user's language for questions and final synthesis unless a source quote or artifact format requires otherwise.
- Browse the web for current, unstable, niche, legal, medical, financial, market, product, standards, API, or vendor facts.
- Prefer primary and official sources for facts about products, APIs, policies, specs, prices, regulations, organizations, and people.
- Do not fabricate sources, dates, quotes, statistics, or consensus. Label inference as inference.
- This skill does not mutate canvas nodes or files by itself. Return structured research that another skill can use.

## Depth Levels

- `quick`: 1-2 research angles, a small set of high-signal sources, concise findings, and clear caveats. Use for orientation or low-stakes decisions.
- `standard`: 3-5 research angles, primary plus credible secondary sources, conflict checks, source ledger, and an actionable synthesis. Use as the default for canvas bootstrap work.
- `deep`: staged passes across primary sources, expert or institutional sources, recent developments, counterarguments, contradictions, and open questions. Use for high-stakes or strategy-shaping work.

When the user asks for "high quality" or "deep research" without a depth, default to `deep` only after confirming the time/cost tradeoff if the work is user-facing. Parent skills may choose `deep` from an approved plan.

## Workflow

### 1. Define the Research Contract

Capture:

- topic and decision context
- intended audience
- research depth
- date range and geography, if relevant
- must-include and must-exclude areas
- success criteria for a good answer

If user-facing, present the contract briefly and ask for approval before a long research pass unless the user already approved a plan.

### 2. Plan Before Searching

Draft a short research plan:

- core questions to answer
- source strategy by question
- expected source types, such as official docs, standards, datasets, research papers, company filings, reputable media, or local files
- contradiction checks and risk areas
- output shape, including whether a canvas handoff is needed

For `deep`, split the plan into multiple passes so findings from early passes can refine later searches.

### 3. Collect Evidence

For each source used, record:

- stable source id, such as `S1`
- title
- publisher or author
- date published or updated when visible
- URL or local path
- source type
- why it is relevant

Use short quotes only when exact wording matters. Otherwise paraphrase and cite the source id.

### 4. Cross-Check and Synthesize

- Compare claims across source types before treating them as settled.
- Separate "what sources say" from "what this implies".
- Surface conflicts, stale data, weak evidence, and missing information.
- Prefer fewer strong findings over many thin observations.
- Assign confidence per major finding: `high`, `medium`, or `low`.

### 5. Produce the Research Brief

Return a brief with this structure when possible:

```yaml
research_brief:
  scope: "What was researched"
  depth: "quick | standard | deep"
  executive_summary:
    - "Most important takeaway"
  key_findings:
    - claim: "Evidence-backed finding"
      support: ["S1", "S2"]
      confidence: "high | medium | low"
      implication: "Why this matters"
  contradictions:
    - issue: "Where sources disagree or evidence is weak"
      sources: ["S3", "S4"]
  source_ledger:
    - id: "S1"
      title: "Source title"
      publisher: "Publisher"
      date: "Published or updated date, if available"
      url_or_path: "URL or local path"
      type: "official | primary | paper | dataset | media | local | other"
      note: "Why it was used"
  open_questions:
    - "Question that remains unresolved"
  canvas_candidates:
    frames:
      - title: "Frame title"
        purpose: "Why this grouping exists"
        nodes:
          - title: "Node title"
            summary: "Content to place in the node"
            source_ids: ["S1"]
    edges:
      - from: "Frame or node title"
        to: "Frame or node title"
        label: "Relationship"
        kind: "flow | dependency | reference | contrast"
    representations:
      - type: "file | mindmap | html | image | frames-edges"
        purpose: "Why this representation improves understanding"
        source_ids: ["S1"]
        learning_question: "Required for HTML; what should interaction clarify?"
        interaction:
          variables: ["Meaningful variable a user can change"]
          feedback: "What changes visibly and what relationship it reveals"
          takeaway: "Durable conclusion to preserve in a searchable card"
        fallback: "Simpler representation if the preferred node type is unavailable"
```

Keep `canvas_candidates` concise. Omit fields that do not apply. It is a handoff, not a final layout or an instruction to create every proposed representation.

## Canvas Handoff Rules

When another skill such as `canvas-bootstrap` will create a canvas:

- Organize findings into natural frames, not a fixed template.
- Suggest 3-6 frames for most topics.
- Suggest 2-4 substantial content nodes per frame.
- Include source ids inside each node summary so final canvas content can cite evidence.
- Include only meaningful edges; avoid connecting everything to everything.
- Mark draft, uncertain, or assumption-heavy nodes clearly.
- Recommend a mindmap only for a genuine hierarchy, taxonomy, decomposition, or branching question.
- Recommend HTML only when manipulating meaningful variables can clarify causality, relationships, trade-offs, sequence, scale, or counterfactual outcomes. Static display alone is not sufficient.
- Recommend images for visual evidence, diagrams, photographs, or explanations that materially benefit from visual form. Include provenance or the evidence source.
- Keep ordinary prose and durable conclusions in file cards. Do not rasterize editable text or propose rich nodes merely for decoration.
- Let the downstream canvas skill make the final representation and layout decision.
