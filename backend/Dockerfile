FROM python:3.12-slim
WORKDIR /app

# Зависимости backend
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Копируем backend и sapix-пакет (ядро верификации; импортируется как `import sapix`)
COPY backend/ ./backend/
COPY sapix/ ./sapix/

ENV PYTHONPATH=/app
WORKDIR /app/backend

RUN useradd --create-home --uid 1001 app && chown -R app:app /app
USER app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
