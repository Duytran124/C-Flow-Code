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

`direct` mode is weaker isolation than Docker. It applies `prlimit` limits (CPU, memory, output size, process count), a wall-clock timeout, kills the whole process group, hands the program a clean environment (no server env vars), and caps concurrent runs/debug sessions. Other environment variables: `CPPFLOW_MAX_CONCURRENT_RUNS` (default 2), `CPPFLOW_MAX_DEBUG_SESSIONS` (default 3), `CPPFLOW_RATE_LIMIT_PER_MIN` (default 30 runs/debug-starts per IP, 0 disables).

## Deploying publicly (e.g. Render, free web service)

1. Push this folder to a GitHub repository (without `.venv`).
2. On Render: New → Web Service → connect the repo → Language/Runtime **Docker** → Instance type **Free**. The root `Dockerfile` installs `g++`/`gdb` and starts the app in `direct` mode as a non-root user.
3. Keep exactly **one worker** (debug sessions live in process memory). Do not store secrets in this service's environment variables.
4. Free instances sleep after a period without traffic and are small; compiling large headers such as `<bits/stdc++.h>` may be slow or run out of memory. GDB may be refused by some container runtimes (ptrace); the UI then shows a message and "Chạy C++" still works.

Anyone with the link can run C++ on that server. Treat it as a public demo, not a hardened judge system.

## Project structure

```text
cpp-flow/
├── app/
│   ├── main.py
│   ├── runner.py
│   ├── debugger.py
│   └── sandbox.py
├── static/
│   ├── index.html
│   ├── app.css
│   └── app.js
├── Dockerfile          (public deploy, direct mode)
├── Dockerfile.debug    (local debugger image for Docker mode)
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
