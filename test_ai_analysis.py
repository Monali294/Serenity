from ai_analysis import analyze_journal_with_ai


journal = """
Today I completed my project. I was tired after working on it,
but I felt really proud of myself. It feels good to finally finish it.
"""

result = analyze_journal_with_ai(journal)

print("\nAI ANALYSIS:")
print(result)