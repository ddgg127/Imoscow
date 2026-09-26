# FieldFlow OR-Tools solver

The solver is a separate FastAPI service. Data-dependent integer bounds make the objective strictly lexicographic: it first maximizes served elevated-priority jobs, then all served jobs, then minimizes active engineers and route distance. Time windows, shifts, skills, equipment, transport and regions are hard constraints.

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r solver_service\requirements.txt
.venv\Scripts\python -m uvicorn solver_service.app:app --host 127.0.0.1 --port 8000
```

Set `SOLVER_URL=http://127.0.0.1:8000` for the web server. `/api/solver` proxies to OR-Tools and accepts only a response whose `engine` is exactly `ortools`. If the service is unavailable, calculation returns HTTP 503; the application never labels a heuristic result as OR-Tools.

The root `render.yaml` deploys this directory as a free Render web service. After deployment, set the published site's `SOLVER_URL` to the resulting `https://…onrender.com` URL and verify both `/health` and the site's `/api/solver` health proxy.
