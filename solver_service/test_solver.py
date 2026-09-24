from fastapi.testclient import TestClient

from solver_service.app import SolveRequest, app, solve_vrptw, vehicle_travel_minutes


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


def test_compatible_jobs_can_be_dropped_when_schedule_is_overloaded():
    data = payload()
    data["engineers"] = data["engineers"][:1]
    data["jobs"][0].update(windowStart=483, windowEnd=483, serviceMinutes=60)
    data["jobs"][1].update(coordinates=[1, 0], windowStart=483, windowEnd=483, serviceMinutes=60)
    # Both jobs fit the same engineer individually, but only one fits the day.
    # The solver must return a partial plan rather than 422/no feasible plan.
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert sum(len(route.jobIds) for route in result.routes) == 1
    assert len(result.droppedJobIds) == 1


def test_cancelled_job_is_forced_inactive():
    data = payload()
    data["jobs"][0]["cancelled"] = True
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert "a" in result.droppedJobIds
    assert all("a" not in route.jobIds for route in result.routes)


def test_completed_job_is_forced_inactive():
    data = payload()
    data["jobs"][0]["executionStatus"] = "completed"
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert "a" in result.droppedJobIds
    assert all("a" not in route.jobIds for route in result.routes)


def test_allowed_transport_list_is_honoured():
    data = payload()
    data["engineers"][0]["transport"] = "Велосипед"
    data["jobs"][0]["allowedTransports"] = ["Автомобиль", "Велосипед"]
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert "a" not in result.droppedJobIds


def test_bad_matrix_is_rejected():
    data = payload()
    data["matrix"]["distancesKm"][0][1] = -1
    response = TestClient(app).post("/solve", json=data)
    assert response.status_code == 422


def test_forced_assignment_runs_a_real_counterfactual():
    data = payload()
    data["forcedAssignments"] = {"a": "e2"}
    result = TestClient(app).post("/solve", json=data)
    assert result.status_code == 200, result.text
    routes = {route["engineerId"]: route["jobIds"] for route in result.json()["routes"]}
    assert "a" in routes["e2"]
    assert result.json()["engine"] == "ortools"


def test_impossible_forced_assignment_is_rejected_explicitly():
    data = payload()
    data["engineers"][1]["skills"] = ["Диагностика"]
    data["forcedAssignments"] = {"a": "e2"}
    result = TestClient(app).post("/solve", json=data)
    assert result.status_code == 422
    assert "forced assignment" in result.text


def test_transport_modes_and_individual_speed_change_travel_time():
    data = payload()
    data["matrix"]["distancesKm"][0][2] = 10
    data["matrix"]["durationsMin"][0][2] = 25
    request = SolveRequest.model_validate(data)
    assert vehicle_travel_minutes(request, 0, 0, 2) == 25
    request.engineers[0].transport = "Велосипед"
    assert vehicle_travel_minutes(request, 0, 0, 2) == 42
    request.engineers[0].transport = "Пешком"
    assert vehicle_travel_minutes(request, 0, 0, 2) == 122
    request.engineers[0].transport = "Общественный транспорт"
    assert vehicle_travel_minutes(request, 0, 0, 2) == 40
    request.engineers[0].transport = "Автомобиль"
    request.engineers[0].speedKmh = 12
    assert vehicle_travel_minutes(request, 0, 0, 2) == 50


def test_bicycle_uses_its_own_network_matrix_in_solver():
    data = payload()
    data["engineers"][0]["transport"] = "Велосипед"
    data["jobs"][0]["allowedTransports"] = ["Велосипед"]
    data["jobs"][0]["windowEnd"] = 505
    data["jobs"][0]["serviceMinutes"] = 10
    data["jobs"][1]["kind"] = "Другой навык"
    data["matrix"]["distancesKm"][0][2] = 10
    data["modeMatrices"] = {"cycling": {
        "points": data["matrix"]["points"],
        "distancesKm": [[0 if i == j else 1.2 for j in range(4)] for i in range(4)],
        "durationsMin": [[0 if i == j else 7 for j in range(4)] for i in range(4)],
    }}
    request = SolveRequest.model_validate(data)
    assert vehicle_travel_minutes(request, 0, 0, 2) == 7
    result = solve_vrptw(request)
    assert "a" not in result.droppedJobIds


def test_slow_pedestrian_cannot_arrive_in_car_window():
    data = payload()
    data["engineers"] = data["engineers"][:1]
    data["engineers"][0]["transport"] = "Пешком"
    data["jobs"] = data["jobs"][:1]
    data["jobs"][0]["allowedTransports"] = ["Пешком", "Автомобиль"]
    data["jobs"][0]["windowEnd"] = 510
    data["matrix"]["distancesKm"][0][2] = 10
    data["matrix"]["durationsMin"][0][2] = 25
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert result.droppedJobIds == ["a"]
    data["engineers"][0]["transport"] = "Автомобиль"
    result = solve_vrptw(SolveRequest.model_validate(data))
    assert result.droppedJobIds == []
