#pragma once
#include "../trading/OrderTypes.hpp"
#include <atomic>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>

#if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace quantos {

class ShmChannel {
public:
    static constexpr const char* ORDER_RING_NAME = "quanteinstein_order_sub_ring";
    static constexpr const char* EXEC_RING_NAME  = "quanteinstein_exec_rep_ring";

    ShmChannel() = default;
    ~ShmChannel() { close_channel(); }

    bool init_as_server() {
#if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        bool ok1 = create_or_open_ring(ORDER_RING_NAME, sizeof(ShmOrderRingBuffer), true, order_handle_, reinterpret_cast<void*&>(order_ring_));
        bool ok2 = create_or_open_ring(EXEC_RING_NAME, sizeof(ShmExecRingBuffer), true, exec_handle_, reinterpret_cast<void*&>(exec_ring_));
#else
        bool ok1 = create_or_open_ring(ORDER_RING_NAME, sizeof(ShmOrderRingBuffer), true, order_fd_, reinterpret_cast<void*&>(order_ring_));
        bool ok2 = create_or_open_ring(EXEC_RING_NAME, sizeof(ShmExecRingBuffer), true, exec_fd_, reinterpret_cast<void*&>(exec_ring_));
#endif

        if (ok1 && order_ring_) {
            if (order_ring_->magic != SHM_MAGIC_RING_BUF) {
                std::memset(order_ring_, 0, sizeof(ShmOrderRingBuffer));
                order_ring_->magic = SHM_MAGIC_RING_BUF;
                order_ring_->write_head = 0;
                order_ring_->read_tail = 0;
            }
        }
        if (ok2 && exec_ring_) {
            if (exec_ring_->magic != SHM_MAGIC_RING_BUF) {
                std::memset(exec_ring_, 0, sizeof(ShmExecRingBuffer));
                exec_ring_->magic = SHM_MAGIC_RING_BUF;
                exec_ring_->write_head = 0;
                exec_ring_->read_tail = 0;
            }
        }
        is_initialized_ = (ok1 && ok2);
        return is_initialized_;
    }

    bool init_as_client() {
#if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        bool ok1 = create_or_open_ring(ORDER_RING_NAME, sizeof(ShmOrderRingBuffer), false, order_handle_, reinterpret_cast<void*&>(order_ring_));
        bool ok2 = create_or_open_ring(EXEC_RING_NAME, sizeof(ShmExecRingBuffer), false, exec_handle_, reinterpret_cast<void*&>(exec_ring_));
#else
        bool ok1 = create_or_open_ring(ORDER_RING_NAME, sizeof(ShmOrderRingBuffer), false, order_fd_, reinterpret_cast<void*&>(order_ring_));
        bool ok2 = create_or_open_ring(EXEC_RING_NAME, sizeof(ShmExecRingBuffer), false, exec_fd_, reinterpret_cast<void*&>(exec_ring_));
#endif
        is_initialized_ = (ok1 && ok2);
        return is_initialized_;
    }

    // Producer (FastAPI / Client) -> Consumer (C++ Engine)
    bool push_order(const ShmOrderSubmission& order) {
        if (!order_ring_) return false;

        uint64_t head = order_ring_->write_head;
        uint64_t tail = order_ring_->read_tail;

        // Check full condition
        if (head - tail >= SHM_RING_CAPACITY) {
            return false; // Ring buffer full
        }

        size_t idx = head % SHM_RING_CAPACITY;
        std::memcpy(&order_ring_->submissions[idx], &order, sizeof(ShmOrderSubmission));
        order_ring_->submissions[idx].is_ready = 1;

        #if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        MemoryBarrier();
        #else
        __sync_synchronize();
        #endif

        order_ring_->write_head = head + 1;
        return true;
    }

    // Consumer (C++ Engine) polls for pending submissions
    bool pop_order(ShmOrderSubmission& out_order) {
        if (!order_ring_) return false;

        uint64_t tail = order_ring_->read_tail;
        uint64_t head = order_ring_->write_head;

        if (tail >= head) {
            return false; // Queue empty
        }

        size_t idx = tail % SHM_RING_CAPACITY;
        if (order_ring_->submissions[idx].is_ready == 0) {
            return false;
        }

        std::memcpy(&out_order, &order_ring_->submissions[idx], sizeof(ShmOrderSubmission));
        order_ring_->submissions[idx].is_ready = 0;

        #if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        MemoryBarrier();
        #else
        __sync_synchronize();
        #endif

        order_ring_->read_tail = tail + 1;
        return true;
    }

    // Engine pushes execution report -> Client reads execution report
    bool push_execution_report(const ShmExecutionReport& report) {
        if (!exec_ring_) return false;

        uint64_t head = exec_ring_->write_head;
        uint64_t tail = exec_ring_->read_tail;

        if (head - tail >= SHM_RING_CAPACITY) {
            return false;
        }

        size_t idx = head % SHM_RING_CAPACITY;
        std::memcpy(&exec_ring_->reports[idx], &report, sizeof(ShmExecutionReport));
        exec_ring_->reports[idx].is_ready = 1;

        #if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        MemoryBarrier();
        #else
        __sync_synchronize();
        #endif

        exec_ring_->write_head = head + 1;
        return true;
    }

