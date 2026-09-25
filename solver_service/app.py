from __future__ import annotations

import math
import time
from typing import Literal

from fastapi import FastAPI, HTTPException
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from pydantic import BaseModel, Field, model_validator


class Engineer(BaseModel):
    id: str
    region: str
    start: tuple[float, float]
    skills: list[str]
    equipment: list[str]
    transport: str
    speedKmh: float | None = Field(default=None, ge=2, le=200)
    shiftStart: int
    shiftEnd: int


class Job(BaseModel):
    id: str
    region: str
    coordinates: tuple[float, float]
    kind: str
    equipment: str
    requiredTransport: str = ""
    allowedTransports: list[str] | None = None
    priority: int = Field(default=1, ge=1, le=100)
    windowStart: int
    windowEnd: int
    serviceMinutes: int
    cancelled: bool = False
    executionStatus: Literal["not_started", "in_progress", "completed"] = "not_started"
    urgency: Literal["normal", "urgent"] = "normal"
    workClass: Literal["emergency", "connection", "repair"] = "repair"


class Matrix(BaseModel):
    points: list[tuple[float, float]]
    distancesKm: list[list[float]]
    durationsMin: list[list[float]]

    @model_validator(mode="after")
    def square(self) -> "Matrix":
        size = len(self.points)
        if size < 2 or any(len(row) != size for row in self.distancesKm) or any(len(row) != size for row in self.durationsMin):
            raise ValueError("matrix must be square and match points")
        values = (value for table in (self.distancesKm, self.durationsMin) for row in table for value in row)
        if any(not math.isfinite(value) or value < 0 for value in values):
            raise ValueError("matrix values must be finite and non-negative")
        return self


class SolveRequest(BaseModel):
    engineers: list[Engineer] = Field(min_length=1, max_length=500)
    jobs: list[Job] = Field(max_length=1000)
    speedKmh: float = Field(ge=5, le=200)
    urgentId: str | None = None
    eventTime: int | None = Field(default=None, ge=0, le=1440)
    eventType: Literal["new_job", "cancel_job", "engineer_unavailable", "recalculate"] | None = None
    forcedAssignments: dict[str, str] = Field(default_factory=dict)
    matrix: Matrix
    modeMatrices: dict[str, Matrix] = Field(default_factory=dict)
    timeLimitSeconds: int = Field(default=12, ge=1, le=60)


class RouteOrder(BaseModel):
    engineerId: str
    jobIds: list[str]


class SolveResponse(BaseModel):
    engine: Literal["ortools"] = "ortools"
    routes: list[RouteOrder]
    droppedJobIds: list[str]
    runtimeMs: float
    status: str


app = FastAPI(title="FieldFlow OR-Tools Solver", version="1.0.0")


def key(point: tuple[float, float]) -> str:
    return f"{point[0]:.5f},{point[1]:.5f}"


def compatible(engineer: Engineer, job: Job) -> bool:
    return (
        not job.cancelled
        and job.executionStatus != "completed"
        and engineer.region == job.region
        and (
            engineer.transport == job.requiredTransport if job.requiredTransport
            else engineer.transport in job.allowedTransports if job.allowedTransports
            else True
        )
        and job.equipment in engineer.equipment
        and job.kind in engineer.skills
    )


TRANSPORT_SPEEDS = {
    "Пешком": 5.0,
    "Пешеход": 5.0,
    "Велосипед": 15.0,
    "Общественный транспорт": 18.0,
}


def vehicle_travel_minutes(data: SolveRequest, vehicle: int, from_point: int, to_point: int) -> int:
    engineer = data.engineers[vehicle]
    matrix = matrix_for_vehicle(data, vehicle)
    road_km = matrix.distancesKm[from_point][to_point]
    if road_km < 0.001:
        return 0
    speed = engineer.speedKmh or (data.speedKmh if engineer.transport == "Автомобиль" else TRANSPORT_SPEEDS.get(engineer.transport, data.speedKmh))
    if engineer.transport == "Автомобиль":
        minutes = matrix.durationsMin[from_point][to_point] * data.speedKmh / speed
    else:
        access = 6 if engineer.transport == "Общественный транспорт" else 2
        minutes = road_km / speed * 60 + access
    return max(1, math.ceil(minutes))


def matrix_for_vehicle(data: SolveRequest, vehicle: int) -> Matrix:
    transport = data.engineers[vehicle].transport
    mode = "walking" if transport in ("Пешком", "Пешеход") else "cycling" if transport == "Велосипед" else "driving"
    return data.modeMatrices.get(mode, data.matrix)


