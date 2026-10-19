# AI 辅助生成的项目代码；版本与个人参与说明见 README.md。
# 项目：瞳心医嘱 (SmartMedBox) - M10 小脑网关 (真实业务落地版)
# 升级：
# 1. 设置时间改为 5 分钟步进。
# 2. 严格执行 0、10、20、30 分钟拍照逻辑，第 30 分钟仍未吃药才报警。

from unihiker import GUI
import datetime
import time
import threading
import serial
import requests
import json
import os
import subprocess
import base64

# 🔴 请修改为你真实的云服务器 IP！
CLOUD_BASE_URL = "http://127.0.0.1:5000"
CLOUD_API_URL = f"{CLOUD_BASE_URL}/api/upload"
CLOUD_CONFIG_URL = f"{CLOUD_BASE_URL}/api/config"
CLOUD_VOICE_URL = f"{CLOUD_BASE_URL}/api/voice"
CLOUD_TTS_TEXT_URL = f"{CLOUD_BASE_URL}/api/tts_text"

SERIAL_PORT = '/dev/ttyACM0'
BAUD_RATE = 115200
ser = None

CONFIG_FILE = "alarms_config.json"
alarms = {"早上": {"h": 8, "m": 0}, "中午": {"h": 12, "m": 30}, "晚上": {"h": 19, "m": 0}}
current_page = "HOME"
edit_tab, edit_focus = "早上", "h"

active_period_name = "未知"
is_med_active = False
check_count = 0
last_action_time = 0

k10_connected = False; cloud_connected = False
ai_status_msg = "状态: 等待检测"

gui = GUI(); page_elements = []; dynamic_ui = {}
def add_ui(element): page_elements.append(element); return element

def load_alarms():
    global alarms
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                for k in alarms:
                    if k in saved: alarms[k] = saved[k]
        except: pass

def push_to_cloud():
    global cloud_connected
    try:
        res = requests.post(CLOUD_CONFIG_URL, json=alarms, timeout=5)
        if res.status_code == 200: cloud_connected = True
    except: cloud_connected = False

def save_alarms():
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f: json.dump(alarms, f)
        threading.Thread(target=push_to_cloud).start()
    except: pass

def init_popup():
    dynamic_ui['pop_bg'] = add_ui(gui.fill_round_rect(x=-500, y=135, w=220, h=50, r=10, color="#263238"))
    dynamic_ui['pop_text'] = add_ui(gui.draw_text(x=-500, y=160, text="等待中...", origin="center", font_size=14, color="#81C784"))

def show_popup(msg):
    if 'pop_bg' in dynamic_ui: dynamic_ui['pop_bg'].config(x=10); dynamic_ui['pop_text'].config(x=120, text=msg)

def hide_popup():
    if 'pop_bg' in dynamic_ui: dynamic_ui['pop_bg'].config(x=-500); dynamic_ui['pop_text'].config(x=-500)

