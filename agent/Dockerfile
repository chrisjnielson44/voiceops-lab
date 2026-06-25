FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pre-download model assets (VAD) at build time for faster cold starts.
RUN python agent.py download-files || true

CMD ["python", "agent.py", "start"]
