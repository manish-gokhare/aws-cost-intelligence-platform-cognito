import { useCallback, useEffect, useMemo, useState } from "react";

import DateRangeFilter from "../components/common/DateRangeFilter";
import ErrorMessage from "../components/common/ErrorMessage";
import Loading from "../components/common/Loading";
import ServiceTable from "../components/dashboard/ServiceTable";

import { fetchCostServices } from "../services/costApi";
import type { ServiceCost } from "../types/cost";

function Services() {
  const [services, setServices] = useState<ServiceCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [appliedStartDate, setAppliedStartDate] = useState("");
  const [appliedEndDate, setAppliedEndDate] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState("cost-desc");

  const loadServices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await fetchCostServices({
        startDate: appliedStartDate || undefined,
        endDate: appliedEndDate || undefined,
      });

      setServices(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load service costs.";

      setError(message);
    } finally {
      setLoading(false);
    }
  }, [appliedStartDate, appliedEndDate]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

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

  const filteredAndSortedServices = useMemo(() => {
    const filtered = services.filter((service) =>
      service.serviceName
        .toLowerCase()
        .includes(searchTerm.toLowerCase()),
    );

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case "cost-asc":
          return a.cost - b.cost;

        case "name-asc":
          return a.serviceName.localeCompare(b.serviceName);

        case "name-desc":
          return b.serviceName.localeCompare(a.serviceName);

        case "cost-desc":
        default:
          return b.cost - a.cost;
      }
    });
  }, [services, searchTerm, sortOption]);

  const totalCost = services.reduce(
    (total, service) => total + service.cost,
    0,
  );

  const topService =
    services.length > 0
      ? [...services].sort((a, b) => b.cost - a.cost)[0]
      : null;

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
          onClick={loadServices}
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
          <h1>Services</h1>
          <p>View AWS spending by service.</p>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <div className="summary-card-label">
            Total Cost
          </div>

          <div className="summary-card-value">
            ${totalCost.toFixed(2)}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-card-label">
            Top Service
          </div>

          <div className="summary-card-value">
            {topService?.serviceName ?? "—"}
          </div>
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

            <option value="name-asc">
              Service: A-Z
            </option>

            <option value="name-desc">
              Service: Z-A
            </option>
          </select>
        </div>

        <ServiceTable
          data={filteredAndSortedServices}
        />
      </div>
    </div>
  );
}

export default Services;
