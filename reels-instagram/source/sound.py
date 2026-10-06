import numpy as np, wave, sys
SR = 44100; T = 14.5; N = int(SR * T)
rng = np.random.default_rng(7)

def env(n, a=0.002, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)

def lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s = (1 - a) * x[i] + a * s; y[i] = s
    return y

def add(buf, t, sig, g=1.0):
    i = int(t * SR)
    if i >= N: return
    sig = sig[: N - i]; buf[i:i + len(sig)] += sig * g

def saw(f, dur, harm=10):
    t = np.arange(int(dur * SR)) / SR
    return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, harm + 1)) * 0.6

def kick():
    n = int(.45 * SR); t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t / .04)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .16) + rng.normal(0, .3, n) * np.exp(-t / .003)

def snare():
    n = int(.3 * SR); t = np.arange(n) / SR
    nz = rng.normal(0, 1, n); nz = nz - lp(nz, 1500)
    return nz * np.exp(-t / .07) * .7 + np.sin(2 * np.pi * 190 * t) * np.exp(-t / .05) * .5

HAT_N = rng.normal(0, 1, int(.08 * SR)); HAT_N = HAT_N - lp(HAT_N, 7000)
def hat(o=False):
    t = np.arange(len(HAT_N)) / SR
    return HAT_N * np.exp(-t / (.05 if o else .015))

def boom():
    n = int(1.2 * SR); t = np.arange(n) / SR
    f = 32 + 90 * np.exp(-t / .08)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .45)
    nz = rng.normal(0, 1, n); s += lp(nz, 900) * np.exp(-t / .12) * 1.2
    return s

def crash():
    n = int(1.8 * SR); t = np.arange(n) / SR
    nz = rng.normal(0, 1, n); nz = nz - lp(nz, 5000)
    return nz * np.exp(-t / .6) * .5

def whoosh(dur=.6, up=True):
    n = int(dur * SR); t = np.arange(n) / SR
    nz = rng.normal(0, 1, n); x = t / dur
    e = (x ** 2 if up else (1 - x) ** 2) * np.sin(np.pi * np.clip(x, 0, 1)) ** .3
    a = lp(nz, 2500); b = a - lp(a, 300)
    return b * e * 2.2

def stamp():
    n = int(.5 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(70 + 80 * np.exp(-t / .02)) / SR) * np.exp(-t / .12)
    nz = rng.normal(0, 1, n); s += (nz - lp(nz, 2000)) * np.exp(-t / .03) * .8
    return s

def bell(f):
    n = int(1.2 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 2.01 * t) + .25 * np.sin(2 * np.pi * f * 3.98 * t)) * np.exp(-t / .35) * .35

def pluck(f, dur=.22):
    s = saw(f, dur, 6) * env(int(dur * SR), .003, .09)
    return s

NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)

