#pragma once
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>

enum class AssetClass : uint8_t {
    EQUITY = 0,
    FUTURES = 1,
    OPTIONS = 2,
    FX = 3,
    CRYPTO = 4
};

enum class Side : uint8_t {
    BUY = 1,
    SELL = 2,
    SHORT_SELL = 5 // FIX Tag 54 = 5 (SEC Reg SHO Short Sell)
};

enum class OrderType : uint8_t {
    MARKET = 1,
    LIMIT = 2,
    STOP = 3,
    STOP_LIMIT = 4,
    ICEBERG = 5,
    TWAP = 6,
    VWAP = 7
};

enum class TimeInForce : uint8_t {
    GTC = 0,
    IOC = 1,
    FOK = 2,
    POST_ONLY = 3,
    DAY = 4
};

enum class OrderStatus : uint8_t {
    NEW = 0,
    ACCEPTED = 1,
    PARTIALLY_FILLED = 2,
    FILLED = 3,
    CANCELLED = 4,
    REJECTED = 5,
    EXPIRED = 6
};

inline const char* to_string(AssetClass a) {
    switch (a) {
        case AssetClass::EQUITY: return "EQUITY";
        case AssetClass::FUTURES: return "FUTURES";
        case AssetClass::OPTIONS: return "OPTIONS";
        case AssetClass::FX: return "FX";
        case AssetClass::CRYPTO: return "CRYPTO";
    }
    return "UNKNOWN";
}

inline const char* to_string(Side side) {
    switch (side) {
        case Side::BUY: return "BUY";
        case Side::SELL: return "SELL";
        case Side::SHORT_SELL: return "SHORT_SELL";
    }
    return "UNKNOWN";
}

inline const char* to_string(OrderType t) {
    switch (t) {
        case OrderType::MARKET: return "MARKET";
        case OrderType::LIMIT: return "LIMIT";
        case OrderType::STOP: return "STOP";
        case OrderType::STOP_LIMIT: return "STOP_LIMIT";
        case OrderType::ICEBERG: return "ICEBERG";
        case OrderType::TWAP: return "TWAP";
        case OrderType::VWAP: return "VWAP";
    }
    return "UNKNOWN";
}

inline const char* to_string(TimeInForce t) {
    switch (t) {
        case TimeInForce::GTC: return "GTC";
        case TimeInForce::IOC: return "IOC";
        case TimeInForce::FOK: return "FOK";
        case TimeInForce::POST_ONLY: return "POST_ONLY";
        case TimeInForce::DAY: return "DAY";
    }
    return "UNKNOWN";
}

inline const char* to_string(OrderStatus s) {
    switch (s) {
        case OrderStatus::NEW: return "NEW";
        case OrderStatus::ACCEPTED: return "ACCEPTED";
        case OrderStatus::PARTIALLY_FILLED: return "PARTIALLY_FILLED";
        case OrderStatus::REJECTED: return "REJECTED";
        case OrderStatus::FILLED: return "FILLED";
        case OrderStatus::CANCELLED: return "CANCELLED";
        case OrderStatus::EXPIRED: return "EXPIRED";
    }
    return "UNKNOWN";
}

struct OrderRequest {
    uint64_t client_order_id = 0;
    std::string symbol;
    AssetClass asset_class = AssetClass::CRYPTO;
    Side side = Side::BUY;
    OrderType type = OrderType::MARKET;
    TimeInForce time_in_force = TimeInForce::GTC;
    double quantity = 0.0;
    double limit_price = 0.0;
    double stop_price = 0.0;
    bool post_only = false;
    bool reduce_only = false;
    std::string owner_id;
    std::string strategy_tag;

    // Institutional Reg SHO & Algorithmic Execution Fields
    std::string borrow_locate_id;
    bool is_short_exempt = false;
    double display_quantity = 0.0;
    uint32_t algo_duration_sec = 0;
    double algo_participation_rate = 0.0;

    // Multi-Asset Identification (Equities, Futures, Options)
    std::string cusip;
    std::string sedol;
    std::string isin;
    std::string futures_roll_code;
    double contract_multiplier = 1.0;
    std::string underlying_symbol;

    // Options Specific Parameters
    double strike_price = 0.0;
    uint8_t put_or_call = 0; // 1 = CALL, 2 = PUT
    uint32_t option_expiry_date = 0;
    double greeks_delta = 0.0;
    double greeks_gamma = 0.0;
    double greeks_vega = 0.0;
    double greeks_theta = 0.0;
};

