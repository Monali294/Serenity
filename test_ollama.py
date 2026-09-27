import requests

url = "http://localhost:11434/api/generate"

data = {
    "model": "gemma3:1b",
    "prompt": "Give a short, supportive reflection on this journal entry: I completed my project today and I feel proud, although I am tired.",
    "stream": False
}

response = requests.post(url, json=data)

print("Status:", response.status_code)
print("Response:")
print(response.json()["response"])