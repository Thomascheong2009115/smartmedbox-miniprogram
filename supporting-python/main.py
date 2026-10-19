# AI 辅助生成的项目代码；版本与个人参与说明见 README.md。
# Project: SmartMedBox - K10 Edge Node (Production Logic + Classic UI)

import time
import gc
import sys
import ubinascii
import select
import os
from unihiker_k10 import screen, button, speaker, temp_humi, rgb, servo

# Try to import Camera, handle error if missing
try:
    from k10_base import Camera
except ImportError:
    print("Warning: k10_base not found. Camera will be simulated or disabled.")
    Camera = None

# --- Configuration & Constants ---
# Colors
C_BLACK = 0x0000; C_WHITE = 0xFFFF; C_RED = 0xF800
C_YELLOW = 0xFFE0; C_BLUE = 0x001F; C_ORANGE = 0xFC00
C_CYAN = 0x07FF;  C_GRAY = 0x8410;  C_GREEN = 0x07E0

# Thresholds
MAX_TEMP = 35.0
MAX_HUMI = 75.0
CHECK_INTERVAL = 5000  # 5 seconds
TEMP_OFFSET = 9.9      # Calibration offset
HEARTBEAT_TIMEOUT = 8000 # 8 seconds for connection timeout
ENABLE_RAW_SERIAL_LOG = False  # 比赛稳定版：默认不输出裸日志到串口

# Servo Configuration
SERVO_OPEN_ANGLE = 160
SERVO_CLOSE_ANGLE = 10

# States (比赛版最小闭环状态机 + 兼容子状态)
STATE_BOOTING = 0
STATE_SELF_TEST = 1
STATE_IDLE = 2
STATE_CAPTURING = 3
STATE_MED_ALARM = 4
STATE_ENV_ALARM = 5
STATE_UPLOADING_WAIT = 6
STATE_ERROR = 7
STATE_ALARM = STATE_MED_ALARM

# Alarm cause is tracked separately to avoid state explosion
ALARM_CAUSE_NONE = "NONE"
ALARM_CAUSE_MED = "MED"
ALARM_CAUSE_ENV = "ENV"

# --- Global Variables ---
current_state = STATE_BOOTING
current_temp = 0.0
current_humi = 0.0
last_check_time = 0
last_alarm_tick = 0
camera_instance = None
poll_obj = None
alarm_cause = ALARM_CAUSE_NONE
env_alarm_reason = ""
upload_wait_since = 0

# Servo Globals
servos = [None, None, None] # Servo objects for ID 1, 2, 3
servo_status = [False, False, False] # Init status
servo_positions = ["未知", "未知", "未知"]

# Connection & Error Status
m10_connected = False
m10_last_seen = 0
sensor_error_count = 0

# Hardware Objects
bt_a = button(button.a)
bt_b = button(button.b)

# --- Helper Functions ---

def flush_stdout():
    """Flush stdout with minimal diagnostics"""
    try:
        sys.stdout.flush()
        return True
    except Exception:
        return False

def log_error(msg):
    """Log error; avoid protocol pollution on serial by default."""
    if not ENABLE_RAW_SERIAL_LOG:
        return
    try:
        safe_msg = str(msg).replace("\n", " ")[:120]
        sys.stdout.write(f"<<<LOG:ERROR:{safe_msg}>>>\n")
        flush_stdout()
    except Exception:
        pass

def _remove_file_if_exists(path):
    """Delete file if present; ignore ENOENT, raise on real filesystem errors."""
    try:
        os.remove(path)
    except OSError as e:
        err_no = getattr(e, "errno", None)
        if err_no == 2:
            return
        if len(getattr(e, "args", ())) > 0 and e.args[0] == 2:
            return
        raise

def send_ack(cmd_type):
    """Send ACK to M10"""
    sys.stdout.write(f"<<<ACK:{cmd_type}>>>\n")
    flush_stdout()

def send_err(err_type):
    """Send ERR to M10"""
    sys.stdout.write(f"<<<ERR:{err_type}>>>\n")
    flush_stdout()

