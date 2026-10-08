from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.cognito import get_allowed_user

from app.services.cost_explorer import CostExplorerService


router = APIRouter(
    prefix="/api/v1/costs",
    tags=["Costs"],
    dependencies=[Depends(get_allowed_user)],
)

def validate_date_range(
    start_date: date,
    end_date: date,
) -> None:
    today = date.today()

    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="Start date cannot be after end date.",
        )

    if start_date > today:
        raise HTTPException(
            status_code=400,
            detail="Start date cannot be in the future.",
        )

    if end_date > today:
        raise HTTPException(
            status_code=400,
            detail="End date cannot be in the future.",
        )


@router.get("/dashboard")
def get_dashboard(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
):
    if start_date is not None and end_date is not None:
        validate_date_range(start_date, end_date)

    service = CostExplorerService(
        start_date=start_date,
        end_date=end_date,
    )

    return service.get_dashboard_data()


@router.get("/summary")
def get_summary(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
):
    if start_date is not None and end_date is not None:
        validate_date_range(start_date, end_date)

    service = CostExplorerService(
        start_date=start_date,
        end_date=end_date,
    )

    return service.get_summary()


@router.get("/daily")
def get_daily_costs(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
):
    if start_date is not None and end_date is not None:
        validate_date_range(start_date, end_date)

    service = CostExplorerService(
        start_date=start_date,
        end_date=end_date,
    )

    return service.get_daily_costs()


@router.get("/services")
def get_service_costs(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
):
    if start_date is not None and end_date is not None:
        validate_date_range(start_date, end_date)

    service = CostExplorerService(
        start_date=start_date,
        end_date=end_date,
    )

    return service.get_service_costs()
