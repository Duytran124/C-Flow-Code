# C++ Flow — Local MVP

C++ Flow is a local website for entering C++ code, providing stdin, compiling/running it in a Docker container, and viewing stdout/stderr/compiler errors. The GDB debugger can stop at source lines, show the current frame's variables/call stack, and step through real C++ execution.

## Features in this MVP
- Browser-based C++ editor (textarea; Monaco can be added later)
- Standard input panel
- Run button and output/error display
- Three feature tabs prepared: Normal Code, Graph, Tree
- C++ execution delegated to a Docker container with resource limits and no network
- Local-only FastAPI backend
- Separate GDB debug image, source-level stepping, variables/call stack panel
- Debug speed choices: 50 ms, 500 ms, 2000 ms, plus pause and single-step controls

## Requirements
- Python 3.10+
- Docker Desktop installed and running (Linux containers)
- Internet for the first Docker image pull (`gcc:14`)

## Windows setup

1. Extract this folder.
2. Open PowerShell in the `cpp-flow` folder.
3. Create and activate a Python virtual environment:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If PowerShell blocks activation, use `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` and then run Uvicorn with `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.

4. Confirm Docker is running:

```powershell
docker version
```

5. Build the separate debugger image (one-time setup; it installs GDB inside Docker):

```powershell
docker build -f Dockerfile.debug -t cpp-flow-debug:local .
```

6. Start the website:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

7. Open http://127.0.0.1:8000 in your browser.

On first setup, Docker may need to download `gcc:14` and install GDB into the separate `cpp-flow-debug:local` image. The normal “Chạy C++” feature continues to use the existing `gcc:14` runner; the debugger uses the separate image.

## Important safety notes
- For the local setup the backend binds only to `127.0.0.1`; do not expose it to your LAN or the public internet unless you deploy it deliberately as described above.
- C++ is compiled and executed inside a container with networking disabled, memory/CPU/PID limits, a read-only root filesystem, and a temporary filesystem for compilation.
- This is a development MVP, not a hardened multi-user service. Keep Docker Desktop and the host OS updated.
- Do not add mounts of your home folder, credentials, or project directories to the execution container.
- The debugger uses GDB source-level stepping. Optimized/complex STL values can be incomplete, and some programs with unusual runtime behavior may not be easy to inspect. The debugger container needs ptrace permission and uses a more permissive seccomp profile than the normal runner, so keep the app bound to localhost and use it only for code you trust.
- Automatic algorithm recognition and graph/tree drawing are not implemented yet.

## Execution modes

The backend chooses how to run C++ with the `CPPFLOW_EXEC_MODE` environment variable:

| Value | Behaviour |
|---|---|
| `auto` (default) | Use Docker when Docker is reachable, otherwise run `g++`/`gdb` directly |
| `docker` | Always use Docker (the local setup described above) |
| `direct` | Always run `g++`/`gdb` directly inside the machine/container running the web app (Linux only, needs `g++`, `gdb`, `prlimit`) |

`direct` mode is weaker isolation than Docker. It applies `prlimit` limits (CPU, memory, output size, process count), a wall-clock timeout, kills the whole process group, hands the program a clean environment (no server env vars), and caps concurrent runs/debug sessions. Other environment variables: `CPPFLOW_MAX_CONCURRENT_RUNS` (default 2), `CPPFLOW_MAX_DEBUG_SESSIONS` (default 3), `CPPFLOW_RATE_LIMIT_PER_MIN` (default 30 runs/debug-starts per IP, 0 disables). `CPPFLOW_PCH_DIR` points to a precompiled `<bits/stdc++.h>` (built in the `Dockerfile`) that makes code starting with `#include <bits/stdc++.h>` compile several times faster; it only helps when that include is the first one in the file. `CPPFLOW_PCH_RUN_DIR` is the same idea for the "Chạy C++" button (its compiler flags differ from the debugger's, so it needs its own build). In `direct` mode, successful compiles are cached by source hash (`CPPFLOW_COMPILE_CACHE_ENTRIES`, default 40, 0 disables; each entry is SHA-256 verified before reuse), so re-running the same code with different input skips g++. In Docker mode, `CPPFLOW_RUN_IMAGE` selects the image (`runner.ps1` builds and sets `cpp-flow-debug:local`, which contains both precompiled headers). The status pill in the page header shows which mode is active (Docker or direct) and refreshes every 15 seconds.