def render_home():
    global current_page
    current_page = "HOME"
    gui.clear(); page_elements.clear(); dynamic_ui.clear()
    add_ui(gui.fill_rect(x=0, y=0, w=240, h=320, color="#FFFFFF"))
    add_ui(gui.draw_text(x=45, y=20, text="✚", origin="center", font_size=24, color="#E53935"))
    add_ui(gui.draw_text(x=135, y=20, text="智能药箱", origin="center", font_size=22, color="#222222"))
    dynamic_ui['clock'] = add_ui(gui.draw_text(x=120, y=80, text="00:00", origin="center", font_size=55, color="#111111"))
    add_ui(gui.fill_round_rect(x=15, y=125, w=210, h=35, r=6, color="#E8F5E9"))
    dynamic_ui['next_alarm'] = add_ui(gui.draw_text(x=120, y=133, text="▶ 推算中...", origin="center", font_size=10, color="#2E7D32"))
    dynamic_ui['ai_status'] = add_ui(gui.draw_text(x=120, y=149, text=ai_status_msg, origin="center", font_size=12, color="#D32F2F"))
    card_y = 175
    add_ui(gui.fill_round_rect(x=15, y=card_y, w=64, h=75, r=8, color="#F0F0F0", onclick=lambda: open_settings("早上")))
    add_ui(gui.draw_text(x=47, y=190, text="☀ 早上", origin="center", font_size=12, color="#F57C00", onclick=lambda: open_settings("早上")))
    dynamic_ui['home_morn'] = add_ui(gui.draw_text(x=47, y=225, text=f"{alarms['早上']['h']:02d}:{alarms['早上']['m']:02d}", origin="center", font_size=16, color="#222222", onclick=lambda: open_settings("早上")))
    add_ui(gui.fill_round_rect(x=88, y=card_y, w=64, h=75, r=8, color="#F0F0F0", onclick=lambda: open_settings("中午")))
    add_ui(gui.draw_text(x=120, y=190, text="☼ 中午", origin="center", font_size=12, color="#F57C00", onclick=lambda: open_settings("中午")))
    dynamic_ui['home_noon'] = add_ui(gui.draw_text(x=120, y=225, text=f"{alarms['中午']['h']:02d}:{alarms['中午']['m']:02d}", origin="center", font_size=16, color="#222222", onclick=lambda: open_settings("中午")))
    add_ui(gui.fill_round_rect(x=161, y=card_y, w=64, h=75, r=8, color="#F0F0F0", onclick=lambda: open_settings("晚上")))
    add_ui(gui.draw_text(x=193, y=190, text="☾ 晚上", origin="center", font_size=12, color="#3949AB", onclick=lambda: open_settings("晚上")))
    dynamic_ui['home_night'] = add_ui(gui.draw_text(x=193, y=225, text=f"{alarms['晚上']['h']:02d}:{alarms['晚上']['m']:02d}", origin="center", font_size=16, color="#222222", onclick=lambda: open_settings("晚上")))

    dynamic_ui['btn_bg'] = add_ui(gui.fill_round_rect(x=15, y=255, w=210, h=30, r=6, color="#2196F3", onclick=toggle_recording))
    dynamic_ui['btn_txt'] = add_ui(gui.draw_text(x=120, y=270, text="[语音助理] 点我开始说话", origin="center", font_size=11, color="#FFFFFF", onclick=toggle_recording))

    add_ui(gui.draw_line(x0=10, y0=290, x1=230, y1=290, width=2, color="#EEEEEE"))
    dynamic_ui['k10_status'] = add_ui(gui.draw_text(x=10, y=305, text="K10: 离线", origin="left", font_size=10, color="#E53935"))
    dynamic_ui['cloud_status'] = add_ui(gui.draw_text(x=230, y=305, text="云端: 离线", origin="right", font_size=10, color="#E53935"))
    init_popup()

