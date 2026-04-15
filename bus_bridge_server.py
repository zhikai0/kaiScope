#!/usr/bin/env python3
import asyncio
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import serial
import serial.tools.list_ports
import websockets

try:
    import can
except Exception:
    can = None


@dataclass
class UartHandle:
  ser: serial.Serial
  task: asyncio.Task


@dataclass
class CanHandle:
  bus: object
  task: asyncio.Task


class BridgeServer:
  def __init__(self):
    self.clients = set()
    self.uart: Optional[UartHandle] = None
    self.can: Optional[CanHandle] = None
    self.test_rx_log_enabled = False
    self.test_fake_plot_task: Optional[asyncio.Task] = None

  async def send(self, ws, payload):
    await ws.send(json.dumps(payload))

  async def send_all(self, payload):
    if not self.clients:
      return
    dead = []
    for ws in list(self.clients):
      try:
        await ws.send(json.dumps(payload))
      except Exception:
        dead.append(ws)
    for ws in dead:
      self.clients.discard(ws)

  async def reply(self, ws, req_id, ok=True, data=None, error=''):
    await self.send(ws, {
      'type': 'response',
      'req_id': req_id,
      'ok': ok,
      'data': data or {},
      'error': error,
    })

  async def list_ports(self, log=True):
    # 只暴露常见外设串口，避免 /dev/ttyS* 等系统设备干扰
    serial_set = {
      p.device for p in serial.tools.list_ports.comports()
      if p.device and (p.device.startswith('/dev/ttyACM') or p.device.startswith('/dev/ttyUSB'))
    }
    dev_set = set()
    for pattern in ('ttyACM*', 'ttyUSB*'):
      for p in Path('/dev').glob(pattern):
        dev_set.add(str(p))

    uart = sorted(serial_set | dev_set)

    can_list = []
    if Path('/sys/class/net').exists():
      for n in Path('/sys/class/net').iterdir():
        if n.name.startswith('can'):
          can_list.append(n.name)

    if log:
      print(f'[bus_bridge] list_ports -> uart={len(uart)} {uart} can={len(can_list)} {sorted(can_list)}')
    return {'uart': uart, 'can': sorted(can_list)}

  async def emit_ports(self, ws=None):
    payload = {'type': 'port_list', **(await self.list_ports())}
    print(f"[bus_bridge] emit_ports target={'all' if ws is None else 'single'} uart={len(payload['uart'])} can={len(payload['can'])}")
    if ws is None:
      await self.send_all(payload)
    else:
      await self.send(ws, payload)

  async def monitor_ports(self):
    last = None
    while True:
      try:
        ports = await self.list_ports(log=False)
        key = (tuple(ports.get('uart', [])), tuple(ports.get('can', [])))
        if key != last:
          last = key
          print(f"[bus_bridge] port-change uart={list(key[0])} can={list(key[1])}")
          await self.emit_ports()
      except Exception as e:
        print(f'[bus_bridge] monitor_ports error={e}')
      await asyncio.sleep(1.0)

  def _ts(self):
    return datetime.now().strftime('%H:%M:%S.%f')[:-3]

  def test_start_rx_log(self):
    self.test_rx_log_enabled = True
    print('[bus_bridge][test] uart rx log enabled')

  def test_stop_rx_log(self):
    self.test_rx_log_enabled = False
    print('[bus_bridge][test] uart rx log disabled')

  async def test_start_fake_plot(self, hz=20.0):
    await self.test_stop_fake_plot()
    hz = float(hz) if hz else 20.0
    hz = min(200.0, max(1.0, hz))
    print(f'[bus_bridge][test] fake plot start hz={hz}')

    async def loop():
      t = 0.0
      dt = 1.0 / hz
      while True:
        c1 = 1.0 * math.sin(2 * math.pi * 0.4 * t)
        c2 = 0.8 * math.cos(2 * math.pi * 0.6 * t + 0.5)
        c3 = 0.6 * math.sin(2 * math.pi * 1.1 * t + 1.2)
        c4 = 0.4 * math.cos(2 * math.pi * 0.2 * t + 0.3)
        line = f'{c1:.4f},{c2:.4f},{c3:.4f},{c4:.4f}'
        await self.send_all({'type': 'uart_rx', 'text': line})
        t += dt
        await asyncio.sleep(dt)

    self.test_fake_plot_task = asyncio.create_task(loop())

  async def test_stop_fake_plot(self):
    if not self.test_fake_plot_task:
      return
    self.test_fake_plot_task.cancel()
    try:
      await self.test_fake_plot_task
    except BaseException:
      pass
    self.test_fake_plot_task = None
    print('[bus_bridge][test] fake plot stopped')

  async def close_uart(self):
    self.test_rx_log_enabled = False
    if not self.uart:
      return
    self.uart.task.cancel()
    try:
      await self.uart.task
    except BaseException:
      pass
    try:
      self.uart.ser.close()
    except Exception:
      pass
    self.uart = None
    await self.send_all({'type': 'bridge_status', 'kind': 'uart', 'open': False, 'message': 'UART closed'})

  async def close_can(self):
    if not self.can:
      return
    self.can.task.cancel()
    try:
      await self.can.task
    except BaseException:
      pass
    try:
      self.can.bus.shutdown()
    except Exception:
      pass
    self.can = None
    await self.send_all({'type': 'bridge_status', 'kind': 'can', 'open': False, 'message': 'CAN closed'})

  async def open_uart(self, cfg):
    await self.close_uart()
    port = cfg.get('port', '/dev/ttyUSB0')
    baud = int(cfg.get('baudRate', 115200))
    data_bits = int(cfg.get('dataBits', 8))
    stop_bits = int(cfg.get('stopBits', 1))
    parity = cfg.get('parity', 'none')

    parity_map = {
      'none': serial.PARITY_NONE,
      'odd': serial.PARITY_ODD,
      'even': serial.PARITY_EVEN,
    }

    print(f'[bus_bridge] opening uart port={port} baud={baud} data={data_bits} stop={stop_bits} parity={parity}')
    ser = serial.Serial(
      port=port,
      baudrate=baud,
      bytesize=data_bits,
      stopbits=stop_bits,
      parity=parity_map.get(parity, serial.PARITY_NONE),
      timeout=0.02,
      exclusive=True,
    )

    async def uart_reader():
      buf = ''
      while True:
        await asyncio.sleep(0.001)
        try:
          chunk = ser.read(4096)
        except Exception:
          chunk = b''
        if not chunk:
          continue

        buf += chunk.decode('utf-8', errors='replace').replace('\r', '')
        parts = buf.split('\n')
        buf = parts.pop() if parts else ''
        for line in parts:
          line = line.strip()
          if not line:
            continue
          if self.test_rx_log_enabled:
            print(f"[bus_bridge][rx][{self._ts()}] {line}")
          await self.send_all({'type': 'uart_rx', 'text': line})

    task = asyncio.create_task(uart_reader())
    self.uart = UartHandle(ser=ser, task=task)
    await self.send_all({'type': 'bridge_status', 'kind': 'uart', 'open': True, 'message': f'UART opened {port} @ {baud}'})

  async def uart_write(self, mode, text='', hex_str=''):
    if not self.uart:
      raise RuntimeError('UART not open')
    if mode == 'hex':
      cleaned = re.sub(r'[^0-9a-fA-F]', '', hex_str)
      if len(cleaned) % 2 != 0:
        raise RuntimeError('hex length must be even')
      payload = bytes.fromhex(cleaned)
    else:
      payload = text.encode('utf-8', errors='ignore')
    n = self.uart.ser.write(payload)
    preview = payload[:64]
    try:
      txt = preview.decode('utf-8', errors='replace')
    except Exception:
      txt = ''
    print(f"[bus_bridge] uart_write bytes={n} mode={mode} preview_hex={preview.hex(' ')} preview_text={txt!r}")

  async def open_can(self, cfg):
    if can is None:
      raise RuntimeError('python-can not installed')
    await self.close_can()
    channel = cfg.get('channel', 'can0')
    bitrate = int(cfg.get('bitrate', 500000))
    bus = can.interface.Bus(channel=channel, bustype='socketcan', bitrate=bitrate)

    async def can_reader():
      while True:
        await asyncio.sleep(0.001)
        msg = bus.recv(timeout=0.01)
        if msg is None:
          continue
        data = ' '.join(f'{b:02X}' for b in msg.data)
        await self.send_all({'type': 'can_rx', 'id': int(msg.arbitration_id), 'data': data})

    task = asyncio.create_task(can_reader())
    self.can = CanHandle(bus=bus, task=task)
    await self.send_all({'type': 'bridge_status', 'kind': 'can', 'open': True, 'message': f'CAN opened {channel} @ {bitrate}'})

  async def can_send(self, frame):
    if not self.can:
      raise RuntimeError('CAN not open')
    arb_id = int(frame.get('id', 0))
    data_str = frame.get('data', '')
    cleaned = re.sub(r'[^0-9a-fA-F]', '', data_str)
    if len(cleaned) % 2 != 0:
      raise RuntimeError('can data hex length must be even')
    payload = bytes.fromhex(cleaned)
    msg = can.Message(arbitration_id=arb_id, data=payload, is_extended_id=False)
    self.can.bus.send(msg)

  async def handle_message(self, ws, raw):
    req_id = raw.get('req_id')
    op = raw.get('op')
    print(f'[bus_bridge] op={op} begin')

    try:
      if op == 'list_ports':
        data = await self.list_ports()
        await self.reply(ws, req_id, ok=True, data=data)
        await self.emit_ports(ws)
        print(f"[bus_bridge] op=list_ports done uart={len(data.get('uart', []))} can={len(data.get('can', []))}")
      elif op == 'open_uart':
        cfg = raw.get('config') or {}
        print(f"[bus_bridge] op=open_uart cfg={cfg}")
        await self.open_uart(cfg)
        await self.reply(ws, req_id, ok=True, data={'open': True})
      elif op == 'close_uart':
        print('[bus_bridge] op=close_uart')
        await self.close_uart()
        await self.reply(ws, req_id, ok=True, data={'open': False})
      elif op == 'uart_write':
        mode = raw.get('mode', 'text')
        print(f'[bus_bridge] op=uart_write mode={mode}')
        await self.uart_write(mode, raw.get('text', ''), raw.get('hex', ''))
        await self.reply(ws, req_id, ok=True, data={})
      elif op == 'open_can':
        cfg = raw.get('config') or {}
        print(f"[bus_bridge] op=open_can cfg={cfg}")
        await self.open_can(cfg)
        await self.reply(ws, req_id, ok=True, data={'open': True})
      elif op == 'close_can':
        print('[bus_bridge] op=close_can')
        await self.close_can()
        await self.reply(ws, req_id, ok=True, data={'open': False})
      elif op == 'can_send':
        frame = raw.get('frame') or {}
        print(f"[bus_bridge] op=can_send id={frame.get('id')} data={frame.get('data')}")
        await self.can_send(frame)
        await self.reply(ws, req_id, ok=True, data={})
      elif op == 'test_start_rx_log':
        self.test_start_rx_log()
        await self.reply(ws, req_id, ok=True, data={'enabled': True})
      elif op == 'test_stop_rx_log':
        self.test_stop_rx_log()
        await self.reply(ws, req_id, ok=True, data={'enabled': False})
      elif op == 'test_start_fake_plot':
        hz = raw.get('hz', 20)
        await self.test_start_fake_plot(hz=hz)
        await self.reply(ws, req_id, ok=True, data={'fake_plot': True, 'hz': hz})
      elif op == 'test_stop_fake_plot':
        await self.test_stop_fake_plot()
        await self.reply(ws, req_id, ok=True, data={'fake_plot': False})
      else:
        await self.reply(ws, req_id, ok=False, error=f'unknown op: {op}')
    except Exception as e:
      print(f'[bus_bridge] op={op} error={e}')
      await self.reply(ws, req_id, ok=False, error=str(e))

  async def ws_handler(self, ws):
    self.clients.add(ws)
    print(f'[bus_bridge] client connected total={len(self.clients)}')
    try:
      await self.send(ws, {
        'type': 'bridge_status',
        'kind': 'uart',
        'open': self.uart is not None,
        'message': 'bridge online',
      })
      await self.send(ws, {
        'type': 'bridge_status',
        'kind': 'can',
        'open': self.can is not None,
      })
      await self.emit_ports(ws)
      async for message in ws:
        try:
          raw = json.loads(message)
        except Exception:
          continue
        await self.handle_message(ws, raw)
    except websockets.exceptions.ConnectionClosed:
      pass
    finally:
      self.clients.discard(ws)
      print(f'[bus_bridge] client disconnected total={len(self.clients)}')


async def main():
  server = BridgeServer()
  monitor_task = asyncio.create_task(server.monitor_ports())
  print('[bus_bridge] ws://0.0.0.0:8764')
  print('[bus_bridge] test cmds: test_start_rx_log | test_stop_rx_log | test_start_fake_plot(hz) | test_stop_fake_plot')
  try:
    async with websockets.serve(server.ws_handler, '0.0.0.0', 8764, max_size=2**22):
      await asyncio.Future()
  finally:
    monitor_task.cancel()
    try:
      await monitor_task
    except Exception:
      pass
    try:
      await server.test_stop_fake_plot()
    except Exception:
      pass


if __name__ == '__main__':
  asyncio.run(main())
