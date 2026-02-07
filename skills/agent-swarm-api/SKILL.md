# Agent Swarm Orchestration with Anthropic API

Build multi-agent swarms using the Anthropic Claude API for parallel task execution, specialized agents, and coordinated workflows.

## Overview

This skill enables you to orchestrate multiple Claude agents working together through three core patterns:
- **Subagents**: Spawned workers with specialized instructions and tool restrictions
- **Prompt Chaining**: Sequential task pipelines where each step builds on previous results
- **Parallelization**: Concurrent execution across multiple independent agents
- **Routing**: Dynamic selection of specialized agents based on task classification

## Prerequisites

- Anthropic API key set in environment: `ANTHROPIC_API_KEY`
- Claude Agent SDK installed:
  ```bash
  npm install @anthropic-ai/claude-agent-sdk
  # or
  pip install claude-agent-sdk
  ```

## Core Patterns

### 1. Subagents (Recommended)

Subagents are separate agent instances spawned from a main agent to handle focused subtasks with isolated context.

**Benefits:**
- **Context Isolation**: Prevents information overload in main agent
- **Parallelization**: Run multiple subagents concurrently
- **Specialized Instructions**: Each subagent has tailored system prompts
- **Tool Restrictions**: Limit subagents to specific tools for safety

**How it works:**
- Define agents in `agents` parameter with description, prompt, tools, model
- Claude automatically invokes subagents based on task descriptions
- Subagents are invoked via the `Task` tool
- Each subagent maintains separate conversation context

**Example:**
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt: "Review the authentication module for security issues",
  options: {
    allowedTools: ['Read', 'Grep', 'Glob', 'Task'], // Task required for subagents
    agents: {
      'security-reviewer': {
        description: 'Security specialist for vulnerability analysis',
        prompt: `You are a security expert. When reviewing code:
- Identify SQL injection, XSS, auth bypass vulnerabilities
- Check for sensitive data exposure
- Verify input validation and sanitization
Be thorough but concise.`,
        tools: ['Read', 'Grep', 'Glob'], // Read-only access
        model: 'opus' // Use more powerful model for critical tasks
      },
      'performance-analyzer': {
        description: 'Performance optimization specialist',
        prompt: `You are a performance expert. Analyze code for:
- N+1 queries and missing indexes
- Memory leaks and inefficient algorithms
- Unnecessary computations
Suggest specific optimizations.`,
        tools: ['Read', 'Grep', 'Glob'],
        model: 'sonnet'
      }
    }
  }
})) {
  if ('result' in message) console.log(message.result);
}
```

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async def main():
    async for message in query(
        prompt="Review the authentication module for security issues",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Grep", "Glob", "Task"],
            agents={
                "security-reviewer": AgentDefinition(
                    description="Security specialist for vulnerability analysis",
                    prompt="""You are a security expert. When reviewing code:
- Identify SQL injection, XSS, auth bypass vulnerabilities
- Check for sensitive data exposure
- Verify input validation and sanitization
Be thorough but concise.""",
                    tools=["Read", "Grep", "Glob"],
                    model="opus"
                ),
                "performance-analyzer": AgentDefinition(
                    description="Performance optimization specialist",
                    prompt="""You are a performance expert. Analyze code for:
- N+1 queries and missing indexes
- Memory leaks and inefficient algorithms
- Unnecessary computations
Suggest specific optimizations.""",
                    tools=["Read", "Grep", "Glob"],
                    model="sonnet"
                )
            }
        )
    ):
        if hasattr(message, "result"):
            print(message.result)

asyncio.run(main())
```

### 2. Prompt Chaining (Sequential Pipeline)

Chain multiple LLM calls where each step builds on previous results.

**Use Case:** Multi-stage data processing, progressive refinement

**Example:**
```python
from anthropic import Anthropic

client = Anthropic()

def llm_call(prompt: str, model: str = "claude-sonnet-4") -> str:
    """Single LLM call with streaming."""
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

def chain(input_text: str, prompts: list[str]) -> str:
    """Chain multiple LLM calls sequentially."""
    result = input_text
    for i, prompt in enumerate(prompts, 1):
        print(f"\n=== Step {i} ===")
        result = llm_call(f"{prompt}\n\nInput:\n{result}")
        print(result[:200] + "..." if len(result) > 200 else result)
    return result

# Example: Document processing pipeline
data = """
Q1 Revenue: $2.5M, Q2 Revenue: $3.1M, Q3 Revenue: $2.8M, Q4 Revenue: $3.6M
Expenses: $1.2M per quarter
"""

pipeline = [
    "Extract all numerical values and label them clearly",
    "Calculate profit for each quarter (Revenue - Expenses)",
    "Convert all dollar amounts to percentages of annual total",
    "Sort by profitability and format as a markdown table"
]

result = chain(data, pipeline)
```

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function llmCall(prompt: string, model = 'claude-sonnet-4'): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });
  return response.content[0].text;
}