def solve_vrptw(data: SolveRequest) -> SolveResponse:
    started = time.perf_counter()
    if not data.jobs:
        return SolveResponse(routes=[], droppedJobIds=[], runtimeMs=0, status="empty")
    if data.eventTime is not None and any(engineer.shiftStart < data.eventTime for engineer in data.engineers):
        raise HTTPException(status_code=422, detail="event continuation starts before eventTime")

    point_index = {key(point): index for index, point in enumerate(data.matrix.points)}
    node_points = [engineer.start for engineer in data.engineers] + [job.coordinates for job in data.jobs]
    try:
        matrix_nodes = [point_index[key(point)] for point in node_points]
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"matrix misses coordinate {exc.args[0]}") from exc

    engineer_count = len(data.engineers)
    engineer_index = {engineer.id: index for index, engineer in enumerate(data.engineers)}
    job_ids = {job.id for job in data.jobs}
    unknown_jobs = sorted(set(data.forcedAssignments) - job_ids)
    unknown_engineers = sorted(set(data.forcedAssignments.values()) - set(engineer_index))
    if unknown_jobs:
        raise HTTPException(status_code=422, detail=f"forced assignment references unknown jobs: {', '.join(unknown_jobs)}")
    if unknown_engineers:
        raise HTTPException(status_code=422, detail=f"forced assignment references unknown engineers: {', '.join(unknown_engineers)}")
    node_count = len(node_points)
    starts = list(range(engineer_count))
    ends = list(range(engineer_count))
    manager = pywrapcp.RoutingIndexManager(node_count, engineer_count, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    for name, matrix in data.modeMatrices.items():
        if matrix.points != data.matrix.points:
            raise HTTPException(status_code=422, detail=f"{name} matrix points must match the main matrix")

    def distance_callback(vehicle: int):
        def distance(from_index: int, to_index: int) -> int:
            if routing.IsEnd(to_index):
                return 0
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            value = matrix_for_vehicle(data, vehicle).distancesKm[matrix_nodes[from_node]][matrix_nodes[to_node]]
            # Decimetric-kilometre objective (100 m units): preserve useful
            # route ordering without multiplying lexicographic penalties into
            # int64 overflow for the complete 205-job source dataset.
            return max(0, int(round(value * 10)))
        return distance

    def time_callback(vehicle: int):
        def transit(from_index: int, to_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            service = data.jobs[from_node - engineer_count].serviceMinutes if from_node >= engineer_count else 0
            if routing.IsEnd(to_index):
                return service
            to_node = manager.IndexToNode(to_index)
            return service + vehicle_travel_minutes(data, vehicle, matrix_nodes[from_node], matrix_nodes[to_node])
        return transit

    time_indices = [routing.RegisterTransitCallback(time_callback(vehicle)) for vehicle in range(engineer_count)]
    distance_indices = [routing.RegisterTransitCallback(distance_callback(vehicle)) for vehicle in range(engineer_count)]
    for vehicle, distance_index in enumerate(distance_indices):
        routing.SetArcCostEvaluatorOfVehicle(distance_index, vehicle)

    # Lexicographic: emergencies -> urgent jobs -> total served -> work class
    # and business priority -> active fleet -> road distance. A new incident
    # can displace several ordinary jobs; ordinary work cannot displace it.
    max_arc_cost = max(int(math.ceil(value * 10)) for matrix in [data.matrix, *data.modeMatrices.values()] for row in matrix.distancesKm for value in row)
    max_total_distance = max(1, max_arc_cost * len(data.jobs))
    vehicle_weight = max_total_distance + 1
    max_fleet_and_distance = len(data.engineers) * vehicle_weight + max_total_distance
    priority_weight = max_fleet_and_distance + 1
    class_rank = {"repair": 0, "connection": 1, "emergency": 2}
    effective_priority = {job.id: class_rank[job.workClass] * 101 + job.priority for job in data.jobs}
    priority_sum = sum(effective_priority.values())
    dropped_job_weight = priority_sum * priority_weight + max_fleet_and_distance + 1
    urgent_weight = len(data.jobs) * dropped_job_weight + priority_sum * priority_weight + max_fleet_and_distance + 1
    emergency_weight = len(data.jobs) * urgent_weight + len(data.jobs) * dropped_job_weight + priority_sum * priority_weight + max_fleet_and_distance + 1
    def drop_penalty(job: Job) -> int:
        urgent = job.urgency == "urgent" or job.id == data.urgentId
        return (dropped_job_weight + effective_priority[job.id] * priority_weight
                + (urgent_weight if urgent else 0)
                + (emergency_weight if job.workClass == "emergency" else 0))
    max_objective = sum(drop_penalty(job) for job in data.jobs) + max_fleet_and_distance
    if max_objective >= 8_000_000_000_000_000_000:
        raise HTTPException(status_code=422, detail="matrix costs are too large for a safe integer objective")

    for vehicle in range(engineer_count):
        routing.SetFixedCostOfVehicle(vehicle_weight, vehicle)

    max_end = max(engineer.shiftEnd for engineer in data.engineers)
    routing.AddDimensionWithVehicleTransits(time_indices, max_end, max_end + 1440, False, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")

    for vehicle, engineer in enumerate(data.engineers):
        time_dimension.CumulVar(routing.Start(vehicle)).SetRange(engineer.shiftStart, engineer.shiftStart)
        time_dimension.CumulVar(routing.End(vehicle)).SetRange(engineer.shiftStart, engineer.shiftEnd)
        routing.AddVariableMinimizedByFinalizer(time_dimension.CumulVar(routing.End(vehicle)))

    for job_offset, job in enumerate(data.jobs):
        node = engineer_count + job_offset
        index = manager.NodeToIndex(node)
        allowed: list[int] = []
        for vehicle, engineer in enumerate(data.engineers):
            if not compatible(engineer, job):
                continue
            travel = vehicle_travel_minutes(data, vehicle, matrix_nodes[vehicle], matrix_nodes[node])
            work_start = max(job.windowStart, engineer.shiftStart + travel)
            if work_start <= job.windowEnd and work_start + job.serviceMinutes <= engineer.shiftEnd:
                allowed.append(vehicle)
        forced_engineer_id = data.forcedAssignments.get(job.id)
        forced_vehicle = engineer_index.get(forced_engineer_id) if forced_engineer_id else None
        if allowed:
            time_dimension.CumulVar(index).SetRange(job.windowStart, job.windowEnd)
            # An optional node has vehicle -1 when dropped. Keep that value in
            # the domain; excluding it silently makes every compatible job
            # mandatory and can render an overloaded schedule infeasible.
            # VehicleVar is used instead of SetAllowedVehiclesForIndex because
            # OR-Tools 9.15 on Windows has a SWIG Span conversion regression.
            routing.VehicleVar(index).SetValues([-1, *allowed])
        if forced_engineer_id:
            if forced_vehicle not in allowed:
                raise HTTPException(
                    status_code=422,
                    detail=f"forced assignment {job.id} -> {forced_engineer_id} violates resources, shift or SLA",
                )
            routing.VehicleVar(index).SetValue(forced_vehicle)
            routing.ActiveVar(index).SetValue(1)
        else:
            penalty = drop_penalty(job)
            routing.AddDisjunction([index], penalty)
        if not allowed and not forced_engineer_id:
            # An optional node without an allowed vehicle must be forced inactive;
            # otherwise OR-Tools treats an empty allow-list as unrestricted.
            routing.ActiveVar(index).SetValue(0)

    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    parameters.time_limit.seconds = data.timeLimitSeconds
    parameters.log_search = False
    solution = routing.SolveWithParameters(parameters)
    if solution is None:
        raise HTTPException(status_code=422, detail="OR-Tools found no feasible plan")

    routes: list[RouteOrder] = []
    served: set[str] = set()
    for vehicle, engineer in enumerate(data.engineers):
        index = routing.Start(vehicle)
        job_ids: list[str] = []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node >= engineer_count:
                job_id = data.jobs[node - engineer_count].id
                job_ids.append(job_id)
                served.add(job_id)
            index = solution.Value(routing.NextVar(index))
        if job_ids:
            routes.append(RouteOrder(engineerId=engineer.id, jobIds=job_ids))

    status = routing.status()
    # Numeric codes are stable in the RoutingSearchStatus proto. Keeping the
    # mapping local avoids depending on optional Python enum attributes.
    status_names = {1: "success", 2: "partial_success", 7: "time_limit"}
    return SolveResponse(
        routes=routes,
        droppedJobIds=[job.id for job in data.jobs if job.id not in served],
        runtimeMs=round((time.perf_counter() - started) * 1000, 1),
        status=status_names.get(status, f"status_{status}"),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "solver": "ortools"}


@app.post("/solve", response_model=SolveResponse)
def solve(data: SolveRequest) -> SolveResponse:
    return solve_vrptw(data)
