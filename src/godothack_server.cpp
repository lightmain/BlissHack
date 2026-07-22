#define WIN32_LEAN_AND_MEAN

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include <nlohmann/json.hpp>

#include <cstdlib>
#include <cstdarg>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace {

constexpr const char *kDefaultHost = "127.0.0.1";
constexpr unsigned short kDefaultPort = 7777;
constexpr int kProtocolVersion = 1;
constexpr size_t kMaxBufferedLineBytes = 1024 * 1024;
constexpr int kMapWidth = 80;
constexpr int kMapHeight = 21;

constexpr int kNhWindowMessage = 1;
constexpr int kNhWindowStatus = 2;
constexpr int kNhWindowMap = 3;
constexpr int kNhWindowMenu = 4;
constexpr int kNhWindowText = 5;

struct Options {
    std::string host = kDefaultHost;
    unsigned short port = kDefaultPort;
    bool help = false;
};

struct GlyphInfoPrefix {
    int glyph = 0;
    int ttychar = 0;
};

struct MapCell {
    int x = 0;
    int y = 0;
    int glyph = 0;
    int ttychar = 0;
};

extern "C" {
typedef void (*GodotHackShimCallback)(const char *, void *, const char *, ...);

void godothack_core_run(GodotHackShimCallback, int, char **);
void godothack_core_mark_window_inited(void);
void godothack_core_player_setup(void);
const char *godothack_core_status_field_name(int);
const char *godothack_core_status_value_to_string(int, void *, char *, int);
}

SOCKET g_game_socket = INVALID_SOCKET;
int g_next_window_id = 1;
int g_server_seq = 1;
bool g_game_started_sent = false;
std::string g_program_path;
std::map<int, int> g_window_types;
std::map<int, MapCell> g_map_cells;

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