def update_connection_status():
    """Update connection status on valid command"""
    global m10_connected, m10_last_seen
    if not m10_connected:
        m10_connected = True
        # If we just connected and in IDLE, refresh UI
        if current_state == STATE_IDLE:
            draw_ui(STATE_IDLE)
    m10_last_seen = time.ticks_ms()

def calc_center_x(text, font_size):
    """Calculate x coordinate for centered text (approximate)"""
    length = 0
    for char in text:
        if ord(char) < 128: length += 0.5
        else: length += 1.0

    pixel_width = int(length * font_size)
    x = int((240 - pixel_width) / 2)
    return max(0, x)

def draw_center_text(text, y, font_size, color):
    """Draw centered text helper"""
    x = calc_center_x(text, font_size)
    screen.draw_text(text=text, x=x, y=y, font_size=font_size, color=color)

def clamp_angle(angle):
    """Restrict servo angle to 0-180"""
    if angle < 0: return 0
    if angle > 180: return 180
    return angle

def set_servo_angle(servo_id, angle):
    """Safely set servo angle (1-based ID)"""
    idx = servo_id - 1
    if idx < 0 or idx >= 3:
        log_error(f"Invalid Servo ID: {servo_id}")
        return False

    if not servo_status[idx] or not servos[idx]:
        log_error(f"Servo {servo_id} not ready")
        return False

    try:
        safe_angle = clamp_angle(angle)
        # Use value=... syntax
        servos[idx].angle(value=safe_angle)
        return True
    except Exception as e:
        log_error(f"Servo {servo_id} move failed: {e}")
        return False

def open_servo_slot(servo_id):
    """Open a medication slot"""
    if set_servo_angle(servo_id, SERVO_OPEN_ANGLE):
        servo_positions[servo_id-1] = "开"
        # NO UI REFRESH HERE
        return True
    return False

def close_servo_slot(servo_id):
    """Close a medication slot"""
    if set_servo_angle(servo_id, SERVO_CLOSE_ANGLE):
        servo_positions[servo_id-1] = "关"
        # NO UI REFRESH HERE
        return True
    return False

def test_all_servos():
    """Test all servos sequentially"""
    try:
        for i in range(1, 4):
            open_servo_slot(i)
            time.sleep(0.2)
            close_servo_slot(i)
            time.sleep(0.1)
    except Exception as e:
        log_error(f"Servo Test Failed: {e}")