## Deploying publicly (e.g. Render, free web service)

1. Push this folder to a GitHub repository (without `.venv`).
2. On Render: New → Web Service → connect the repo → Language/Runtime **Docker** → Instance type **Free**. The root `Dockerfile` installs `g++`/`gdb` and starts the app in `direct` mode as a non-root user.
3. Keep exactly **one worker** (debug sessions live in process memory). Keep unrelated secrets out of this service's environment; the runner token below is hidden from user code on Linux (`PR_SET_DUMPABLE`).
4. Free instances sleep after a period without traffic and are small; compiling large headers such as `<bits/stdc++.h>` may be slow or run out of memory. GDB may be refused by some container runtimes (ptrace); the UI then shows a message and "Chạy C++" still works.

Anyone with the link can run C++ on that server. Treat it as a public demo, not a hardened judge system.

## Optional: use Docker on your own PC when it is on (hybrid)

The public site can hand code execution over to a **runner** on your PC (Docker) through an ngrok tunnel, and fall back to direct mode on the server when the runner is off.

**Public site (Render → Environment):**
- `CPPFLOW_REMOTE_RUNNER_URL` = `https://your-domain.ngrok-free.app` (no trailing slash)
- `CPPFLOW_REMOTE_RUNNER_TOKEN` = a long random string, e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- optional `CPPFLOW_REMOTE_DEBUG=0` keeps the step debugger on the server and only moves "Chạy C++" to your PC.

**Your PC (Docker Desktop running):**
1. `.\runner.ps1` — starts the runner on port 8001 with Docker mode and asks for the same token.
2. In another terminal: `ngrok http 8001` (use a reserved/static ngrok domain so the URL does not change).

The runner rejects any `/api/*` call without the correct `X-Runner-Token`. The header pill on the site shows `Docker (máy chạy từ xa)` while the runner is reachable and `Chạy trực tiếp (máy Docker đang tắt)` otherwise. If the runner disappears mid debug session, the user sees a message and restarts the debug; new runs use the fallback automatically.

Security: your PC runs strangers' code in Docker (no network, memory/CPU/PID limits). The debugger container needs ptrace and a looser seccomp profile than the normal runner, so consider `CPPFLOW_REMOTE_DEBUG=0`. Use a strong token and stop the runner when you do not want to serve traffic.

## Project structure

```text
cpp-flow/
├── app/
│   ├── main.py
│   ├── runner.py
│   ├── debugger.py
│   ├── sandbox.py
│   └── remote.py
├── static/
│   ├── index.html
│   ├── app.css
│   └── app.js
├── Dockerfile          (public deploy, direct mode)
├── Dockerfile.debug    (local debugger image for Docker mode)
├── runner.ps1          (start the Docker runner on your PC)
├── requirements.txt
└── README.md
```

## Troubleshooting
- `Docker is not available`: launch Docker Desktop and wait until it says the engine is running.
- Image pull error: run `docker pull gcc:14` and retry.
- Debugger says image is missing: from the project folder, run `docker build -f Dockerfile.debug -t cpp-flow-debug:local .` and wait for it to finish.
- Debugger cannot start: confirm Docker Desktop is using Linux containers and rebuild the debug image if needed.
- `docker` permission/connection error: check Docker Desktop settings and current user permissions.
- Compile errors appear in the error panel.
- Infinite loops are stopped by a timeout.
