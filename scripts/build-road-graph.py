"""Build the bundled routing graph from OpenStreetMap extracts.

Install ``osmium`` in the build environment and pass one or more .osm.pbf/.osm
extracts. The generated file is the only artifact needed at application runtime.
"""

import argparse
import gzip
import json
from pathlib import Path

import osmium


CAR = 1
FOOT = 2
BIKE = 4
ROAD_TYPES = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "residential",
    "unclassified", "living_street", "service", "road", "pedestrian",
    "footway", "path", "steps", "cycleway", "track",
}
CAR_TYPES = ROAD_TYPES - {"pedestrian", "footway", "path", "steps", "cycleway", "track"}
FOOT_TYPES = ROAD_TYPES - {"motorway", "motorway_link"}
BIKE_TYPES = ROAD_TYPES - {"motorway", "motorway_link", "trunk", "trunk_link", "steps"}
ARTERIAL_TYPES = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"}


def permissions(tags):
    kind = tags.get("highway", "")
    if kind not in ROAD_TYPES or tags.get("area") == "yes":
        return 0
    general = tags.get("access", "")
    if general in {"no", "private"}:
        return 0
    mask = 0
    motor = tags.get("motor_vehicle", tags.get("vehicle", ""))
    if kind in CAR_TYPES and motor not in {"no", "private"}:
        mask |= CAR
    if kind in FOOT_TYPES and tags.get("foot", "") not in {"no", "private"}:
        mask |= FOOT
    if kind in BIKE_TYPES and tags.get("bicycle", "") not in {"no", "private"}:
        mask |= BIKE
    if tags.get("foot") in {"yes", "designated"}:
        mask |= FOOT
    if tags.get("bicycle") in {"yes", "designated"}:
        mask |= BIKE
    return mask


class Roads(osmium.SimpleHandler):
    def __init__(self, boxes, arterial_boxes):
        super().__init__()
        self.boxes = boxes
        self.arterial_boxes = arterial_boxes
        self.nodes = []
        self.index = {}
        self.edges = []
        self.ways = 0
        self.seen_ways = set()

    def node_index(self, node):
        ident = int(node.ref)
        if ident not in self.index:
            self.index[ident] = len(self.nodes)
            self.nodes.append([round(node.lon, 6), round(node.lat, 6)])
        return self.index[ident]

    def way(self, way):
        if int(way.id) in self.seen_ways:
            return
        mask = permissions(way.tags)
        if not mask:
            return
        points = [node for node in way.nodes if node.location.valid()]
        if len(points) < 2:
            return
        in_local = any(west <= node.lon <= east and south <= node.lat <= north for node in points for west, south, east, north in self.boxes)
        in_arterial = way.tags.get("highway") in ARTERIAL_TYPES and any(west <= node.lon <= east and south <= node.lat <= north for node in points for west, south, east, north in self.arterial_boxes)
        if not in_local and not in_arterial:
            return
        self.seen_ways.add(int(way.id))
        self.ways += 1
        oneway = way.tags.get("oneway", "")
        car_direction = -1 if oneway == "-1" else 1 if oneway in {"yes", "1", "true"} or way.tags.get("junction") == "roundabout" else 0
        bike_direction = -1 if way.tags.get("oneway:bicycle") == "-1" else 1 if way.tags.get("oneway:bicycle") in {"yes", "1", "true"} else 0
        for left, right in zip(points, points[1:]):
            a, b = self.node_index(left), self.node_index(right)
            if a == b:
                continue
            forward = (mask & FOOT) | ((mask & CAR) if car_direction >= 0 else 0) | ((mask & BIKE) if bike_direction >= 0 else 0)
            backward = (mask & FOOT) | ((mask & CAR) if car_direction <= 0 else 0) | ((mask & BIKE) if bike_direction <= 0 else 0)
            self.edges.append([a, b, forward, backward])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/road-graph.json.gz"))
    parser.add_argument("--bbox", action="append", help="west,south,east,north; may be repeated")
    parser.add_argument("--arterial-bbox", action="append", help="west,south,east,north; only major roads")
    args = parser.parse_args()
    boxes = [tuple(map(float, value.split(","))) for value in args.bbox] if args.bbox else [(-180, -90, 180, 90)]
    arterial_boxes = [tuple(map(float, value.split(","))) for value in args.arterial_bbox or []]
    graph = Roads(boxes, arterial_boxes)
    for source in args.sources:
        graph.apply_file(str(source), locations=True)
        print(f"{source}: {graph.ways} ways, {len(graph.nodes)} nodes, {len(graph.edges)} edges")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if args.output.suffix == ".gz" else open
    with opener(args.output, "wt", encoding="utf-8", compresslevel=9) if args.output.suffix == ".gz" else opener(args.output, "w", encoding="utf-8") as stream:
        json.dump({"version": 1, "source": "OpenStreetMap contributors", "nodes": graph.nodes, "edges": graph.edges}, stream, separators=(",", ":"))
    print(f"{args.output}: {args.output.stat().st_size / 1024 / 1024:.1f} MiB")


if __name__ == "__main__":
    main()
