#!/usr/bin/env python3
"""
Example: Parallel Processing Swarm

Demonstrates concurrent execution across multiple independent workers.
"""

from anthropic import Anthropic
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import time

client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

def llm_call(prompt: str, model: str = "claude-sonnet-4") -> str:
    """Single LLM call."""
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

def parallel(
    prompt: str,
    inputs: list[str],
    n_workers: int = 3,
    model: str = "claude-sonnet-4"
) -> list[tuple[str, str]]:
    """
    Process multiple inputs in parallel with the same prompt.

    Returns list of (input, output) tuples.
    """
    def process(item: str) -> tuple[str, str]:
        worker_prompt = f"{prompt}\n\nInput:\n{item}"
        result = llm_call(worker_prompt, model=model)
        return (item, result)

    print(f"Processing {len(inputs)} items with {n_workers} parallel workers...")
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=n_workers) as executor:
        futures = [executor.submit(process, x) for x in inputs]

        results = []
        for future in as_completed(futures):
            input_item, output = future.result()
            results.append((input_item, output))
            print(f"✓ Completed: {input_item[:50]}...")

    elapsed = time.time() - start_time
    print(f"\nProcessed {len(inputs)} items in {elapsed:.2f}s")
    print(f"Average: {elapsed/len(inputs):.2f}s per item")

    return results

def code_review_swarm():
    """Review multiple files in parallel."""
    print("CODE REVIEW SWARM")
    print("=" * 60)

    files = [
        "app/models/user.py",
        "app/controllers/auth_controller.py",
        "app/services/payment_processor.py",
        "app/utils/validators.py",
        "app/models/order.py"
    ]

    review_prompt = """You are a code reviewer. Analyze this file for:

1. Security vulnerabilities (SQL injection, XSS, auth issues)
2. Performance problems (N+1 queries, inefficient algorithms)
3. Code quality issues (naming, complexity, duplication)

For each finding, provide:
- Severity: CRITICAL/HIGH/MEDIUM/LOW
- Location: Line number
- Issue: What's wrong
- Fix: How to resolve

Keep your review concise but thorough. Focus on the most important issues."""

    results = parallel(review_prompt, files, n_workers=3)

    # Print results
    for file_name, review in results:
        print("\n" + "=" * 80)
        print(f"FILE: {file_name}")
        print("=" * 80)
        print(review)

def stakeholder_analysis_swarm():
    """Analyze impact on multiple stakeholders in parallel."""
    print("STAKEHOLDER IMPACT ANALYSIS")
    print("=" * 60)

    decision = """
    Proposal: Increase product price by 20% while adding premium features
    - Features: Advanced analytics, priority support, API access
    - Current price: $49/month
    - New price: $59/month
    - Estimated development cost: $500K
    - Timeline: 6 months
    """

    stakeholders = [
        "Customers (current paying users)",
        "Sales team (responsible for new customer acquisition)",
        "Customer support team (handles user inquiries and issues)",
        "Product team (builds and maintains features)",
        "Investors (focused on revenue and growth)",
        "Engineering team (implements and maintains features)"
    ]

    analysis_prompt = """You are analyzing a business decision's impact on a specific stakeholder group.

For the given stakeholder:
1. Immediate Impact: How does this affect them right away?
2. Long-term Impact: What are the lasting effects?
3. Concerns: What will they worry about?
4. Opportunities: What benefits might they see?
5. Risk Level: LOW/MEDIUM/HIGH
6. Recommended Action: What should we do to address their needs?

Be specific and realistic. Consider both positive and negative impacts."""

    results = parallel(analysis_prompt, stakeholders, n_workers=6)

    # Print results
    for stakeholder, analysis in results:
        print("\n" + "=" * 80)
        print(f"STAKEHOLDER: {stakeholder}")
        print("=" * 80)
        print(analysis)

    # Synthesize findings
    print("\n" + "=" * 80)
    print("SYNTHESIS - OVERALL RECOMMENDATION")
    print("=" * 80)

    synthesis_prompt = f"""Based on these stakeholder analyses, provide:

1. Overall Risk Assessment: LOW/MEDIUM/HIGH
2. Key Concerns: Top 3 issues across all stakeholders
3. Mitigation Strategies: How to address each concern
4. Go/No-Go Recommendation: Should we proceed? Why or why not?

Stakeholder Analyses:
{chr(10).join([f"{s}:\n{a}\n" for s, a in results])}
"""

    synthesis = llm_call(synthesis_prompt, model="claude-opus-4")  # Use best model for synthesis
    print(synthesis)

def document_translation_swarm():
    """Translate documents to multiple languages in parallel."""
    print("MULTI-LANGUAGE TRANSLATION SWARM")
    print("=" * 60)

    document = """
    Product Launch Announcement

    We're excited to announce the launch of our new AI-powered analytics platform!

    Key Features:
    - Real-time data processing with sub-second latency
    - Advanced machine learning models for predictive analytics
    - Intuitive dashboard with customizable visualizations
    - Enterprise-grade security and compliance

    Pricing starts at $99/month for small teams.
    Sign up today for a 14-day free trial!
    """

    languages = [
        "Spanish (Latin American)",
        "French (European)",
        "German",
        "Japanese",
        "Mandarin Chinese (Simplified)"
    ]

    translation_prompt = """Translate this product announcement to the specified language.

Requirements:
- Maintain professional business tone
- Keep formatting (bullet points, etc.)
- Adapt cultural references appropriately
- Ensure pricing information is clear
- Make it compelling for that market

Provide ONLY the translation, no explanations."""

    results = parallel(translation_prompt, languages, n_workers=5, model="claude-sonnet-4")

    # Print results
    for language, translation in results:
        print("\n" + "=" * 80)
        print(f"LANGUAGE: {language}")
        print("=" * 80)
        print(translation)

if __name__ == "__main__":
    import sys

    example = sys.argv[1] if len(sys.argv) > 1 else "code"

    if example == "code":
        code_review_swarm()
    elif example == "stakeholder":
        stakeholder_analysis_swarm()
    elif example == "translate":
        document_translation_swarm()
    else:
        print(f"Unknown example: {example}")
        print("Usage: python parallel_swarm.py [code|stakeholder|translate]")
