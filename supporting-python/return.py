# AI 辅助生成的项目代码；版本与个人参与说明见 README.md。
# 项目：瞳心医嘱 (SmartMedBox) - K10 边缘感知节点 (先叮后说经典版)

from unihiker_k10 import screen, button, speaker, temp_humi, rgb
from k10_base import Camera
import time
import gc
import sys
import ubinascii
import select
import os

C_BLACK = 0x0000; C_WHITE = 0xFFFF; C_RED = 0xF800
C_YELLOW = 0xFFE0; C_BLUE = 0x001F; C_ORANGE = 0xFC00
C_CYAN = 0x07FF;  C_GRAY = 0x8410;  C_GREEN = 0x07E0

bt_a = button(button.a); bt_b = button(button.b)

MAX_TEMP = 35.0
MAX_HUMI = 75.0
CHECK_INTERVAL = 5000
TEMP_OFFSET = 9.9
last_check_time = 0
current_temp = 0.0
current_humi = 0.0

try:
    screen.init(dir=2); screen.clear()
    camera = Camera(); camera.init()
    speaker.reinit()
except: pass

poll_obj = select.poll()
poll_obj.register(sys.stdin, select.POLLIN)

def draw_idle_ui():
    screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK)
    screen.draw_text(text="系 统 监 控 中", x=75, y=5, font_size=16, color=C_GRAY)
    screen.draw_text(text=f"温度: {current_temp}℃ | 湿度: {current_humi}%", x=10, y=30, font_size=16, color=C_CYAN)

    screen.draw_rect(x=65, y=90, w=110, h=10, bcolor=C_GRAY, fcolor=C_WHITE)
    screen.draw_rect(x=70, y=100, w=100, h=70, bcolor=C_WHITE, fcolor=C_WHITE)
    screen.draw_rect(x=115, y=120, w=10, h=30, bcolor=C_RED, fcolor=C_RED)
    screen.draw_rect(x=105, y=130, w=30, h=10, bcolor=C_RED, fcolor=C_RED)

    screen.draw_text(text="智 能 药 箱", x=60, y=190, font_size=24, color=C_WHITE)
    screen.draw_text(text="SmartMedBox", x=75, y=225, font_size=23, color=C_GRAY)

    screen.draw_rect(x=10, y=270, w=220, h=40, bcolor=C_WHITE, fcolor=C_BLACK)
    screen.draw_text(text="[A] 或 [B] 停 止 警 报", x=30, y=280, font_size=16, color=C_GREEN)
    screen.show_draw()

def update_env_ui():
    screen.draw_rect(0, 28, 240, 30, C_BLACK, C_BLACK)
    screen.draw_text(text=f"温度: {current_temp}℃ | 湿度: {current_humi}%", x=10, y=30, font_size=16, color=C_CYAN)
    screen.show_draw()

def draw_progress(current, total):
    pct = int(current / total * 100) if total > 0 else 0
    if pct > 100: pct = 100
    screen.draw_rect(20, 260, 200, 20, 0x8410, 0x8410)
    if (fill_w := int(200 * pct / 100)) > 0: screen.draw_rect(20, 260, fill_w, 20, C_GREEN, C_GREEN)
    screen.draw_rect(0, 290, 240, 30, C_BLACK, C_BLACK)
    screen.draw_text(text=f"{int(current/1024)}KB / {int(total/1024)}KB", x=50, y=290, font_size=16, color=C_WHITE)
    screen.show_draw()

def freeze_and_send():
    gc.collect()
    screen.draw_rect(0, 0, 240, 320, C_BLACK, C_BLACK)
    screen.draw_text(text="静 默 抓 拍 中...", x=50, y=140, font_size=20, color=C_GRAY)
    screen.show_draw()

    for _ in range(5):
        camera.camera_capture(); time.sleep(0.2)

    raw_ref = camera.camera_capture()
    if not raw_ref: return
    img_base64 = ubinascii.b2a_base64(bytes(raw_ref))
    total_len = len(img_base64)
    raw_ref = None; gc.collect()

    sys.stdout.write(f"<<<START:{total_len}>>>\n")
    chunk_size = 1024; offset = 0
    draw_progress(0, total_len)

    while offset < total_len:
        end = min(offset + chunk_size, total_len)
        sys.stdout.write(img_base64[offset : end].decode('utf-8'))
        time.sleep(0.015)
        offset = end
        if offset % 10240 == 0 or offset == total_len: draw_progress(offset, total_len)

    time.sleep(0.1)
    sys.stdout.write("\n<<<END>>>\n")
    img_base64 = None; gc.collect(); draw_idle_ui()