async function chain(input: string, prompts: string[]): Promise<string> {
  let result = input;
  for (const [i, prompt] of prompts.entries()) {
    console.log(`\n=== Step ${i + 1} ===`);
    result = await llmCall(`${prompt}\n\nInput:\n${result}`);
    console.log(result.slice(0, 200) + (result.length > 200 ? '...' : ''));
  }
  return result;
}

// Example: Document processing pipeline
const data = `
Q1 Revenue: $2.5M, Q2 Revenue: $3.1M, Q3 Revenue: $2.8M, Q4 Revenue: $3.6M
Expenses: $1.2M per quarter
`;

const pipeline = [
  "Extract all numerical values and label them clearly",
  "Calculate profit for each quarter (Revenue - Expenses)",
  "Convert all dollar amounts to percentages of annual total",
  "Sort by profitability and format as a markdown table"
];

await chain(data, pipeline);
```

### 3. Parallelization (Concurrent Workers)

Process multiple independent tasks concurrently with parallel LLM calls.

**Use Case:** Batch processing, multi-stakeholder analysis, code review swarms

**Example:**
```python
from anthropic import Anthropic
from concurrent.futures import ThreadPoolExecutor, as_completed

client = Anthropic()

def llm_call(prompt: str, model: str = "claude-sonnet-4") -> str:
    """Single LLM call."""
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

def parallel(prompt: str, inputs: list[str], n_workers: int = 3) -> list[str]:
    """Process multiple inputs in parallel with same prompt."""
    def process(item: str) -> str:
        return llm_call(f"{prompt}\n\nInput:\n{item}")

    with ThreadPoolExecutor(max_workers=n_workers) as executor:
        futures = [executor.submit(process, x) for x in inputs]
        return [f.result() for f in as_completed(futures)]

# Example: Parallel code review swarm
files = [
    "app/models/user.rb",
    "app/controllers/auth_controller.rb",
    "app/services/payment_processor.rb"
]

review_prompt = """Review this file for:
- Security vulnerabilities
- Performance issues
- Code quality problems
Provide specific findings with line references."""

results = parallel(review_prompt, files, n_workers=3)
for result in results:
    print(result)
    print("\n" + "="*50 + "\n")
```

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function llmCall(prompt: string, model = 'claude-sonnet-4'): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });
  return response.content[0].text;
}

async function parallel(prompt: string, inputs: string[], nWorkers = 3): Promise<string[]> {
  const process = (item: string) => llmCall(`${prompt}\n\nInput:\n${item}`);

  // Process in batches to respect concurrency limit
  const results: string[] = [];
  for (let i = 0; i < inputs.length; i += nWorkers) {
    const batch = inputs.slice(i, i + nWorkers);
    const batchResults = await Promise.all(batch.map(process));
    results.push(...batchResults);
  }
  return results;
}

// Example: Parallel code review swarm
const files = [
  "app/models/user.rb",
  "app/controllers/auth_controller.rb",
  "app/services/payment_processor.rb"
];

const reviewPrompt = `Review this file for:
- Security vulnerabilities
- Performance issues
- Code quality problems
Provide specific findings with line references.`;

const results = await parallel(reviewPrompt, files, 3);
results.forEach(result => {
  console.log(result);
  console.log("\n" + "=".repeat(50) + "\n");
});
```

### 4. Routing (Dynamic Specialization)

Classify input and route to specialized agent based on classification.

**Use Case:** Customer support triage, task classification, multi-domain systems

