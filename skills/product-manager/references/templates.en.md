# English Deliverable Templates

Copy the matching template and fill it section by section. Collect every `[TBD: xxx]` into the closing checklist.

---

## 1. Opportunity Assessment

```markdown
# Opportunity Assessment: [Name]
**Submitted by**: [PM]  **Date**: [date]  **Decision needed by**: [date]

## 1. Why Now?
- Market signal / behavior shift / competitive pressure: [specific signal with source]
- What happens if we wait 6 months: [cost of delay]

## 2. User Evidence
**Interviews** (n=[X])
- Theme 1: "[representative quote]" - observed in [X/Y] sessions
- Theme 2: "[representative quote]" - observed in [X/Y] sessions

**Behavioral Data**
- [Metric]: [current state] - indicates [interpretation]
- [Funnel step]: [X]% drop-off - hypothesis: [cause]

**Support Signal**
- [X] tickets/month mentioning [theme] - [Y]% of total volume
- NPS detractor comments: [recurring theme]

## 3. Business Case
- **Revenue impact**: [ARR lift, churn reduction, or upsell opportunity, with estimation method]
- **Cost impact**: [support cost reduction, infra savings]
- **Strategic fit**: [quote the relevant OKR]
- **Market sizing**: [TAM/SAM slice relevant to this feature]

## 4. RICE Score
| Factor | Value | Notes |
|---|---|---|
| Reach | [X users/quarter] | Source: [analytics / estimate] |
| Impact | [0.25 / 0.5 / 1 / 2 / 3] | [justification] |
| Confidence | [X%] | Based on: [interviews / data / analogous features] |
| Effort | [X person-months] | Eng t-shirt: [S/M/L/XL] |
| **RICE** | **(R x I x C) / E = [XX]** | |

## 5. Options Considered
| Option | Pros | Cons | Effort |
|---|---|---|---|
| Build full feature | [pros] | [cons] | L |
| MVP / scoped version | [pros] | [cons] | M |
| Buy / integrate partner | [pros] | [cons] | S |
| Defer 2 quarters | [pros] | [cons] | - |

## 6. Recommendation
**Decision**: Build / Explore further / Defer / Kill

**Rationale**: [2-3 sentences on the driving evidence and what would change the decision]

**Next step if approved**: [e.g. "Schedule design sprint for the week of [date]"]
**Owner**: [name]
```

---

## 2. PRD

```markdown
# PRD: [Feature / Initiative]
**Status**: Draft | In Review | Approved | In Development | Shipped
**Author**: [name]  **Last Updated**: [date]  **Version**: [X.X]
**Stakeholders**: [Eng Lead, Design Lead, Marketing, Legal if needed]

## 1. Problem Statement
- What specific user pain or business opportunity are we solving?
- Who experiences it, how often, and what is the cost of not solving it?

**Evidence**
- User research: [findings, n=X]
- Behavioral data: [metric showing the problem]
- Support signal: [ticket volume / theme]
- Competitive signal: [what competitors do or do not do]

## 2. Goals & Success Metrics
| Goal | Metric | Baseline | Target | Measurement Window |
|---|---|---|---|---|
| Improve activation | % completing setup | [X]% | [Y]% | 60 days post-launch |
| Reduce support load | Tickets/week on this topic | [X] | <[Y] | 90 days post-launch |
| Increase retention | 30-day return rate | [X]% | [Y]% | Q3 cohort |

## 3. Non-Goals
- We are not redesigning onboarding (separate initiative, Q4)
- No mobile support in v1 (analytics show <8% mobile usage for this flow)
- No admin-level configuration until the base behavior is validated

## 4. Personas & User Stories
**Primary Persona**: [Name] - [context, e.g. "Mid-market ops manager, 200-person company, daily user"]

**Story 1**: As a [persona], I want to [action] so that [measurable outcome].
**Acceptance Criteria**
- [ ] Given [context], when [action], then [expected result]
- [ ] Given [edge case], when [action], then [fallback behavior]
- [ ] Performance: [action] completes in under [X]ms for [Y]% of requests

**Story 2**: As a [persona], I want to [action] so that [measurable outcome].
**Acceptance Criteria**
- [ ] Given [context], when [action], then [expected result]

## 5. Solution Overview
[2-4 paragraphs: key UX flows, major interactions, core value delivered]
[Link to Figma mocks when available]

**Key Design Decisions**
- [Decision 1]: chose [A] over [B] because [reason]. Trade-off: [what we give up].
- [Decision 2]: deferring [X] to v2 because [reason].

## 6. Technical Considerations
**Dependencies**
- [System / team / API] - needed for [reason] - owner: [name] - timeline risk: [High/Med/Low]

**Known Risks**
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Third-party API rate limits | Medium | High | Request queuing + fallback cache |
| Data migration complexity | Low | High | Spike in week 1 to validate approach |

**Open Questions** (must close before dev starts)
- [ ] [Question] - Owner: [name] - Deadline: [date]

## 7. Launch Plan
| Phase | Date | Audience | Success Gate |
|---|---|---|---|
| Internal alpha | [date] | Team + 5 design partners | No P0 bugs, core flow complete |
| Closed beta | [date] | 50 opted-in customers | <5% error rate, CSAT >= 4/5 |
| GA rollout | [date] | 20% to 100% over 2 weeks | Metrics on target at 20% |

**Rollback Criteria**: If [metric] drops below [threshold] or error rate exceeds [X]%, revert the flag and page on-call.

## 8. Appendix
- User research recordings / notes
- Competitive analysis doc
- Design mocks (Figma link)
- Analytics dashboard link
- Relevant support tickets
```