def render_settings():
    global current_page, temp_edit_h, temp_edit_m
    current_page = "SETTINGS"
    gui.clear(); page_elements.clear(); dynamic_ui.clear()
    add_ui(gui.fill_rect(x=0, y=0, w=240, h=320, color="#FFFFFF"))
    add_ui(gui.draw_text(x=120, y=25, text=f"设定 [{edit_tab}] 时间", origin="center", font_size=18, color="#222222"))
    add_ui(gui.fill_round_rect(x=35, y=85, w=70, h=80, r=8, color="#FFE0B2" if edit_focus=="h" else "#F0F0F0", onclick=lambda: handle_click('focus', 'h')))
    add_ui(gui.draw_text(x=70, y=125, text=f"{temp_edit_h:02d}", origin="center", font_size=45, color="#F57C00" if edit_focus=="h" else "#222222", onclick=lambda: handle_click('focus', 'h')))
    add_ui(gui.draw_text(x=120, y=120, text=":", origin="center", font_size=40, color="#9E9E9E"))
    add_ui(gui.fill_round_rect(x=135, y=85, w=70, h=80, r=8, color="#FFE0B2" if edit_focus=="m" else "#F0F0F0", onclick=lambda: handle_click('focus', 'm')))
    add_ui(gui.draw_text(x=170, y=125, text=f"{temp_edit_m:02d}", origin="center", font_size=45, color="#F57C00" if edit_focus=="m" else "#222222", onclick=lambda: handle_click('focus', 'm')))
    add_ui(gui.fill_round_rect(x=35, y=185, w=70, h=45, r=6, color="#EEEEEE", onclick=lambda: handle_click('adj', 1)))
    add_ui(gui.draw_text(x=70, y=207, text="▲ 增加", origin="center", font_size=13, color="#2E7D32", onclick=lambda: handle_click('adj', 1)))
    add_ui(gui.fill_round_rect(x=135, y=185, w=70, h=45, r=6, color="#EEEEEE", onclick=lambda: handle_click('adj', -1)))
    add_ui(gui.draw_text(x=170, y=207, text="▼ 减少", origin="center", font_size=13, color="#D32F2F", onclick=lambda: handle_click('adj', -1)))
    add_ui(gui.fill_round_rect(x=25, y=250, w=190, h=45, r=8, color="#4CAF50", onclick=lambda: handle_click('save', None)))
    add_ui(gui.draw_text(x=120, y=272, text="确定保存", origin="center", font_size=14, color="#FFFFFF", onclick=lambda: handle_click('save', None)))

def handle_click(action, val):
    global edit_focus, temp_edit_h, temp_edit_m, alarms
    if action == 'focus': edit_focus = val
    elif action == 'adj':
        if edit_focus == "h":
            temp_edit_h = (temp_edit_h + val) % 24
        else:
            # 💡 步进逻辑升级：分钟按 5 分钟一档增减！
            temp_edit_m = (temp_edit_m + val * 5) % 60
    elif action == 'save':
        alarms[edit_tab]['h'] = temp_edit_h; alarms[edit_tab]['m'] = temp_edit_m
        save_alarms(); render_home(); return
    gui.clear(); page_elements.clear(); dynamic_ui.clear(); render_settings()

def open_settings(tab):
    global edit_tab, edit_focus, temp_edit_h, temp_edit_m
    edit_tab, edit_focus = tab, "h"
    temp_edit_h = alarms[tab]['h']; temp_edit_m = alarms[tab]['m']
    gui.clear(); page_elements.clear(); dynamic_ui.clear(); render_settings()

record_process = None
is_recording = False

def upload_voice_to_cloud():
    try:
        if not os.path.exists("temp_record.wav") or os.path.getsize("temp_record.wav") < 5000:
            show_popup("[忽略] 录音太短")
            time.sleep(2); hide_popup(); return
        show_popup("[处理中] 上传分析...")
        with open("temp_record.wav", "rb") as f: audio_b64 = base64.b64encode(f.read()).decode('utf-8')
        res = requests.post(CLOUD_VOICE_URL, json={"audio": audio_b64}, timeout=20)
        if res.status_code == 200:
            reply_b64 = res.json().get("reply_audio")
            if reply_b64 and ser and ser.is_open:
                show_popup("下发语音至药箱...")
                ser.write(b"<<<REPLY_START>>>\n")
                for i in range(0, len(reply_b64), 1024):
                    ser.write(reply_b64[i:i+1024].encode('utf-8') + b"\n")
                    time.sleep(0.02)
                ser.write(b"<<<REPLY_END>>>\n")
                show_popup("[成功] 语音已送达！")
        else: show_popup("[失败] AI 思考超时")
    except Exception as e: show_popup("网络连接异常")
    time.sleep(2); hide_popup()