struct OrderExecution {
    uint64_t client_order_id = 0;
    std::string broker_order_id;
    std::string symbol;
    AssetClass asset_class = AssetClass::CRYPTO;
    Side side = Side::BUY;
    OrderStatus status = OrderStatus::NEW;
    double requested_quantity = 0.0;
    double filled_quantity = 0.0;
    double remaining_quantity = 0.0;
    double fill_price = 0.0;
    double avg_fill_price = 0.0;
    double reference_price = 0.0;
    double commission = 0.0;
    double slippage_bps = 0.0;
    double market_impact_bps = 0.0;
    double fill_ratio = 0.0;
    uint64_t exchange_ts_ns = 0;
    uint64_t ack_ts_ns = 0;
    uint64_t network_latency_ns = 0;
    uint64_t gateway_latency_ns = 0;
    uint64_t exchange_latency_ns = 0;
    uint64_t acknowledgement_delay_ns = 0;
    uint64_t total_latency_ns = 0;
    uint64_t queue_delay_ns = 0;
    std::string message;

    // Regulatory & drop-copy metadata
    std::string borrow_locate_id;
    std::string exec_id;
    std::string drop_copy_target;
};

struct Position {
    std::string symbol;
    AssetClass asset_class = AssetClass::CRYPTO;
    double quantity = 0.0;
    double avg_price = 0.0;
    double realized_pnl = 0.0;
    double unrealized_pnl = 0.0;
};

// ─── Zero-Copy Shared-Memory Binary Inter-Process Communication (IPC) ─────────
// Exactly aligned 1-byte packed structs matching Python ctypes in shm_order_bridge.py
#pragma pack(push, 1)

static constexpr uint64_t SHM_MAGIC_ORDER_SUB = 0x5145495043535542ULL; // "QEIPCSUB"
static constexpr uint64_t SHM_MAGIC_EXEC_REP  = 0x5145495043455845ULL; // "QEIPCEXE"
static constexpr uint64_t SHM_MAGIC_RING_BUF  = 0x514552494E474255ULL; // "QERINGBU"
static constexpr size_t   SHM_RING_CAPACITY   = 1024;

struct ShmOrderSubmission {
    uint64_t magic;                 // SHM_MAGIC_ORDER_SUB
    uint64_t seq_num;               // Monotonic sequence number
    uint64_t client_order_id;
    char client_order_id_str[36];   // Client order string / UUID
    char user_id[36];
    char org_id[36];
    char symbol[32];
    uint8_t asset_class;            // 0=EQUITY, 1=FUTURES, 2=OPTIONS, 3=FX, 4=CRYPTO
    uint8_t side;                   // 1=BUY, 2=SELL, 5=SHORT_SELL
    uint8_t order_type;             // 1=MARKET, 2=LIMIT, 3=STOP, 4=STOP_LIMIT, 5=ICEBERG, 6=TWAP, 7=VWAP
    uint8_t time_in_force;          // 0=GTC, 1=IOC, 2=FOK, 3=POST_ONLY, 4=DAY
    double quantity;
    double limit_price;
    double stop_price;
    double display_quantity;        // For Iceberg orders
    uint32_t algo_duration_sec;     // For TWAP/VWAP
    double algo_participation_rate; // For VWAP (0.01 - 1.0)
    char borrow_locate_id[32];      // SEC Reg SHO Rule 203(b)(1)
    char cusip[12];
    char sedol[8];
    char isin[16];
    char futures_roll_code[12];     // e.g. "ESZ26"
    double strike_price;
    uint8_t put_or_call;            // 1=CALL, 2=PUT
    uint32_t option_expiry_date;    // YYYYMMDD
    double greeks_delta;
    double greeks_gamma;
    double greeks_vega;
    double greeks_theta;
    uint64_t timestamp_ns;
    uint8_t is_ready;               // Memory barrier flag: 1 = written, 0 = idle
    uint8_t padding[7];
};

struct ShmExecutionReport {
    uint64_t magic;                 // SHM_MAGIC_EXEC_REP
    uint64_t seq_num;
    uint64_t client_order_id;
    char client_order_id_str[36];
    char broker_order_id[48];
    char exec_id[48];
    char symbol[32];
    uint8_t asset_class;
    uint8_t side;
    uint8_t exec_type;              // 0=New, 1=Partial, 2=Fill, 4=Cancelled, 5=Replaced, 8=Rejected
    uint8_t ord_status;
    double order_qty;
    double cum_qty;
    double leaves_qty;
    double last_qty;
    double last_px;
    double avg_px;
    double commission;
    double slippage_bps;
    double market_impact_bps;
    uint64_t send_ts_ns;
    uint64_t engine_ts_ns;
    uint64_t wire_ts_ns;
    uint64_t total_latency_ns;
    char text[64];
    uint8_t is_ready;               // 1 = filled/reported, ready for consumer
    uint8_t padding[7];
};

struct ShmOrderRingBuffer {
    uint64_t magic;
    uint64_t write_head;
    uint8_t pad1[48];
    uint64_t read_tail;
    uint8_t pad2[48];
    ShmOrderSubmission submissions[SHM_RING_CAPACITY];
};

struct ShmExecRingBuffer {
    uint64_t magic;
    uint64_t write_head;
    uint8_t pad1[48];
    uint64_t read_tail;
    uint8_t pad2[48];
    ShmExecutionReport reports[SHM_RING_CAPACITY];
};

#pragma pack(pop)
