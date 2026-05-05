#include <winsock2.h>
#include <ws2tcpip.h>

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <string>

#include <nlohmann/json.hpp>

namespace {

constexpr int kDefaultPort = 7777;

uint64_t now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

std::string make_game_id() {
    return std::string("G-") + std::to_string(now_ms());
}

bool send_all(SOCKET sock, const char* data, int len) {
    int sent = 0;
    while (sent < len) {
        int n = send(sock, data + sent, len - sent, 0);
        if (n == SOCKET_ERROR || n == 0) {
            return false;
        }
        sent += n;
    }
    return true;
}

} // namespace

int main() {
    WSADATA wsa_data;
    if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
        std::fprintf(stderr, "WSAStartup failed.\n");
        return 1;
    }

    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) {
        std::fprintf(stderr, "socket failed.\n");
        WSACleanup();
        return 1;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(static_cast<u_short>(kDefaultPort));

    if (bind(listen_sock, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
        std::fprintf(stderr, "bind failed.\n");
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    if (listen(listen_sock, 1) == SOCKET_ERROR) {
        std::fprintf(stderr, "listen failed.\n");
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    std::printf("NetHackServer listening on port %d...\n", kDefaultPort);

    SOCKET client_sock = accept(listen_sock, nullptr, nullptr);
    if (client_sock == INVALID_SOCKET) {
        std::fprintf(stderr, "accept failed.\n");
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    nlohmann::json hello = {
        {"type", "hello"},
        {"version", "0.1"},
        {"seq", 1},
        {"time_ms", now_ms()},
        {"game_id", make_game_id()},
        {"turn", 0},
        {"payload", {
            {"server", "NetHackServer"},
            {"protocol", "ipc-v0"}
        }}
    };

    std::string line = hello.dump();
    line.push_back('\n');

    if (!send_all(client_sock, line.c_str(), static_cast<int>(line.size()))) {
        std::fprintf(stderr, "send failed.\n");
        closesocket(client_sock);
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    std::printf("hello sent, waiting for client messages...\n");

    char buffer[1024];
    while (true) {
        int n = recv(client_sock, buffer, static_cast<int>(sizeof(buffer)), 0);
        if (n <= 0) {
            break;
        }
    }

    closesocket(client_sock);
    closesocket(listen_sock);
    WSACleanup();
    std::printf("client disconnected, server exiting.\n");
    return 0;
}