def draw_ui(state, **kwargs):
    """Unified UI drawer based on state"""
    try:
        if state == STATE_SELF_TEST:
            screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK)
            draw_center_text("系统自检中...", 140, 24, C_WHITE)

        elif state == STATE_IDLE:
            # === Classic UI Layout (Restored from return.py) ===
            screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK)

            # Header
            screen.draw_text(text="系 统 监 控 中", x=75, y=5, font_size=16, color=C_GRAY)

            # Sensor Data (Color changed from CYAN to WHITE for visibility)
            screen.draw_text(text=f"温度: {current_temp}℃ | 湿度: {current_humi}%", x=10, y=30, font_size=16, color=C_WHITE)

            # Classic Icon
            screen.draw_rect(x=65, y=90, w=110, h=10, bcolor=C_GRAY, fcolor=C_WHITE)
            screen.draw_rect(x=70, y=100, w=100, h=70, bcolor=C_WHITE, fcolor=C_WHITE)
            screen.draw_rect(x=115, y=120, w=10, h=30, bcolor=C_RED, fcolor=C_RED)
            screen.draw_rect(x=105, y=130, w=30, h=10, bcolor=C_RED, fcolor=C_RED)

            # Title
            screen.draw_text(text="智 能 药 箱", x=60, y=190, font_size=24, color=C_WHITE)
            screen.draw_text(text="SmartMedBox", x=75, y=225, font_size=23, color=C_GRAY)

            # Connection Status (Integrated into classic layout)
            if m10_connected:
                draw_center_text("M10 已连接", 250, 16, C_GREEN)
            else:
                draw_center_text("M10 未连接", 250, 16, C_RED)

            # Footer (Classic Box Style)
            screen.draw_rect(x=10, y=270, w=220, h=40, bcolor=C_WHITE, fcolor=C_BLACK)
            screen.draw_text(text="[A] 刷新 | [B] 拍照", x=40, y=280, font_size=16, color=C_GREEN)

        elif state == STATE_ENV_ALARM:
            screen.draw_rect(0, 0, 240, 320, C_YELLOW, C_YELLOW)
            screen.draw_text(text="环境异常报警", x=50, y=40, font_size=24, color=C_BLACK)

            reason = kwargs.get("reason", "UNKNOWN")
            y_pos = 100
            both_abnormal = ("TEMP" in reason and "HUMI" in reason)

            if both_abnormal:
                draw_center_text("温湿度异常", y_pos, 28, C_RED)
                y_pos += 50
                draw_center_text(f"温度 {current_temp}℃ / 阈值 {MAX_TEMP}℃", y_pos, 16, C_WHITE)
                y_pos += 26
                draw_center_text(f"湿度 {current_humi}% / 阈值 {MAX_HUMI}%", y_pos, 16, C_GRAY)

            elif "TEMP" in reason:
                draw_center_text("温度过高", y_pos, 28, C_RED)
                y_pos += 60
                draw_center_text(f"当前 {current_temp}℃", y_pos, 18, C_WHITE)
                y_pos += 30
                draw_center_text(f"阈值 {MAX_TEMP}℃", y_pos, 18, C_GRAY)

            elif "HUMI" in reason:
                draw_center_text("湿度过高", y_pos, 28, C_RED)
                y_pos += 60
                draw_center_text(f"当前 {current_humi}%", y_pos, 18, C_WHITE)
                y_pos += 30
                draw_center_text(f"阈值 {MAX_HUMI}%", y_pos, 18, C_GRAY)

        elif state == STATE_MED_ALARM:
            screen.draw_rect(0, 0, 240, 320, C_RED, C_RED)
            screen.draw_text(text="服药提醒", x=70, y=50, font_size=24, color=C_WHITE)
            screen.draw_text(text="请及时取药", x=40, y=120, font_size=30, color=C_WHITE)
            screen.draw_text(text="按任意键停止", x=70, y=220, font_size=16, color=C_WHITE)

        elif state == STATE_CAPTURING:
            screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK)
            draw_center_text("正在拍照", 140, 24, C_WHITE)

        elif state == STATE_UPLOADING_WAIT:
            screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK)
            draw_center_text("正在确认本次药物是否已取走", 120, 20, C_WHITE)
            draw_center_text("请稍候...", 160, 18, C_GRAY)

        elif state == STATE_ERROR:
            screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK)
            # Top Bar
            screen.draw_rect(0, 0, 240, 50, C_RED, C_RED)
            draw_center_text("系统异常", 15, 20, C_WHITE)

            err_msg = kwargs.get("msg", "未知错误")
            draw_center_text(err_msg, 120, 18, C_WHITE)

            draw_center_text("按 A/B 重试", 260, 16, C_GRAY)

        screen.show_draw()
    except Exception as e:
        log_error(f"UI Draw Failed: {e}")

def draw_progress(current, total):
    """Draw progress bar for image sending - Minimalist"""
    try:
        pct = int(current / total * 100) if total > 0 else 0
        if pct > 100: pct = 100

        screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK) # Refresh bg

        draw_center_text("正在上传图像", 80, 18, C_WHITE)

        # Simple thin bar centered
        bar_w = 160
        bar_h = 12
        bar_x = 40
        bar_y = 140
        screen.draw_rect(bar_x, bar_y, bar_w, bar_h, 0x4208, 0x4208) # Dark Gray bg
        if (fill_w := int(bar_w * pct / 100)) > 0:
            screen.draw_rect(bar_x, bar_y, fill_w, bar_h, C_GREEN, C_GREEN)

        # Percentage text
        draw_center_text(f"{pct}%", 170, 18, C_WHITE)

        screen.show_draw()
    except Exception as e:
        log_error(f"Progress Draw Failed: {e}")

# --- Core Logic Functions ---