std::string configure_runtime_directory()
{
    std::vector<char> path_buffer(32768, '\0');
    const DWORD length = GetModuleFileNameA(nullptr, path_buffer.data(),
                                            static_cast<DWORD>(path_buffer.size()));
    if (length == 0 || length >= path_buffer.size()) {
        throw std::runtime_error("failed to resolve NetHackServer executable path");
    }

    const std::string executable(path_buffer.data(), length);
    const size_t separator = executable.find_last_of("\\/");
    if (separator == std::string::npos) {
        throw std::runtime_error("failed to resolve NetHackServer runtime directory");
    }

    const std::string directory = executable.substr(0, separator);
    if (!SetCurrentDirectoryA(directory.c_str())) {
        throw std::runtime_error("failed to enter NetHackServer runtime directory");
    }
    return executable;
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

bool send_game_json(const json &message)
{
    if (g_game_socket == INVALID_SOCKET) {
        return false;
    }
    return send_json_line(g_game_socket, message);
}

json protocol_message(const std::string &type, json payload)
{
    return {
        { "type", type },
        { "seq", g_server_seq++ },
        { "payload", std::move(payload) }
    };
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

std::string read_socket_line(SOCKET socket)
{
    std::string line;
    char ch = '\0';
    for (;;) {
        const int received = recv(socket, &ch, 1, 0);
        if (received == 0) {
            throw std::runtime_error("client disconnected");
        }
        if (received == SOCKET_ERROR) {
            throw std::runtime_error("recv failed, WSA error " + last_winsock_error());
        }
        if (ch == '\n') {
            if (!line.empty() && line.back() == '\r') {
                line.pop_back();
            }
            return line;
        }
        line.push_back(ch);
        if (line.size() > kMaxBufferedLineBytes) {
            throw std::runtime_error("incoming JSON line is too large");
        }
    }
}

int key_for_direction(const std::string &direction)
{
    if (direction == "west") return 'h';
    if (direction == "south") return 'j';
    if (direction == "north") return 'k';
    if (direction == "east") return 'l';
    if (direction == "southwest") return 'b';
    if (direction == "southeast") return 'n';
    if (direction == "northwest") return 'y';
    if (direction == "northeast") return 'u';
    return 0;
}

int read_command_key()
{
    for (;;) {
        const std::string line = read_socket_line(g_game_socket);
        if (line.empty()) {
            continue;
        }

        json message;
        try {
            message = json::parse(line);
        } catch (const json::parse_error &error) {
            send_game_json(protocol_message("game.error", {
                { "code", "invalid_json" },
                { "message", error.what() },
                { "recoverable", true }
            }));
            continue;
        }

        if (!message.is_object() || !message.contains("type")
            || !message["type"].is_string()) {
            send_game_json(protocol_message("game.error", {
                { "code", "invalid_message" },
                { "message", "message.type must be a string" },
                { "recoverable", true }
            }));
            continue;
        }

        const std::string type = message["type"].get<std::string>();
        const json payload = message.contains("payload") && message["payload"].is_object()
                                 ? message["payload"]
                                 : json::object();

        if (type == "command.move" && payload.contains("direction")
            && payload["direction"].is_string()) {
            const std::string direction = payload["direction"].get<std::string>();
            const int key = key_for_direction(direction);
            if (key) {
                send_game_json(protocol_message("command.accepted", {
                    { "command", type },
                    { "direction", direction }
                }));
                return key;
            }
        } else if (type == "command.key" && payload.contains("key")
                   && payload["key"].is_string()) {
            const std::string key = payload["key"].get<std::string>();
            if (!key.empty()) {
                send_game_json(protocol_message("command.accepted", {
                    { "command", type },
                    { "key", key.substr(0, 1) }
                }));
                return static_cast<unsigned char>(key[0]);
            }
        }

        send_game_json(protocol_message("game.error", {
            { "code", "unsupported_command" },
            { "message", "expected command.move or command.key while game is waiting for input" },
            { "recoverable", true }
        }));
    }
}

void maybe_send_game_started()
{
    if (g_game_started_sent) {
        return;
    }
    g_game_started_sent = true;
    send_game_json(protocol_message("game.started", {
        { "backend", "NetHack 5.0.0" }
    }));
}

void send_map_snapshot()
{
    maybe_send_game_started();

    json cells = json::array();
    for (const auto &entry : g_map_cells) {
        const MapCell &cell = entry.second;
        json encoded = {
            { "x", cell.x },
            { "y", cell.y },
            { "glyph", cell.glyph },
            { "ttychar", cell.ttychar }
        };
        if (cell.ttychar >= 32 && cell.ttychar <= 126) {
            encoded["char"] = std::string(1, static_cast<char>(cell.ttychar));
        }
        cells.push_back(std::move(encoded));
    }

    send_game_json(protocol_message("view.map", {
        { "width", kMapWidth },
        { "height", kMapHeight },
        { "cells", std::move(cells) }
    }));
}

void set_int_return(void *ret_ptr, int value)
{
    if (ret_ptr) {
        *static_cast<int *>(ret_ptr) = value;
    }
}

void set_char_return(void *ret_ptr, int value)
{
    if (ret_ptr) {
        *static_cast<char *>(ret_ptr) = static_cast<char>(value);
    }
}

void set_boolean_return(void *ret_ptr, bool value)
{
    if (ret_ptr) {
        *static_cast<unsigned char *>(ret_ptr) = value ? 1 : 0;
    }
}

void set_pointer_return(void *ret_ptr, void *value)
{
    if (ret_ptr) {
        *static_cast<void **>(ret_ptr) = value;
    }
}

void godothack_window_callback(const char *name, void *ret_ptr, const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);

    const std::string callback = name ? name : "";

    if (callback == "shim_init_nhwindows") {
        (void) va_arg(args, void *);
        (void) va_arg(args, void *);
        godothack_core_mark_window_inited();
    } else if (callback == "shim_player_selection") {
        godothack_core_player_setup();
    } else if (callback == "shim_create_nhwindow") {
        const int window_type = va_arg(args, int);
        const int window_id = g_next_window_id++;
        g_window_types[window_id] = window_type;
        set_int_return(ret_ptr, window_id);
    } else if (callback == "shim_destroy_nhwindow") {
        const int window_id = va_arg(args, int);
        g_window_types.erase(window_id);
    } else if (callback == "shim_putstr") {
        const int window_id = va_arg(args, int);
        const int attr = va_arg(args, int);
        const char *text = va_arg(args, const char *);
        const int window_type = g_window_types.count(window_id) ? g_window_types[window_id] : 0;
        if (text && (window_type == kNhWindowMessage || window_id == kNhWindowMessage)) {
            maybe_send_game_started();
            send_game_json(protocol_message("view.messages", {
                { "messages", json::array({ text }) },
                { "attr", attr }
            }));
        } else if (text && window_type == kNhWindowText) {
            send_game_json(protocol_message("view.text", {
                { "text", text },
                { "attr", attr }
            }));
        }
    } else if (callback == "shim_raw_print" || callback == "shim_raw_print_bold") {
        const char *text = va_arg(args, const char *);
        if (text) {
            send_game_json(protocol_message("view.messages", {
                { "messages", json::array({ text }) },
                { "raw", true }
            }));
        }
    } else if (callback == "shim_print_glyph") {
        const int window_id = va_arg(args, int);
        const int x = va_arg(args, int);
        const int y = va_arg(args, int);
        const auto *glyph = va_arg(args, const GlyphInfoPrefix *);
        (void) va_arg(args, const void *);
        const int window_type = g_window_types.count(window_id) ? g_window_types[window_id] : 0;
        if (glyph && (window_type == kNhWindowMap || window_id == kNhWindowMap)) {
            MapCell cell;
            cell.x = x;
            cell.y = y;
            cell.glyph = glyph->glyph;
            cell.ttychar = glyph->ttychar;
            g_map_cells[y * kMapWidth + x] = cell;
        }
    } else if (callback == "shim_display_nhwindow") {
        const int window_id = va_arg(args, int);
        (void) va_arg(args, int);
        const int window_type = g_window_types.count(window_id) ? g_window_types[window_id] : 0;
        if (window_type == kNhWindowMap || window_id == kNhWindowMap) {
            send_map_snapshot();
        }
    } else if (callback == "shim_mark_synch" || callback == "shim_wait_synch") {
        if (!g_map_cells.empty()) {
            send_map_snapshot();
        }
    } else if (callback == "shim_status_enablefield") {
        const int field = va_arg(args, int);
        const char *name_arg = va_arg(args, const char *);
        const char *format = va_arg(args, const char *);
        const int enabled = va_arg(args, int);
        send_game_json(protocol_message("view.status_field", {
            { "field", field },
            { "name", name_arg ? name_arg : "" },
            { "format", format ? format : "" },
            { "enabled", enabled != 0 }
        }));
    } else if (callback == "shim_status_update") {
        const int field = va_arg(args, int);
        void *value = va_arg(args, void *);
        const int changed = va_arg(args, int);
        const int percent = va_arg(args, int);
        const int color = va_arg(args, int);
        (void) va_arg(args, void *);
        char value_buffer[256];
        const char *field_name = godothack_core_status_field_name(field);
        const char *field_value =
            godothack_core_status_value_to_string(field, value, value_buffer,
                                                  sizeof value_buffer);
        send_game_json(protocol_message("view.player", {
            { "field", field },
            { "name", field_name ? field_name : "" },
            { "value", field_value ? field_value : "" },
            { "changed", changed },
            { "percent", percent },
            { "color", color }
        }));
    } else if (callback == "shim_nhgetch") {
        send_game_json(protocol_message("prompt.command", {
            { "input", "key" }
        }));
        try {
            set_int_return(ret_ptr, read_command_key());
        } catch (const std::exception &) {
            set_int_return(ret_ptr, 27);
        }
    } else if (callback == "shim_nh_poskey") {
        (void) va_arg(args, void *);
        (void) va_arg(args, void *);
        (void) va_arg(args, void *);
        send_game_json(protocol_message("prompt.command", {
            { "input", "position-or-key" }
        }));
        try {
            set_int_return(ret_ptr, read_command_key());
        } catch (const std::exception &) {
            set_int_return(ret_ptr, 27);
        }
    } else if (callback == "shim_yn_function") {
        const char *query = va_arg(args, const char *);
        const char *choices = va_arg(args, const char *);
        const int default_choice = va_arg(args, int);
        send_game_json(protocol_message("prompt.yn", {
            { "question", query ? query : "" },
            { "choices", choices ? choices : "" },
            { "default", default_choice ? std::string(1, static_cast<char>(default_choice)) : "" }
        }));
        set_char_return(ret_ptr, default_choice ? default_choice
                                                : (choices && choices[0] ? choices[0] : 'n'));
    } else if (callback == "shim_getlin") {
        const char *query = va_arg(args, const char *);
        char *buffer = va_arg(args, char *);
        send_game_json(protocol_message("prompt.text", {
            { "question", query ? query : "" }
        }));
        if (buffer) {
            std::strcpy(buffer, "GodotHack");
        }
    } else if (callback == "shim_select_menu") {
        (void) va_arg(args, int);
        (void) va_arg(args, int);
        (void) va_arg(args, void *);
        set_int_return(ret_ptr, 0);
    } else if (callback == "shim_message_menu") {
        (void) va_arg(args, int);
        (void) va_arg(args, int);
        const char *message = va_arg(args, const char *);
        if (message) {
            send_game_json(protocol_message("view.messages", {
                { "messages", json::array({ message }) }
            }));
        }
        set_char_return(ret_ptr, 0);
    } else if (callback == "shim_doprev_message"
               || callback == "shim_get_ext_cmd") {
        set_int_return(ret_ptr, 0);
    } else if (callback == "shim_player_selection_or_tty") {
        set_boolean_return(ret_ptr, true);
    } else if (callback == "shim_getmsghistory"
               || callback == "shim_ctrl_nhwindow") {
        set_pointer_return(ret_ptr, nullptr);
    }

    va_end(args);
}

void reset_game_state(SOCKET socket)
{
    g_game_socket = socket;
    g_next_window_id = 1;
    g_game_started_sent = false;
    g_window_types.clear();
    g_map_cells.clear();
}

void run_nethack_game(SOCKET socket)
{
    reset_game_state(socket);

    const std::string player_name =
        "-uGodotHack" + std::to_string(GetCurrentProcessId()) + "-"
        + std::to_string(GetTickCount64());

    std::vector<std::string> args = {
        g_program_path.empty() ? std::string("NetHackServer.exe") : g_program_path,
        "-wshim",
        "-@",
        player_name
    };
    std::vector<char *> argv;
    argv.reserve(args.size());
    for (std::string &arg : args) {
        argv.push_back(&arg[0]);
    }

    godothack_core_run(godothack_window_callback, static_cast<int>(argv.size()),
                       argv.data());
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

    if (type == "game.start") {
        g_server_seq = server_seq;
        send_json_line(client, protocol_message("game.starting", {
            { "backend", "NetHack 5.0.0" }
        }));
        run_nethack_game(client);
        return false;
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
        g_program_path = configure_runtime_directory();

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
