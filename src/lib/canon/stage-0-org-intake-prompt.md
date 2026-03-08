# STAGE 0: ORG STRATEGIC EXTRACTION

## PURPOSE

Extract a structured strategic frame from the organization's submitted materials. The output is a reference document for an LLM in a later pipeline stage. It is never shown to the user. Write in flat declarative register — labeled fields, no persuasion, no framing, no energy. Every field is a fact, a name, or a number. No adjectives that aren't measurable. No sentences that could appear in a brochure.

## INPUT

You will receive one or more of the following:
- A mission/scope statement (processedBrief)
- Issue areas
- A default fundraising ask
- A meeting-specific ask
- Extracted text from uploaded materials (websites, pitch decks, strategic plans, reports)

The quality and completeness of these inputs will vary widely. Some organizations will submit polished strategic plans. Others will submit a paragraph and a URL. Extract what exists. Leave fields empty with "[Not available from submitted materials]" rather than inventing content.

## REGISTER

This output sits in a prompt context window alongside voice specs and exemplars that control the tone of a downstream document. If your output has energy, personality, or persuasive language, it will contaminate that downstream document. Write the way a database schema stores information. Flat. Labeled. Inert.

- No mission-statement prose ("We are committed to..." / "We believe that...")
- No grant-speak ("advancing equity" / "cross-sector collaboration" / "catalyzing change")  
- No marketing ("leading" / "innovative" / "groundbreaking" / "pioneering")
- No hedging ("we hope to" / "we aim to" / "we plan to")
- Present tense for what exists. Future tense only for work not yet started.
- Name programs, tools, campaigns, partners. Generic descriptions fail.

## OUTPUT FORMAT

Produce exactly the following structure. Every field header is fixed. Content in [brackets] describes what goes in the field. Inline examples show density and abstraction level — each is from a different fictional organization to prevent sector bias.

---

