#pragma once

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <string_view>
#include <chrono>

// Branch prediction macros
#if defined(__GNUC__) || defined(__clang__)
    #define HFT_LIKELY_COND(x)   (__builtin_expect(!!(x), 1))
    #define HFT_UNLIKELY_COND(x) (__builtin_expect(!!(x), 0))
#else
    #define HFT_LIKELY_COND(x)   (x)
    #define HFT_UNLIKELY_COND(x) (x)
#endif

#if defined(__has_cpp_attribute) && __has_cpp_attribute(likely) >= 201803L
    #define HFT_LIKELY   [[likely]]
    #define HFT_UNLIKELY [[unlikely]]
#else
    #define HFT_LIKELY
    #define HFT_UNLIKELY
#endif

namespace quantos::fix {

// Standard FIX Tags
namespace tags {
    constexpr int BeginString        = 8;
    constexpr int BodyLength         = 9;
    constexpr int CheckSum           = 10;
    constexpr int ClOrdID            = 11;
    constexpr int CumQty             = 14;
    constexpr int ExecID             = 17;
    constexpr int MsgSeqNum          = 34;
    constexpr int MsgType            = 35;
    constexpr int OrderID            = 37;
    constexpr int OrderQty           = 38;
    constexpr int OrdStatus          = 39;
    constexpr int OrdType            = 40;
    constexpr int OrigClOrdID        = 41;
    constexpr int Price              = 44;
    constexpr int SenderCompID       = 49;
    constexpr int SendingTime        = 52;
    constexpr int Side               = 54;
    constexpr int Symbol             = 55;
    constexpr int TargetCompID       = 56;
    constexpr int Text               = 58;
    constexpr int TimeInForce        = 59;
    constexpr int TransactTime       = 60;
    constexpr int LastPx             = 31;
    constexpr int LastQty            = 32;
    constexpr int AvgPx              = 6;
    constexpr int ExecType           = 150;
    constexpr int LeavesQty          = 151;
    constexpr int HeartBtInt         = 108;
    constexpr int EncryptMethod      = 98;
    constexpr int CxlRejResponseTo   = 434;
    constexpr int CxlRejReason       = 102;
    constexpr int OrdRejReason       = 103;
}

// Standard FIX MsgTypes
namespace msg_type {
    inline constexpr std::string_view Heartbeat          = "0";
    inline constexpr std::string_view TestRequest        = "1";
    inline constexpr std::string_view ResendRequest      = "2";
    inline constexpr std::string_view Reject             = "3";
    inline constexpr std::string_view SequenceReset      = "4";
    inline constexpr std::string_view Logout             = "5";
    inline constexpr std::string_view ExecutionReport    = "8";
    inline constexpr std::string_view OrderCancelReject  = "9";
    inline constexpr std::string_view Logon              = "A";
    inline constexpr std::string_view NewOrderSingle     = "D";
    inline constexpr std::string_view OrderCancelRequest = "F";
    inline constexpr std::string_view OrderCancelReplace = "G";
}

// Standard FIX OrdStatus
namespace ord_status {
    constexpr char New             = '0';
    constexpr char PartiallyFilled = '1';
    constexpr char Filled          = '2';
    constexpr char DoneForDay      = '3';
    constexpr char Cancelled       = '4';
    constexpr char Replaced        = '5';
    constexpr char PendingCancel   = '6';
    constexpr char Stopped         = '7';
    constexpr char Rejected        = '8';
    constexpr char Suspended       = '9';
    constexpr char PendingNew      = 'A';
    constexpr char Calculated      = 'B';
    constexpr char Expired         = 'C';
}

// Standard FIX Tag 102 CxlRejReason Codes
namespace cxl_rej_reason {
    constexpr int TooLateToCancel                = 0;
    constexpr int UnknownOrder                   = 1;
    constexpr int BrokerCredit                   = 2;
    constexpr int OrderAlreadyInPendingStatus    = 3;
    constexpr int UnableToProcessOrderMassCancel = 4;
    constexpr int OrigOrdModTimeDidNotMatch      = 5;
    constexpr int DuplicateClOrdID               = 6;
    constexpr int Other                          = 99;
}

// Standard FIX Tag 103 OrdRejReason Codes
namespace ord_rej_reason {
    constexpr int BrokerCreditCheckFailed       = 0;
    constexpr int UnknownSymbol                 = 1;
    constexpr int ExchangeClosed                = 2;
    constexpr int OrderExceedsLimit             = 3;
    constexpr int TooLateToEnter                = 4;
    constexpr int UnknownOrder                  = 5;
    constexpr int DuplicateOrder                = 6;
    constexpr int UnsupportedOrderType          = 11;
    constexpr int Other                         = 99;
}

// SOH delimiter
constexpr char SOH = '\x01';

// Fast branchless integer to ASCII
inline int fast_itoa(int64_t val, char* buf) noexcept {
    if (HFT_UNLIKELY_COND(val == 0)) {
        buf[0] = '0';
        buf[1] = '\0';
        return 1;
    }
    char temp[24];
    int p = 0;
    bool neg = false;
    uint64_t uval;
    if (val < 0) {
        neg = true;
        uval = static_cast<uint64_t>(-(val + 1)) + 1;
    } else {
        uval = static_cast<uint64_t>(val);
    }
    while (uval > 0) {
        temp[p++] = static_cast<char>('0' + (uval % 10));
        uval /= 10;
    }
    int out = 0;
    if (neg) {
        buf[out++] = '-';
    }
    while (p > 0) {
        buf[out++] = temp[--p];
    }
    buf[out] = '\0';
    return out;
}

// Fast fixed-precision double to ASCII without heap allocations
inline int fast_dtoa(double val, int precision, char* buf) noexcept {
    if (HFT_UNLIKELY_COND(std::isnan(val))) {
        std::memcpy(buf, "nan", 4);
        return 3;
    }
    if (HFT_UNLIKELY_COND(std::isinf(val))) {
        if (val < 0) {
            std::memcpy(buf, "-inf", 5);
            return 4;
        } else {
            std::memcpy(buf, "inf", 4);
            return 3;
        }
    }
    int out = 0;
    if (val < 0.0) {
        buf[out++] = '-';
        val = -val;
    }
    static const double pow10[] = {
        1.0, 10.0, 100.0, 1000.0, 10000.0, 100000.0, 1000000.0, 10000000.0, 100000000.0
    };
    int prec = std::clamp(precision, 0, 8);
    double scale = pow10[prec];
    val += 0.5 / scale; // rounding

    auto int_part = static_cast<uint64_t>(val);
    double frac_part = val - static_cast<double>(int_part);

    out += fast_itoa(static_cast<int64_t>(int_part), buf + out);
    if (prec > 0) {
        buf[out++] = '.';
        auto frac_int = static_cast<uint64_t>(frac_part * scale);
        char frac_buf[16];
        int f_len = fast_itoa(static_cast<int64_t>(frac_int), frac_buf);
        for (int i = 0; i < prec - f_len; ++i) {
            buf[out++] = '0';
        }
        std::memcpy(buf + out, frac_buf, f_len);
        out += f_len;
    }
    buf[out] = '\0';
    return out;
}

// Sub-millisecond cached UTC timestamp generator (Zero heap allocation)
inline void current_fix_utc_timestamp_fast(char* out_buf) noexcept {
    using namespace std::chrono;
    auto now = system_clock::now();
    auto ms_since_epoch = duration_cast<milliseconds>(now.time_since_epoch()).count();
    time_t sec = static_cast<time_t>(ms_since_epoch / 1000);
    int ms = static_cast<int>(ms_since_epoch % 1000);

    struct alignas(64) SecCache {
        time_t last_sec = 0;
        char prefix[18] = {}; // "YYYYMMDD-HH:MM:SS."
    };
    static thread_local SecCache cache;

    if (HFT_UNLIKELY_COND(sec != cache.last_sec)) {
        cache.last_sec = sec;
        std::tm tm_buf;
#if defined(_WIN32) || defined(_WIN64)
        gmtime_s(&tm_buf, &sec);
#else
        gmtime_r(&sec, &tm_buf);
#endif
        std::snprintf(cache.prefix, sizeof(cache.prefix), "%04d%02d%02d-%02d:%02d:%02d.",
                      tm_buf.tm_year + 1900, tm_buf.tm_mon + 1, tm_buf.tm_mday,
                      tm_buf.tm_hour, tm_buf.tm_min, tm_buf.tm_sec);
    }

    std::memcpy(out_buf, cache.prefix, 18);
    out_buf[18] = static_cast<char>('0' + (ms / 100));
    out_buf[19] = static_cast<char>('0' + ((ms / 10) % 10));
    out_buf[20] = static_cast<char>('0' + (ms % 10));
    out_buf[21] = '\0';
}

inline std::string current_fix_utc_timestamp() {
    char buf[32];
    current_fix_utc_timestamp_fast(buf);
    return std::string(buf, 21);
}

// Cache-aligned, Zero-Allocation FIX Message
class alignas(64) FixMessage {
public:
    static constexpr size_t MAX_FIELDS = 64;
    static constexpr size_t MAX_TAG_LOOKUP = 1024;
    static constexpr size_t FIELD_VAL_CAPACITY = 64;