**Example:**
```python
from anthropic import Anthropic
import re

client = Anthropic()

def llm_call(prompt: str, model: str = "claude-sonnet-4") -> str:
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

def extract_xml(text: str, tag: str) -> str:
    """Extract content between XML tags."""
    match = re.search(f"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
    return match.group(1) if match else ""

def route(input_text: str, routes: dict[str, str]) -> str:
    """Route input to specialized prompt based on classification."""

    selector_prompt = f"""Analyze the input and select the most appropriate team from: {list(routes.keys())}

Provide your analysis in this format:
<reasoning>Brief explanation of why this team is best</reasoning>
<selection>Team name exactly as listed</selection>

Input: {input_text}"""

    route_response = llm_call(selector_prompt, model="claude-haiku-4") # Fast routing
    route_key = extract_xml(route_response, "selection").strip().lower()

    print(f"Routing to: {route_key}")
    print(f"Reasoning: {extract_xml(route_response, 'reasoning')}\n")

    if route_key not in routes:
        raise ValueError(f"Invalid route: {route_key}. Valid routes: {list(routes.keys())}")

    return llm_call(f"{routes[route_key]}\n\nInput:\n{input_text}")

# Example: Customer support routing
routes = {
    "billing": """You are a billing specialist. Handle:
- Payment issues
- Refund requests
- Subscription changes
Provide clear, empathetic responses with action steps.""",

    "technical": """You are a technical support engineer. Handle:
- Software bugs
- API errors
- Configuration issues
Provide debugging steps and workarounds.""",

    "account": """You are an account manager. Handle:
- Account access issues
- Password resets
- Security concerns
Prioritize security and verification."""
}

# Test cases
tickets = [
    "My credit card was charged twice for last month's subscription",
    "The API keeps returning 500 errors when I POST to /users",
    "I can't log in to my account and password reset isn't working"
]

for ticket in tickets:
    print(f"\n{'='*60}\nTicket: {ticket}\n{'='*60}")
    response = route(ticket, routes)
    print(response)
```

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function llmCall(prompt: string, model = 'claude-sonnet-4'): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });
  return response.content[0].text;
}

function extractXml(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
  return match ? match[1] : '';
}

async function route(input: string, routes: Record<string, string>): Promise<string> {
  const selectorPrompt = `Analyze the input and select the most appropriate team from: ${Object.keys(routes)}

Provide your analysis in this format:
<reasoning>Brief explanation of why this team is best</reasoning>
<selection>Team name exactly as listed</selection>

Input: ${input}`;

  const routeResponse = await llmCall(selectorPrompt, 'claude-haiku-4'); // Fast routing
  const routeKey = extractXml(routeResponse, 'selection').trim().toLowerCase();

  console.log(`Routing to: ${routeKey}`);
  console.log(`Reasoning: ${extractXml(routeResponse, 'reasoning')}\n`);

  if (!(routeKey in routes)) {
    throw new Error(`Invalid route: ${routeKey}. Valid routes: ${Object.keys(routes)}`);
  }

  return llmCall(`${routes[routeKey]}\n\nInput:\n${input}`);
}

// Example: Customer support routing
const routes = {
  billing: `You are a billing specialist. Handle:
- Payment issues
- Refund requests
- Subscription changes
Provide clear, empathetic responses with action steps.`,

  technical: `You are a technical support engineer. Handle:
- Software bugs
- API errors
- Configuration issues
Provide debugging steps and workarounds.`,

  account: `You are an account manager. Handle:
- Account access issues
- Password resets
- Security concerns
Prioritize security and verification.`
};

// Test cases
const tickets = [
  "My credit card was charged twice for last month's subscription",
  "The API keeps returning 500 errors when I POST to /users",
  "I can't log in to my account and password reset isn't working"
];

for (const ticket of tickets) {
  console.log(`\n${'='.repeat(60)}\nTicket: ${ticket}\n${'='.repeat(60)}`);
  const response = await route(ticket, routes);
  console.log(response);
}
```

## Advanced Patterns

### Hierarchical Swarms (Queen-led Coordination)

For complex multi-agent systems, implement hierarchical coordination with a coordinator agent managing specialized workers.

**Architecture:**
- **Coordinator (Queen)**: Plans tasks, delegates to workers, synthesizes results
- **Specialized Workers**: Execute focused tasks and report back
- **Consensus Mechanisms**: Majority voting, weighted voting, or Byzantine fault tolerance

**Example:**
```python
from anthropic import Anthropic
from concurrent.futures import ThreadPoolExecutor
import json

client = Anthropic()

def llm_call(prompt: str, model: str = "claude-sonnet-4") -> str:
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