def toggle_recording():
    global is_recording, record_process
    if not is_recording:
        is_recording = True
        dynamic_ui['btn_bg'].config(color="#F44336")
        dynamic_ui['btn_txt'].config(text="[录音中] 说话完毕请再点一次")
        subprocess.run(['killall', 'arecord'], stderr=subprocess.DEVNULL)
        record_process = subprocess.Popen(['arecord', '-f', 'S16_LE', '-r', '16000', 'temp_record.wav'])
    else:
        is_recording = False
        dynamic_ui['btn_bg'].config(color="#2196F3")
        dynamic_ui['btn_txt'].config(text="[语音助理] 点我开始说话")
        if record_process:
            record_process.terminate(); record_process.wait(); record_process = None
        threading.Thread(target=upload_voice_to_cloud).start()

def trigger_smart_alarm():
    global active_period_name
    try:
        alarm_text = f"警告！系统发现您{active_period_name}的药过了半小时还没吃，请赶快服药！"
        show_popup("请求终极警报语音...")
        res = requests.post(CLOUD_TTS_TEXT_URL, json={"text": alarm_text}, timeout=10)
        if res.status_code == 200:
            reply_b64 = res.json().get("reply_audio")
            if reply_b64 and ser and ser.is_open:
                ser.write(b"<<<ALARM_AUDIO_START>>>\n")
                for i in range(0, len(reply_b64), 1024):
                    ser.write(reply_b64[i:i+1024].encode('utf-8') + b"\n")
                    time.sleep(0.02)
                ser.write(b"<<<ALARM_AUDIO_END>>>\n")
    except: pass
    if ser and ser.is_open: ser.write(b"<<<CMD:ALARM_MED>>>\n")
    hide_popup()

# ----------------- 📸 真实业务：0/10/20/30 分钟轮询 -----------------
def timekeeper_thread():
    global active_period_name, is_med_active, check_count, last_action_time
    current_hm_record = ""
    while True:
        now = datetime.datetime.now()
        current_hm = f"{now.hour:02d}:{now.minute:02d}"

        # 1. 触发点 (第 0 分钟，第一次检测)
        for period, t in alarms.items():
            if current_hm == f"{t['h']:02d}:{t['m']:02d}" and current_hm_record != current_hm:
                current_hm_record = current_hm
                active_period_name = period
                is_med_active = True
                check_count = 1
                if ser and ser.is_open: ser.write(b"<<<CMD:TAKE_PIC>>>\n")
                last_action_time = time.time()
                break

        # 2. 轮询检测 (第 10/20/30 分钟)
        # 真实环境中 600 秒 = 10 分钟。如果在等待期间没吃药，is_med_active 将保持 True。
        if is_med_active and (time.time() - last_action_time >= 600):
            if check_count < 4:
                check_count += 1
                if ser and ser.is_open: ser.write(b"<<<CMD:TAKE_PIC>>>\n")
                last_action_time = time.time()

        time.sleep(1)