    struct FieldEntry {
        int16_t tag = 0;
        uint16_t len = 0;
        char val[FIELD_VAL_CAPACITY] = {};
    };

    FixMessage() noexcept {
        reset();
    }

    explicit FixMessage(std::string_view msg_type) noexcept {
        reset();
        set_field(tags::MsgType, msg_type);
    }

    explicit FixMessage(const std::string& msg_type) noexcept {
        reset();
        set_field(tags::MsgType, std::string_view(msg_type));
    }

    void reset() noexcept {
        for (size_t i = 0; i < num_fields_; ++i) {
            int tag = entries_[i].tag;
            if (HFT_LIKELY_COND(tag >= 0 && tag < static_cast<int>(MAX_TAG_LOOKUP))) {
                tag_lut_[tag] = -1;
            }
        }
        num_fields_ = 0;
    }

    void set_field(int tag, std::string_view val) noexcept {
        int idx = find_or_allocate_tag_index(tag);
        if (HFT_UNLIKELY_COND(idx < 0)) return;

        FieldEntry& entry = entries_[idx];
        entry.tag = static_cast<int16_t>(tag);
        size_t cpy_len = std::min(val.size(), FIELD_VAL_CAPACITY - 1);
        std::memcpy(entry.val, val.data(), cpy_len);
        entry.val[cpy_len] = '\0';
        entry.len = static_cast<uint16_t>(cpy_len);
    }

