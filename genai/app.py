from google import genai

# The client gets the API key from the environment variable .
client = genai.Client()

response = client.models.generate_content(
    model="gemini-2.5-flash", contents="以下のメッセージに対して2択の返事を返す場合、適切な返事を作成してください「今日仕事帰りによって夕飯食べて帰ろうと思うけど、そちらの都合はどう？」"
)
print(response.text)
