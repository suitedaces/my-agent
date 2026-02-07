#!/usr/bin/env python3
"""
Example: Parallel Code Review using Subagents

Demonstrates spawning multiple specialized subagents for concurrent code review.
"""

import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async def parallel_code_review(file_path: str):
    """Review a file using multiple specialized subagents in parallel."""

    print(f"Starting parallel code review for: {file_path}\n")

    async for message in query(
        prompt=f"Review {file_path} using all available specialist agents",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Grep", "Glob", "Task"],
            agents={
                "security-specialist": AgentDefinition(
                    description="Security vulnerability analyst. Use for security audits.",
                    prompt="""You are a security expert. When reviewing code:

1. Identify vulnerabilities:
   - SQL injection, XSS, CSRF
   - Authentication/authorization bypass
   - Sensitive data exposure
   - Input validation issues

2. For each finding:
   - Severity: CRITICAL/HIGH/MEDIUM/LOW
   - Location: File and line number
   - Description: What the vulnerability is
   - Impact: What could go wrong
   - Fix: Specific code changes needed

Format findings as:
[SEVERITY] Vulnerability Type at line X
- Impact: ...
- Fix: ...
""",
                    tools=["Read", "Grep", "Glob"],
                    model="opus"  # Use most capable model for security
                ),

                "performance-specialist": AgentDefinition(
                    description="Performance optimization analyst. Use for performance reviews.",
                    prompt="""You are a performance expert. When reviewing code:

1. Identify performance issues:
   - Database: N+1 queries, missing indexes, slow queries
   - Algorithms: Inefficient time/space complexity
   - Memory: Leaks, excessive allocations
   - Caching: Missing opportunities

2. For each finding:
   - Impact: Estimated performance cost
   - Location: File and line number
   - Problem: What's causing slowness
   - Solution: Specific optimization

Format findings as:
[IMPACT] Issue Type at line X
- Problem: ...
- Solution: ...
""",
                    tools=["Read", "Grep", "Glob"],
                    model="sonnet"
                ),

                "architecture-specialist": AgentDefinition(
                    description="Software architecture analyst. Use for design reviews.",
                    prompt="""You are an architecture expert. When reviewing code:

1. Evaluate design:
   - SOLID principles adherence
   - Design pattern appropriateness
   - Separation of concerns
   - Code maintainability
   - Testability

2. For each finding:
   - Principle: Which principle is violated
   - Location: File and line number
   - Issue: What's wrong with current design
   - Refactor: How to improve

Format findings as:
[PRINCIPLE] Violation Type at line X
- Issue: ...
- Refactor: ...
""",
                    tools=["Read", "Grep", "Glob"],
                    model="sonnet"
                ),

                "code-quality-specialist": AgentDefinition(
                    description="Code quality analyst. Use for style and best practice reviews.",
                    prompt="""You are a code quality expert. When reviewing code:

1. Check for:
   - Code complexity and readability
   - Naming conventions
   - Documentation quality
   - Error handling
   - Dead code and duplication

2. For each finding:
   - Category: Readability/Naming/Documentation/etc
   - Location: File and line number
   - Issue: What needs improvement
   - Suggestion: Specific improvement

Format findings as:
[CATEGORY] Issue Type at line X
- Issue: ...
- Suggestion: ...
""",
                    tools=["Read", "Grep", "Glob"],
                    model="sonnet"
                )
            }
        )
    ):
        # Track subagent invocations
        if hasattr(message, 'content') and message.content:
            for block in message.content:
                if getattr(block, 'type', None) == 'tool_use' and block.name == 'Task':
                    agent_type = block.input.get('subagent_type', 'unknown')
                    print(f"[SWARM] Spawned: {agent_type}")

        if hasattr(message, 'parent_tool_use_id') and message.parent_tool_use_id:
            print("[SWARM] Agent is executing...")

        # Print final synthesized report
        if hasattr(message, "result"):
            print("\n" + "=" * 80)
            print("FINAL CODE REVIEW REPORT")
            print("=" * 80)
            print(message.result)

if __name__ == "__main__":
    import sys

    file_to_review = sys.argv[1] if len(sys.argv) > 1 else "app/models/user.py"

    asyncio.run(parallel_code_review(file_to_review))
