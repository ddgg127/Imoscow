"""Merge two OSM road graph extracts by coordinate, preserving connected roads."""

import argparse
import gzip
import json
from pathlib import Path


def read(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base", type=Path)
    parser.add_argument("addition", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    base = read(args.base)
    addition = read(args.addition)
    if base["version"] != 1 or addition["version"] != 1:
        raise ValueError("Both graphs must use version 1")
    nodes = base["nodes"]
    edges = base["edges"]
    indices = {tuple(point): index for index, point in enumerate(nodes)}
    remap = []
    for point in addition["nodes"]:
        key = tuple(point)
        index = indices.get(key)
        if index is None:
            index = len(nodes)
            indices[key] = index
            nodes.append(point)
        remap.append(index)
    seen = {tuple(edge) for edge in edges}
    for left, right, forward, backward in addition["edges"]:
        edge = (remap[left], remap[right], forward, backward)
        if edge not in seen:
            edges.append(list(edge))
            seen.add(edge)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(args.output, "wt", encoding="utf-8", compresslevel=9) as stream:
        json.dump(base, stream, separators=(",", ":"))
    print(f"{len(nodes)} nodes, {len(edges)} edges, {args.output.stat().st_size / 1024 / 1024:.1f} MiB")


if __name__ == "__main__":
    main()
