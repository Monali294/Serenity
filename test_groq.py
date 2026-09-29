from dotenv import load_dotenv
load_dotenv()

from groq_client import groq_chat

print(groq_chat([{"role": "user", "content": "Say hello in one short sentence."}]))