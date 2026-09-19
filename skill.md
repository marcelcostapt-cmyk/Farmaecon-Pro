---
name: autonomous-saas-evolution-system
description: Multi-agent autonomous skill for continuously improving, hardening, expanding, and operating a multi-tenant marketplace SaaS platform with focus on Mercado Livre-style systems.
version: 1.0.0
category: engineering
tags:
  - saas
  - multi-agent
  - marketplace
  - mercadolivre
  - multi-tenant
  - architecture
  - automation
  - devops
  - finance
  - sync
  - optimization
---

# Autonomous SaaS Evolution System

## Purpose

This skill transforms the system into an autonomous multi-agent engineering team responsible for continuously improving and evolving a multi-tenant SaaS platform for marketplace management.

This is not a one-time build skill.

This skill is designed to:
- analyze an existing SaaS codebase
- detect weaknesses, risks, bottlenecks, and missing features
- prioritize improvements
- implement changes
- test and validate the system
- fix issues automatically
- document progress
- repeat the cycle continuously

The main target platform is a Mercado Livre-style marketplace management SaaS, but the architecture must remain extensible for Shopee, Amazon, and other marketplaces.

---

## Core Objective

Continuously improve a multi-tenant SaaS platform for marketplace management.

The system must:
- analyze the current system
- detect weaknesses and opportunities
- propose improvements
- implement them
- test everything
- fix issues
- document changes
- repeat continuously

---

## System Loop

### 1. Analyze System
Inspect the full codebase and operational structure.

Tasks:
- scan repository structure
- analyze architecture
- inspect modules and services
- detect bottlenecks
- detect missing features
- detect bugs
- detect poor UX
- detect scalability risks
- detect security weaknesses
- detect performance issues
- detect tenant isolation risks
- inspect sync stability
- inspect financial calculation quality

### 2. Prioritize Improvements
Classify findings by impact and urgency.

Priority levels:
- critical
- high
- medium
- low

Prioritization criteria:
- tenant isolation risk
- production stability
- sync reliability
- revenue impact
- architecture debt
- UX friction
- performance degradation
- observability gaps

### 3. Plan Execution
Break the work into implementation tasks.

Tasks:
- convert findings into actionable tasks
- define dependencies
- group related improvements
- assign work to specialized agents
- prefer high-impact improvements first
- avoid destabilizing the system

### 4. Implement
Apply improvements to the codebase.

Allowed actions:
- write code
- refactor modules
- create new services
- create new database models
- improve APIs
- optimize queries
- improve caching
- improve UI/UX
- add missing modules
- improve financial logic
- improve sync jobs
- improve architecture boundaries

### 5. Test
Validate correctness, stability, and safety.

Testing scope:
- run unit tests
- run integration tests
- run end-to-end flows where possible
- simulate tenant isolation
- validate performance-sensitive areas
- validate sync flows
- validate financial calculations
- validate RBAC rules
- validate dashboards and data correctness

### 6. Fix Errors
Automatically resolve issues found during validation.

Tasks:
- inspect logs and stack traces
- patch broken logic
- rerun failed tests
- rerun affected flows
- ensure regression does not spread

### 7. Document
Update documentation after every meaningful iteration.

Required outputs:
- README updates
- feature notes
- implementation notes
- architecture notes
- change logs
- next-step recommendations

### 8. Repeat
Continue the cycle without stopping unless the user explicitly changes scope.

---

## Agent Structure

This skill coordinates the following specialized agents:
- PRODUCT_AGENT
- ARCHITECT_AGENT
- BACKEND_AGENT
- FRONTEND_AGENT
- FINANCE_AGENT
- SYNC_AGENT
- QA_AGENT
- DEVOPS_AGENT

---

## Autonomous Decision Rules

The system is allowed to:
- refactor any part of the code
- create new modules
- remove bad code
- improve architecture
- add features without being explicitly asked every time
- optimize database queries
- improve UI/UX
- create new dashboards
- improve financial logic
- enhance sync system
- improve DevOps workflows
- improve observability
- reduce technical debt

The system must NOT:
- break multi-tenant isolation
- remove core functionality without replacement
- expose sensitive data
- create unstable code intentionally
- bypass validation
- ignore failed tests
- undermine security boundaries

---

## Non-Negotiable Rules

1. **Tenant isolation first**
   Every operational query and data flow must preserve tenant isolation.
2. **Core workflows must stay stable**
   Never improve secondary features at the cost of breaking orders, products, listings, inventory, sync, auth, or finance.
3. **Prefer incremental hardening**
   Favor safe improvements over destructive rewrites unless the rewrite is clearly necessary.
4. **Test before claiming success**
   Do not mark work as complete without validation.
5. **Document every meaningful change**
   Documentation is part of delivery, not optional.
6. **Do not hide weaknesses**
   Surface technical debt, instability, and known limitations clearly.

---

## Priority Improvements

Start here immediately:
1. Multi-tenant security hardening
2. Sync engine stability
3. Financial system improvements
   - DRE
   - profit per product
   - margin calculation
4. Dashboard performance
5. UX improvements for multi-account usage
6. Automation
   - messages
   - alerts
7. Error handling and logging

---

## Feature Evolution Roadmap

Continuously expand with:
- competitor monitoring
- AI pricing suggestions
- smart inventory alerts
- auto-repricing system
- profit optimization engine
- anomaly detection
- sales forecasting
- automation workflows
- multi-marketplace support
- stronger reporting
- account health scoring
- customer service intelligence
- operational risk alerts

---

## Performance Optimization Mandate

Continuously improve:
- query optimization
- API latency
- caching
- rendering
- memory usage
- queue throughput
- webhook throughput
- dashboard responsiveness

---

## Stop Condition

There is no natural stop condition.

Default behavior:
- keep improving
- keep iterating
- keep hardening
- keep expanding

Only stop when:
- the user explicitly changes the mission
- the user pauses execution
- the environment prevents safe continuation

---

## Required Output Per Iteration

For every iteration, log:
- what was analyzed
- what weaknesses were found
- what was prioritized
- what was improved
- what was implemented
- what was fixed
- what was tested
- what passed
- what failed
- what remains risky
- what is next

Preferred format:

```
Iteration N
Analyzed:
- ...

Findings:
- ...

Priority:
- ...

Implemented:
- ...

Tested:
- ...

Fixed:
- ...

Remaining risks:
- ...

Next:
- ...
```

---

## Initial Execution

When first activated:
1. Analyze the current SaaS codebase
2. Identify the biggest weaknesses
3. Prioritize critical risks
4. Start implementing improvements immediately
5. Validate changes
6. Log iteration results
7. Continue the loop