    bool pop_execution_report(ShmExecutionReport& out_report) {
        if (!exec_ring_) return false;

        uint64_t tail = exec_ring_->read_tail;
        uint64_t head = exec_ring_->write_head;

        if (tail >= head) {
            return false;
        }

        size_t idx = tail % SHM_RING_CAPACITY;
        if (exec_ring_->reports[idx].is_ready == 0) {
            return false;
        }

        std::memcpy(&out_report, &exec_ring_->reports[idx], sizeof(ShmExecutionReport));
        exec_ring_->reports[idx].is_ready = 0;

        #if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        MemoryBarrier();
        #else
        __sync_synchronize();
        #endif

        exec_ring_->read_tail = tail + 1;
        return true;
    }

    // Linux Real-Time Deterministic Kernel Isolation & CPU Core Pinning
    static bool configure_linux_realtime_isolation(int core_id = 1, int rt_priority = 80) {
#if !((defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX))
        // 1. Prevent kernel paging and memory swapping across critical execution paths
        if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
            std::cerr << "[ShmChannel/WARN] mlockall failed (requires CAP_SYS_RESOURCE/CAP_IPC_LOCK)\n";
        }

        // 2. Pin thread to isolated CPU core
        cpu_set_t cpuset;
        CPU_ZERO(&cpuset);
        CPU_SET(core_id, &cpuset);
        pthread_t thread = pthread_self();
        if (pthread_setaffinity_np(thread, sizeof(cpu_set_t), &cpuset) != 0) {
            std::cerr << "[ShmChannel/WARN] pthread_setaffinity_np failed for core " << core_id << "\n";
        }

        // 3. Enforce SCHED_FIFO real-time deterministic priority
        struct sched_param param;
        std::memset(&param, 0, sizeof(param));
        param.sched_priority = rt_priority;
        if (pthread_setschedparam(thread, SCHED_FIFO, &param) != 0) {
            std::cerr << "[ShmChannel/WARN] pthread_setschedparam SCHED_FIFO failed (requires CAP_SYS_NICE)\n";
        }
        return true;
#else
        (void)core_id;
        (void)rt_priority;
        return true;
#endif
    }

        bool is_ready() const { return is_initialized_; }

    void close_channel() {
#if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        if (order_ring_) { UnmapViewOfFile(order_ring_); order_ring_ = nullptr; }
        if (order_handle_) { CloseHandle(order_handle_); order_handle_ = nullptr; }
        if (exec_ring_) { UnmapViewOfFile(exec_ring_); exec_ring_ = nullptr; }
        if (exec_handle_) { CloseHandle(exec_handle_); exec_handle_ = nullptr; }
#else
        if (order_ring_) { munmap(order_ring_, sizeof(ShmOrderRingBuffer)); order_ring_ = nullptr; }
        if (order_fd_ >= 0) { close(order_fd_); order_fd_ = -1; }
        if (exec_ring_) { munmap(exec_ring_, sizeof(ShmExecRingBuffer)); exec_ring_ = nullptr; }
        if (exec_fd_ >= 0) { close(exec_fd_); exec_fd_ = -1; }
#endif
        is_initialized_ = false;
    }

private:
#if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
    HANDLE order_handle_ = nullptr;
    HANDLE exec_handle_  = nullptr;
#else
    int order_fd_ = -1;
    int exec_fd_  = -1;
#endif

    ShmOrderRingBuffer* order_ring_ = nullptr;
    ShmExecRingBuffer*  exec_ring_  = nullptr;
    bool is_initialized_ = false;

    bool create_or_open_ring(const char* name, size_t size, bool is_server,
#if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        HANDLE& handle_out,
#else
        int& fd_out,
#endif
        void*& ptr_out)
    {
#if (defined(_WIN32) || defined(_WIN64)) && !defined(ENTERPRISE_CORE_LINUX)
        std::string full_name = std::string("Local\\") + name;
        if (is_server) {
            handle_out = CreateFileMappingA(
                INVALID_HANDLE_VALUE,
                nullptr,
                PAGE_READWRITE,
                0,
                static_cast<DWORD>(size),
                full_name.c_str()
            );
        } else {
            handle_out = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, full_name.c_str());
            if (!handle_out) {
                // If not created yet, create it
                handle_out = CreateFileMappingA(
                    INVALID_HANDLE_VALUE,
                    nullptr,
                    PAGE_READWRITE,
                    0,
                    static_cast<DWORD>(size),
                    full_name.c_str()
                );
            }
        }
        if (!handle_out) {
            return false;
        }
        ptr_out = MapViewOfFile(handle_out, FILE_MAP_ALL_ACCESS, 0, 0, size);
        return (ptr_out != nullptr);
#else
        std::string posix_name = std::string("/") + name;
        int flags = O_RDWR | (is_server ? O_CREAT : 0);
        fd_out = shm_open(posix_name.c_str(), flags, 0666);
        if (fd_out < 0 && !is_server) {
            fd_out = shm_open(posix_name.c_str(), O_RDWR | O_CREAT, 0666);
        }
        if (fd_out < 0) {
            return false;
        }
        if (ftruncate(fd_out, static_cast<off_t>(size)) != 0) {
            // Non-fatal if already truncated
        }
        ptr_out = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd_out, 0);
        return (ptr_out != MAP_FAILED);
#endif
    }
};

} // namespace quantos
