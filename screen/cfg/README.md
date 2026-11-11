# Screen core config

`T5UID1.CFG` is the DGUS-reloaded 1.0.2 CFG with UART2 set to
**250000 baud** (bytes 0x09–0x0A = `00 1F`); nothing else is changed.
It can only be flashed from the SD card. See "Baud rate" in
[docs/PROTOCOL.md](../../docs/PROTOCOL.md#baud-rate).

Regenerate it with:

```sh
~/dgus-env/bin/python -c "from dgus_lcd import screen_files as sf; \
d = open('vendor/DGUS-reloaded-Klipper/project/DWIN_SET/T5UID1.CFG','rb').read(); \
open('screen/cfg/T5UID1.CFG','wb').write(sf.set_cfg_baud(d, 250000))"
```
