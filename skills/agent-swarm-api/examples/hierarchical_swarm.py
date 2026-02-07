#!/usr/bin/env python3
"""
Example: Hierarchical Swarm with Coordinator

Demonstrates queen-led swarm coordination with synthesis and consensus.
"""

from anthropic import Anthropic
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import json
from typing import Dict, List, Tuple

client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

def llm_call(prompt: str, model: str = "claude-sonnet-4") -> str:
    """Single LLM call."""
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

class HierarchicalSwarm:
    """
    Hierarchical swarm with coordinator (queen) and specialized workers.

    The coordinator:
    - Delegates tasks to workers
    - Synthesizes worker results
    - Makes final decisions
    - Resolves conflicts
    """

    def __init__(
        self,
        workers: Dict[str, str],
        coordinator_model: str = "claude-opus-4",
        worker_model: str = "claude-sonnet-4"
    ):
        """
        Initialize swarm.

        Args:
            workers: Dict of {worker_name: worker_system_prompt}
            coordinator_model: Model for coordinator (needs best reasoning)
            worker_model: Model for workers (can be cheaper)
        """
        self.workers = workers
        self.coordinator_model = coordinator_model
        self.worker_model = worker_model

    def delegate(self, task: str, n_workers: int = None) -> Dict[str, str]:
        """
        Delegate task to workers in parallel.

        Returns: {worker_name: worker_result}
        """
        max_workers = n_workers or len(self.workers)

        def run_worker(name: str, system_prompt: str) -> Tuple[str, str]:
            print(f"[SWARM] Worker '{name}' starting...")

            full_prompt = f"""{system_prompt}

Task:
{task}

Provide your analysis below:"""

            result = llm_call(full_prompt, model=self.worker_model)
            print(f"[SWARM] Worker '{name}' completed")
            return (name, result)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                executor.submit(run_worker, name, prompt)
                for name, prompt in self.workers.items()
            ]
            return dict(f.result() for f in as_completed(futures))

    def synthesize(self, task: str, worker_results: Dict[str, str]) -> str:
        """
        Coordinator synthesizes worker results into final answer.
        """
        print(f"[SWARM] Coordinator synthesizing {len(worker_results)} worker reports...")

        coordinator_prompt = f"""You are the swarm coordinator. You delegated a task to specialized workers and received their reports.

Your responsibilities:
1. Analyze each worker's findings
2. Identify agreements and conflicts between workers
3. Resolve conflicts using expert judgment
4. Synthesize a comprehensive final answer
5. Highlight critical issues flagged by multiple workers
6. Make a clear final recommendation

Original Task:
{task}

Worker Reports:
{json.dumps(worker_results, indent=2)}

Provide your synthesis with these sections:
## Summary
## Key Agreements
## Conflicts and Resolutions
## Critical Issues
## Final Recommendation

Your synthesis:"""

        return llm_call(coordinator_prompt, model=self.coordinator_model)

    def consensus_vote(self, task: str, options: List[str], n_votes: int = 5) -> Dict:
        """
        Run consensus voting on multiple options.

        Returns: {option: vote_count, winner: option}
        """
        print(f"[SWARM] Running consensus vote with {n_votes} voters on {len(options)} options...")

        voting_prompt = f"""You are a voter in a consensus system. Analyze the task and vote for the BEST option.

Task:
{task}

Options:
{json.dumps(options, indent=2)}

Vote for exactly ONE option. Provide your reasoning and vote:

<reasoning>Your analysis of each option and why you chose this one</reasoning>
<vote>The exact option text you're voting for</vote>"""

        def vote() -> str:
            response = llm_call(voting_prompt, model=self.worker_model)
            # Extract vote
            import re
            match = re.search(r'<vote>(.*?)</vote>', response, re.DOTALL)
            return match.group(1).strip() if match else ""

        # Run parallel votes
        with ThreadPoolExecutor(max_workers=n_votes) as executor:
            futures = [executor.submit(vote) for _ in range(n_votes)]
            votes = [f.result() for f in as_completed(futures)]

        # Count votes
        vote_counts = {opt: 0 for opt in options}
        for vote_result in votes:
            if vote_result in vote_counts:
                vote_counts[vote_result] += 1

        winner = max(vote_counts, key=vote_counts.get)

        print(f"[SWARM] Voting complete. Winner: {winner} ({vote_counts[winner]}/{n_votes} votes)")

        return {
            "votes": vote_counts,
            "winner": winner,
            "consensus_strength": vote_counts[winner] / n_votes
        }

    def execute(self, task: str) -> str:
        """
        Execute task using hierarchical swarm.

        Returns final synthesized result from coordinator.
        """
        print(f"\n{'=' * 80}")
        print("HIERARCHICAL SWARM EXECUTION")
        print(f"{'=' * 80}\n")

        # Step 1: Delegate to workers
        print(f"Step 1: Delegating to {len(self.workers)} specialized workers...")
        worker_results = self.delegate(task)

        # Step 2: Print worker results
        print(f"\nStep 2: Worker Results:")
        for name, result in worker_results.items():
            print(f"\n--- {name.upper()} ---")
            print(result[:300] + "..." if len(result) > 300 else result)

        # Step 3: Coordinator synthesis
        print(f"\nStep 3: Coordinator synthesizing...")
        synthesis = self.synthesize(task, worker_results)

        return synthesis


