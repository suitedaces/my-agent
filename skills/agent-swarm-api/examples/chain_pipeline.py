#!/usr/bin/env python3
"""
Example: Sequential Pipeline using Prompt Chaining

Demonstrates chaining multiple LLM calls for progressive data transformation.
"""

from anthropic import Anthropic
import os

client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

def llm_call(prompt: str, model: str = "claude-sonnet-4") -> str:
    """Single LLM call with streaming."""
    print(f"[LLM] Calling {model}...")
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

def chain(input_text: str, prompts: list[str], verbose: bool = True) -> str:
    """Chain multiple LLM calls sequentially, passing results between steps."""
    result = input_text

    for i, prompt in enumerate(prompts, 1):
        print(f"\n{'=' * 60}")
        print(f"STEP {i}/{len(prompts)}")
        print(f"{'=' * 60}")

        if verbose:
            print(f"Prompt: {prompt[:100]}..." if len(prompt) > 100 else f"Prompt: {prompt}")
            print(f"\nInput:\n{result[:200]}..." if len(result) > 200 else f"\nInput:\n{result}")

        result = llm_call(f"{prompt}\n\nInput:\n{result}")

        if verbose:
            print(f"\nOutput:\n{result[:300]}..." if len(result) > 300 else f"\nOutput:\n{result}")

    return result

def financial_analysis_pipeline():
    """Example: Multi-stage financial data processing."""
    print("FINANCIAL ANALYSIS PIPELINE")
    print("=" * 60)

    # Raw data
    data = """
    Revenue Data (2024):
    Q1: $2,500,000
    Q2: $3,100,000
    Q3: $2,800,000
    Q4: $3,600,000

    Operating Expenses:
    Q1: $1,200,000
    Q2: $1,400,000
    Q3: $1,300,000
    Q4: $1,500,000

    Marketing Spend:
    Q1: $400,000
    Q2: $500,000
    Q3: $450,000
    Q4: $600,000
    """

    # Define transformation pipeline
    pipeline = [
        "Extract all numerical values and organize them into a structured format with clear labels for Revenue, Operating Expenses, and Marketing Spend per quarter.",

        "Calculate the following metrics for each quarter: Net Profit (Revenue - Operating Expenses), Profit Margin (Net Profit / Revenue * 100), Marketing ROI ((Revenue - Marketing Spend) / Marketing Spend * 100). Show all calculations.",

        "Convert all dollar amounts to percentages of the annual total in their respective categories. For example, Q1 Revenue as a percentage of total annual revenue.",

        "Identify trends: Which quarter performed best? Are there any concerning patterns? Calculate quarter-over-quarter growth rates.",

        "Format the final analysis as a markdown table with columns: Quarter, Revenue, Expenses, Profit, Profit Margin %, Marketing ROI %, and Key Insights. Sort by profitability."
    ]

    # Execute pipeline
    result = chain(data, pipeline, verbose=True)

    print("\n" + "=" * 60)
    print("FINAL RESULT")
    print("=" * 60)
    print(result)

    return result

def code_refactoring_pipeline():
    """Example: Multi-stage code transformation."""
    print("CODE REFACTORING PIPELINE")
    print("=" * 60)

    # Code to refactor
    code = """
def get_user_data(user_id):
    user = User.query.get(user_id)
    if user:
        orders = []
        for order_id in user.order_ids:
            o = Order.query.get(order_id)
            if o.status == 'completed':
                orders.append(o)
        total = 0
        for o in orders:
            total = total + o.amount
        return {'user': user.name, 'orders': len(orders), 'total': total}
    return None
    """

    pipeline = [
        "Identify all code quality issues: inefficiencies, poor naming, missing error handling, potential bugs. List each issue with line reference.",

        "Fix the N+1 query problem by suggesting how to use eager loading or batch queries.",

        "Improve variable naming: rename all single-letter or ambiguous variables to descriptive names.",

        "Add proper error handling: What happens if user is None? What if orders is empty? Add appropriate try-except blocks and validations.",

        "Refactor into a clean, production-ready function with: type hints, docstring, proper query optimization, error handling, and meaningful variable names. Show the complete refactored code."
    ]

    result = chain(code, pipeline, verbose=True)

    print("\n" + "=" * 60)
    print("REFACTORED CODE")
    print("=" * 60)
    print(result)

    return result

if __name__ == "__main__":
    import sys

    example = sys.argv[1] if len(sys.argv) > 1 else "financial"

    if example == "financial":
        financial_analysis_pipeline()
    elif example == "code":
        code_refactoring_pipeline()
    else:
        print(f"Unknown example: {example}")
        print("Usage: python chain_pipeline.py [financial|code]")
