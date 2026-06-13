#define WIN32_LEAN_AND_MEAN

#include <winsock2.h>
#include <ws2tcpip.h>

#include <nlohmann/json.hpp>

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

using json = nlohmann::json;

namespace {

constexpr const char *kDefaultHost = "127.0.0.1";
constexpr unsigned short kDefaultPort = 7777;
constexpr int kProtocolVersion = 1;
constexpr size_t kMaxBufferedLineBytes = 1024 * 1024;

struct Options {
    std::string host = kDefaultHost;
    unsigned short port = kDefaultPort;
    bool help = false;
};

struct MaybeInt {
    MaybeInt() = default;
    explicit MaybeInt(int present_value)
        : has_value(true)
        , value(present_value)
    {
    }

    bool has_value = false;
    int value = 0;
};

class WinsockSession {
public:
    WinsockSession()
    {
        WSADATA data {};
        const int result = WSAStartup(MAKEWORD(2, 2), &data);
        if (result != 0) {
            throw std::runtime_error("WSAStartup failed: " + std::to_string(result));
        }
    }

    ~WinsockSession()
    {
        WSACleanup();
    }

    WinsockSession(const WinsockSession &) = delete;
    WinsockSession &operator=(const WinsockSession &) = delete;
};

class SocketHandle {
public:
    SocketHandle() = default;
    explicit SocketHandle(SOCKET socket)
        : socket_(socket)
    {
    }

    ~SocketHandle()
    {
        reset();
    }

    SocketHandle(const SocketHandle &) = delete;
    SocketHandle &operator=(const SocketHandle &) = delete;

    SocketHandle(SocketHandle &&other) noexcept
        : socket_(other.socket_)
    {
        other.socket_ = INVALID_SOCKET;
    }

    SocketHandle &operator=(SocketHandle &&other) noexcept
    {
        if (this != &other) {
            reset();
            socket_ = other.socket_;
            other.socket_ = INVALID_SOCKET;
        }
        return *this;
    }

    SOCKET get() const
    {
        return socket_;
    }

    bool valid() const
    {
        return socket_ != INVALID_SOCKET;
    }

    void reset(SOCKET replacement = INVALID_SOCKET)
    {
        if (socket_ != INVALID_SOCKET) {
            closesocket(socket_);
        }
        socket_ = replacement;
    }

private:
    SOCKET socket_ = INVALID_SOCKET;
};

void print_usage()
{
    std::cout
        << "Usage: NetHackServer.exe [--host <address>] [--port <port>]\n"
        << "\n"
        << "Defaults:\n"
        << "  --host " << kDefaultHost << "\n"
        << "  --port " << kDefaultPort << "\n";
}

unsigned short parse_port(const std::string &value)
{
    char *end = nullptr;
    const long parsed = std::strtol(value.c_str(), &end, 10);
    if (end == value.c_str() || *end != '\0' || parsed < 1 || parsed > 65535) {
        throw std::runtime_error("invalid port: " + value);
    }
    return static_cast<unsigned short>(parsed);
}

Options parse_options(int argc, char **argv)
{
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            options.help = true;
        } else if (arg == "--host") {
            if (++i >= argc) {
                throw std::runtime_error("--host requires a value");
            }
            options.host = argv[i];
        } else if (arg == "--port") {
            if (++i >= argc) {
                throw std::runtime_error("--port requires a value");
            }
            options.port = parse_port(argv[i]);
        } else {
            throw std::runtime_error("unknown argument: " + arg);
        }
    }
    return options;
}

std::string last_winsock_error()
{
    return std::to_string(WSAGetLastError());
}

SocketHandle create_listener(const Options &options)
{
    addrinfo hints {};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_protocol = IPPROTO_TCP;
    hints.ai_flags = AI_PASSIVE;

    addrinfo *resolved = nullptr;
    const std::string port = std::to_string(options.port);
    const int lookup_result =
        getaddrinfo(options.host.c_str(), port.c_str(), &hints, &resolved);
    if (lookup_result != 0) {
        throw std::runtime_error("getaddrinfo failed: " + std::to_string(lookup_result));
    }

    SocketHandle listener;
    for (addrinfo *candidate = resolved; candidate != nullptr; candidate = candidate->ai_next) {
        SocketHandle socket(::socket(candidate->ai_family, candidate->ai_socktype,
                                     candidate->ai_protocol));
        if (!socket.valid()) {
            continue;
        }

        BOOL reuse = TRUE;
        setsockopt(socket.get(), SOL_SOCKET, SO_REUSEADDR,
                   reinterpret_cast<const char *>(&reuse), sizeof(reuse));

        if (bind(socket.get(), candidate->ai_addr,
                 static_cast<int>(candidate->ai_addrlen)) == SOCKET_ERROR) {
            continue;
        }

        if (listen(socket.get(), SOMAXCONN) == SOCKET_ERROR) {
            continue;
        }

        listener = std::move(socket);
        break;
    }

    freeaddrinfo(resolved);

    if (!listener.valid()) {
        throw std::runtime_error("failed to bind listener, WSA error " + last_winsock_error());
    }
    return listener;
}

bool send_all(SOCKET socket, const std::string &data)
{
    size_t total_sent = 0;
    while (total_sent < data.size()) {
        const int sent = send(socket, data.data() + total_sent,
                              static_cast<int>(data.size() - total_sent), 0);
        if (sent == SOCKET_ERROR || sent == 0) {
            return false;
        }
        total_sent += static_cast<size_t>(sent);
    }
    return true;
}