def init_hardware():
    """Startup self-check and initialization"""
    global camera_instance, poll_obj, current_temp, current_humi, current_state
    current_state = STATE_SELF_TEST

    screen.init(dir=2); screen.clear()
    draw_center_text("开机自检报告", 18, 18, C_WHITE)
    screen.show_draw()
    time.sleep(0.5)

    y_pos = 56
    x_label = 30
    x_status = 160
    success = True

    # Check Camera
    screen.draw_text(text="摄像头", x=x_label, y=y_pos, font_size=16, color=C_WHITE)
    try:
        if Camera:
            camera_instance = Camera()
            camera_instance.init()
            screen.draw_text(text="正常", x=x_status, y=y_pos, font_size=16, color=C_GREEN)
        else:
            screen.draw_text(text="缺失", x=x_status, y=y_pos, font_size=16, color=C_YELLOW)
    except Exception as e:
        log_error(f"Camera Init Failed: {e}")
        screen.draw_text(text="异常", x=x_status, y=y_pos, font_size=16, color=C_RED)
        send_err("CAMERA_INIT_FAIL")
        success = False
    y_pos += 30

    # Check Speaker
    screen.draw_text(text="扬声器", x=x_label, y=y_pos, font_size=16, color=C_WHITE)
    try:
        speaker.reinit()
        speaker.play_tone(1000, 100) # Short beep
        screen.draw_text(text="正常", x=x_status, y=y_pos, font_size=16, color=C_GREEN)
    except Exception as e:
        log_error(f"Speaker Init Failed: {e}")
        screen.draw_text(text="异常", x=x_status, y=y_pos, font_size=16, color=C_RED)
        send_err("SPEAKER_INIT_FAIL")
    y_pos += 30

    # Check Sensors
    screen.draw_text(text="传感器", x=x_label, y=y_pos, font_size=16, color=C_WHITE)
    try:
        raw_temp = temp_humi.read_temp()
        raw_humi = temp_humi.read_humi()
        current_temp = round(raw_temp - TEMP_OFFSET, 1)
        current_humi = round(raw_humi, 1)
        screen.draw_text(text="正常", x=x_status, y=y_pos, font_size=16, color=C_GREEN)
    except Exception as e:
        log_error(f"Sensor Read Failed: {e}")
        screen.draw_text(text="异常", x=x_status, y=y_pos, font_size=16, color=C_RED)
        send_err("SENSOR_FAIL")
        success = False
    y_pos += 30

    # Check Servos
    screen.draw_text(text="舵机", x=x_label, y=y_pos, font_size=16, color=C_WHITE)
    servo_ok = True
    for i in range(1, 4):
        try:
            s = servo(i)
            servos[i-1] = s
            servo_status[i-1] = True
            set_servo_angle(i, SERVO_CLOSE_ANGLE)
            servo_positions[i-1] = "关"
        except Exception as e:
            log_error(f"Servo {i} Init Failed: {e}")
            servo_status[i-1] = False
            servo_ok = False

    if servo_ok:
        screen.draw_text(text="正常", x=x_status, y=y_pos, font_size=16, color=C_GREEN)
    else:
        screen.draw_text(text="异常", x=x_status, y=y_pos, font_size=16, color=C_YELLOW)
    y_pos += 30

    # Setup Serial Poll
    screen.draw_text(text="串口", x=x_label, y=y_pos, font_size=16, color=C_WHITE)
    try:
        poll_obj = select.poll()
        poll_obj.register(sys.stdin, select.POLLIN)
        screen.draw_text(text="正常", x=x_status, y=y_pos, font_size=16, color=C_GREEN)
    except Exception as e:
        log_error(f"Serial Init Failed: {e}")
        screen.draw_text(text="异常", x=x_status, y=y_pos, font_size=16, color=C_RED)
        success = False

    screen.show_draw()
    time.sleep(2) # Let user see the result
    return success

