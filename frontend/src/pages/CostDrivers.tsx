import { useCallback, useEffect, useMemo, useState } from "react";

import DateRangeFilter from "../components/common/DateRangeFilter";
import ErrorMessage from "../components/common/ErrorMessage";
import Loading from "../components/common/Loading";

import { fetchCostDashboard } from "../services/costApi";
import type { CostDriver } from "../types/cost";

function CostDrivers() {
  const [drivers, setDrivers] = useState<CostDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [appliedStartDate, setAppliedStartDate] = useState("");
  const [appliedEndDate, setAppliedEndDate] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState("cost-desc");

  const loadCostDrivers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await fetchCostDashboard({
        startDate: appliedStartDate || undefined,
        endDate: appliedEndDate || undefined,
      });

      setDrivers(data.topCostDrivers);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load cost drivers.";

      setError(message);
    } finally {
      setLoading(false);
    }
  }, [appliedStartDate, appliedEndDate]);

  useEffect(() => {
    loadCostDrivers();
  }, [loadCostDrivers]);

  const handleApply = () => {
    if (startDate && endDate && startDate > endDate) {
      setError("Start date cannot be after end date.");
      return;
    }

    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
  };

  const handleReset = () => {
    setStartDate("");
    setEndDate("");
    setAppliedStartDate("");
    setAppliedEndDate("");
  };

  const filteredAndSortedDrivers = useMemo(() => {
    const filtered = drivers.filter((driver) =>
      driver.serviceName
        .toLowerCase()
        .includes(searchTerm.toLowerCase()),
    );

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case "cost-asc":
          return a.cost - b.cost;

        case "change-desc":
          return b.changePercentage - a.changePercentage;

        case "change-asc":
          return a.changePercentage - b.changePercentage;

        case "cost-desc":
        default:
          return b.cost - a.cost;
      }
    });
  }, [drivers, searchTerm, sortOption]);

  if (loading) {
    return (
      <div className="page-container">
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApply={handleApply}
          onReset={handleReset}
        />

        <ErrorMessage message={error} />

        <button
          type="button"
          onClick={loadCostDrivers}
          className="retry-button"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="page-container">
      <DateRangeFilter
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onApply={handleApply}
        onReset={handleReset}
      />

      <div className="page-header">
        <div>
          <h1>Cost Drivers</h1>
          <p>
            Identify the AWS services contributing most
            to your spending.
          </p>
        </div>
      </div>

      <div className="dashboard-card">
        <div className="service-controls">
          <input
            type="text"
            placeholder="Search services..."
            value={searchTerm}
            onChange={(event) =>
              setSearchTerm(event.target.value)
            }
          />

          <select
            value={sortOption}
            onChange={(event) =>
              setSortOption(event.target.value)
            }
          >
            <option value="cost-desc">
              Cost: High to Low
            </option>

            <option value="cost-asc">
              Cost: Low to High
            </option>

            <option value="change-desc">
              Change: Highest to Lowest
            </option>

            <option value="change-asc">
              Change: Lowest to Highest
            </option>
          </select>
        </div>

        <div className="cost-driver-list">
          {filteredAndSortedDrivers.map((driver) => (
            <div
              className="cost-driver-row"
              key={driver.serviceName}
            >
              <div className="cost-driver-rank">
                #{driver.rank}
              </div>

              <div className="cost-driver-service">
                <strong>{driver.serviceName}</strong>

                <span>
                  {driver.percentageOfTotal.toFixed(1)}% of total
                </span>
              </div>

              <div className="cost-driver-cost">
                <strong>
                  ${driver.cost.toFixed(2)}
                </strong>

                <span>
                  {driver.changePercentage >= 0 ? "+" : ""}
                  {driver.changePercentage.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}

          {filteredAndSortedDrivers.length === 0 && (
            <div className="empty-state">
              No cost drivers found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CostDrivers;