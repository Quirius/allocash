# Report and forecast requirements

Owner requirements moved from the original project brief. These describe intended
behavior and scope, not completion status. See [status](status.md) for implementation
and validation limits; read only sections relevant to the task.

## Reports

### Net Worth

Show:

- assets
- debts
- net worth
- change
- optional debt ratio
- date range
- account filters

### Inflow / Outflow

Show monthly:

- inflows
- outflows
- difference
- savings ratio if useful

### Spending by Category

Support:

- donut/pie
- optional bar mode
- category filters
- account filters
- date range
- totals
- averages

### Spending by Payee

Support:

- donut/pie
- optional bar mode
- account/category/date filters
- long-tail grouping such as `All Other Payees`

### Income vs Expense

Tabular monthly report with:

- income groups
- categories
- month columns
- average
- total
- net income
- savings ratio

### Income Breakdown / Sankey

Desired flow:

`Income sources -> Budget -> Category groups -> Categories / Net Gain`

Transfers must not distort true income.

### Balance Over Time

Required features:

- account filters
- grouped/separate account view
- group-by-type
- trendline
- step graph
- optional scheduled-transaction projection
- date range
- hover values

### Outflow Over Time

Required.

Support useful account/category/date filters and trend visualization.

### Days of Buffering

Low priority.

May remain a small informational indicator. Do not make it central.

## Monte Carlo forecast

Required advanced report.

It must not require investments to become on-budget accounts.

Allow the user to select what balances/accounts/categories are included.

Desired percentile paths:

- 10%
- 25%
- 50%
- 75%
- 90%

Potential inputs:

- historical income
- historical category expenses
- irregular expenses
- seasonality
- scheduled recurring transactions
- known targets
- configurable horizon

Keep simulation assumptions inspectable/configurable later.