class SwarmCoordinator:
    """Hierarchical swarm with coordinator and specialized workers."""

    def __init__(self, workers: dict[str, str], coordinator_model: str = "claude-opus-4"):
        self.workers = workers  # {worker_name: worker_prompt}
        self.coordinator_model = coordinator_model

    def delegate(self, task: str) -> dict[str, str]:
        """Delegate task to all workers in parallel."""
        def run_worker(name: str, prompt: str) -> tuple[str, str]:
            worker_prompt = f"{prompt}\n\nTask:\n{task}"
            result = llm_call(worker_prompt, model="claude-sonnet-4")
            return (name, result)

        with ThreadPoolExecutor(max_workers=len(self.workers)) as executor:
            futures = [executor.submit(run_worker, name, prompt)
                      for name, prompt in self.workers.items()]
            return dict(f.result() for f in futures)

    def synthesize(self, task: str, worker_results: dict[str, str]) -> str:
        """Coordinator synthesizes worker results into final answer."""
        coordinator_prompt = f"""You are the swarm coordinator. You delegated a task to specialized workers and received their reports.

Original Task:
{task}

Worker Reports:
{json.dumps(worker_results, indent=2)}

Your job:
1. Analyze each worker's findings
2. Identify agreements and conflicts
3. Synthesize a comprehensive final answer
4. Highlight any critical issues flagged by multiple workers

Provide your synthesis below:"""

        return llm_call(coordinator_prompt, model=self.coordinator_model)

    def execute(self, task: str) -> str:
        """Execute task using hierarchical swarm."""
        print(f"Delegating to {len(self.workers)} workers...")
        worker_results = self.delegate(task)

        print("\nWorker Results:")
        for name, result in worker_results.items():
            print(f"\n{name}:\n{result[:200]}...\n")

        print("Synthesizing results...")
        return self.synthesize(task, worker_results)

# Example: Code review swarm
workers = {
    "security-analyst": """You are a security specialist. Review code for:
- Authentication/authorization vulnerabilities
- Input validation issues
- SQL injection, XSS, CSRF risks
- Sensitive data exposure
Flag critical issues with [CRITICAL] prefix.""",

    "performance-analyst": """You are a performance expert. Review code for:
- Database query optimization (N+1, missing indexes)
- Algorithm efficiency (time/space complexity)
- Memory leaks and resource management
- Caching opportunities
Flag severe performance issues with [SEVERE] prefix.""",

    "architecture-analyst": """You are an architecture reviewer. Review code for:
- SOLID principles adherence
- Design pattern appropriateness
- Separation of concerns
- Code maintainability and testability
Flag architectural violations with [VIOLATION] prefix."""
}

swarm = SwarmCoordinator(workers)

# Execute code review
code_snippet = """
def get_user_orders(user_id):
    user = User.query.get(user_id)
    orders = []
    for order_id in user.order_ids:
        order = Order.query.get(order_id)
        orders.append(order)
    return orders
"""

result = swarm.execute(f"Review this Python code:\n\n{code_snippet}")
print("\n" + "="*60)
print("FINAL SYNTHESIS:")
print("="*60)
print(result)
```

### Resumable Subagents

Continue a subagent's work from where it left off by resuming with the same session ID.

**Example:**
```typescript
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

function extractAgentId(message: SDKMessage): string | undefined {
  if (!('message' in message)) return undefined;
  const content = JSON.stringify(message.message.content);
  const match = content.match(/agentId:\s*([a-f0-9-]+)/);
  return match?.[1];
}

let agentId: string | undefined;
let sessionId: string | undefined;

// First query: initial analysis
for await (const message of query({
  prompt: "Use the Explore agent to find all API endpoints in this codebase",
  options: { allowedTools: ['Read', 'Grep', 'Glob', 'Task'] }
})) {
  if ('session_id' in message) sessionId = message.session_id;
  const extractedId = extractAgentId(message);
  if (extractedId) agentId = extractedId;
  if ('result' in message) console.log(message.result);
}

