# Image để deploy C++ Flow lên nền tảng hosting (ví dụ Render).
# Ở đây g++ và gdb nằm ngay trong container của web, nên web chạy code trực tiếp
# (CPPFLOW_EXEC_MODE=direct) thay vì gọi `docker run`.
FROM python:3.12-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        g++ gdb util-linux \
    && rm -rf /var/lib/apt/lists/*

# Chạy bằng user thường (không phải root) để code người dùng không có quyền root.
RUN useradd --create-home --uid 10001 appuser

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static

USER appuser

ENV CPPFLOW_EXEC_MODE=direct \
    CPPFLOW_MAX_CONCURRENT_RUNS=2 \
    CPPFLOW_MAX_DEBUG_SESSIONS=3 \
    CPPFLOW_RATE_LIMIT_PER_MIN=30 \
    PYTHONUNBUFFERED=1

# Phiên debug nằm trong bộ nhớ của tiến trình, nên bắt buộc chỉ dùng 1 worker.
# Render cung cấp cổng qua biến PORT.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
