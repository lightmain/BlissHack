#include <cstdlib>
#include <iostream>
#include <string>

namespace {

constexpr const char *kDefaultHost = "127.0.0.1";
constexpr int kDefaultPort = 7777;

#if defined(GODOTHACK_TEST_CORE)
constexpr const char *kCoreKind = "test";
#else
constexpr const char *kCoreKind = "nethack";
#endif

struct ServerOptions {
    std::string host = kDefaultHost;
    int port = kDefaultPort;
};

void print_usage(const char *program)
{
    std::cout << "Usage: " << program
              << " [--host <address>] [--port <1-65535>] [--help]\n"
              << "Core kind: " << kCoreKind << "\n"
              << "Default host: " << kDefaultHost << "\n"
              << "Default port: " << kDefaultPort << "\n";
}

bool parse_port(const char *value, int &port)
{
    char *end = nullptr;
    const long parsed = std::strtol(value, &end, 10);
    if (!value[0] || !end || *end != '\0' || parsed < 1 || parsed > 65535)
        return false;
    port = static_cast<int>(parsed);
    return true;
}

bool parse_options(int argc, char **argv, ServerOptions &options)
{
    for (int i = 1; i < argc; ++i) {
        const std::string argument = argv[i];
        if (argument == "--help") {
            print_usage(argv[0]);
            std::exit(0);
        }
        if (argument == "--host") {
            if (++i >= argc || !argv[i][0]) {
                std::cerr << "--host requires a non-empty address.\n";
                return false;
            }
            options.host = argv[i];
            continue;
        }
        if (argument == "--port") {
            if (++i >= argc || !parse_port(argv[i], options.port)) {
                std::cerr << "--port requires an integer from 1 to 65535.\n";
                return false;
            }
            continue;
        }
        std::cerr << "Unknown argument: " << argument << "\n";
        return false;
    }
    return true;
}

} // namespace

int main(int argc, char **argv)
{
    ServerOptions options;
    if (!parse_options(argc, argv, options)) {
        print_usage(argv[0]);
        return 64;
    }

    std::cout << "GodotHack server bootstrap\n"
              << "core_kind=" << kCoreKind << "\n"
              << "host=" << options.host << "\n"
              << "port=" << options.port << "\n";
    std::cerr << "Server runtime is not implemented in stage 0.\n";
    return 2;
}