def freeze_and_send(trigger_source="m10"):
    """Capture image and send via serial"""
    global current_state, upload_wait_since

    # Protocol: ACK Receipt immediately
    send_ack("TAKE_PIC")

    if not camera_instance:
        send_err("NO_CAMERA")
        return

    prev_state = current_state
    current_state = STATE_CAPTURING
    draw_ui(STATE_CAPTURING)

    try:
        gc.collect()
        # Warmup
        for _ in range(3):
            camera_instance.camera_capture()
            time.sleep(0.1)

        raw_ref = camera_instance.camera_capture()
        if not raw_ref:
            send_err("CAPTURE_FAIL")
            current_state = prev_state
            draw_ui(current_state)
            return

        img_base64 = ubinascii.b2a_base64(bytes(raw_ref))
        total_len = len(img_base64)
        raw_ref = None; gc.collect()

        # Protocol: START
        sys.stdout.write(f"<<<START:{total_len}>>>\n")
        flush_stdout()

        chunk_size = 1024
        offset = 0
        draw_progress(0, total_len)

        while offset < total_len:
            end = min(offset + chunk_size, total_len)
            chunk = img_base64[offset : end]
            sys.stdout.write(chunk.decode('utf-8'))
            flush_stdout() # Ensure sent
            time.sleep(0.015)
            offset = end
            if offset % 10240 == 0 or offset == total_len:
                draw_progress(offset, total_len)

        time.sleep(0.1)
        sys.stdout.write("\n<<<END>>>\n")
        flush_stdout()

        img_base64 = None; gc.collect()

    except Exception as e:
        log_error(f"Send Image Failed: {e}")
        send_err("SEND_FAIL")

    # Enter upload-wait state for remote-triggered captures, then fall back automatically.
    if trigger_source == "m10":
        current_state = STATE_UPLOADING_WAIT
        upload_wait_since = time.ticks_ms()
        draw_ui(STATE_UPLOADING_WAIT)
    else:
        current_state = prev_state
        draw_ui(current_state)

def receive_audio(filename, play_now=False):
    """Receive audio file from M10"""
    try:
        try:
            _remove_file_if_exists(filename)
        except Exception as e:
            log_error(f"Del file failed: {e}")
            send_err("FILE_OP_FAIL")

        start_wait = time.ticks_ms()
        with open(filename, "wb") as f:
            while True:
                # Timeout 15s
                if time.ticks_diff(time.ticks_ms(), start_wait) > 15000:
                    send_err("AUDIO_RECV_TIMEOUT")
                    break

                if poll_obj.poll(100):
                    line = sys.stdin.readline().strip()
                    if line.endswith("END>>>"):
                        send_ack("AUDIO_RECV")
                        break
                    elif line == "<<<REPLY_FAIL>>>":
                        break
                    elif line:
                        try:
                            f.write(ubinascii.a2b_base64(line))
                            start_wait = time.ticks_ms()
                        except ValueError as e:
                            log_error(f"Audio chunk decode failed: {e}")
                            send_err("AUDIO_CHUNK_DECODE_FAIL")
                            break

        if play_now and filename in os.listdir():
             try:
                 speaker.play_sys_music(filename)
             except Exception as e:
                 log_error(f"Play Audio Failed: {e}")

    except Exception as e:
        log_error(f"Receive Audio Failed: {e}")
        send_err("AUDIO_RECV_ERROR")

def check_sensors():
    """Read sensors and update state if alarm needed"""
    global current_temp, current_humi, current_state, env_alarm_reason, sensor_error_count, alarm_cause

    try:
        # Read with offset correction
        raw_t = temp_humi.read_temp()
        raw_h = temp_humi.read_humi()

        current_temp = round(raw_t - TEMP_OFFSET, 1)
        current_humi = round(raw_h, 1)

        # Reset error count on success
        sensor_error_count = 0

        # Only check alarm if we are not already in a higher priority state (like MED_ALARM)
        # or if we are already in ENV_ALARM (to update it)
        # or if we are in IDLE
        if current_state in [STATE_IDLE, STATE_ENV_ALARM]:
            reasons = []
            if current_temp > MAX_TEMP: reasons.append("TEMP")
            if current_humi > MAX_HUMI: reasons.append("HUMI")

            if reasons:
                env_alarm_reason = "+".join(reasons)
                if current_state != STATE_ENV_ALARM:
                    current_state = STATE_ENV_ALARM
                    alarm_cause = ALARM_CAUSE_ENV
                    draw_ui(STATE_ENV_ALARM, reason=env_alarm_reason)
            else:
                if current_state == STATE_ENV_ALARM:
                    current_state = STATE_IDLE
                    alarm_cause = ALARM_CAUSE_NONE
                    draw_ui(STATE_IDLE)
    except Exception as e:
        sensor_error_count += 1
        log_error(f"Sensor Check Failed ({sensor_error_count}): {e}")
        if sensor_error_count >= 3:
            current_state = STATE_ERROR
            alarm_cause = ALARM_CAUSE_NONE
            send_err("SENSOR_FAIL")
            draw_ui(STATE_ERROR, msg="传感器连续异常")