def trigger_env_alarm():
    screen.draw_rect(0, 0, 240, 320, C_YELLOW, C_YELLOW)
    screen.draw_text(text="环 境 警 报", x=55, y=80, font_size=24, color=C_BLACK)
    screen.draw_text(text="药 箱 温 度 过 高", x=35, y=140, font_size=20, color=C_RED)
    screen.draw_text(text="超 过 35.0 ℃", x=45, y=200, font_size=24, color=C_BLACK)
    screen.show_draw()
    while True:
        try: speaker.play_tone_music("BA_DING")
        except: pass
        rgb.write(num=-1, R=255, G=255, B=0)
        for _ in range(5):
            if bt_a.status() == 1 or bt_b.status() == 1: rgb.clear(); draw_idle_ui(); return
            time.sleep(0.1)
        rgb.clear()
        for _ in range(3):
            if bt_a.status() == 1 or bt_b.status() == 1: rgb.clear(); draw_idle_ui(); return
            time.sleep(0.1)

# 💡 核心：第一次先响一下，然后后面再接语音
def trigger_med_alarm():
    screen.draw_rect(0, 0, 240, 320, C_RED, C_RED)
    screen.draw_text(text="用 药 警 报", x=55, y=80, font_size=24, color=C_WHITE)
    screen.draw_text(text="请 立 即 服 药 !", x=35, y=200, font_size=24, color=C_WHITE)
    screen.show_draw()

    rgb.write(num=-1, R=255, G=0, B=0)

    # 1. 进门先强制“叮叮叮”响 3 声
    for _ in range(3):
        if bt_a.status() == 1 or bt_b.status() == 1:
            rgb.clear()
            try: os.remove("alarm.wav")
            except: pass
            draw_idle_ui()
            return
        try: speaker.play_tone(2500, 400)
        except: pass
        time.sleep(0.1)

    # 2. 进入死循环：后面只接语音播报
    while True:
        rgb.write(num=-1, R=255, G=0, B=0)

        has_voice = False
        try:
            if "alarm.wav" in os.listdir() and os.stat("alarm.wav")[6] > 100:
                has_voice = True
        except: pass

        if has_voice:
            try: speaker.play_sys_music("alarm.wav")
            except: pass
        else:
            # 如果断网没拿到语音，就一直用这个蜂鸣兜底
            try: speaker.play_tone(2500, 400)
            except: pass

        # 亮灯等老人家按键
        for _ in range(25):
            if bt_a.status() == 1 or bt_b.status() == 1:
                rgb.clear()
                try: os.remove("alarm.wav")
                except: pass
                draw_idle_ui()
                return
            time.sleep(0.1)

        # 灭灯红闪
        rgb.clear()
        for _ in range(10):
            if bt_a.status() == 1 or bt_b.status() == 1:
                rgb.clear()
                try: os.remove("alarm.wav")
                except: pass
                draw_idle_ui()
                return
            time.sleep(0.1)

def receive_audio(filename, play_now=False):
    try:
        try: os.remove(filename)
        except: pass
        start_wait = time.ticks_ms()
        with open(filename, "wb") as f:
            while True:
                if time.ticks_diff(time.ticks_ms(), start_wait) > 15000: break
                if poll_obj.poll(100):
                    line = sys.stdin.readline().strip()
                    if line.endswith("END>>>"): break
                    elif line == "<<<REPLY_FAIL>>>": break
                    elif line:
                        try:
                            f.write(ubinascii.a2b_base64(line))
                            start_wait = time.ticks_ms()
                        except: pass

        if play_now:
            try:
                if filename in os.listdir() and os.stat(filename)[6] > 100:
                    speaker.play_sys_music(filename)
            except: pass
    except: pass

def listen_to_m10():
    if poll_obj.poll(0):
        try:
            msg = sys.stdin.readline().strip()
            if msg == "<<<CMD:ALARM_MED>>>": trigger_med_alarm()
            elif msg == "<<<CMD:TAKE_PIC>>>": freeze_and_send()
            elif msg == "<<<REPLY_START>>>": receive_audio("reply.wav", play_now=True)
            elif msg == "<<<ALARM_AUDIO_START>>>": receive_audio("alarm.wav", play_now=False)
        except: pass

def main():
    global last_check_time, current_temp, current_humi
    last_check_time = time.ticks_ms()
    draw_idle_ui()
    while True:
        if time.ticks_diff(time.ticks_ms(), last_check_time) > CHECK_INTERVAL:
            last_check_time = time.ticks_ms()
            try:
                current_temp = round(temp_humi.read_temp() - TEMP_OFFSET, 1)
                current_humi = round(temp_humi.read_humi(), 1)
                update_env_ui()
                if current_temp > MAX_TEMP or current_humi > MAX_HUMI: trigger_env_alarm()
            except: pass
        listen_to_m10()
        time.sleep(0.1)

if __name__ == "__main__":
    main()