---

## 3. Roadmap (Now / Next / Later)

```markdown
# Product Roadmap - [Team / Area] - [Quarter Year]

## North Star Metric
[The single metric that best captures user value and business health]
**Current**: [value]  **Target by EOY**: [value]

## Supporting Metrics
| Metric | Current | Target | Trend |
|---|---|---|---|
| [Activation rate] | [X]% | [Y]% | up / down / flat |
| [Retention D30] | [X]% | [Y]% | up / down / flat |
| [Feature adoption] | [X]% | [Y]% | up / down / flat |
| [NPS] | [X] | [Y] | up / down / flat |

## Now - Active This Quarter
Committed. Engineering, design, and PM fully aligned.

| Initiative | User Problem | Success Metric | Owner | Status | ETA |
|---|---|---|---|---|---|
| [Feature A] | [pain solved] | [metric + target] | [name] | In Dev | Week X |
| [Tech Debt X] | [engineering health] | [metric] | [name] | Scoped | Week X |

## Next - Next 1-2 Quarters
Directionally committed. Needs scoping before dev starts.

| Initiative | Hypothesis | Expected Outcome | Confidence | Blocker |
|---|---|---|---|---|
| [Feature C] | If we build X, users will Y | [metric target] | High | None |

## Later - 3-6 Month Horizon
Strategic bets. Not scheduled.

| Initiative | Strategic Hypothesis | Signal Needed to Advance |
|---|---|---|
| [Feature F] | [why it matters long-term] | [interview signal / usage threshold / competitive trigger] |

## What We Are Not Building (and Why)
| Request | Source | Reason for Deferral | Revisit Condition |
|---|---|---|---|
| [Request X] | [Sales / Customer / Eng] | [reason] | [condition] |
```

---

## 4. Go-to-Market Plan

```markdown
# Go-to-Market Plan: [Feature / Product]
**Launch Date**: [date]  **Launch Tier**: 1 (Major) / 2 (Standard) / 3 (Silent)
**PM Owner**: [name]  **Marketing DRI**: [name]  **Eng DRI**: [name]

## 1. What We Are Launching
[One paragraph: what it is, what problem it solves, why now]

## 2. Target Audience
| Segment | Size | Why They Care | Channel |
|---|---|---|---|
| Primary: [Persona] | [# users / % base] | [pain solved] | [channel] |
| Secondary: [Persona] | [# users] | [benefit] | [channel] |
| Expansion: [New segment] | [opportunity] | [hook] | [channel] |

## 3. Core Value Proposition
**One-liner**: [Feature] helps [persona] [achieve outcome] without [current friction].

| Audience | Their Language for the Pain | Our Message | Proof Point |
|---|---|---|---|
| End user | [how they describe it] | [message] | [quote / stat] |
| Buyer | [business framing] | [ROI message] | [case study / metric] |
| Internal champion | [what they need to convince peers] | [social proof] | [customer logo / win] |

## 4. Launch Checklist
**Engineering**
- [ ] Feature flag enabled for [cohort / %] by [date]
- [ ] Monitoring dashboards live with alert thresholds set
- [ ] Rollback runbook written and reviewed

**Product**
- [ ] In-app announcement copy approved
- [ ] Release notes written
- [ ] Help center article published

**Marketing**
- [ ] Blog post drafted, reviewed, scheduled for [date]
- [ ] Email to [segment] approved - send date [date]
- [ ] Social copy ready (LinkedIn, X)

**Sales / CS**
- [ ] Sales enablement deck updated by [date]
- [ ] CS trained - session on [date]
- [ ] FAQ for common objections published

## 5. Success Criteria
| Timeframe | Metric | Target | Owner |
|---|---|---|---|
| Launch day | Error rate | < 0.5% | Eng |
| 7 days | Feature activation | >= 20% | PM |
| 30 days | Retention of feature users vs. control | +8pp | PM |
| 60 days | Support tickets on topic | -30% | CS |
| 90 days | NPS delta for feature users | +5 | PM |

## 6. Rollback & Contingency
- **Rollback trigger**: error rate > [X]% OR [metric] below [threshold]
- **Rollback owner**: [name] - paged via [channel]
- **Communication plan**: [who to notify, template to use]
```

---

## 5. Sprint Health Snapshot

```markdown
# Sprint Health Snapshot - Sprint [N] - [Dates]

## Committed vs. Delivered
| Story | Points | Status | Blocker |
|---|---|---|---|
| [Story A] | 5 | Done | - |
| [Story B] | 8 | In Review | Waiting on design sign-off |
| [Story C] | 3 | Carried | External API delay |

**Velocity**: [X] pts committed / [Y] pts delivered ([Z]% completion)
**3-sprint rolling avg**: [X] pts

## Blockers & Actions
| Blocker | Impact | Owner | ETA |
|---|---|---|---|
| [Blocker] | [scope affected] | [name] | [date] |

## Scope Changes This Sprint
| Request | Source | Decision | Rationale |
|---|---|---|---|
| [Request] | [name] | Accept / Defer | [reason] |

## Risks Entering Next Sprint
- [Risk 1]: [mitigation in place]
- [Risk 2]: [owner tracking]
```

---

## 6. Standard Closing Sections

Append these two sections to every deliverable:

```markdown
## Open Questions
| # | What needs confirming | Affects section | Who to ask |
|---|---|---|---|
| 1 | [e.g. current activation baseline] | Success Metrics | [name / role] |

## Next Actions
| # | Action | Owner | Due |
|---|---|---|---|
| 1 | [action] | [name] | [date] |
```