    void set_field(int tag, const char* val) noexcept {
        set_field(tag, std::string_view(val ? val : ""));
    }

    void set_field(int tag, const std::string& val) noexcept {
        set_field(tag, std::string_view(val));
    }

    void set_field(int tag, int val) noexcept {
        char buf[24];
        fast_itoa(val, buf);
        set_field(tag, std::string_view(buf));
    }

    void set_field(int tag, int64_t val) noexcept {
        char buf[24];
        fast_itoa(val, buf);
        set_field(tag, std::string_view(buf));
    }

    void set_field(int tag, uint64_t val) noexcept {
        char buf[24];
        fast_itoa(static_cast<int64_t>(val), buf);
        set_field(tag, std::string_view(buf));
    }

    void set_field(int tag, double val, int precision = 4) noexcept {
        char buf[32];
        fast_dtoa(val, precision, buf);
        set_field(tag, std::string_view(buf));
    }

    std::string_view get_field_sv(int tag, std::string_view fallback = "") const noexcept {
        int idx = get_tag_index(tag);
        if (HFT_LIKELY_COND(idx >= 0)) {
            return std::string_view(entries_[idx].val, entries_[idx].len);
        }
        return fallback;
    }

    std::string get_field(int tag, const std::string& fallback = "") const {
        std::string_view sv = get_field_sv(tag, std::string_view(fallback));
        return std::string(sv);
    }

    bool has_field(int tag) const noexcept {
        return get_tag_index(tag) >= 0;
    }

    std::string_view msg_type_sv() const noexcept {
        return get_field_sv(tags::MsgType);
    }

    std::string msg_type() const {
        return std::string(msg_type_sv());
    }

    // Zero-copy direct checksum calculation into 3-digit ASCII
    static void calculate_checksum_fast(const char* data, size_t len, char* out_buf) noexcept {
        uint32_t sum = 0;
        for (size_t i = 0; i < len; ++i) {
            sum += static_cast<uint8_t>(data[i]);
        }
        sum %= 256;
        out_buf[0] = static_cast<char>('0' + (sum / 100));
        out_buf[1] = static_cast<char>('0' + ((sum / 10) % 10));
        out_buf[2] = static_cast<char>('0' + (sum % 10));
        out_buf[3] = '\0';
    }

