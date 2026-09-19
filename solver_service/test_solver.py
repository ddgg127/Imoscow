from fastapi.testclient import TestClient

from solver_service.app import SolveRequest, app, solve_vrptw


def payload(engineers=None, jobs=None, distances=None, durations=None):
    engineers = engineers or [
        {
            "id": "e1", "region": "Восток", "start": [0, 0],
            "skills": ["Монтаж"], "equipment": ["ONT"],
            "transport": "Автомобиль", "shiftStart": 480, "shiftEnd": 720,
        },
        {
            "id": "e2", "region": "Восток", "start": [10, 0],
            "skills": ["Монтаж"], "equipment": ["ONT"],
            "transport": "Автомобиль", "shiftStart": 480, "shiftEnd": 720,
        },
    ]
    jobs = jobs or [
        {
            "id": "a", "region": "Восток", "coordinates": [1, 0], "kind": "Монтаж",
            "equipment": "ONT", "requiredTransport": "Автомобиль", "priority": 1,
            "windowStart": 480, "windowEnd": 650, "serviceMinutes": 30,
        },
        {
            "id": "b", "region": "Восток", "coordinates": [9, 0], "kind": "Монтаж",
            "equipment": "ONT", "requiredTransport": "Автомобиль", "priority": 1,
            "windowStart": 480, "windowEnd": 650, "serviceMinutes": 30,
        },
    ]
    points = [item["start"] for item in engineers] + [item["coordinates"] for item in jobs]
    distances = distances or [[abs(a[0] - b[0]) for b in points] for a in points]
    durations = durations or [[abs(a[0] - b[0]) * 3 for b in points] for a in points]
    return {
        "engineers": engineers, "jobs": jobs, "speedKmh": 24,
        "matrix": {"points": points, "distancesKm": distances, "durationsMin": durations},
        "timeLimitSeconds": 1,
    }


def test_health_and_solve_endpoint():
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok", "solver": "ortools"}
    response = client.post("/solve", json=payload())
    assert response.status_code == 200, response.text
    assert response.json()["engine"] == "ortools"
    assert not response.json()["droppedJobIds"]


def test_solver_uses_idle_qualified_engineer_to_maximize_coverage():
    data = payload()
    # One engineer cannot serve both jobs inside these disjoint tight windows,
    # but two qualified engineers can serve one each.
    data["jobs"][0].update(windowStart=480, windowEnd=490, serviceMinutes=60)
    data["jobs"][1].update(windowStart=480, windowEnd=490, serviceMinutes=60)
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert not result.droppedJobIds
    assert len(result.routes) == 2


def test_solver_minimizes_active_fleet_after_served_count():
    result = solve_vrptw(SolveRequest.model_validate(payload()))
    assert sum(len(route.jobIds) for route in result.routes) == 2
    assert len(result.routes) == 1


def test_incompatible_job_is_dropped_not_assigned():
    data = payload()
    data["jobs"][0]["kind"] = "Сварка"
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert "a" in result.droppedJobIds
    assert all("a" not in route.jobIds for route in result.routes)


def test_impossible_time_window_is_dropped():
    data = payload()
    data["jobs"][0].update(windowStart=100, windowEnd=110)
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert "a" in result.droppedJobIds


def test_bad_matrix_is_rejected():
    data = payload()
    data["matrix"]["distancesKm"][0][1] = -1
    response = TestClient(app).post("/solve", json=data)
    assert response.status_code == 422
