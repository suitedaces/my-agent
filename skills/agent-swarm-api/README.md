# Agent Swarm API Examples

Practical examples of multi-agent orchestration using the Anthropic Claude API.

## Setup

1. Install dependencies:
```bash
# Python
pip install anthropic claude-agent-sdk

# Node.js
npm install @anthropic-ai/sdk @anthropic-ai/claude-agent-sdk
```

2. Set your API key:
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

## Examples

### 1. Subagent Review (`subagent_review.py`)

Spawn multiple specialized subagents for parallel code review.

**Pattern**: Subagents with tool restrictions
**Use Case**: Concurrent code analysis by security, performance, architecture, and quality specialists

```bash
python examples/subagent_review.py app/models/user.py
```

**What it demonstrates:**
- Defining specialized subagents with custom prompts
- Tool restriction for safety (read-only access)
- Model selection per subagent (Opus for security, Sonnet for others)
- Parallel execution via Claude's automatic delegation

### 2. Chain Pipeline (`chain_pipeline.py`)

Sequential transformation pipeline using prompt chaining.

**Pattern**: Prompt chaining
**Use Case**: Multi-stage data processing with progressive refinement

```bash
# Financial analysis pipeline
python examples/chain_pipeline.py financial

# Code refactoring pipeline
python examples/chain_pipeline.py code
```

**What it demonstrates:**
- Sequential LLM calls where each builds on previous output
- Progressive data transformation
- Two complete examples: financial analysis and code refactoring

### 3. Parallel Swarm (`parallel_swarm.py`)

Concurrent processing across independent workers.

**Pattern**: Parallelization
**Use Case**: Batch processing, multi-file reviews, multi-stakeholder analysis

```bash
# Parallel code review
python examples/parallel_swarm.py code

# Stakeholder impact analysis
python examples/parallel_swarm.py stakeholder

# Multi-language translation
python examples/parallel_swarm.py translate
```

**What it demonstrates:**
- ThreadPoolExecutor for parallel LLM calls
- Performance metrics (items/second)
- Three real-world use cases with different complexity levels

### 4. Hierarchical Swarm (`hierarchical_swarm.py`)

Queen-led coordination with synthesis and consensus.

**Pattern**: Hierarchical orchestration
**Use Case**: Complex analysis requiring multiple expert perspectives

```bash
# Architecture review with 4 specialist workers
python examples/hierarchical_swarm.py architecture

# Consensus voting for high-stakes decisions
python examples/hierarchical_swarm.py consensus

# Research pipeline with synthesis
python examples/hierarchical_swarm.py research
```

**What it demonstrates:**
- Coordinator-worker architecture
- Parallel delegation to specialized workers
- Synthesis of multiple expert opinions
- Consensus voting mechanism
- Conflict resolution by coordinator

## Pattern Comparison

| Pattern | Concurrency | Communication | Best For |
|---------|-------------|---------------|----------|
| **Subagents** | Parallel | Via Task tool | Specialized analysis with safety |
| **Chaining** | Sequential | Pass-through | Multi-stage transformation |
| **Parallel** | Parallel | Independent | Batch processing, no dependencies |
| **Hierarchical** | Parallel + Synthesis | Coordinator mediates | Complex decisions requiring expertise |

## Performance Tips

### 1. Model Selection
```python
# Routing and classification - use Haiku (fast, cheap)
model="claude-haiku-4"

# Most development tasks - use Sonnet (balanced)
model="claude-sonnet-4"

# Critical decisions and synthesis - use Opus (best reasoning)
model="claude-opus-4"
```

### 2. Parallelization Limits
```python
# Don't exceed rate limits
n_workers = min(desired_workers, 10)  # Anthropic API limit

# For large batches, process in chunks
for batch in chunks(items, batch_size=10):
    parallel(prompt, batch, n_workers=10)
```

### 3. Context Management
```python
# For chaining, compress intermediate results
result = llm_call(f"{prompt}\n\nSummarize this concisely:\n{previous_result}")

# For subagents, each gets fresh context automatically
```

## Cost Optimization

### Example Cost Comparison

**Single agent approach:**
- 1 Opus call for complex analysis: ~$0.50

**Swarm approach:**
- 1 Haiku routing call: ~$0.01
- 4 Sonnet worker calls (parallel): ~$0.40
- 1 Opus synthesis call: ~$0.50
- **Total: ~$0.91 but 3-4x faster**

**When swarms save money:**
- Use Haiku for routing instead of Opus: 90% cost reduction
- Parallel Sonnet workers instead of sequential Opus: 2x cheaper, 3x faster
- Caching common prompts (coming soon to Anthropic API)

## Common Patterns

### Pattern: Retry with Exponential Backoff
```python
import time
from anthropic import RateLimitError

def llm_call_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            return llm_call(prompt)
        except RateLimitError:
            if attempt < max_retries - 1:
                wait = 2 ** attempt
                print(f"Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            else:
                raise
```

### Pattern: Consensus Voting
```python
def consensus(prompt, options, n_votes=5):
    """Run multiple agents and vote on best option."""
    votes = parallel(f"{prompt}\nChoose ONE: {options}", [""] * n_votes)
    # Count votes and return winner
    from collections import Counter
    return Counter(votes).most_common(1)[0][0]
```

### Pattern: Progressive Refinement
```python
def refine(initial_result, refinement_steps=3):
    """Progressively improve a result."""
    result = initial_result
    for i in range(refinement_steps):
        result = llm_call(f"Improve this:\n{result}\n\nFocus: iteration {i+1}")
    return result
```

## Troubleshooting

### Issue: Subagents not being invoked
**Solution**: Include `Task` in `allowedTools` and mention subagent by name:
```python
options=ClaudeAgentOptions(
    allowed_tools=["Read", "Grep", "Task"],  # Task required!
    agents={...}
)
```

### Issue: Rate limit errors
**Solution**: Reduce `n_workers` or add retry logic:
```python
n_workers = min(desired_workers, 5)  # Lower concurrency
```

### Issue: Context overflow in chaining
**Solution**: Compress intermediate results:
```python
pipeline = [
    "Extract data",
    "Summarize previous output before transforming",  # Compression step
    "Transform data"
]
```

## Next Steps

1. **Read the skill documentation**: `SKILL.md` for complete API reference
2. **Explore advanced patterns**: Hierarchical swarms, consensus mechanisms
3. **Build your own**: Adapt examples to your use case
4. **Monitor costs**: Track token usage with Anthropic dashboard

## Resources

- [Anthropic API Docs](https://platform.claude.com/docs)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk)
- [Multi-Agent Patterns Cookbook](https://platform.claude.com/cookbook/patterns-agents-basic-workflows)

## Contributing

Have a useful pattern or example? Please contribute!

1. Add example to `examples/`
2. Update this README
3. Submit PR or share with community

---

**Last Updated**: February 2026
**Compatible With**: Claude API, Claude Agent SDK (Python/TypeScript)