    static std::string calculate_checksum(const std::string& text) {
        char buf[8];
        calculate_checksum_fast(text.data(), text.size(), buf);
        return std::string(buf, 3);
    }

    // Direct-to-Wire Zero-Copy serialization
    size_t encode_to(char* dest, size_t max_len, char delimiter = SOH) const noexcept {
        if (HFT_UNLIKELY_COND(dest == nullptr || max_len < 128)) return 0;

        // Stage 1: Build message body in a stack-allocated buffer (Zero Heap Allocation)
        char body_buf[2048];
        size_t body_len = 0;

        auto append_tag = [&](int t) noexcept {
            int idx = get_tag_index(t);
            if (idx >= 0) {
                const FieldEntry& e = entries_[idx];
                char tag_str[16];
                int t_len = fast_itoa(e.tag, tag_str);
                if (body_len + t_len + 1 + e.len + 1 < sizeof(body_buf)) {
                    std::memcpy(body_buf + body_len, tag_str, t_len);
                    body_len += t_len;
                    body_buf[body_len++] = '=';
                    std::memcpy(body_buf + body_len, e.val, e.len);
                    body_len += e.len;
                    body_buf[body_len++] = delimiter;
                }
            }
        };

        // Write header tags in standard FIX order
        append_tag(tags::MsgType);
        append_tag(tags::SenderCompID);
        append_tag(tags::TargetCompID);
        append_tag(tags::MsgSeqNum);
        append_tag(tags::SendingTime);

        // Write remaining fields in insertion order
        for (size_t i = 0; i < num_fields_; ++i) {
            int t = entries_[i].tag;
            if (t == tags::MsgType || t == tags::SenderCompID || t == tags::TargetCompID ||
                t == tags::MsgSeqNum || t == tags::SendingTime ||
                t == tags::BeginString || t == tags::BodyLength || t == tags::CheckSum) {
                continue;
            }
            append_tag(t);
        }

        // Stage 2: Pre-Checksum framing into destination wire buffer
        size_t pos = 0;
        std::string_view begin_str = get_field_sv(tags::BeginString, "FIX.4.4");

        // 8=BeginString<delim>
        pos += std::snprintf(dest + pos, max_len - pos, "8=%.*s%c",
                             static_cast<int>(begin_str.size()), begin_str.data(), delimiter);

        // 9=BodyLength<delim>
        char body_len_str[16];
        int bl_len = fast_itoa(static_cast<int64_t>(body_len), body_len_str);
        if (pos + 2 + bl_len + 1 + body_len + 8 < max_len) {
            dest[pos++] = '9';
            dest[pos++] = '=';
            std::memcpy(dest + pos, body_len_str, bl_len);
            pos += bl_len;
            dest[pos++] = delimiter;

            // Copy body
            std::memcpy(dest + pos, body_buf, body_len);
            pos += body_len;

            // 10=CheckSum<delim>
            char chk_buf[4];
            calculate_checksum_fast(dest, pos, chk_buf);
            dest[pos++] = '1';
            dest[pos++] = '0';
            dest[pos++] = '=';
            dest[pos++] = chk_buf[0];
            dest[pos++] = chk_buf[1];
            dest[pos++] = chk_buf[2];
            dest[pos++] = delimiter;
            dest[pos] = '\0';
            return pos;
        }
        return 0;
    }

    std::string encode(char delimiter = SOH) const {
        char buf[2048];
        size_t len = encode_to(buf, sizeof(buf), delimiter);
        return std::string(buf, len);
    }

    // Zero-heap fast parser
    static FixMessage parse(std::string_view raw, char delimiter = SOH) noexcept {
        FixMessage msg;
        size_t start = 0;
        while (start < raw.size()) {
            size_t end = raw.find(delimiter, start);
            if (end == std::string_view::npos) {
                end = raw.size();
            }
            std::string_view token = raw.substr(start, end - start);
            if (!token.empty()) {
                size_t eq = token.find('=');
                if (eq != std::string_view::npos) {
                    int tag = 0;
                    for (size_t i = 0; i < eq; ++i) {
                        char c = token[i];
                        if (c >= '0' && c <= '9') {
                            tag = tag * 10 + (c - '0');
                        }
                    }
                    std::string_view val = token.substr(eq + 1);
                    msg.set_field(tag, val);
                }
            }
            start = end + 1;
        }
        return msg;
    }

