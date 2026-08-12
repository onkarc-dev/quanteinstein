````markdown
# QuantOS — Personal Quant Operating System

QuantOS is a distributed paper-trading, backtesting, analytics, journaling, and trader-coaching platform for Binance USDT markets.

It combines a **Next.js frontend, FastAPI API, PostgreSQL/SQLite persistence, Redis/RQ background workers, and a C++ trading/backtest engine** into a single research platform.

The goal is to help traders become systematic decision makers:

- Define explicit trading rules
- Backtest strategies on historical market data
- Run real-time paper trading using market WebSockets
- Analyze trades and performance
- Track behavioral discipline through journaling
- Review strategy strengths and weaknesses
- Experiment with quantitative strategies without risking real capital

> **QuantOS is research and simulation software only. It does not place real orders and is not financial advice.**

---

## Table of Contents

- [Product Vision](#product-vision)
- [Architecture](#architecture)
- [Core Components](#core-components)
- [System Data Flow](#system-data-flow)
- [Backtesting Pipeline](#backtesting-pipeline)
- [Live Paper Trading Pipeline](#live-paper-trading-pipeline)
- [Distributed Job Architecture](#distributed-job-architecture)
- [Supported Markets](#supported-markets)
- [Features](#features)
- [Authentication](#authentication)
- [Observability](#observability)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Local Development](#local-development)
- [Running the C++ Engine](#running-the-c-engine)
- [Running Background Workers](#running-background-workers)
- [Environment Configuration](#environment-configuration)
- [Production Architecture](#production-architecture)
- [Docker](#docker)
- [API](#api)
- [Testing and Validation](#testing-and-validation)
- [Production Readiness](#production-readiness)
- [Security](#security)
- [Performance Engineering](#performance-engineering)
- [Engineering Principles](#engineering-principles)
- [Roadmap](#roadmap)
- [Safety Scope](#safety-scope)
- [Disclaimer](#disclaimer)

---

# Product Vision

QuantOS is designed as a **personal quantitative research and trading-simulation operating system**.

It is not intended to be another charting application or a simple buy/sell signal generator.

The platform combines:

- Quantitative research
- Strategy development
- Historical backtesting
- Real-time paper execution
- Performance analytics
- Behavioral journaling
- Strategy diagnostics
- Quant coaching
- Infrastructure for asynchronous computation

The long-term vision is to create an environment where a trader can go from:

```text
Idea
 ↓
Strategy Definition
 ↓
Historical Backtest
 ↓
Performance Analysis
 ↓
Paper Trading
 ↓
Behavioral Review
 ↓
Strategy Improvement
 ↓
Repeat
````

---

# Architecture

QuantOS follows a layered architecture:

```text
                         ┌───────────────────────────┐
                         │       Next.js Web         │
                         │                           │
                         │ Dashboard                 │
                         │ Strategy Builder          │
                         │ Backtests                 │
                         │ Analytics                 │
                         │ Journal                   │
                         │ Quant Coach               │
                         └─────────────┬─────────────┘
                                       │ HTTP
                                       ▼
                         ┌───────────────────────────┐
                         │       FastAPI API         │
                         │                           │
                         │ Authentication            │
                         │ Strategies                │
                         │ Jobs                      │
                         │ Reports                   │
                         │ Analytics                 │
                         │ Live Paper Trading        │
                         │ System / Health           │
                         └───────┬─────────┬─────────┘
                                 │         │
                    ┌────────────┘         └─────────────┐
                    ▼                                    ▼
          ┌───────────────────┐                ┌───────────────────┐
          │    PostgreSQL     │                │     Redis / RQ    │
          │                   │                │                   │
          │ Users             │                │ Job Queue         │
          │ Strategies        │                │ Background Jobs   │
          │ Jobs              │                │ Worker Pool       │
          │ Journal           │                │                   │
          │ Metadata          │                │                   │
          └───────────────────┘                └─────────┬─────────┘
                                                         │
                                                         ▼
                                               ┌───────────────────┐
                                               │    RQ Workers     │
                                               │                   │
                                               │ Backtest Jobs     │
                                               │ Async Processing  │
                                               │ Report Generation │
                                               └─────────┬─────────┘
                                                         │
                                                         ▼
                                               ┌───────────────────┐
                                               │   C++ Engine      │
                                               │                   │
                                               │ Backtesting       │
                                               │ Paper Execution   │
                                               │ Market Processing │
                                               └─────────┬─────────┘
                                                         │
                                                         ▼
                                               ┌───────────────────┐
                                               │ Market Data       │
                                               │                   │
                                               │ Historical Data   │
                                               │ Binance WebSocket │
                                               └───────────────────┘
```

The system separates:

* User-facing application logic
* Persistent application state
* Asynchronous computation
* High-performance execution
* Market-data ingestion
* Analytics and reporting

---

# Core Components

## 1. Next.js Frontend

The frontend provides the user-facing research environment.

Major areas include:

* Dashboard
* Strategy Builder
* Backtest configuration
* Backtest results
* Analytics
* Trade reports
* Journal
* Quant Coach
* Live Paper Trading
* Onboarding

---

## 2. FastAPI Backend

The FastAPI service acts as the primary application/API layer.

Responsibilities include:

* Authentication
* Authorization
* Strategy management
* Job submission
* Job status
* Report retrieval
* Analytics APIs
* Journal APIs
* Paper-trading control
* Engine communication
* Health checks
* Readiness checks
* Production-readiness reporting

---

## 3. PostgreSQL

PostgreSQL is the intended production database.

It provides persistent storage for application-level state such as:

* Users
* Authentication/session information
* Strategies
* Jobs
* Journal entries
* Trading metadata
* Application records

SQLite remains available for local development and lightweight validation.

Production deployments should use PostgreSQL.

---

## 4. Redis + RQ

Redis provides the queue backend for asynchronous jobs.

RQ workers consume jobs from Redis.

The architecture is:

```text
FastAPI
   │
   │ enqueue
   ▼
Redis
   │
   │ consume
   ▼
RQ Worker
   │
   ▼
C++ Engine
   │
   ▼
Reports / Results
```

This keeps long-running computational work outside the request/response lifecycle.

Multiple workers can consume the same queue for horizontal job-processing capacity.

---

## 5. C++ Engine

The C++ component handles performance-sensitive workloads.

It is responsible for areas such as:

* Backtesting
* Market-data processing
* Paper-trading execution
* Strategy evaluation
* High-frequency event processing

The engine is separated from the FastAPI application so performance-sensitive workloads do not need to execute inside the Python API process.

---

# System Data Flow

A typical backtest request follows this architecture:

```text
User
 │
 ▼
Next.js
 │
 ▼
FastAPI
 │
 ├── Validate request
 │
 ├── Validate strategy
 │
 └── Create job
 │
 ▼
Redis
 │
 ▼
RQ Worker
 │
 ▼
C++ Engine
 │
 ▼
Backtest Results
 │
 ├── Trades
 ├── Equity Curve
 ├── R-Multiples
 ├── Metrics
 ├── Events
 └── Audit Data
 │
 ▼
Persistent Output
 │
 ▼
FastAPI
 │
 ▼
Next.js
```

The API therefore does not need to remain blocked while a computationally expensive backtest is running.

---

# Backtesting Pipeline

QuantOS supports historical strategy research.

The high-level pipeline is:

```text
Historical Market Data
        │
        ▼
Data Validation
        │
        ▼
Strategy Configuration
        │
        ▼
Job Submission
        │
        ▼
Redis Queue
        │
        ▼
RQ Worker
        │
        ▼
C++ Backtest Engine
        │
        ▼
Trade Generation
        │
        ▼
Performance Calculation
        │
        ▼
Reports
        │
        ├── Summary
        ├── Trade Log
        ├── Equity Curve
        ├── R Multiples
        ├── Strategy Health
        ├── Events
        └── Audit
```

Historical data can be cached/stored as CSV or structured files after being retrieved from market-data sources.

---

# Live Paper Trading Pipeline

Live paper trading uses real-time Binance WebSocket market data.

No real orders are sent.

```text
Binance WebSocket
        │
        ▼
Market Tick / Candle
        │
        ▼
C++ Paper Engine
        │
        ▼
Strategy Evaluation
        │
        ▼
Simulated Order
        │
        ▼
Virtual Position
        │
        ▼
Virtual Wallet
        │
        ▼
Trade / Event Records
        │
        ▼
FastAPI
        │
        ▼
Next.js Dashboard
```

The paper-trading environment uses simulated capital and simulated fills.

---

# Distributed Job Architecture

QuantOS separates synchronous API operations from asynchronous compute workloads.

For example:

```text
                  ┌───────────────┐
                  │    Client     │
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │    FastAPI    │
                  └───────┬───────┘
                          │
                    Submit Job
                          │
                          ▼
                  ┌───────────────┐
                  │     Redis     │
                  │     Queue     │
                  └───────┬───────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
          Worker 1    Worker 2    Worker 3
              │           │           │
              └───────────┼───────────┘
                          ▼
                    C++ Engine
                          │
                          ▼
                       Results
```

This enables the worker layer to scale independently from the API layer.

For example:

```text
1 API
3 Workers
1 Redis
1 PostgreSQL
```

can later become:

```text
Multiple API instances
        +
Multiple worker instances
        +
Redis
        +
PostgreSQL
        +
Dedicated engine workers
```

The exact scaling limits depend on workload characteristics and infrastructure configuration.

---

# Supported Markets

QuantOS currently supports paper/backtest workflows for Binance USDT markets including:

* BTCUSDT
* ETHUSDT
* BNBUSDT
* SOLUSDT
* XRPUSDT
* ADAUSDT
* DOGEUSDT
* AVAXUSDT
* LINKUSDT
* TRXUSDT

---

# Features

## Strategy Builder

Users can define strategy parameters and rules through the Strategy Builder.

The system supports configurable strategy logic including:

* Entry conditions
* Risk configuration
* Stop-loss configuration
* Target configuration
* Re-entry configuration
* Trend filters

---

## Higher-Timeframe EMA Trend Filter

QuantOS includes an optional higher-timeframe EMA trend filter.

The default configuration is:

```text
5m EMA20 > EMA50
```

The filter can allow lower-timeframe long breakout/retest entries only when the higher timeframe trend is bullish.

Backtest summaries can report:

* Whether the filter was enabled
* Number of setups rejected
* Rejection reason such as:

```text
HTF_EMA_TREND_NOT_BULLISH
```

---

## Backtesting

Backtesting provides quantitative evaluation of strategy behavior against historical data.

Available outputs include:

* Summary
* Trade Log
* Equity Curve
* R-Multiple Distribution
* Events
* Audit information
* Strategy Health

---

## Analytics

QuantOS exposes analytical views including:

* Equity curves
* R-multiple analysis
* Strategy health
* Trade statistics
* Performance reports

Future visualization work includes:

* Drawdown curves
* Win/loss by symbol
* Setup score over time
* Trade heatmaps
* Expectancy by regime
* Risk-adjusted leaderboards

---

## Trade Journal

The journal is designed to track trading behavior in addition to numerical performance.

Journal information can include:

* Symbol
* Entry
* Exit
* Slippage
* R-multiple
* Result
* Exit reason
* Behavioral information
* Emotional state
* Rule violations

---

## Quant Coach

The current Quant Coach provides rule-based strategy analysis.

The planned AI layer focuses on explanation and discipline rather than blind prediction.

Potential capabilities include:

* Explain why a strategy lost money
* Detect overtrading patterns
* Identify revenge-trading behavior
* Summarize drawdown behavior
* Suggest areas to test
* Compare strategy behavior across market regimes
* Explain risk changes after losing streaks

---

# Authentication

QuantOS includes authentication flows for:

* Registration
* OTP verification
* Login
* Access tokens
* Refresh tokens
* Token rotation
* Logout
* Password reset
* Current-user profile

Production authentication requires:

```text
PRISMFLOW_SECRET_KEY
```

with a strong stable secret.

---

# Observability

QuantOS includes infrastructure for operational monitoring.

Available system endpoints include:

```text
GET /health
GET /metrics
GET /version
GET /system/health
GET /system/readiness
GET /system/production-readiness
```

The project also includes support for:

* Prometheus
* Grafana
* Health checks
* Readiness checks
* Production-readiness checks

The goal is to make infrastructure state observable instead of relying only on application logs.

---

# Technology Stack

## Frontend

* Next.js
* TypeScript / JavaScript

## Backend

* Python
* FastAPI
* Pydantic
* JWT authentication

## Compute Engine

* C++
* CMake

## Data

* PostgreSQL
* SQLite for local development
* CSV / structured historical market data

## Distributed Processing

* Redis
* RQ
* Multiple worker processes

## Market Data

* Binance WebSocket
* Historical market data

## Infrastructure

* Docker
* Docker Compose
* Prometheus
* Grafana

---

# Project Structure

A simplified structure is:

```text
QuantOS/
│
├── apps/
│   ├── api/
│   │   ├── app/
│   │   │   ├── core/
│   │   │   ├── services/
│   │   │   ├── routes/
│   │   │   ├── db.py
│   │   │   ├── main.py
│   │   │   └── worker.py
│   │   │
│   │   ├── scripts/
│   │   ├── tests/
│   │   └── requirements.txt
│   │
│   └── web/
│       ├── app/
│       ├── components/
│       ├── lib/
│       └── package.json
│
├── engine/
│   ├── CMakeLists.txt
│   └── ...
│
├── build/
│
├── docker-compose.yml
├── CMakeLists.txt
├── prometheus.yml
├── ARCHITECTURE.md
├── RUN_LOCAL.md
├── RUN_DOCKER.md
└── README.md
```

The exact structure may evolve as the platform grows.

---

# Local Development

## Requirements

Recommended local environment:

* Windows 10/11
* Python 3.12
* Node.js
* npm
* CMake
* Visual Studio / MSVC
* Redis
* PostgreSQL for production-like development

> Python 3.12 is recommended for the current QuantOS environment.

---

## Backend

Open Command Prompt:

```bat
cd C:\Users\Admin\QuantOS\apps\api
```

Create a virtual environment:

```bat
py -3.12 -m venv venv
```

Activate it:

```bat
venv\Scripts\activate
```

Verify:

```bat
python --version
```

Expected:

```text
Python 3.12.x
```

Install dependencies:

```bat
pip install -r requirements.txt
```

Start the API:

```bat
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API:

```text
http://127.0.0.1:8000
```

Swagger:

```text
http://127.0.0.1:8000/docs
```

OpenAPI:

```text
http://127.0.0.1:8000/openapi.json
```

---

# Frontend

Open a second terminal:

```bat
cd C:\Users\Admin\QuantOS\apps\web
```

Install dependencies:

```bat
npm install
```

Start development server:

```bat
npm run dev
```

Open:

```text
http://localhost:3000
```

---

# Running the C++ Engine

Open a Visual Studio Developer Command Prompt.

From the repository root:

```bat
cd C:\Users\Admin\QuantOS
```

Configure:

```bat
cmake -S . -B build
```

Build:

```bat
cmake --build build --config Release
```

Verify the executable:

```bat
dir build\Release\prism_live_paper_trading.exe
```

---

# Running Background Workers

From:

```text
C:\Users\Admin\QuantOS\apps\api
```

activate the environment and run:

```bat
python -m app.worker
```

Expected behavior:

```text
Starting QuantOS RQ worker
Listening on prismflow
```

Multiple worker processes can consume the same Redis/RQ queue:

```text
Terminal 1:
python -m app.worker

Terminal 2:
python -m app.worker

Terminal 3:
python -m app.worker
```

This provides multiple independent worker processes for asynchronous job execution.

---

# Environment Configuration

Create an appropriate `.env` file for the environment.

## Secret Key

```text
PRISMFLOW_SECRET_KEY=<strong-random-secret>
```

Generate one with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

The secret must remain stable across API and worker restarts.

Changing it invalidates existing sessions and refresh tokens.

---

# Database

## Local Development

SQLite can be used for lightweight local development:

```text
DATABASE_URL=sqlite:///./prismflow.db
```

## Production

Production deployments should use PostgreSQL:

```text
DATABASE_URL=postgresql://user:password@host:5432/quantos
```

PostgreSQL is preferred for:

* Multi-user deployments
* Concurrent access
* Persistent production workloads
* Horizontal application scaling

---

# Redis

Production background jobs should use Redis:

```text
REDIS_URL=redis://redis:6379/0
```

The intended production execution path is:

```text
FastAPI
   ↓
Redis
   ↓
RQ Worker
   ↓
C++ Engine
   ↓
Result
```

---

# CORS

Production CORS configuration should use trusted frontend origins.

Example:

```text
CORS_ORIGINS=https://app.example.com
```

Avoid:

```text
CORS_ORIGINS=*
```

for production deployments.

---

# SMTP / OTP

Configure SMTP for production email verification and password-reset flows:

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=no-reply@example.com
SMTP_TLS=true
EMAIL_OTP_DEV_RETURN=false
```

Development-only OTP return behavior must never be enabled in production.

---

# Token Lifetimes

Default configuration:

```text
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TTL_SECONDS=2592000
```

Access tokens should remain short-lived.

Refresh tokens provide longer-lived sessions while allowing access tokens to be rotated.

---

# Production Architecture

A production deployment is intended to evolve toward:

```text
                    Internet
                       │
                       ▼
                ┌──────────────┐
                │ Load Balancer│
                │ / Reverse    │
                │ Proxy + HTTPS│
                └──────┬───────┘
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
        FastAPI #1          FastAPI #2
             │                   │
             └─────────┬─────────┘
                       │
              ┌────────┴────────┐
              │                 │
              ▼                 ▼
         PostgreSQL           Redis
              │                 │
              │        ┌────────┼────────┐
              │        │        │        │
              │        ▼        ▼        ▼
              │     Worker 1 Worker 2 Worker 3
              │        │        │        │
              │        └────────┼────────┘
              │                 ▼
              │            C++ Engine
              │
              ▼
         Persistent Data
```

This architecture allows application/API capacity and background compute capacity to scale independently.

---

# Docker

QuantOS includes Docker support for components such as:

* API
* Frontend
* PostgreSQL
* Redis
* Workers
* Prometheus
* Grafana

Typical development/deployment workflow:

```bash
docker compose up
```

The exact profiles and services depend on the current `docker-compose.yml`.

For Docker-specific setup, see:

```text
RUN_DOCKER.md
```

---

# API

QuantOS exposes APIs for the following domains.

## System

```text
GET /metrics
GET /health
GET /version
GET /system/health
GET /system/readiness
GET /system/production-readiness
GET /system/onboarding
POST /system/onboarding/{step}
```

## Authentication

```text
POST /auth/register/request-otp
POST /auth/register/verify
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/password-reset/request-otp
POST /auth/password-reset/verify
POST /auth/logout
GET /auth/me
```

## Strategies

```text
POST /strategies
GET /strategies
GET /strategies/{strategy_id}
```

## Jobs

```text
POST /jobs/submit-backtest
GET /jobs/
GET /jobs/{job_id}
GET /jobs/{job_id}/download-output
```

## Reports

```text
GET /reports/{job_id}/outputs
GET /reports/{job_id}/trade-log
GET /reports/{job_id}/summary
GET /reports/{job_id}/audit
GET /reports/{job_id}/events
GET /reports/{job_id}/dashboard-snapshot
```

## Analytics

```text
GET /analytics/{job_id}/r-multiples
GET /analytics/{job_id}/equity-curve
GET /analytics/{job_id}/strategy-health
```

## Quant Coach

```text
GET /coach/{job_id}/coach-report
GET /coach/{job_id}/strengths-weaknesses
GET /coach/{job_id}/strategy-health
```

## Journal

```text
POST /journal/entry
GET /journal/
GET /journal/summary/violations
GET /journal/summary/emotional-states
```

## Live Paper Trading

```text
POST /live-paper/start
POST /live-paper/stop
GET /live-paper/status
GET /live-paper/trades
GET /live-paper/wallet
GET /live-paper/replay
GET /live-paper/validate-data
```

## Local Engine

```text
POST /engine/token
GET /engine/status
POST /engine/heartbeat
```

## AI

```text
POST /ai/backtest-explainer
```

## Backtests

```text
POST /backtests/upload-csv
```

The complete interactive API specification is available through FastAPI's generated OpenAPI documentation.

---

# Testing and Validation

QuantOS includes automated validation and test infrastructure.

Validation should cover:

* API startup
* Authentication
* Database connectivity
* Queue configuration
* Worker startup
* Strategy creation
* Job submission
* Job execution
* Report generation
* Analytics
* Engine availability
* Production configuration

A representative lifecycle is:

```text
Create Strategy
      ↓
Submit Backtest
      ↓
Redis Queue
      ↓
Worker
      ↓
C++ Engine
      ↓
Job Complete
      ↓
Reports
      ↓
Analytics
```

The important distinction is between:

```text
Architecture exists
```

and:

```text
Architecture has been executed end-to-end
```

QuantOS is designed to validate the complete path through actual job execution.

---

# Production Readiness

QuantOS includes a production-readiness system that evaluates infrastructure and product checks.

The readiness model covers areas including:

* Engine
* Database
* Queue
* Security
* Deployment
* Observability
* Testing
* Documentation
* Product safety

The system reports:

```text
Score
Checks Passed
Checks Total
Warnings
Blocking Items
Production Status
```

The intended production configuration is:

```text
PostgreSQL
+
Redis
+
RQ Workers
+
C++ Engine
+
FastAPI
+
Next.js
+
HTTPS
+
Observability
```

SQLite remains appropriate for local development and lightweight validation.

---

# Security

Production deployments should ensure:

* Strong JWT signing secret
* Short-lived access tokens
* Refresh-token rotation
* Secure password hashing
* Restricted CORS
* HTTPS
* Secure SMTP configuration
* No development OTP return behavior
* No secrets committed to source control
* No internal filesystem paths exposed to users
* No real-money execution endpoints
* Proper environment-specific configuration

---

# Performance Engineering

Performance-sensitive execution is isolated into C++ rather than forcing computationally intensive workloads into the Python API process.

The architecture intentionally separates:

```text
Control Plane
     │
     ├── FastAPI
     ├── Authentication
     ├── Job Management
     └── API Operations
     
Compute Plane
     │
     ├── Redis
     ├── RQ Workers
     └── C++ Engine
```

This allows performance-sensitive components to evolve independently from the application layer.

Performance work should follow:

```text
Measure
   ↓
Profile
   ↓
Identify Bottleneck
   ↓
Optimize
   ↓
Benchmark
   ↓
Validate
```

The project should avoid claiming performance improvements without reproducible benchmarks.

---

# Engineering Principles

QuantOS follows several core engineering principles.

## Separation of concerns

Application logic, persistence, asynchronous processing, and compute-intensive execution are separated into different layers.

## Asynchronous execution

Long-running backtests should not block HTTP request processing.

## Horizontal scalability

API instances and worker instances should be independently scalable.

## Observability

Health, readiness, metrics, and production-readiness endpoints expose system state.

## Safety by design

The platform is explicitly restricted to paper trading and backtesting.

## Performance-aware architecture

Performance-sensitive workloads are implemented in C++ and separated from the Python control plane.

## Measure before optimizing

Performance claims should be supported by reproducible measurements.

## Production-oriented development

The project includes:

* Docker
* PostgreSQL support
* Redis
* Workers
* CI validation
* Health checks
* Readiness checks
* Monitoring infrastructure
* Documentation

---

# Roadmap

## Infrastructure

* PostgreSQL-first production deployment
* Redis/RQ worker scaling
* Worker autoscaling
* Improved job retry policies
* Job timeout handling
* Distributed job observability
* Better failure recovery
* Production deployment automation

## Performance

* C++ engine profiling
* Memory optimization
* Lock/concurrency analysis
* Event-processing benchmarks
* Latency benchmarking
* Throughput benchmarking
* Performance regression testing

## Data

Potential future context layers:

* Funding rates
* Open interest
* Long/short ratios
* Fear & Greed Index
* Crypto news
* Reddit/social sentiment
* Macro indicators

These will be treated as contextual inputs rather than guaranteed predictive signals.

## AI Quant Coach

Future capabilities:

* Strategy explanation
* Loss attribution
* Drawdown analysis
* Behavioral pattern detection
* Regime comparison
* Strategy experimentation suggestions
* Risk-management analysis

## Visualization

Planned dashboards include:

* Equity curve
* Drawdown curve
* R-multiple distribution
* Win/loss by symbol
* Setup score over time
* Trade heatmap
* Expectancy by regime
* Risk-adjusted leaderboard

## Weekly QuantOS Challenges

A future competitive paper-trading environment may allow traders to compete using:

* Same virtual starting balance
* Same market window
* Same trading rules
* Risk-adjusted scoring
* Drawdown control
* Discipline scoring
* Rule consistency

The objective is to reward systematic trading rather than simply maximizing raw returns.

---

# Safety Scope

QuantOS intentionally does **not** provide real-money trading.

The platform does not:

* Place real exchange orders
* Connect to brokerage accounts for execution
* Require exchange API keys for trading
* Guarantee profits
* Recommend guaranteed leverage
* Provide guaranteed buy/sell signals

The live trading environment is:

```text
REAL MARKET DATA
       +
SIMULATED EXECUTION
       =
PAPER TRADING
```

---

# Current System Position

QuantOS is designed as more than a monolithic web application.

Its architecture separates:

```text
Frontend
    │
    ▼
API / Control Plane
    │
    ├──────────────► Database
    │
    └──────────────► Queue
                         │
                         ▼
                      Workers
                         │
                         ▼
                     C++ Engine
                         │
                         ▼
                    Market Data
```

This provides a foundation for evolving the project toward a larger distributed research and compute platform.

The architecture can progressively scale from:

```text
Local Development
```

to:

```text
Single Production Server
```

and eventually toward:

```text
Multiple API Instances
+
Distributed Workers
+
Central Redis
+
PostgreSQL
+
Dedicated Compute Nodes
+
Observability
```

without requiring the core application model to be completely redesigned.

---

# Disclaimer

QuantOS is a software engineering, quantitative research, and trading-simulation project.

It is **not financial advice**.

QuantOS does not execute real-money trades and does not guarantee trading performance, profitability, or investment returns.

All live-market functionality is paper trading using simulated execution and virtual balances.

```
```