// Second query: resume and ask follow-up
if (agentId && sessionId) {
  for await (const message of query({
    prompt: `Resume agent ${agentId} and list the top 3 most complex endpoints`,
    options: {
      allowedTools: ['Read', 'Grep', 'Glob', 'Task'],
      resume: sessionId  // Resume same session
    }
  })) {
    if ('result' in message) console.log(message.result);
  }
}
```

## Tool Restriction Patterns

Restrict subagent tool access for safety and focus:

| Use Case | Tools | Description |
|----------|-------|-------------|
| Read-only analysis | `Read`, `Grep`, `Glob` | Examine code without modifying |
| Test execution | `Bash`, `Read`, `Grep` | Run commands and analyze output |
| Code modification | `Read`, `Edit`, `Write`, `Grep`, `Glob` | Full read/write without command execution |
| Full access | All tools | Inherits all tools from parent (omit `tools` field) |

## Model Selection Strategy

Choose models based on task criticality and cost:

```typescript
const agents = {
  'critical-security': {
    model: 'opus',  // Most capable, expensive - for critical tasks
    description: 'Security audit for production systems'
  },
  'code-review': {
    model: 'sonnet', // Balanced - for most development tasks
    description: 'General code review and quality checks'
  },
  'simple-classifier': {
    model: 'haiku', // Fast, cheap - for routing and classification
    description: 'Classify tickets or route requests'
  }
}
```

**Cost Optimization:**
- Use Haiku for routing, classification, simple transforms
- Use Sonnet for most coding, analysis, review tasks
- Reserve Opus for critical security, architecture, complex reasoning

## Troubleshooting

### Subagents not being invoked

**Problem**: Claude completes tasks directly instead of delegating.

**Solutions:**
1. **Include Task tool**: Must be in `allowedTools` for subagent invocation
2. **Explicit prompting**: Mention subagent by name (e.g., "Use the security-reviewer agent to...")
3. **Clear descriptions**: Write specific descriptions explaining when to use each subagent

### Parallel execution failures

**Problem**: Some parallel workers fail or timeout.

**Solutions:**
1. **Implement retries**: Wrap worker calls with retry logic
2. **Use `as_completed()`**: Process results as they finish, don't wait for all
3. **Reduce batch size**: Lower `n_workers` to avoid rate limits
4. **Add timeouts**: Set reasonable timeouts per worker

### Context overflow in chaining

**Problem**: Later steps in chain run out of context.

**Solutions:**
1. **Compress intermediate results**: Summarize before passing to next step
2. **Use subagents**: Each step gets fresh context
3. **Reduce prompt verbosity**: Keep transformation prompts concise

## Best Practices

### 1. Write Clear Subagent Descriptions
```typescript
// ✅ Good: Specific, actionable
description: 'Security reviewer for authentication code. Finds SQL injection, XSS, auth bypass.'

// ❌ Bad: Vague, generic
description: 'Helps with security stuff'
```

### 2. Use Appropriate Parallelization
```python
# ✅ Good: Independent tasks
tasks = ["Review file A", "Review file B", "Review file C"]
parallel(review_prompt, tasks)

# ❌ Bad: Sequential dependencies
tasks = ["Extract data", "Transform data", "Load data"]  # Use chaining instead
```

### 3. Implement Consensus for Critical Decisions
```python
# For important decisions, run multiple agents and vote
results = parallel("Is this code secure? Answer YES or NO.", [code] * 5)
votes = [r.strip().upper() for r in results]
decision = "SECURE" if votes.count("YES") >= 3 else "INSECURE"
```

### 4. Monitor and Log Swarm Activity
```typescript
// Log all subagent invocations
for await (const message of query({...})) {
  for (const block of message.message?.content ?? []) {
    if (block.type === 'tool_use' && block.name === 'Task') {
      console.log(`[SWARM] Invoked: ${block.input.subagent_type}`);
    }
  }
}
```

### 5. Use Hierarchical Coordination for Complex Tasks
- **Small tasks (1-3 steps)**: Single agent
- **Medium tasks (4-10 steps)**: Chaining or parallelization
- **Large tasks (10+ steps)**: Hierarchical swarm with coordinator

## Performance Metrics

### Context Efficiency
- **Single agent**: Uses 80-90% of context window
- **Subagent swarm**: ~40% usage per agent (distributed context)

### Speed Improvements
- **Sequential**: N tasks × T time = N×T total
- **Parallel (3 workers)**: N tasks / 3 workers = ~N/3 total

### Cost Optimization
- **Routing with Haiku**: ~90% cost reduction for classification
- **Token compression**: 30-50% reduction in chain patterns
- **Model selection**: Use cheapest capable model (Haiku → Sonnet → Opus)

## Sources

- [Subagents in the SDK](https://platform.claude.com/docs/en/agent-sdk/subagents) - Official Anthropic documentation
- [Basic Multi-LLM Workflows](https://platform.claude.com/cookbook/patterns-agents-basic-workflows) - Anthropic cookbook
- [Claude-Flow Agent Orchestration](https://github.com/ruvnet/claude-flow) - Open source swarm framework
- [Claude Code Swarm Mode Guide](https://help.apiyi.com/en/claude-code-swarm-mode-multi-agent-guide-en.html) - Complete guide
- [Anthropic Agent Teams Announcement](https://techcrunch.com/2026/02/05/anthropic-releases-opus-4-6-with-new-agent-teams/) - Opus 4.6 release

---

**Version**: 1.0
**Last Updated**: February 2026
**Compatibility**: Claude API, Claude Agent SDK (TypeScript/Python)
