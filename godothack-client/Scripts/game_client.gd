extends Node
class_name GameClient

# --- Core process settings ---
@export var core_exe_path := ""
@export var core_port := 7777
@export var auto_start_core := true

# --- Reconnect settings ---
@export var retry_interval_ms := 500

var _tcp := StreamPeerTCP.new()
var _buffer := ""
var _core_pid := -1
var _next_retry_ms := 0
var _last_status := -1

func _ready() -> void:
	set_process(true)
	if auto_start_core:
		_start_core()
	_connect_to_core()

func _process(_delta: float) -> void:
	_tcp.poll()
	var status := _tcp.get_status()
	if status != _last_status:
		_last_status = status
		print("[TCPDemo] status=%s" % str(status))

	if status != StreamPeerTCP.STATUS_CONNECTED:
		_try_reconnect()
		return

	var available := _tcp.get_available_bytes()
	if available <= 0:
		return

	_buffer += _tcp.get_utf8_string(available)
	while true:
		var newline := _buffer.find("\n")
		if newline == -1:
			break
		var line := _buffer.substr(0, newline)
		_buffer = _buffer.substr(newline + 1)
		line = line.strip_edges()
		if line.is_empty():
			continue
		print("[TCPDemo] << %s" % line)
		_handle_json_line(line)

# --- Core process ---
func _start_core() -> void:
	if core_exe_path.is_empty():
		push_warning("core_exe_path is empty; core process not started.")
		return
	_core_pid = OS.create_process(core_exe_path, [], true)
	if _core_pid < 0:
		push_error("Failed to start core process.")
		return
	print("[TCPDemo] core started, pid=%s" % str(_core_pid))

# --- TCP connection ---
func _connect_to_core() -> void:
	print("[TCPDemo] connecting to 127.0.0.1:%s" % str(core_port))
	var err := _tcp.connect_to_host("127.0.0.1", core_port)
	if err != OK:
		print("[TCPDemo] connect error=%s" % str(err))
		return

func _try_reconnect() -> void:
	var now := Time.get_ticks_msec()
	if now < _next_retry_ms:
		return
	_next_retry_ms = now + retry_interval_ms
	if _tcp.get_status() == StreamPeerTCP.STATUS_CONNECTING:
		return
	_connect_to_core()

# --- JSON handling ---
func _handle_json_line(line: String) -> void:
	var data = JSON.parse_string(line)
	if typeof(data) != TYPE_DICTIONARY:
		print("[TCPDemo] invalid json")
		return
	print("[TCPDemo] parsed type=%s" % str(data.get("type", "")))
