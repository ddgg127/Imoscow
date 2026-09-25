// Вызывает app.py, строка 205: GUIDED_LOCAL_SEARCH.
// Источник: https://github.com/google/or-tools/blob/b21a1326/ortools/constraint_solver/search.cc
// Ниже только функции, которые поднимают цену застрявшего куска. Остальной файл не скопирован.
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



GuidedLocalSearchPenaltiesTable::GuidedLocalSearchPenaltiesTable(int num_vars)
    : penalties_(num_vars), has_values_(false) {}

void GuidedLocalSearchPenaltiesTable::IncrementPenalty(
    const VarValue& var_value) {
  std::vector<int64_t>& var_penalties = penalties_[var_value.var];
  const int64_t value = var_value.value;
  if (value >= var_penalties.size()) {
    var_penalties.resize(value + 1, 0);
  }
  ++var_penalties[value];
  has_values_ = true;
}

// Penalize (var, value) pairs of maximum utility, with
// utility(var, value) = cost(var, value) / (1 + penalty(var, value))
template <typename P>
bool GuidedLocalSearch<P>::AtLocalOptimum() {
  solver()->SetUseFastLocalSearch(false);
  std::vector<double> utilities(num_vars_);
  double max_utility = -std::numeric_limits<double>::infinity();
  for (int var = 0; var < num_vars_; ++var) {
    const IntVarElement& element = assignment_.Element(var);
    if (!element.Bound()) {
      // Never synced with a solution, problem infeasible.
      return false;
    }
    const int64_t value = element.Value();
    // The fact that we do not penalize loops is influenced by vehicle routing.
    // Assuming a cost of 0 in that case.
    const int64_t cost = (value != var) ? AssignmentPenalty(var, value) : 0;
    const double utility = cost / (penalties_.GetPenalty({var, value}) + 1.0);
    utilities[var] = utility;
    if (utility > max_utility) max_utility = utility;
  }
  for (int var = 0; var < num_vars_; ++var) {
    if (utilities[var] == max_utility) {
      const IntVarElement& element = assignment_.Element(var);
      DCHECK(element.Bound());
      const int64_t value = element.Value();
      if (get_equivalent_pairs_ == nullptr) {
        penalties_.IncrementPenalty({var, value});
      } else {
        for (const auto [other_var, other_value] :
             get_equivalent_pairs_(var, value)) {
          penalties_.IncrementPenalty({other_var, other_value});
        }
      }
    }
  }
  SetCurrentInternalValue(0, std::numeric_limits<int64_t>::max());
  return true;
}

// Penalized value for (i, j) = penalty_factor_ * penalty(i, j) * cost (i, j)
template <typename P>
int64_t BinaryGuidedLocalSearch<P>::PenalizedValue(int64_t i, int64_t j) const {
  const int64_t penalty = this->penalties_.GetPenalty({i, j});
  // Calls to objective_function_(i, j) can be costly.
  if (penalty == 0) return 0;
  const double penalized_value_fp =
      this->penalty_factor_ * penalty * objective_function_(i, j);
  const int64_t penalized_value =
      (penalized_value_fp <= std::numeric_limits<int64_t>::max())
          ? static_cast<int64_t>(penalized_value_fp)
          : std::numeric_limits<int64_t>::max();
  return penalized_value;
}