def serial_listener():
    global ser, k10_connected, ai_status_msg, cloud_connected, active_period_name, is_med_active, check_count
    buffer = bytearray(); receiving_pic = False
    expected_total = 35840; last_update_time = 0

    while True:
        try:
            if ser is None or not ser.is_open:
                try: ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=0.01)
                except: k10_connected = False; time.sleep(1); continue
            k10_connected = True

            if ser.in_waiting > 0:
                chunk = ser.read(ser.in_waiting)
                buffer.extend(chunk)

                if not receiving_pic:
                    if b'<<<START:' in buffer and b'>>>' in buffer[buffer.find(b'<<<START:'):]:
                        start_idx = buffer.find(b'<<<START:')
                        end_idx = buffer.find(b'>>>', start_idx)
                        len_str = buffer[start_idx+9 : end_idx].decode('utf-8', 'ignore')
                        try: expected_total = int(len_str)
                        except: expected_total = 35840
                        buffer = bytearray(buffer[end_idx+3:])
                        receiving_pic, last_update_time = True, time.time()
                        show_popup("传输中: 0%")

                    elif b'<<<START>>>' in buffer:
                        start_idx = buffer.find(b'<<<START>>>')
                        buffer = bytearray(buffer[start_idx+11:])
                        expected_total = 35840
                        receiving_pic, last_update_time = True, time.time()
                        show_popup("传输中: 0%")
                else:
                    if b'<<<END>>>' in buffer:
                        end_idx = buffer.find(b'<<<END>>>')
                        final_data = buffer[:end_idx]
                        receiving_pic = False; buffer.clear()
                        show_popup("AI 分析中...")

                        def upload_to_cloud(img_bytes):
                            global ai_status_msg, cloud_connected, is_med_active
                            try:
                                clean_b64 = img_bytes.decode('utf-8', errors='ignore').replace('\n', '').replace('\r', '').strip()
                                payload = {"image": clean_b64, "period": active_period_name, "check_count": check_count}
                                res = requests.post(CLOUD_API_URL, json=payload, timeout=60)
                                if res.status_code == 200:
                                    ai_reply = res.json().get("ai_result", "未知")
                                    ai_status_msg = f"判定结果: 【{ai_reply}】 (第{check_count}次)"

                                    if "已服药" in ai_reply:
                                        is_med_active = False # 老人吃了！关闭拍照轮询
                                        show_popup("[验证通过] 药已服下")
                                        time.sleep(3); hide_popup()
                                    else:
                                        # 如果是第4次（30分钟），触发终极警报！
                                        if check_count >= 4:
                                            show_popup("30分钟未服药！触发警报")
                                            is_med_active = False # 报警后停止拍照
                                            trigger_smart_alarm()
                                        else:
                                            show_popup(f"[未服药] 10分钟后再拍...")
                                            time.sleep(3); hide_popup()

                                cloud_connected = True
                            except: ai_status_msg = "状态: 网络断开"; cloud_connected = False; time.sleep(2); hide_popup()

                        threading.Thread(target=upload_to_cloud, args=(final_data,)).start()
                    else:
                        now = time.time()
                        if now - last_update_time > 0.1:
                            pct = int((len(buffer) / expected_total) * 100)
                            if pct > 99: pct = 99
                            show_popup(f"传输中: {pct}%")
                            last_update_time = now
        except OSError: k10_connected, ser = False, None
        except Exception: pass
        time.sleep(0.001)

load_alarms()
threading.Thread(target=push_to_cloud).start()
threading.Thread(target=timekeeper_thread, daemon=True).start()
threading.Thread(target=serial_listener, daemon=True).start()
render_home()

while True:
    try:
        if current_page == "HOME" and 'clock' in dynamic_ui:
            now = datetime.datetime.now()
            dynamic_ui['clock'].config(text=now.strftime("%H:%M"))
            dynamic_ui['ai_status'].config(text=ai_status_msg)
            cur_mins = now.hour * 60 + now.minute
            future = sorted([(alarms[k]['h']*60 + alarms[k]['m'], k, alarms[k]) for k in alarms if (alarms[k]['h']*60 + alarms[k]['m']) > cur_mins])
            if future: dynamic_ui['next_alarm'].config(text=f"▶ 下次服药: {future[0][1]} {future[0][2]['h']:02d}:{future[0][2]['m']:02d}")
            else: dynamic_ui['next_alarm'].config(text=f"▶ 下次服药: 明天早上 {alarms['早上']['h']:02d}:{alarms['早上']['m']:02d}")
            dynamic_ui['k10_status'].config(text="K10: 已连接" if k10_connected else "K10: 离线", color="#4CAF50" if k10_connected else "#E53935")
            dynamic_ui['cloud_status'].config(text="云端: 已连接" if cloud_connected else "云端: 未同步", color="#4CAF50" if cloud_connected else "#9E9E9E")
    except: pass
    time.sleep(1)
