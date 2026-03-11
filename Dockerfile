FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps 2>/dev/null || true

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD exec gunicorn --worker-class gthread \
    --workers 1 --threads 8 \
    --bind 0.0.0.0:$PORT --timeout 600 main:app