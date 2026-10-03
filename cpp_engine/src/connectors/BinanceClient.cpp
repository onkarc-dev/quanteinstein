#include "BinanceClient.h"

#include "../engine_shared.hpp"
#include "../time_utils.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

namespace {

BinanceClient* g_client = nullptr;

static const struct lws_protocols protocols[] = {
    {"binance-market-data-client", BinanceClient::callback_ws, 0, 1 << 16},
    {nullptr, nullptr, 0, 0}
};

std::string lower_copy(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return s;
}

bool contains_token(const char* data, size_t len, const char* token) {
    if (!data || !token) return false;
    const std::string view(data, len);
    return view.find(token) != std::string::npos;
}

} // namespace

BinanceClient::BinanceClient(std::string symbol, bool enable_depth_stream)
    : symbol_(lower_copy(std::move(symbol))), enable_depth_stream_(enable_depth_stream) {
    path_ = enable_depth_stream_
        ? "/stream?streams=" + symbol_ + "@trade/" + symbol_ + "@depth@100ms"
        : "/ws/" + symbol_ + "@trade";
    g_client = this;
}

BinanceClient::~BinanceClient() {
    stop();
    if (context_) {
        lws_context_destroy(context_);
        context_ = nullptr;
    }
    if (g_client == this) g_client = nullptr;
}

void BinanceClient::stop() {
    connected_.store(false, std::memory_order_relaxed);
}

bool BinanceClient::connect() {
    if (!context_) {
        struct lws_context_creation_info info;
        std::memset(&info, 0, sizeof(info));
        info.port = CONTEXT_PORT_NO_LISTEN;
        info.protocols = protocols;
        info.options = LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;
        context_ = lws_create_context(&info);
        if (!context_) {
            std::cerr << "Failed to create libwebsockets context\n";
            return false;
        }
    }

    struct lws_client_connect_info ccinfo;
    std::memset(&ccinfo, 0, sizeof(ccinfo));
    static int s_host_index = 0;
    static const char* s_hosts[] = {"data-stream.binance.vision", "stream.binance.com"};
    const char* chosen_host = s_hosts[(s_host_index++) % 2];
    ccinfo.address = chosen_host;
    ccinfo.port = 9443;
    ccinfo.path = path_.c_str();
    ccinfo.host = ccinfo.address;
    ccinfo.origin = ccinfo.address;
    ccinfo.protocol = protocols[0].name;
    ccinfo.ssl_connection = LCCSCF_USE_SSL;
    ccinfo.userdata = this;

    wsi_ = lws_client_connect_via_info(&ccinfo);
    if (!wsi_) {
        std::cerr << "Failed to start Binance WebSocket connection\n";
        return false;
    }
    return true;
}

void BinanceClient::run() {
    std::cout << "Connecting QuantOS market data client path=" << path_ << "\n";
    while (running.load(std::memory_order_relaxed)) {
        if (!wsi_ && !connect()) {
            std::this_thread::sleep_for(std::chrono::seconds(2));
            continue;
        }
        if (context_) lws_service(context_, 50);
    }
}

void BinanceClient::enqueue_trade(const char* data, size_t len, uint64_t ingest_ts_ns) {
    if (len >= sizeof(RawTradeMessage::data)) {
        dropped_.fetch_add(1, std::memory_order_relaxed);
        dropped_too_large_.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    RawTradeMessage raw{};
    raw.len = static_cast<uint16_t>(len);
    raw.ingest_ts_ns = ingest_ts_ns;
    std::memcpy(raw.data, data, len);
    raw.data[len] = '\0';
    if (!raw_trade_queue.push(raw)) {
        dropped_.fetch_add(1, std::memory_order_relaxed);
        dropped_queue_full_.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    received_.fetch_add(1, std::memory_order_relaxed);
}

void BinanceClient::enqueue_market(const char* data, size_t len, uint64_t ingest_ts_ns) {
    if (len >= sizeof(RawMarketMessage::data)) {
        market_dropped_.fetch_add(1, std::memory_order_relaxed);
        dropped_too_large_.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    RawMarketMessage raw{};
    raw.len = static_cast<uint16_t>(len);
    raw.ingest_ts_ns = ingest_ts_ns;
    std::memcpy(raw.data, data, len);
    raw.data[len] = '\0';
    if (!raw_market_queue.push(raw)) {
        market_dropped_.fetch_add(1, std::memory_order_relaxed);
        dropped_queue_full_.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    market_received_.fetch_add(1, std::memory_order_relaxed);
}

void BinanceClient::handle_message(const char* data, size_t len) {
    if (!data || len == 0) {
        dropped_.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    const uint64_t ts = now_ns();
    if (contains_token(data, len, "depthUpdate")) {
        enqueue_market(data, len, ts);
    } else if (contains_token(data, len, "trade")) {
        enqueue_trade(data, len, ts);
    } else {
        dropped_.fetch_add(1, std::memory_order_relaxed);
    }
}

int BinanceClient::callback_ws(struct lws* wsi, enum lws_callback_reasons reason, void* user, void* in, size_t len) {
    BinanceClient* self = static_cast<BinanceClient*>(user);
    if (!self) self = g_client;
    switch (reason) {
        case LWS_CALLBACK_CLIENT_ESTABLISHED:
            if (self) self->connected_.store(true, std::memory_order_relaxed);
            std::cout << "Binance WebSocket connected\n";
            break;
        case LWS_CALLBACK_CLIENT_RECEIVE:
            if (self && in && len > 0) self->handle_message(static_cast<const char*>(in), len);
            break;
        case LWS_CALLBACK_CLIENT_CLOSED:
        case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
            if (self) {
                self->connected_.store(false, std::memory_order_relaxed);
                self->wsi_ = nullptr;
            }
            std::cerr << "Binance WebSocket disconnected; reconnecting...\n";
            break;
        default:
            break;
    }
    (void)wsi;
    return 0;
}
