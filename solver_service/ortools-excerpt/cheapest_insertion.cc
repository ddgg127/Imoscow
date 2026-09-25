// Вызывает app.py, строка 204: PARALLEL_CHEAPEST_INSERTION.
// Источник: https://github.com/google/or-tools/blob/b21a1326/ortools/constraint_solver/routing_search.cc
// Ниже цена вставки заявки в конкретное место и цикл, который берёт самую дешёвую вставку.
// Copyright 2010-2025 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


int64_t
CheapestInsertionFilteredHeuristic::GetEvaluatorInsertionCostForNodeAtPosition(
    int64_t node_to_insert, int64_t insert_after, int64_t insert_before,
    int vehicle) const {
  DCHECK(evaluator_ != nullptr);
  EvaluatorCache& cache_entry = evaluator_cache_[insert_after];
  if (cache_entry.node != insert_before || cache_entry.vehicle != vehicle) {
    cache_entry = {.value = evaluator_(insert_after, insert_before, vehicle),
                   .node = insert_before,
                   .vehicle = vehicle};
  }
  return CapSub(CapAdd(evaluator_(insert_after, node_to_insert, vehicle),
                       evaluator_(node_to_insert, insert_before, vehicle)),
                cache_entry.value);
}

std::optional<int64_t>
CheapestInsertionFilteredHeuristic::GetInsertionCostForNodeAtPosition(
    int64_t node_to_insert, int64_t insert_after, int64_t insert_before,
    int vehicle, int hint_weight) {
  if (evaluator_ != nullptr) {
    return GetEvaluatorInsertionCostForNodeAtPosition(
        node_to_insert, insert_after, insert_before, vehicle);
  }
  InsertBetween(node_to_insert, insert_after, insert_before, vehicle);
  return Evaluate(/*commit=*/false, /*ignore_upper_bound=*/hint_weight > 0,
                  /*update_upper_bound=*/hint_weight >= 0);
}

bool GlobalCheapestInsertionFilteredHeuristic::InsertNodesOnRoutes(
    const std::map<int64_t, std::vector<int>>& nodes_by_bucket,
    const absl::flat_hash_set<int>& vehicles) {
  NodeEntryQueue queue(model()->Nexts().size());
  SparseBitset<int> nodes_to_insert(model()->Size());
  for (const auto& [bucket, nodes] : nodes_by_bucket) {
    for (int node : nodes) {
      nodes_to_insert.Set(node);
    }
    if (!InitializePositions(nodes_to_insert, vehicles, &queue)) {
      return false;
    }
    // The following boolean indicates whether or not all vehicles are being
    // considered for insertion of the nodes simultaneously.
    // In the sequential version of the heuristic, as well as when inserting
    // single pickup or deliveries from pickup/delivery pairs, this will be
    // false. In the general parallel version of the heuristic, all_vehicles is
    // true.
    const bool all_vehicles =
        vehicles.empty() || vehicles.size() == model()->vehicles();

    while (!queue.IsEmpty()) {
      const NodeEntryQueue::Entry* node_entry = queue.Top();
      if (StopSearch()) return false;
      const int64_t node_to_insert = node_entry->node_to_insert;
      if (Contains(node_to_insert)) {
        queue.Pop();
        continue;
      }

      const int entry_vehicle = node_entry->vehicle;
      if (entry_vehicle == -1) {
        DCHECK(all_vehicles);
        // Make node unperformed.
        SetNext(node_to_insert, node_to_insert, -1);
        if (!Evaluate(/*commit=*/true).has_value()) {
          queue.Pop();
        }
        continue;
      }

      // Make node performed.
      if (UseEmptyVehicleTypeCuratorForVehicle(entry_vehicle, all_vehicles)) {
        DCHECK(all_vehicles);
        if (!InsertNodeEntryUsingEmptyVehicleTypeCurator(
                nodes_to_insert, all_vehicles, &queue)) {
          return false;
        }
        continue;
      }

      const int64_t insert_after = node_entry->insert_after;
      InsertBetween(node_to_insert, insert_after, Value(insert_after));
      if (Evaluate(/*commit=*/true).has_value()) {
        if (!UpdateAfterNodeInsertion(nodes_to_insert, entry_vehicle,
                                      node_to_insert, insert_after,
                                      all_vehicles, &queue)) {
          return false;
        }
      } else {
        queue.Pop();
      }
    }
    // In case all nodes could not be inserted, pushing uninserted ones to the
    // next bucket.
    std::vector<int> non_inserted_nodes;
    non_inserted_nodes.reserve(
        nodes_to_insert.NumberOfSetCallsWithDifferentArguments());
    for (int node : nodes_to_insert.PositionsSetAtLeastOnce()) {
      if (!Contains(node)) non_inserted_nodes.push_back(node);
    }
    nodes_to_insert.ResetAllToFalse();
    for (int node : non_inserted_nodes) {
      nodes_to_insert.Set(node);
    }
  }
  return true;
}

