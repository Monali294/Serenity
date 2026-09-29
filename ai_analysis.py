from groq_client import groq_chat, AIUnavailable


def analyze_journal_with_ai(journal_text):
    prompt = f"""
You are the AI reflection feature inside a wellness application called Serenity.

Analyze the journal entry below.

STRICT OUTPUT RULES:

1. Output ONLY the three sections shown below.
2. Do NOT write an introduction.
3. Do NOT write a conclusion.
4. Do NOT greet the user.
5. Do NOT ask questions.
6. Do NOT offer further help.
7. Do NOT use emojis.
8. End the response immediately after the Suggestion.
9. Keep the response under 100 words.

Use exactly this format:

Mood:
[One short mood description]

Reflection:
[2-3 short supportive sentences about the emotions and main feeling expressed]

Suggestion:
[One simple, practical and supportive suggestion]

IMPORTANT CALM CORNER RULE:
If the journal indicates that the user feels stressed, nervous, anxious, overwhelmed, tense, restless, or worried, the Suggestion MUST recommend trying a suitable activity from Serenity's Calm Corner.

Calm Corner activities include:

* Breathing exercises
* Guided relaxation
* Meditation
* Calming music
* Mindful breathing
* Short relaxation activities

For stress or nervousness, naturally suggest one or two suitable Calm Corner activities.
Example:
"Try a few minutes of mindful breathing or a guided relaxation exercise in the Calm Corner."

If the journal does not indicate stress, nervousness, anxiety, or similar feelings, give a normal supportive suggestion instead.

Do not diagnose the user.
Do not mention mental health disorders.
Do not provide medical advice.

Journal entry:
{journal_text}
"""


    try:
        ai_response = groq_chat(
            [{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=250,
        )
        return ai_response or None

    except AIUnavailable as e:
        print("AI ANALYSIS ERROR:", e)
        return None