# Example 1: Comprehensive Code Architecture Review
def architecture_review_example():
    """Multi-perspective architecture review using hierarchical swarm."""

    workers = {
        "security-architect": """You are a security architect. Analyze the system for:
- Authentication and authorization weaknesses
- Data protection and encryption gaps
- API security vulnerabilities
- Compliance issues (GDPR, HIPAA, etc.)

Format: List findings with severity (CRITICAL/HIGH/MEDIUM/LOW) and specific recommendations.""",

        "performance-architect": """You are a performance architect. Analyze the system for:
- Scalability bottlenecks
- Database query optimization opportunities
- Caching strategies
- Resource utilization issues

Format: List findings with estimated impact and optimization strategies.""",

        "maintainability-architect": """You are a maintainability architect. Analyze the system for:
- Code organization and modularity
- Technical debt
- Testing coverage gaps
- Documentation quality

Format: List findings with maintenance cost impact and refactoring suggestions.""",

        "reliability-architect": """You are a reliability architect. Analyze the system for:
- Single points of failure
- Error handling gaps
- Monitoring and alerting needs
- Disaster recovery preparedness

Format: List findings with risk level and resilience improvements."""
    }

    swarm = HierarchicalSwarm(workers, coordinator_model="claude-opus-4")

    architecture_description = """
System: E-commerce Platform

Components:
- Web frontend (React SPA)
- REST API (Node.js/Express)
- PostgreSQL database
- Redis cache
- S3 for image storage
- Stripe for payments

Current Architecture:
- Monolithic API with 50+ endpoints
- Direct database queries from controllers (no ORM)
- Session storage in Redis
- No API rate limiting
- Basic error handling (try-catch, log to console)
- Manual deployment via SSH
- Single production server (no load balancer)

Pain Points:
- API response times degrading (1-2s for product listing)
- Occasional payment failures with no retry mechanism
- No monitoring or alerting
- Deployments cause 2-3 minutes of downtime
"""

    print("Analyzing e-commerce platform architecture...\n")
    result = swarm.execute(f"Review this system architecture:\n\n{architecture_description}")

    print(f"\n{'=' * 80}")
    print("FINAL COORDINATOR SYNTHESIS")
    print(f"{'=' * 80}\n")
    print(result)


