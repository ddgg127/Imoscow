# FieldFlow OR-Tools solver

The solver is a separate FastAPI service. Data-dependent integer bounds make the objective strictly lexicographic: it maximizes the number of served jobs, keeps the highest-priority jobs, minimizes the number of active engineers, then road distance. Time windows, shifts, skills, equipment, transport and regions are hard constraints.

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r solver_service\requirements.txt
.venv\Scripts\python -m uvicorn solver_service.app:app --host 127.0.0.1 --port 8000
```

Set `SOLVER_URL=http://127.0.0.1:8000` for the web server. `/api/solver` proxies to OR-Tools. If the service is unavailable, the API uses the deterministic server heuristic and reports `heuristic-server` as its engine.