def track(lines, root, prog, bpm):
    mix = np.zeros(N); drums = np.zeros(N); music = np.zeros(N); sfx = np.zeros(N)
    beat = 60 / bpm; D0 = 3.2
    # intro : drone grave + riser + impacts sur chaque ligne de l'accroche
    drone = saw(NOTE(root - 24), D0 + .2, 6) * np.linspace(.5, 1, int((D0 + .2) * SR))
    add(music, 0, lp(drone, 400), .5)
    add(sfx, 0, boom(), .9)
    for i in range(lines):
        add(sfx, .15 + i * .33 + .2, boom(), .85); add(sfx, .15 + i * .33 + .2, snare(), .35)
    rs = int(1.4 * SR); x = np.linspace(0, 1, rs); nz = rng.normal(0, 1, rs)
    add(sfx, D0 - 1.4, (nz - lp(nz, 800)) * x ** 3 * .45)
    add(sfx, D0 - .45, whoosh(.55), .9)
    # drop
    add(sfx, D0, boom(), .9); add(sfx, D0, crash(), .8)
    n_beats = int((T - D0) / beat) + 1
    for b in range(n_beats):
        t = D0 + b * beat
        if t > T - .3: break
        add(drums, t, kick(), 1.0)
        if b % 2 == 1: add(drums, t, snare(), .6)
        add(drums, t, hat(), .25); add(drums, t + beat / 2, hat(b % 4 == 3), .35)
        chord = prog[(b // 4) % 4]
        # basse en croches
        for k in range(2):
            bn = NOTE(root - 12 + chord[0]); seg = saw(bn, beat / 2 * .95, 8) * env(int(beat / 2 * .95 * SR), .005, .18)
            add(music, t + k * beat / 2, lp(seg, 700), .55)
        # arpège en doubles croches
        for k in range(4):
            m = root + 12 + chord[(b * 4 + k) % 3]
            add(music, t + k * beat / 4, lp(pluck(NOTE(m)), 3500), .12)
    # tampons
    add(sfx, D0 + 4.4, stamp(), .9); add(sfx, D0 + 5.0, stamp(), .9)
    # CTA
    C1 = 10.6
    add(sfx, C1 - .45, whoosh(.5), .9); add(sfx, C1, crash(), .7)
    add(sfx, C1 + .55, bell(NOTE(root + 24 + prog[0][1])), 1); add(sfx, C1 + .8, bell(NOTE(root + 24 + prog[0][2] + 12)), 1)
    add(sfx, C1 + 1.6, bell(NOTE(root + 36)), .6)
    mix = drums * .55 + music * .5 + sfx * .6
    mix = np.tanh(mix * 1.3)
    f = int(.5 * SR); mix[-f:] *= np.linspace(1, 0, f)
    mix /= np.max(np.abs(mix)) / .89
    return mix

PRESETS = {
    1:  (3, 57, [(0, 3, 7), (-4, 0, 3), (3, 7, 10), (-2, 2, 5)], 120),   # La mineur
    6:  (2, 62, [(0, 3, 7), (-2, 2, 5), (-4, 0, 3), (-5, -2, 2)], 124),  # Ré mineur
    13: (3, 55, [(0, 3, 7), (5, 8, 12), (-4, 0, 3), (-2, 2, 5)], 118),   # Sol mineur
    18: (3, 60, [(0, 3, 7), (-4, 0, 3), (-7, -3, 0), (-2, 2, 5)], 122),  # Do mineur
    22: (3, 52, [(0, 3, 7), (-4, 0, 3), (-2, 2, 5), (3, 7, 10)], 126),   # Mi mineur
}
I0 = 2.25
def glass():
    n = int(.8 * SR); t = np.arange(n) / SR; nz = rng.normal(0, 1, n); nz = nz - lp(nz, 6000)
    sp = (rng.random(n) < .004) * rng.normal(0, 3, n)
    return (nz * .5 + sp) * np.exp(-t / .18)
def buzz(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    sq = np.sign(np.sin(2 * np.pi * 110 * t)) * .5 + np.sign(np.sin(2 * np.pi * 333 * t)) * .3
    sq = np.round(sq * 4) / 4; nz = rng.normal(0, .4, n)
    return (sq + nz) * (rng.random(n // 800 + 1).repeat(800)[:n] > .3)
def zap():
    n = int(.3 * SR); t = np.arange(n) / SR; f = 60 + 1400 * np.exp(-t / .06)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .12)
def clang():
    n = int(1.2 * SR); t = np.arange(n) / SR
    return sum(np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, d in [(420, .3), (1130, .2), (1790, .15), (2650, .1)]) * .5
def tick():
    n = int(.05 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * 1500 * t) * np.exp(-t / .01)
def crumple(dur):
    n = int(dur * SR); x = rng.normal(0, 1, n); x = x - lp(x, 2500)
    return x * (rng.random(n // 300 + 1).repeat(300)[:n] > .5) * .6
def intro(var):
    global N
    keep = N; N = int(I0 * SR); b = np.zeros(N)
    if var == 0:
        add(b, 0, whoosh(.5), .9); add(b, .5, boom(), 1); add(b, .5, glass(), .9); add(b, .5, crash(), .6)
        for t0 in (1.55, 1.7, 1.95): add(b, t0, zap(), .3)
    elif var == 1:
        for a, d in ((0, .35), (.8, .35), (1.45, .5)): add(b, a, buzz(d), .35)
        add(b, 1.95, zap(), .9)
    elif var == 2:
        r = int(.45 * SR); nz = rng.normal(0, 1, r); add(b, 0, (nz - lp(nz, 600)) * np.linspace(0, 1, r) ** 2 * .6)
        add(b, .45, boom(), 1.2); add(b, .45, crash(), .8); add(b, .45, glass(), .5)
    elif var == 3:
        add(b, 0, crumple(.5), .8); add(b, .5, whoosh(.85), .8); add(b, 1.38, clang(), .9); add(b, 1.38, boom(), .6)
    else:
        add(b, 0, whoosh(1.95), 1.0); add(b, 1.97, boom(), 1.1); add(b, 1.97, crash(), .7)
    N = keep
    return np.tanh(b * 1.2)
def kinetic():
    global N
    durs = [.5,.5,.5,.5,.75,.5,.5,.5,.5,.5,.5,1,.75,.75,1.25,2.25]; KT = sum(durs); N = int(KT * SR)
    drums = np.zeros(N); music = np.zeros(N); sfx = np.zeros(N); beat = .5; root = 57
    prog = [(0, 4, 7), (-3, 0, 4), (5, 9, 12), (7, 11, 14)]
    for bt in range(int(KT / beat)):
        t = bt * beat
        add(drums, t, kick(), 1); add(drums, t + beat / 2, hat(), .3)
        if bt % 2 == 1: add(drums, t, snare(), .5)
        ch = prog[(bt // 4) % 4]
        seg_ = saw(NOTE(root - 12 + ch[0]), beat * .9, 8) * env(int(beat * .9 * SR), .005, .25); add(music, t, lp(seg_, 600), .5)
        for k in range(2): add(music, t + k * beat / 2, lp(pluck(NOTE(root + 12 + ch[(bt * 2 + k) % 3])), 3000), .1)
    c = 0
    for i, d in enumerate(durs):
        add(sfx, c, tick(), .5)
        if i == 11: add(sfx, c + .5, boom(), .5)
        if i == 14:
            for k in range(14): add(sfx, c + .05 + k * .06, tick(), .25)
        if i == 15: add(sfx, c, crash(), .6); add(sfx, c + .3, bell(NOTE(81)), 1); add(sfx, c + .55, bell(NOTE(88)), 1)
        c += d
    m = np.tanh((drums * .55 + music * .5 + sfx * .6) * 1.3)
    return m
def final(var, main):
    it = intro(var); out = np.concatenate([it, main])
    f = int(.5 * SR); out[-f:] *= np.linspace(1, 0, f)
    return out / (np.max(np.abs(out)) / .85)
VAR = {1: 0, 6: 3, 13: 1, 18: 4, 22: 2, 31: 2}
for v in map(int, sys.argv[1:]):
    if v == 31: st = final(VAR[v], kinetic())
    else:
        N = int(SR * T); lines, root, prog, bpm = PRESETS[v]; st = final(VAR[v], track(lines, root, prog, bpm))
    st2 = np.stack([st, np.roll(st, 12) * .98], 1)  # léger élargissement stéréo
    pcm = (st2 * 32767).astype('<i2')
    with wave.open(f'audio/s{v:02d}.wav', 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print('ok', v)