# Example 2: Consensus-Based Decision Making
def consensus_decision_example():
    """Use consensus voting for high-stakes decisions."""

    swarm = HierarchicalSwarm({})  # Don't need workers for voting

    decision = """
Our startup has $500K in funding and must choose our next 6-month priority.

Options:
1. Build mobile apps (iOS + Android) - Expand to mobile users, estimated 30% user growth
2. Add enterprise features (SSO, RBAC, audit logs) - Target larger customers, 10x average contract value
3. Improve core product (performance, UX, reliability) - Reduce churn from 5% to 2%, improve retention
4. Expand to new market (launch in EU) - New market opportunity, requires localization and compliance
5. Build API platform - Enable integrations and 3rd-party developers, potential new revenue stream

Context:
- Current MRR: $50K
- Team size: 8 engineers
- Burn rate: $80K/month
- Runway: 6 months
- Current users: 500 SMBs
"""

    options = [
        "Build mobile apps (iOS + Android)",
        "Add enterprise features (SSO, RBAC, audit logs)",
        "Improve core product (performance, UX, reliability)",
        "Expand to new market (launch in EU)",
        "Build API platform"
    ]

    print("Running consensus vote with 7 voters...\n")
    vote_result = swarm.consensus_vote(decision, options, n_votes=7)

    print(f"\n{'=' * 80}")
    print("VOTING RESULTS")
    print(f"{'=' * 80}\n")
    print(f"Winner: {vote_result['winner']}")
    print(f"Consensus Strength: {vote_result['consensus_strength']:.0%}\n")
    print("Vote Distribution:")
    for option, count in sorted(vote_result['votes'].items(), key=lambda x: x[1], reverse=True):
        bar = "█" * count
        print(f"{option:50} {bar} {count}")


# Example 3: Research + Analysis + Recommendation Pipeline
def research_pipeline_example():
    """Hierarchical swarm for comprehensive research and recommendation."""

    workers = {
        "market-researcher": """You are a market researcher. Analyze:
- Market size and growth trends
- Competitive landscape
- Customer demand signals
- Pricing benchmarks

Provide data-driven insights with specific numbers and sources.""",

        "technical-researcher": """You are a technical researcher. Analyze:
- Technical feasibility and complexity
- Technology stack options
- Integration requirements
- Development time estimates

Provide realistic technical assessment.""",

        "financial-analyst": """You are a financial analyst. Analyze:
- Revenue potential
- Cost structure
- Break-even timeline
- ROI projections

Provide conservative financial projections.""",

        "risk-analyst": """You are a risk analyst. Analyze:
- Market risks
- Technical risks
- Competitive risks
- Regulatory risks

Provide risk ratings and mitigation strategies."""
    }

    swarm = HierarchicalSwarm(workers, coordinator_model="claude-opus-4")

    opportunity = """
Opportunity: Launch AI-powered code review tool for enterprise teams

Product Vision:
- Automated code review with AI suggestions
- Security vulnerability detection
- Performance optimization recommendations
- Integration with GitHub, GitLab, Bitbucket

Target Market:
- Enterprise engineering teams (100+ developers)
- Mid-market tech companies (20-100 developers)

Competitive Landscape:
- SonarQube (established, complex setup)
- CodeClimate (expensive, limited AI)
- Snyk (focused on security only)

Pricing Idea:
- $10/developer/month
- Minimum 10 seats
"""

    print("Analyzing new product opportunity...\n")
    result = swarm.execute(f"Research and analyze this opportunity:\n\n{opportunity}")

    print(f"\n{'=' * 80}")
    print("FINAL RESEARCH SYNTHESIS & RECOMMENDATION")
    print(f"{'=' * 80}\n")
    print(result)


if __name__ == "__main__":
    import sys

    example = sys.argv[1] if len(sys.argv) > 1 else "architecture"

    if example == "architecture":
        architecture_review_example()
    elif example == "consensus":
        consensus_decision_example()
    elif example == "research":
        research_pipeline_example()
    else:
        print(f"Unknown example: {example}")
        print("Usage: python hierarchical_swarm.py [architecture|consensus|research]")
