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
    shiftStart: int
    shiftEnd: int


class Job(BaseModel):
    id: str
    region: str
    coordinates: tuple[float, float]
    kind: str
    equipment: str
    requiredTransport: str
    allowedTransports: list[str] | None = None
    priority: int = Field(default=1, ge=1, le=100)
    windowStart: int
    windowEnd: int
    serviceMinutes: int
    cancelled: bool = False


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
    matrix: Matrix
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
        and engineer.region == job.region
        and engineer.transport in (job.allowedTransports or [job.requiredTransport])
        and job.equipment in engineer.equipment
        and job.kind in engineer.skills
    )


def solve_vrptw(data: SolveRequest) -> SolveResponse:
    started = time.perf_counter()
    if not data.jobs:
        return SolveResponse(routes=[], droppedJobIds=[], runtimeMs=0, status="empty")

    point_index = {key(point): index for index, point in enumerate(data.matrix.points)}
    node_points = [engineer.start for engineer in data.engineers] + [job.coordinates for job in data.jobs]
    try:
        matrix_nodes = [point_index[key(point)] for point in node_points]
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"matrix misses coordinate {exc.args[0]}") from exc

    engineer_count = len(data.engineers)
    node_count = len(node_points)
    starts = list(range(engineer_count))
    ends = list(range(engineer_count))
    manager = pywrapcp.RoutingIndexManager(node_count, engineer_count, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        if routing.IsEnd(to_index):
            return 0
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        value = data.matrix.distancesKm[matrix_nodes[from_node]][matrix_nodes[to_node]]
        return max(0, int(round(value * 1000)))

    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        service = data.jobs[from_node - engineer_count].serviceMinutes if from_node >= engineer_count else 0
        if routing.IsEnd(to_index):
            return service
        to_node = manager.IndexToNode(to_index)
        travel = data.matrix.durationsMin[matrix_nodes[from_node]][matrix_nodes[to_node]]
        return service + max(0, int(math.ceil(travel)))

    distance_index = routing.RegisterTransitCallback(distance_callback)
    time_index = routing.RegisterTransitCallback(time_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(distance_index)

    # Exact integer weights implement a lexicographic objective rather than a
    # hand-tuned approximation:
    # served count -> served priority -> active fleet -> road distance.
    max_arc_m = max(int(math.ceil(value * 1000)) for row in data.matrix.distancesKm for value in row)
    max_total_distance = max(1, max_arc_m * len(data.jobs))
    vehicle_weight = max_total_distance + 1
    max_fleet_and_distance = len(data.engineers) * vehicle_weight + max_total_distance
    priority_weight = max_fleet_and_distance + 1
    priority_sum = sum(job.priority for job in data.jobs)
    dropped_job_weight = priority_sum * priority_weight + max_fleet_and_distance + 1
    max_objective = len(data.jobs) * dropped_job_weight + priority_sum * priority_weight + max_fleet_and_distance
    if max_objective >= 8_000_000_000_000_000_000:
        raise HTTPException(status_code=422, detail="matrix costs are too large for a safe integer objective")

    for vehicle in range(engineer_count):
        routing.SetFixedCostOfVehicle(vehicle_weight, vehicle)

    max_end = max(engineer.shiftEnd for engineer in data.engineers)
    routing.AddDimension(time_index, max_end, max_end + 1440, False, "Time")
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
            travel = math.ceil(data.matrix.durationsMin[matrix_nodes[vehicle]][matrix_nodes[node]])
            work_start = max(job.windowStart, engineer.shiftStart + travel)
            if work_start <= job.windowEnd and work_start + job.serviceMinutes <= engineer.shiftEnd:
                allowed.append(vehicle)
        if allowed:
            time_dimension.CumulVar(index).SetRange(job.windowStart, job.windowEnd)
            # VehicleVar is used instead of SetAllowedVehiclesForIndex because
            # OR-Tools 9.15 on Windows has a SWIG Span conversion regression.
            routing.VehicleVar(index).SetValues(allowed)
        penalty = dropped_job_weight + job.priority * priority_weight
        routing.AddDisjunction([index], penalty)
        if not allowed:
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
