# Build stage
FROM python:3.12-slim AS builder

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Force uv to use the container's system Python 3.12
ENV UV_PYTHON=python3.12

# Copy dependency files first to leverage caching
COPY pyproject.toml uv.lock ./

# Sync dependencies into a virtual environment
RUN uv sync --frozen --no-dev

# Temporarily add venv to path so we can run Python for the model download
ENV PATH="/app/.venv/bin:$PATH"

# BAKE IN THE FAST-EMBED MODEL DURING THE BUILD STAGE
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2', cache_dir='/app/model_cache')"

# Runtime stage
FROM python:3.12-slim AS runner

WORKDIR /app

# Create a non-root user for secure local deployment
RUN useradd -m -r appuser && chown -R appuser /app

# Copy the virtual environment AND the cached model from the builder stage
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appuser /app/model_cache /app/model_cache

# Explicitly copy ONLY the backend files
COPY --chown=appuser:appuser main.py database.py RAGengine.py ./

# Set environment variables (combined to reduce image layers)
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

# Switch to the non-root user
USER appuser

EXPOSE 8000

# Run your application via Uvicorn (FastAPI)
CMD ["python", "main.py"]