def handle_input():
    """Check serial input"""
    global current_state, alarm_cause

    if poll_obj and poll_obj.poll(0):
        try:
            line = sys.stdin.readline().strip()
            if not line: return

            # Only update connection status on VALID commands

            if line == "<<<CMD:ALARM_MED>>>":
                update_connection_status()
                current_state = STATE_MED_ALARM
                alarm_cause = ALARM_CAUSE_MED
                send_ack("ALARM_MED")
                draw_ui(STATE_MED_ALARM)

            elif line == "<<<CMD:TAKE_PIC>>>":
                update_connection_status()
                freeze_and_send(trigger_source="m10")

            elif line == "<<<REPLY_START>>>":
                update_connection_status()
                receive_audio("reply.wav", play_now=True)

            elif line == "<<<ALARM_AUDIO_START>>>":
                update_connection_status()
                receive_audio("alarm.wav", play_now=False)

            elif line == "<<<CMD:STOP_ALARM>>>":
                update_connection_status()
                if current_state in [STATE_MED_ALARM, STATE_ENV_ALARM]:
                    current_state = STATE_IDLE
                    alarm_cause = ALARM_CAUSE_NONE
                    rgb.clear()
                    try:
                        _remove_file_if_exists("alarm.wav")
                    except Exception as e:
                        log_error(f"Del alarm failed: {e}")
                        send_err("FILE_OP_FAIL")
                    draw_ui(STATE_IDLE)
                    send_ack("STOP_ALARM")

            elif line.startswith("<<<CMD:SERVO_OPEN:"):
                update_connection_status()
                try:
                    sid = int(line.split(":")[2].replace(">>>", ""))
                    if open_servo_slot(sid):
                        send_ack(f"SERVO_OPEN_{sid}")
                    else:
                        send_err(f"SERVO_OPEN_FAIL_{sid}")
                except Exception as e:
                    log_error(f"SERVO_OPEN parse failed: {e}")
                    send_err("SERVO_CMD_PARSE_FAIL")

            elif line.startswith("<<<CMD:SERVO_CLOSE:"):
                update_connection_status()
                try:
                    sid = int(line.split(":")[2].replace(">>>", ""))
                    if close_servo_slot(sid):
                        send_ack(f"SERVO_CLOSE_{sid}")
                    else:
                        send_err(f"SERVO_CLOSE_FAIL_{sid}")
                except Exception as e:
                    log_error(f"SERVO_CLOSE parse failed: {e}")
                    send_err("SERVO_CMD_PARSE_FAIL")

            elif line == "<<<CMD:SERVO_TEST_ALL>>>":
                update_connection_status()
                test_all_servos()
                send_ack("SERVO_TEST_ALL")

            elif line == "<<<PING>>>":
                update_connection_status()
                send_ack("PING")

            elif line == "<<<ACK:K10>>>":
                update_connection_status()
                pass

        except Exception as e:
            log_error(f"Serial Parse Failed: {e}")