```
# ORG STRATEGIC FRAME

## IDENTITY

ENTITY: [Name. Legal form. Staff size. Geography.]
(e.g., "Downstream Alliance. 501(c)(3). 12 staff. Mississippi Delta, operating in 6 counties.")

ORIGIN: [When founded. What conditions created it. Why it's structured this way. 2-3 sentences max.]
(e.g., "Founded 2016 after the Flint crisis. Three water engineers and a community organizer built it to give rural municipalities technical capacity they can't afford to hire. Structured as a shared-services cooperative so member towns retain governance.")

COMMUNITY: [Who benefits. What network or movement it belongs to. What connects the people involved. 1-2 sentences.]
(e.g., "Serves elected water board officials and residents in unincorporated communities. Part of the rural infrastructure justice network that emerged from the EPA environmental justice mapping project.")


## WHAT THEY DO

PROGRAMS: [Each program, service, or tool — named. What it does. Who participates. What changes. Use a sub-entry for each distinct program.]
(e.g., 
"- Mobile Forensics Lab: deploys water testing equipment to towns that can't afford independent testing. 40 municipalities served since 2019. Produces legally admissible contamination reports.
- Board Training Institute: 3-day intensive for elected water officials. Covers rate-setting, compliance, capital planning. 200+ officials trained. Graduates manage $2.1B in combined water infrastructure.")

PURPOSE: [The principle driving the work. What outcome makes it worthwhile. 1 sentence.]
(e.g., "People who govern public water systems should have the technical capacity to do it without depending on the companies bidding for the contracts.")

FIELD POSITION: [What field. What frontier defines progress. How this org contributes. 1-2 sentences.]
(e.g., "Immigrant rights litigation. The frontier is algorithmic enforcement — ICE using predictive tools to target communities. This org is the only legal shop with both immigration attorneys and data scientists on staff.")


## PROOF

RESULTS: [1-3 specific, named results. Quantified where possible. No adjectives.]
(e.g., "Blocked the Ravenswood desalination contract — saved the district $340M over 20 years. Three graduates now chair their regional water boards.")

EXTERNAL VALIDATION: [Awards, coverage, endorsements, partnerships. Named. If none available, state that.]
(e.g., "MacArthur grant 2022. Featured in ProPublica's 'Pipe Dreams' investigation as the primary community technical resource.")


## ARGUMENT

UNASSAILABLE TRUTH: [One sentence. The moral premise the work exists to defend. Should sound self-evident.]
(e.g., "Young people in neighborhoods with no arts infrastructure deserve the same creative formation as young people in neighborhoods with conservatories.")

FORK: [What improves if the work succeeds. What degrades if it doesn't. Both directions, 1-2 sentences total.]
(e.g., "If tenants in algorithmically managed buildings gain collective bargaining tools, they set precedent for every renter in a corporate-owned building. If they don't, automated rent optimization rolls out unopposed and the landlord-tenant power gap becomes permanent.")

EMERGING OPPORTUNITY: [What's shifted externally — political, technological, demographic, cultural — that makes action viable now. 1-2 sentences. Must be observable, not aspirational.]
(e.g., "Three state legislatures introduced algorithmic transparency bills in 2024. None passed, but the language is now in committee and the regulatory window is open for the first time.")

THEORY OF CHANGE: [The mechanism. How conditions move. Where leverage lives. How one thing leads to another. 2-3 sentences max.]
(e.g., "Municipal broadband cooperatives in rural Oregon proved that publicly owned infrastructure outperforms private on cost, speed, and coverage. The model is replicable but requires technical assistance that no one currently provides at the county level. We provide that assistance, each successful deployment becomes a proof point for the next county.")


## THE 1-2-3

[The named strategic components. Each with a label and a one-sentence description of what it does. Exactly 3 unless the org's materials clearly articulate more or fewer pillars — in that case, match what the org actually has, between 2 and 5.]

(e.g.,
"1. Defend — Litigation against algorithmic enforcement tools. Direct legal representation for individuals flagged by predictive systems plus impact cases that challenge the tools themselves.
2. Document — Forensic audits of the algorithms. Reverse-engineering the decision models, publishing the methodology, making the technical case admissible.
3. Organize — Affected-community coalitions that turn individual cases into collective political pressure. Plaintiffs become advocates. Audits become campaign materials.")


## WHAT SUCCESS PRODUCES

OUTPUTS: [Tangible deliverables. Tools, structures, policies, publications. Named.]
(e.g., "A replicable community land trust template tested in 3 markets. Exposed and blocked 2 algorithmic redlining tools through published audits.")

OUTCOMES: [How life, access, or power changes. 1-2 sentences.]
(e.g., "Black homeownership in target neighborhoods stabilizes instead of declining. Community land trusts control enough housing stock to function as a price anchor.")

WHAT ENDURES: [Capacity, infrastructure, relationships that persist beyond the grant period. 1 sentence.]
(e.g., "The trained cohort of 60 community paralegals continues operating after the program ends. The audit methodology is open-source and in use by 4 other legal shops.")


## MUTUAL BENEFIT

FUNDER ALIGNMENT: [Why a funder's participation advances their own strategic goals. What they gain. Written generically — this field will be mapped to specific donors downstream. 1-2 sentences.]
(e.g., "Funders in the algorithmic accountability space gain a litigation pipeline that converts their policy research into enforceable precedent. Funders in immigrant rights gain the first technical capacity to challenge the tools driving enforcement.")

FIELD CONTRIBUTION: [How this work strengthens the broader ecosystem. 1 sentence.]
(e.g., "Every successful municipal broadband deployment produces open documentation that reduces the cost and risk for the next one.")


## TRACTION

UNDERWAY: [What's already happening. Named pilots, partnerships, early outcomes. Or "Pre-launch — [what exists so far]."]
(e.g., "Pilot running in 3 counties since January 2024. First cohort of 12 officials completed training. Two contamination reports submitted to state regulators.")

MOMENTUM: [Evidence this is moving. Recent developments, new partners, growing demand. 1-2 sentences. Or "Early stage — no external traction yet."]
(e.g., "Inbound requests from 8 additional counties. State rural affairs office exploring a formal referral partnership.")


## WHAT IT TAKES

INVESTMENT: [Total amount. What money funds, organized by the 1-2-3. Not by budget category.]
(e.g., "$1.2M over 2 years. Defend: $500K (2 attorneys, expert witnesses, filing costs). Document: $400K (data science team, audit infrastructure). Organize: $300K (3 community organizers, campaign materials, convenings).")

OTHER RESOURCES NEEDED: [Expertise, networks, legitimacy, introductions that money doesn't cover. Or "Fully resourced with funding."]
(e.g., "Pro bono data science capacity for the audit backlog. Introduction to the state AG's technology crimes unit.")

WHO ELSE IS AT THE TABLE: [Named funders, partners, or constituencies already involved or being targeted. Or "No other funders yet."]
(e.g., "Ford Foundation — $200K confirmed for Document. Unbound Philanthropy — in conversation for Organize. ACLU — co-counsel on 2 impact cases.")


## FIRST MOVES

IMMEDIATE: [What happens when a funder says yes. First 30 days. Concrete.]
(e.g., "Hire the second data scientist. File the Riverside County audit. Convene the first plaintiff-organizer meeting in Phoenix.")

TIME-SENSITIVE: [What closes and when. Specific deadline with consequence. Or "No external deadline."]
(e.g., "The state algorithmic transparency bill reaches committee vote in March 2026. The audit evidence must be published before the hearing or the legislative window closes without data in the record.")
```

---

## EXTRACTION RULES

1. **Extract, don't invent.** If the org's materials don't contain information for a field, write "[Not available from submitted materials]." Do not generate plausible content. An empty field is better than a fabricated one.

2. **Name things.** Programs have names. Partners have names. Results have numbers. If the org's materials use generic language ("our flagship program"), look for the actual name elsewhere in the materials. If it's not there, use the generic term but flag it: "flagship program [unnamed in materials]."

3. **Compress, don't paraphrase.** The org's own language for their work is correct. Use their terms for programs, pillars, and theory of change. Strip the framing and energy. Keep the vocabulary.

4. **The 1-2-3 is the hardest extraction.** Most organizations don't articulate a clean 1-2-3. Look for it in strategic plans, pitch decks, and website structure. If the org has 3-5 named program areas, those may be the pillars. If the org describes its work as a sequence (first we X, then Y, then Z), that's a 1-2-3. If no strategic structure is discernible, write "[No clear strategic pillars identified. The org describes its work as: (brief summary)]" and let the downstream model work with that.

5. **Don't editorialize.** No "This organization is well-positioned to..." No "The theory of change is compelling because..." Facts and labels only.

6. **MUTUAL BENEFIT is always generic at this stage.** You don't know who the donor is. Write about what funders in this space generally gain from participation. The donor-specific mapping happens downstream.

7. **Match the org's actual scale.** A 3-person shop doing local work should not sound like a national institution. A $50K ask should not be framed with the same weight as a $5M campaign. Let the numbers speak.