    static FixMessage parse(const std::string& raw, char delimiter = SOH) noexcept {
        return parse(std::string_view(raw), delimiter);
    }

private:
    int get_tag_index(int tag) const noexcept {
        if (HFT_LIKELY_COND(tag >= 0 && tag < static_cast<int>(MAX_TAG_LOOKUP))) {
            return tag_lut_[tag];
        }
        for (size_t i = 0; i < num_fields_; ++i) {
            if (entries_[i].tag == tag) return static_cast<int>(i);
        }
        return -1;
    }

    int find_or_allocate_tag_index(int tag) noexcept {
        if (HFT_LIKELY_COND(tag >= 0 && tag < static_cast<int>(MAX_TAG_LOOKUP))) {
            int existing = tag_lut_[tag];
            if (existing >= 0) return existing;
            if (HFT_LIKELY_COND(num_fields_ < MAX_FIELDS)) {
                int new_idx = static_cast<int>(num_fields_++);
                tag_lut_[tag] = static_cast<int16_t>(new_idx);
                return new_idx;
            }
            return -1;
        }
        for (size_t i = 0; i < num_fields_; ++i) {
            if (entries_[i].tag == tag) return static_cast<int>(i);
        }
        if (num_fields_ < MAX_FIELDS) {
            return static_cast<int>(num_fields_++);
        }
        return -1;
    }

    std::array<FieldEntry, MAX_FIELDS> entries_{};
    std::array<int16_t, MAX_TAG_LOOKUP> tag_lut_{};
    size_t num_fields_ = 0;
};

// Thread-Local Pre-Allocated FIX Message Object Pool
class FixMessagePool {
public:
    static constexpr size_t POOL_CAPACITY = 128;

    static FixMessagePool& instance() noexcept {
        static thread_local FixMessagePool pool;
        return pool;
    }

    FixMessage* acquire() noexcept {
        if (HFT_LIKELY_COND(available_ > 0)) {
            FixMessage* msg = pool_[--available_];
            msg->reset();
            return msg;
        }
        return &overflow_;
    }

    void release(FixMessage* msg) noexcept {
        if (HFT_LIKELY_COND(msg != &overflow_ && available_ < POOL_CAPACITY)) {
            pool_[available_++] = msg;
        }
    }

private:
    FixMessagePool() noexcept {
        for (size_t i = 0; i < POOL_CAPACITY; ++i) {
            storage_[i].reset();
            pool_[i] = &storage_[i];
        }
        available_ = POOL_CAPACITY;
    }

    FixMessage storage_[POOL_CAPACITY];
    FixMessage* pool_[POOL_CAPACITY];
    size_t available_ = POOL_CAPACITY;
    FixMessage overflow_;
};

// RAII Handle for Object-Pooled FixMessage
class PooledFixMessage {
public:
    PooledFixMessage() noexcept : msg_(FixMessagePool::instance().acquire()) {}
    explicit PooledFixMessage(std::string_view msg_type) noexcept
        : msg_(FixMessagePool::instance().acquire()) {
        msg_->set_field(tags::MsgType, msg_type);
    }
    ~PooledFixMessage() noexcept {
        if (msg_) {
            FixMessagePool::instance().release(msg_);
        }
    }
    PooledFixMessage(const PooledFixMessage&) = delete;
    PooledFixMessage& operator=(const PooledFixMessage&) = delete;
    PooledFixMessage(PooledFixMessage&& other) noexcept : msg_(other.msg_) {
        other.msg_ = nullptr;
    }
    PooledFixMessage& operator=(PooledFixMessage&& other) noexcept {
        if (this != &other) {
            if (msg_) FixMessagePool::instance().release(msg_);
            msg_ = other.msg_;
            other.msg_ = nullptr;
        }
        return *this;
    }

    FixMessage* get() const noexcept { return msg_; }
    FixMessage& operator*() const noexcept { return *msg_; }
    FixMessage* operator->() const noexcept { return msg_; }

private:
    FixMessage* msg_ = nullptr;
};

} // namespace quantos::fix