def handle_buttons():
    """Check physical buttons"""
    global current_state, alarm_cause

    if bt_a.status() == 1 or bt_b.status() == 1:
        # A or B stops alarm
        if current_state in [STATE_MED_ALARM, STATE_ENV_ALARM]:
            # Stop Alarm
            current_state = STATE_IDLE
            alarm_cause = ALARM_CAUSE_NONE
            rgb.clear()
            try:
                _remove_file_if_exists("alarm.wav")
            except Exception as e:
                log_error(f"Del alarm failed: {e}")
                send_err("FILE_OP_FAIL")
            draw_ui(STATE_IDLE)
            time.sleep(0.5) # Debounce

        elif current_state == STATE_IDLE:
            if bt_a.status() == 1:
                # A: Manual Check
                check_sensors()
                draw_ui(STATE_IDLE)
            elif bt_b.status() == 1:
                # B: Manual Test (Photo)
                freeze_and_send(trigger_source="manual")
            time.sleep(0.5)

        elif current_state == STATE_ERROR:
             # Retry Init
             if init_hardware():
                 current_state = STATE_IDLE
                 alarm_cause = ALARM_CAUSE_NONE
                 draw_ui(STATE_IDLE)
             else:
                 draw_ui(STATE_ERROR, msg="自检再次失败")
             time.sleep(0.5)

def update_alarm_effects():
    """Handle blinking and beeping for alarm states"""
    global last_alarm_tick

    if current_state == STATE_ENV_ALARM:
        # Blink Yellow, Beep occasionally
        now = time.ticks_ms()
        if time.ticks_diff(now, last_alarm_tick) > 1000: # Every 1s
            last_alarm_tick = now
            try:
                rgb.write(num=-1, R=255, G=255, B=0)
                speaker.play_tone(1500, 100)
                time.sleep(0.1)
                rgb.clear()
            except Exception as e: log_error(f"Env Alarm Eff Failed: {e}")

    elif current_state == STATE_MED_ALARM:
        # Blink Red, Play Audio or Beep
        now = time.ticks_ms()

        if time.ticks_diff(now, last_alarm_tick) > 3000: # Every 3s
            last_alarm_tick = now
            rgb.write(num=-1, R=255, G=0, B=0)

            has_voice = False
            try:
                if "alarm.wav" in os.listdir(): has_voice = True
            except Exception as e: log_error(f"Check alarm file failed: {e}")

            if has_voice:
                try: speaker.play_sys_music("alarm.wav")
                except Exception as e: log_error(f"Play alarm failed: {e}")
            else:
                try: speaker.play_tone(2500, 500)
                except Exception as e: log_error(f"Play tone failed: {e}")

            rgb.clear()

def main():
    global last_check_time, current_state, m10_connected, alarm_cause

    # 1. Init
    if not init_hardware():
        current_state = STATE_ERROR
        draw_ui(STATE_ERROR, msg="开机自检失败")
    else:
        # 2. Enter Idle & Send Handshake
        current_state = STATE_IDLE
        alarm_cause = ALARM_CAUSE_NONE
        draw_ui(STATE_IDLE)
        last_check_time = time.ticks_ms()

        # Send HELLO to wake up M10 connection
        sys.stdout.write("<<<HELLO:K10>>>\n")
        flush_stdout()

    # 3. Loop
    while True:
        try:
            # A. Check Inputs
            handle_input()
            handle_buttons()

            # B. Periodic Sensor Check (Only in IDLE/ENV_ALARM)
            if current_state != STATE_ERROR:
                if time.ticks_diff(time.ticks_ms(), last_check_time) > CHECK_INTERVAL:
                    last_check_time = time.ticks_ms()
                    check_sensors()
                    if current_state == STATE_IDLE:
                        draw_ui(STATE_IDLE) # Refresh values

            # C. Connection Timeout Check
            if m10_connected:
                if time.ticks_diff(time.ticks_ms(), m10_last_seen) > HEARTBEAT_TIMEOUT:
                    m10_connected = False
                    if current_state == STATE_IDLE:
                        draw_ui(STATE_IDLE) # Refresh to show disconnected

            # D. Alarm Effects
            update_alarm_effects()

            # E. Upload wait timeout fallback (for manual test / missing follow-up command)
            if current_state == STATE_UPLOADING_WAIT:
                if time.ticks_diff(time.ticks_ms(), upload_wait_since) > 12000:
                    current_state = STATE_IDLE
                    draw_ui(STATE_IDLE)

            # F. Small Delay
            time.sleep(0.05)

        except Exception as e:
            log_error(f"Main Loop Error: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()