bool send_json_line(SOCKET socket, const json &message)
{
    std::string encoded = message.dump();
    encoded.push_back('\n');
    return send_all(socket, encoded);
}

MaybeInt client_seq(const json &message)
{
    if (message.contains("seq") && message["seq"].is_number_integer()) {
        return MaybeInt(message["seq"].get<int>());
    }
    return MaybeInt();
}

json base_payload()
{
    return {
        { "server", "NetHackServer" },
        { "backend", "NetHack 5.0.0" },
        { "protocol_version", kProtocolVersion },
        { "transport", "ndjson" }
    };
}

json welcome_message(int seq, const std::string &status,
                     const MaybeInt echoed_client_seq = MaybeInt(),
                     const json &client_payload = json::object())
{
    json payload = base_payload();
    payload["status"] = status;
    if (echoed_client_seq.has_value) {
        payload["client_seq"] = echoed_client_seq.value;
    }
    if (client_payload.is_object()) {
        if (client_payload.contains("client")) {
            payload["client"] = client_payload["client"];
        }
        if (client_payload.contains("protocol_version")) {
            payload["client_protocol_version"] = client_payload["protocol_version"];
        }
    }

    return {
        { "type", "session.welcome" },
        { "seq", seq },
        { "payload", payload }
    };
}

json error_message(int seq, const std::string &code, const std::string &text,
                   const MaybeInt echoed_client_seq = MaybeInt())
{
    json payload = {
        { "code", code },
        { "message", text },
        { "recoverable", true }
    };
    if (echoed_client_seq.has_value) {
        payload["client_seq"] = echoed_client_seq.value;
    }

    return {
        { "type", "game.error" },
        { "seq", seq },
        { "payload", payload }
    };
}

bool handle_message(SOCKET client, const std::string &line, int &server_seq)
{
    json parsed;
    try {
        parsed = json::parse(line);
    } catch (const json::parse_error &error) {
        return send_json_line(client, error_message(server_seq++, "invalid_json", error.what()));
    }

    if (!parsed.is_object()) {
        return send_json_line(client, error_message(server_seq++, "invalid_message",
                                                   "message must be a JSON object"));
    }
    if (!parsed.contains("type") || !parsed["type"].is_string()) {
        return send_json_line(client, error_message(server_seq++, "invalid_message",
                                                   "message.type must be a string",
                                                   client_seq(parsed)));
    }

    const std::string type = parsed["type"].get<std::string>();
    if (type == "session.hello") {
        const json payload =
            parsed.contains("payload") && parsed["payload"].is_object()
                ? parsed["payload"]
                : json::object();
        return send_json_line(client, welcome_message(server_seq++, "ready",
                                                      client_seq(parsed), payload));
    }

    return send_json_line(client, error_message(server_seq++, "not_implemented",
                                               "message type is not implemented yet: " + type,
                                               client_seq(parsed)));
}

void handle_client(SocketHandle client)
{
    int server_seq = 1;
    if (!send_json_line(client.get(), welcome_message(server_seq++, "connected"))) {
        std::cerr << "failed to send welcome message\n";
        return;
    }

    std::string buffer;
    char chunk[4096];
    for (;;) {
        const int received = recv(client.get(), chunk, sizeof(chunk), 0);
        if (received == 0) {
            std::cout << "client disconnected\n";
            return;
        }
        if (received == SOCKET_ERROR) {
            std::cerr << "recv failed, WSA error " << last_winsock_error() << "\n";
            return;
        }

        buffer.append(chunk, static_cast<size_t>(received));
        if (buffer.size() > kMaxBufferedLineBytes) {
            send_json_line(client.get(), error_message(server_seq++, "line_too_long",
                                                       "incoming JSON line is too large"));
            return;
        }

        size_t newline = std::string::npos;
        while ((newline = buffer.find('\n')) != std::string::npos) {
            std::string line = buffer.substr(0, newline);
            buffer.erase(0, newline + 1);
            if (!line.empty() && line.back() == '\r') {
                line.pop_back();
            }
            if (line.empty()) {
                continue;
            }
            if (!handle_message(client.get(), line, server_seq)) {
                std::cerr << "send failed, WSA error " << last_winsock_error() << "\n";
                return;
            }
        }
    }
}

} // namespace

int main(int argc, char **argv)
{
    try {
        const Options options = parse_options(argc, argv);
        if (options.help) {
            print_usage();
            return 0;
        }

        WinsockSession winsock;
        SocketHandle listener = create_listener(options);
        std::cout << "NetHackServer listening on " << options.host << ":" << options.port
                  << "\n";

        for (;;) {
            sockaddr_storage remote_addr {};
            int remote_len = sizeof(remote_addr);
            SocketHandle client(accept(listener.get(), reinterpret_cast<sockaddr *>(&remote_addr),
                                       &remote_len));
            if (!client.valid()) {
                std::cerr << "accept failed, WSA error " << last_winsock_error() << "\n";
                continue;
            }
            std::cout << "client connected\n";
            handle_client(std::move(client));
        }
    } catch (const std::exception &error) {
        std::cerr << "NetHackServer error: " << error.what() << "\n";
        return 1;
    }
}
