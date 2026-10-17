/*
 * fxaudio.exe — malý pomocník pre ClipIt, ktorý zachytáva zvuk cez WASAPI.
 *
 *   fxaudio list                        -> JSON so zariadeniami (výstupy aj vstupy)
 *   fxaudio sessions                    -> JSON s appkami, ktoré práve majú zvuk
 *   fxaudio capture [voľby]             -> nekonečný prúd f32le 48 kHz stereo
 *
 * Voľby pre capture:
 *   --pipe \\.\pipe\meno     zapisuj do pomenovanej rúry (inak stdout)
 *   --device ID              zariadenie podľa stabilného ID (nie podľa poradia!)
 *   --name "Meno"            záloha: keď ID zmizne, nájdi zariadenie podľa mena
 *   --flow render|capture    render = loopback toho, čo počuješ; capture = mikrofón
 *   --default                keď nenájdeš ani ID, ani meno, zober predvolené
 *   --process app.exe        zvuk len z tejto appky (a jej podprocesov)
 *   --foreground             zvuk z hry v popredí (fullscreen / borderless okno)
 *   --games a.exe,b.exe      tieto appky ber ako hry, aj keď nie sú na celú obrazovku
 *   --exclude a.exe,b.exe    tieto appky v režime --foreground nikdy neber
 *
 * Výstup je vždy súvislý: keď nič nehrá alebo zariadenie zmizne, píše ticho,
 * takže sa zvuk v klipe nikdy nerozíde s obrazom. Na stderr idú JSON riadky
 * so stavom ({"ev":"bound",...}) a úrovňou hlasitosti ({"ev":"lvl","v":0.4}).
 */
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <initguid.h>
#include <objbase.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmreg.h>
#include <ks.h>
#include <ksmedia.h>
#include <tlhelp32.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define RATE 48000
#define CH 2
#define LAT_FRAMES (RATE / 10)          /* výstup zaostáva 100 ms za hodinami, aby stihli doraziť oneskorené pakety */
#define MAX_EXTRA (RATE / 5)            /* viac ako 200 ms navyše = zahodíme najstaršie */
#define RING_FRAMES (RATE * 4)

DEFINE_GUID(CLSID_MMDeviceEnumerator_, 0xBCDE0395, 0xE52F, 0x467C, 0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E);
DEFINE_GUID(IID_IMMDeviceEnumerator_, 0xA95664D2, 0x9614, 0x4F35, 0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6);
DEFINE_GUID(IID_IAudioClient_, 0x1CB9AD4C, 0xDBFA, 0x4c32, 0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2);
DEFINE_GUID(IID_IAudioCaptureClient_, 0xC8ADBD64, 0xE71E, 0x48a0, 0xA4, 0xDE, 0x18, 0x5C, 0x39, 0x5C, 0xD3, 0x17);
DEFINE_GUID(IID_IAudioSessionManager2_, 0x77AAAA8D, 0xA6B6, 0x4D85, 0xB0, 0xE4, 0x7B, 0xE3, 0x8B, 0xD0, 0x3B, 0x14);
DEFINE_GUID(IID_IAudioSessionControl2_, 0xbfb7ff88, 0x7239, 0x4fc9, 0x8f, 0xa2, 0x07, 0xc9, 0x50, 0xbe, 0x9c, 0x6d);
DEFINE_GUID(IID_IAgileObject_, 0x94ea2b94, 0xe9cc, 0x49e0, 0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90);
DEFINE_GUID(IID_IUnknown_, 0x00000000, 0x0000, 0x0000, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46);
DEFINE_GUID(IID_IActivateAudioInterfaceCompletionHandler_, 0x41d949ab, 0x9862, 0x444a, 0x80, 0xf6, 0xc2, 0x61, 0x33, 0x4d, 0xa5, 0xeb);
DEFINE_GUID(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_, 0x00000003, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);
DEFINE_GUID(KSDATAFORMAT_SUBTYPE_PCM_, 0x00000001, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);

/* hlavička audioclientactivationparams.h v mingw chýba, tak si ju nadefinujeme */
typedef struct { DWORD TargetProcessId; DWORD ProcessLoopbackMode; } PROC_LOOPBACK_PARAMS;
typedef struct { DWORD ActivationType; PROC_LOOPBACK_PARAMS p; } ACTIVATION_PARAMS;
#define ACTIVATION_TYPE_PROCESS_LOOPBACK 1
#define LOOPBACK_MODE_INCLUDE_TREE 0
typedef HRESULT (WINAPI *PFN_ActivateAudioInterfaceAsync)(LPCWSTR, REFIID, PROPVARIANT *, IActivateAudioInterfaceCompletionHandler *, IActivateAudioInterfaceAsyncOperation **);

/* ---------------------------------------------------------------- pomôcky */
static void jsonw(FILE *f, const wchar_t *w) {
  char buf[2048];
  int n = WideCharToMultiByte(CP_UTF8, 0, w ? w : L"", -1, buf, sizeof buf, NULL, NULL);
  if (n <= 0) buf[0] = 0;
  fputc('"', f);
  for (const unsigned char *p = (const unsigned char *)buf; *p; p++) {
    if (*p == '"' || *p == '\\') { fputc('\\', f); fputc(*p, f); }
    else if (*p < 0x20) fprintf(f, "\\u%04x", *p);
    else fputc(*p, f);
  }
  fputc('"', f);
}
static void ev(const char *type, const wchar_t *name, const char *how) {
  fprintf(stderr, "{\"ev\":\"%s\",\"name\":", type);
  jsonw(stderr, name);
  fprintf(stderr, ",\"how\":\"%s\"}\n", how ? how : "");
  fflush(stderr);
}
static void ev_dev(const wchar_t *name, const char *how, IMMDevice *d) {
  LPWSTR id = NULL; IMMDevice_GetId(d, &id);
  fprintf(stderr, "{\"ev\":\"bound\",\"name\":"); jsonw(stderr, name);
  fprintf(stderr, ",\"how\":\"%s\",\"id\":", how); jsonw(stderr, id ? id : L"");
  fprintf(stderr, "}\n"); fflush(stderr);
  if (id) CoTaskMemFree(id);
}
static int wieq(const wchar_t *a, const wchar_t *b) { return a && b && _wcsicmp(a, b) == 0; }
static int inlist(const wchar_t *csv, const wchar_t *exe) {
  if (!csv || !exe || !*exe) return 0;
  wchar_t *tmp = _wcsdup(csv); /* zoznam môže byť dlhý (všetky nainštalované hry) */
  if (!tmp) return 0;
  int hit = 0;
  wchar_t *ctx = NULL;
  for (wchar_t *t = wcstok(tmp, L",", &ctx); t && !hit; t = wcstok(NULL, L",", &ctx)) {
    while (*t == L' ') t++;
    if (_wcsicmp(t, exe) == 0) hit = 1;
  }
  free(tmp);
  return hit;
}

/* ---------------------------------------------------------------- zariadenia */
static IMMDeviceEnumerator *g_enum;

static void device_name(IMMDevice *d, wchar_t *out, int cap) {
  out[0] = 0;
  IPropertyStore *ps = NULL;
  if (FAILED(IMMDevice_OpenPropertyStore(d, STGM_READ, &ps))) return;
  PROPVARIANT v; PropVariantInit(&v);
  if (SUCCEEDED(IPropertyStore_GetValue(ps, &PKEY_Device_FriendlyName, &v)) && v.vt == VT_LPWSTR) { wcsncpy(out, v.pwszVal, cap - 1); out[cap - 1] = 0; }
  PropVariantClear(&v);
  IPropertyStore_Release(ps);
}

static void list_flow(EDataFlow flow) {
  wchar_t defId[512] = L"";
  IMMDevice *def = NULL;
  if (SUCCEEDED(IMMDeviceEnumerator_GetDefaultAudioEndpoint(g_enum, flow, eConsole, &def))) {
    LPWSTR id = NULL; if (SUCCEEDED(IMMDevice_GetId(def, &id))) { wcsncpy(defId, id, 511); CoTaskMemFree(id); }
    IMMDevice_Release(def);
  }
  IMMDeviceCollection *col = NULL; UINT n = 0;
  printf("[");
  if (SUCCEEDED(IMMDeviceEnumerator_EnumAudioEndpoints(g_enum, flow, DEVICE_STATE_ACTIVE, &col))) {
    IMMDeviceCollection_GetCount(col, &n);
    for (UINT i = 0; i < n; i++) {
      IMMDevice *d = NULL; LPWSTR id = NULL; wchar_t name[512];
      if (FAILED(IMMDeviceCollection_Item(col, i, &d))) continue;
      IMMDevice_GetId(d, &id); device_name(d, name, 512);
      printf(i ? ",{\"id\":" : "{\"id\":"); jsonw(stdout, id);
      printf(",\"name\":"); jsonw(stdout, name);
      printf(",\"default\":%s}", wieq(id, defId) ? "true" : "false");
      CoTaskMemFree(id); IMMDevice_Release(d);
    }
    IMMDeviceCollection_Release(col);
  }
  printf("]");
}

static void exe_of_pid(DWORD pid, wchar_t *out, int cap) {
  out[0] = 0;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return;
  wchar_t path[MAX_PATH]; DWORD len = MAX_PATH;
  if (QueryFullProcessImageNameW(h, 0, path, &len)) { const wchar_t *b = wcsrchr(path, L'\\'); wcsncpy(out, b ? b + 1 : path, cap - 1); out[cap - 1] = 0; }
  CloseHandle(h);
}

static void list_sessions(void) {
  wchar_t seen[64][MAX_PATH]; int nseen = 0;
  IMMDeviceCollection *col = NULL; UINT n = 0;
  printf("[");
  if (SUCCEEDED(IMMDeviceEnumerator_EnumAudioEndpoints(g_enum, eRender, DEVICE_STATE_ACTIVE, &col))) {
    IMMDeviceCollection_GetCount(col, &n);
    for (UINT i = 0; i < n; i++) {
      IMMDevice *d = NULL; IAudioSessionManager2 *m = NULL; IAudioSessionEnumerator *se = NULL;
      if (FAILED(IMMDeviceCollection_Item(col, i, &d))) continue;
      if (SUCCEEDED(IMMDevice_Activate(d, &IID_IAudioSessionManager2_, CLSCTX_ALL, NULL, (void **)&m)) &&
          SUCCEEDED(IAudioSessionManager2_GetSessionEnumerator(m, &se))) {
        int cnt = 0; IAudioSessionEnumerator_GetCount(se, &cnt);
        for (int k = 0; k < cnt; k++) {
          IAudioSessionControl *c = NULL; IAudioSessionControl2 *c2 = NULL; DWORD pid = 0; AudioSessionState st;
          if (FAILED(IAudioSessionEnumerator_GetSession(se, k, &c))) continue;
          if (SUCCEEDED(IAudioSessionControl_QueryInterface(c, &IID_IAudioSessionControl2_, (void **)&c2))) {
            IAudioSessionControl2_GetProcessId(c2, &pid);
            IAudioSessionControl_GetState(c, &st);
            wchar_t exe[MAX_PATH]; exe_of_pid(pid, exe, MAX_PATH);
            int dup = !pid || !exe[0];
            for (int s = 0; s < nseen && !dup; s++) if (wieq(seen[s], exe)) dup = 1;
            if (!dup && nseen < 64) {
              wcscpy(seen[nseen], exe);
              printf(nseen ? ",{\"exe\":" : "{\"exe\":"); jsonw(stdout, exe);
              printf(",\"pid\":%lu,\"active\":%s}", (unsigned long)pid, st == AudioSessionStateActive ? "true" : "false");
              nseen++;
            }
            IAudioSessionControl2_Release(c2);
          }
          IAudioSessionControl_Release(c);
        }
      }
      if (se) IAudioSessionEnumerator_Release(se);
      if (m) IAudioSessionManager2_Release(m);
      IMMDevice_Release(d);
    }
    IMMDeviceCollection_Release(col);
  }
  printf("]\n");
}

/* nájdi zariadenie: 1) podľa ID, 2) podľa presného mena, 3) podľa časti mena, 4) predvolené */
static IMMDevice *resolve_device(const wchar_t *id, const wchar_t *name, EDataFlow flow, int allowDefault, const char **how, wchar_t *gotName) {
  IMMDevice *d = NULL; DWORD state = 0;
  if (id && *id && SUCCEEDED(IMMDeviceEnumerator_GetDevice(g_enum, id, &d))) {
    if (SUCCEEDED(IMMDevice_GetState(d, &state)) && state == DEVICE_STATE_ACTIVE) { *how = "id"; device_name(d, gotName, 512); return d; }
    IMMDevice_Release(d); d = NULL;
  }
  if (name && *name) {
    IMMDeviceCollection *col = NULL; UINT n = 0; IMMDevice *partial = NULL;
    if (SUCCEEDED(IMMDeviceEnumerator_EnumAudioEndpoints(g_enum, flow, DEVICE_STATE_ACTIVE, &col))) {
      IMMDeviceCollection_GetCount(col, &n);
      for (UINT i = 0; i < n && !d; i++) {
        IMMDevice *x = NULL; wchar_t nm[512];
        if (FAILED(IMMDeviceCollection_Item(col, i, &x))) continue;
        device_name(x, nm, 512);
        if (wieq(nm, name)) { d = x; continue; }
        if (!partial && (wcsstr(nm, name) || wcsstr(name, nm))) { partial = x; continue; }
        IMMDevice_Release(x);
      }
      IMMDeviceCollection_Release(col);
    }
    if (d) { if (partial) IMMDevice_Release(partial); *how = "name"; device_name(d, gotName, 512); return d; }
    if (partial) { *how = "name"; device_name(partial, gotName, 512); return partial; }
  }
  if (allowDefault && SUCCEEDED(IMMDeviceEnumerator_GetDefaultAudioEndpoint(g_enum, flow, eConsole, &d))) { *how = "default"; device_name(d, gotName, 512); return d; }
  return NULL;
}

/* ---------------------------------------------------------------- procesy */
static DWORD parent_of(DWORD pid, HANDLE snap) {
  PROCESSENTRY32W pe = { sizeof pe };
  if (Process32FirstW(snap, &pe)) do { if (pe.th32ProcessID == pid) return pe.th32ParentProcessID; } while (Process32NextW(snap, &pe));
  return 0;
}
/* koreňový proces appky podľa mena exe (Discord má veľa procesov, chceme toho hlavného) */
static DWORD find_root_pid(const wchar_t *exe) {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return 0;
  DWORD found = 0;
  PROCESSENTRY32W pe = { sizeof pe };
  if (Process32FirstW(snap, &pe)) do {
    if (_wcsicmp(pe.szExeFile, exe) == 0) {
      DWORD pid = pe.th32ProcessID, par = pe.th32ParentProcessID;
      wchar_t pexe[MAX_PATH]; exe_of_pid(par, pexe, MAX_PATH);
      if (!wieq(pexe, exe)) { found = pid; break; }
      if (!found) found = pid;
    }
  } while (Process32NextW(snap, &pe));
  CloseHandle(snap);
  return found;
}
static DWORD root_of(DWORD pid) {
  wchar_t exe[MAX_PATH]; exe_of_pid(pid, exe, MAX_PATH);
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return pid;
  for (int guard = 0; guard < 16; guard++) {
    DWORD par = parent_of(pid, snap); wchar_t pexe[MAX_PATH];
    if (!par) break;
    exe_of_pid(par, pexe, MAX_PATH);
    if (!wieq(pexe, exe)) break;
    pid = par;
  }
  CloseHandle(snap);
  return pid;
}
static int alive(DWORD pid) {
  HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
  if (!h) return 0;
  DWORD r = WaitForSingleObject(h, 0);
  CloseHandle(h);
  return r == WAIT_TIMEOUT;
}
/* okno pokrýva celý monitor = fullscreen alebo borderless = asi hra */
static int covers_monitor(HWND w) {
  RECT r; MONITORINFO mi = { sizeof mi };
  if (!GetWindowRect(w, &r)) return 0;
  if (!GetMonitorInfoW(MonitorFromWindow(w, MONITOR_DEFAULTTONEAREST), &mi)) return 0;
  return r.left <= mi.rcMonitor.left && r.top <= mi.rcMonitor.top && r.right >= mi.rcMonitor.right && r.bottom >= mi.rcMonitor.bottom;
}

/* ---------------------------------------------------------------- aktivácia process loopbacku (async COM) */
typedef struct {
  IActivateAudioInterfaceCompletionHandler iface;
  LONG ref; HANDLE done; HRESULT hr; IAudioClient *client;
} Handler;
static HRESULT STDMETHODCALLTYPE h_qi(IActivateAudioInterfaceCompletionHandler *This, REFIID riid, void **pp) {
  if (IsEqualGUID(riid, &IID_IUnknown_) || IsEqualGUID(riid, &IID_IAgileObject_) || IsEqualGUID(riid, &IID_IActivateAudioInterfaceCompletionHandler_)) {
    *pp = This; InterlockedIncrement(&((Handler *)This)->ref); return S_OK;
  }
  *pp = NULL; return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE h_addref(IActivateAudioInterfaceCompletionHandler *This) { return InterlockedIncrement(&((Handler *)This)->ref); }
static ULONG STDMETHODCALLTYPE h_release(IActivateAudioInterfaceCompletionHandler *This) {
  Handler *h = (Handler *)This; LONG r = InterlockedDecrement(&h->ref);
  if (r == 0) { CloseHandle(h->done); free(h); }
  return r;
}
static HRESULT STDMETHODCALLTYPE h_done(IActivateAudioInterfaceCompletionHandler *This, IActivateAudioInterfaceAsyncOperation *op) {
  Handler *h = (Handler *)This; HRESULT hr = E_FAIL; IUnknown *unk = NULL;
  if (SUCCEEDED(IActivateAudioInterfaceAsyncOperation_GetActivateResult(op, &hr, &unk)) && SUCCEEDED(hr) && unk) {
    hr = IUnknown_QueryInterface(unk, &IID_IAudioClient_, (void **)&h->client);
  }
  if (unk) IUnknown_Release(unk);
  h->hr = hr; SetEvent(h->done);
  return S_OK;
}
static IActivateAudioInterfaceCompletionHandlerVtbl g_hvt = { h_qi, h_addref, h_release, h_done };

static IAudioClient *activate_process_loopback(DWORD pid) {
  static PFN_ActivateAudioInterfaceAsync fn;
  if (!fn) { HMODULE m = LoadLibraryW(L"Mmdevapi.dll"); if (m) fn = (PFN_ActivateAudioInterfaceAsync)GetProcAddress(m, "ActivateAudioInterfaceAsync"); }
  if (!fn) { ev("error", L"ActivateAudioInterfaceAsync chýba (treba Windows 10 2004+ / 11)", "noapi"); return NULL; }
  ACTIVATION_PARAMS ap = { ACTIVATION_TYPE_PROCESS_LOOPBACK, { pid, LOOPBACK_MODE_INCLUDE_TREE } };
  PROPVARIANT pv; PropVariantInit(&pv);
  pv.vt = VT_BLOB; pv.blob.cbSize = sizeof ap; pv.blob.pBlobData = (BYTE *)&ap;
  Handler *h = calloc(1, sizeof *h);
  h->iface.lpVtbl = &g_hvt; h->ref = 1; h->done = CreateEventW(NULL, FALSE, FALSE, NULL); h->hr = E_FAIL;
  IActivateAudioInterfaceAsyncOperation *op = NULL;
  IAudioClient *client = NULL;
  HRESULT hr = fn(L"VAD\\Process_Loopback", &IID_IAudioClient_, &pv, &h->iface, &op);
  if (SUCCEEDED(hr) && WaitForSingleObject(h->done, 5000) == WAIT_OBJECT_0 && SUCCEEDED(h->hr)) { client = h->client; h->client = NULL; }
  if (op) IActivateAudioInterfaceAsyncOperation_Release(op);
  if (h->client) IAudioClient_Release(h->client);
  h_release(&h->iface);
  return client;
}

/* ---------------------------------------------------------------- zachytávanie */
typedef struct {
  IAudioClient *client; IAudioCaptureClient *cap; HANDLE evt;
  int is16;              /* záloha: zdroj nám dáva 16-bit PCM */
  int srcCh;
} Source;

static void src_close(Source *s) {
  if (s->client) IAudioClient_Stop(s->client);
  if (s->cap) IAudioCaptureClient_Release(s->cap);
  if (s->client) IAudioClient_Release(s->client);
  s->cap = NULL; s->client = NULL;
}

static void make_fmt(WAVEFORMATEXTENSIBLE *f, int is16) {
  memset(f, 0, sizeof *f);
  f->Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  f->Format.nChannels = CH; f->Format.nSamplesPerSec = RATE;
  f->Format.wBitsPerSample = is16 ? 16 : 32;
  f->Format.nBlockAlign = CH * f->Format.wBitsPerSample / 8;
  f->Format.nAvgBytesPerSec = RATE * f->Format.nBlockAlign;
  f->Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  f->Samples.wValidBitsPerSample = f->Format.wBitsPerSample;
  f->dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
  f->SubFormat = is16 ? KSDATAFORMAT_SUBTYPE_PCM_ : KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_;
}

/* inicializuj klienta vo formáte 48k float stereo; Windows si prevod spraví sám (AUTOCONVERTPCM) */
static int src_start(Source *s, IAudioClient *client, int loopback) {
  s->client = client; s->is16 = 0; s->srcCh = CH;
  DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  if (loopback) flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
  WAVEFORMATEXTENSIBLE f; HRESULT hr = E_FAIL;
  for (int attempt = 0; attempt < 2; attempt++) {
    make_fmt(&f, attempt);
    hr = IAudioClient_Initialize(client, AUDCLNT_SHAREMODE_SHARED, flags, 10000000 /* 1 s */, 0, (WAVEFORMATEX *)&f, NULL);
    if (SUCCEEDED(hr)) { s->is16 = attempt; break; }
  }
  if (FAILED(hr)) { char m[64]; sprintf(m, "init 0x%08lx", (unsigned long)hr); ev("error", L"Initialize zlyhal", m); src_close(s); return 0; }
  IAudioClient_SetEventHandle(client, s->evt);
  if (FAILED(IAudioClient_GetService(client, &IID_IAudioCaptureClient_, (void **)&s->cap))) { src_close(s); return 0; }
  if (FAILED(IAudioClient_Start(client))) { src_close(s); return 0; }
  return 1;
}

/* kruhový buffer s float vzorkami (interleaved stereo) */
static float g_ring[RING_FRAMES * CH];
static size_t g_head, g_count; /* head = index najstaršieho rámca */

static void ring_push(const float *src, size_t frames) {
  if (frames > RING_FRAMES) { src += (frames - RING_FRAMES) * CH; frames = RING_FRAMES; }
  for (size_t i = 0; i < frames; i++) {
    size_t pos = (g_head + g_count) % RING_FRAMES;
    if (g_count == RING_FRAMES) { g_head = (g_head + 1) % RING_FRAMES; g_count--; }
    pos = (g_head + g_count) % RING_FRAMES;
    g_ring[pos * CH] = src ? src[i * CH] : 0.f;
    g_ring[pos * CH + 1] = src ? src[i * CH + 1] : 0.f;
    g_count++;
  }
}
static size_t ring_pop(float *dst, size_t frames) {
  size_t n = frames < g_count ? frames : g_count;
  for (size_t i = 0; i < n; i++) {
    size_t pos = (g_head + i) % RING_FRAMES;
    dst[i * CH] = g_ring[pos * CH]; dst[i * CH + 1] = g_ring[pos * CH + 1];
  }
  g_head = (g_head + n) % RING_FRAMES; g_count -= n;
  return n;
}
static void ring_drop(size_t frames) { if (frames > g_count) frames = g_count; g_head = (g_head + frames) % RING_FRAMES; g_count -= frames; }

/* vyber všetky čakajúce pakety zo zdroja; vráti 0, ak zariadenie zmizlo */
static int src_drain(Source *s) {
  static float conv[RATE * CH];
  UINT32 next = 0;
  for (;;) {
    HRESULT hr = IAudioCaptureClient_GetNextPacketSize(s->cap, &next);
    if (FAILED(hr)) return 0;
    if (!next) return 1;
    BYTE *data = NULL; UINT32 frames = 0; DWORD fl = 0;
    hr = IAudioCaptureClient_GetBuffer(s->cap, &data, &frames, &fl, NULL, NULL);
    if (FAILED(hr)) return 0;
    if (frames > RATE) frames = RATE;
    if ((fl & AUDCLNT_BUFFERFLAGS_SILENT) || !data) ring_push(NULL, frames);
    else if (s->is16) {
      const short *p = (const short *)data;
      for (UINT32 i = 0; i < frames * CH; i++) conv[i] = p[i] / 32768.f;
      ring_push(conv, frames);
    } else ring_push((const float *)data, frames);
    IAudioCaptureClient_ReleaseBuffer(s->cap, frames);
  }
}

/* ---------------------------------------------------------------- main */
static const wchar_t *arg(int argc, wchar_t **argv, const wchar_t *key) {
  for (int i = 1; i < argc - 1; i++) if (wcscmp(argv[i], key) == 0) return argv[i + 1];
  return NULL;
}
static int flag(int argc, wchar_t **argv, const wchar_t *key) {
  for (int i = 1; i < argc; i++) if (wcscmp(argv[i], key) == 0) return 1;
  return 0;
}

int main(void) {
  int argc = 0;
  wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  SetConsoleOutputCP(CP_UTF8);
  if (FAILED(CoInitializeEx(NULL, COINIT_MULTITHREADED))) return 2;
  if (FAILED(CoCreateInstance(&CLSID_MMDeviceEnumerator_, NULL, CLSCTX_ALL, &IID_IMMDeviceEnumerator_, (void **)&g_enum))) { fprintf(stderr, "no enumerator\n"); return 2; }

  const wchar_t *cmd = argc > 1 ? argv[1] : L"";
  if (wcscmp(cmd, L"list") == 0) {
    printf("{\"render\":"); list_flow(eRender);
    printf(",\"capture\":"); list_flow(eCapture);
    printf("}\n"); fflush(stdout); return 0;
  }
  if (wcscmp(cmd, L"sessions") == 0) { list_sessions(); fflush(stdout); return 0; }
  if (wcscmp(cmd, L"capture") != 0) { fprintf(stderr, "pouzitie: fxaudio list | sessions | capture [volby]\n"); return 1; }

  const wchar_t *pipeName = arg(argc, argv, L"--pipe");
  const wchar_t *devId = arg(argc, argv, L"--device");
  const wchar_t *devName = arg(argc, argv, L"--name");
  const wchar_t *flowS = arg(argc, argv, L"--flow");
  const wchar_t *procExe = arg(argc, argv, L"--process");
  const wchar_t *games = arg(argc, argv, L"--games");
  const wchar_t *exclude = arg(argc, argv, L"--exclude");
  const wchar_t *epochFile = arg(argc, argv, L"--epoch-file");
  int useDefault = flag(argc, argv, L"--default");
  int foreground = flag(argc, argv, L"--foreground");
  EDataFlow flow = (flowS && wcscmp(flowS, L"capture") == 0) ? eCapture : eRender;
  int mode = foreground ? 2 : procExe ? 1 : 0; /* 0 zariadenie, 1 proces, 2 popredie */
  DWORD selfPid = GetCurrentProcessId();

  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  if (pipeName) {
    out = CreateNamedPipeW(pipeName, PIPE_ACCESS_OUTBOUND, PIPE_TYPE_BYTE | PIPE_WAIT, 1, 1 << 20, 0, 0, NULL);
    if (out == INVALID_HANDLE_VALUE) { ev("error", pipeName, "pipe"); return 3; }
    ev("waiting", pipeName, "pipe");
    if (!ConnectNamedPipe(out, NULL) && GetLastError() != ERROR_PIPE_CONNECTED) { ev("error", pipeName, "connect"); return 3; }
  }
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);

  Source src = { 0 };
  src.evt = CreateEventW(NULL, FALSE, FALSE, NULL);
  DWORD boundPid = 0;
  ULONGLONG lastTry = 0, lastFg = 0;

  LARGE_INTEGER freq, t0, now;
  QueryPerformanceFrequency(&freq); QueryPerformanceCounter(&t0);
  /* spoločný začiatok všetkých stôp: ffmpeg otvára rúry jednu po druhej, takže každý pomocník sa pripojí
     o kúsok neskôr. Prvý zapíše svoj čas do súboru, ostatní začnú počítať od neho (chýbajúci kúsok = ticho),
     takže vzorka 0 je vo všetkých stopách v rovnakom okamihu. */
  if (epochFile) {
    HANDLE ef = CreateFileW(epochFile, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (ef != INVALID_HANDLE_VALUE) {
      DWORD wr = 0; WriteFile(ef, &t0.QuadPart, sizeof(t0.QuadPart), &wr, NULL); CloseHandle(ef);
    } else {
      for (int tries = 0; tries < 50; tries++) {
        HANDLE rf = CreateFileW(epochFile, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
        if (rf != INVALID_HANDLE_VALUE) {
          LONGLONG e = 0; DWORD rd = 0;
          BOOL ok = ReadFile(rf, &e, sizeof(e), &rd, NULL); CloseHandle(rf);
          if (ok && rd == sizeof(e)) {
            /* len rozumný rozdiel (max 5 s dozadu), inak radšej vlastný čas */
            if (e <= t0.QuadPart && t0.QuadPart - e < freq.QuadPart * 5) {
              fprintf(stderr, "{\"ev\":\"epoch\",\"shift\":%.1f}\n", (double)(t0.QuadPart - e) * 1000.0 / (double)freq.QuadPart); fflush(stderr);
              t0.QuadPart = e;
            }
            break;
          }
        }
        Sleep(2);
      }
    }
  }
  unsigned long long written = 0;
  static float outbuf[RATE * CH];
  float peak = 0; ULONGLONG lastLvl = 0;

  for (;;) {
    ULONGLONG tick = GetTickCount64();

    /* ---- napoj zdroj, keď nie je */
    if (!src.client && tick - lastTry > 1000) {
      lastTry = tick;
      if (mode == 0) {
        const char *how = ""; wchar_t got[512] = L"";
        IMMDevice *d = resolve_device(devId, devName, flow, useDefault, &how, got);
        if (d) {
          IAudioClient *c = NULL;
          if (SUCCEEDED(IMMDevice_Activate(d, &IID_IAudioClient_, CLSCTX_ALL, NULL, (void **)&c)) && src_start(&src, c, flow == eRender)) ev_dev(got, how, d);
          IMMDevice_Release(d);
        } else ev("missing", devName ? devName : L"", "device");
      } else if (mode == 1) {
        DWORD pid = find_root_pid(procExe);
        if (pid) { IAudioClient *c = activate_process_loopback(pid); if (c && src_start(&src, c, 1)) { boundPid = pid; ev("bound", procExe, "process"); } }
        else ev("missing", procExe, "process");
      }
    }

    /* ---- režim hry v popredí: každú 1,5 s pozri, či sa nezmenila */
    if (mode == 2 && tick - lastFg > 1500) {
      lastFg = tick;
      HWND w = GetForegroundWindow(); DWORD pid = 0;
      if (w) GetWindowThreadProcessId(w, &pid);
      if (pid && pid != selfPid) {
        wchar_t exe[MAX_PATH]; exe_of_pid(pid, exe, MAX_PATH);
        int isGame = exe[0] && !inlist(exclude, exe) && (inlist(games, exe) || covers_monitor(w));
        DWORD root = isGame ? root_of(pid) : 0;
        if (isGame && root != boundPid) {
          src_close(&src);
          IAudioClient *c = activate_process_loopback(root);
          if (c && src_start(&src, c, 1)) { boundPid = root; ev("bound", exe, "foreground"); }
          else boundPid = 0;
        }
      }
      if (boundPid && !alive(boundPid)) { src_close(&src); boundPid = 0; ev("missing", L"", "foreground"); }
    }
    if (mode == 1 && boundPid && tick - lastTry > 2000) {
      lastTry = tick;
      if (!alive(boundPid)) { src_close(&src); boundPid = 0; ev("missing", procExe, "process"); }
    }

    /* ---- čakaj na dáta (max 10 ms) a vyber ich */
    if (src.client) {
      WaitForSingleObject(src.evt, 10);
      if (!src_drain(&src)) { src_close(&src); boundPid = 0; ev("lost", L"", "invalidated"); }
    } else Sleep(10);

    /* ---- zapisuj presne podľa hodín: chýbajúce dáta = ticho, prebytok = zahodiť */
    QueryPerformanceCounter(&now);
    unsigned long long target = (unsigned long long)((double)(now.QuadPart - t0.QuadPart) * RATE / freq.QuadPart);
    if (target <= LAT_FRAMES) continue;
    target -= LAT_FRAMES;
    if (target <= written) continue;
    size_t need = (size_t)(target - written);
    if (g_count > need + MAX_EXTRA) ring_drop(g_count - need - MAX_EXTRA / 2);
    while (need) {
      size_t chunk = need > RATE ? RATE : need;
      size_t got = ring_pop(outbuf, chunk);
      if (got < chunk) memset(outbuf + got * CH, 0, (chunk - got) * CH * sizeof(float));
      for (size_t i = 0; i < chunk * CH; i++) { float a = outbuf[i] < 0 ? -outbuf[i] : outbuf[i]; if (a > peak) peak = a; }
      DWORD wr = 0;
      if (!WriteFile(out, outbuf, (DWORD)(chunk * CH * sizeof(float)), &wr, NULL)) return 0; /* ffmpeg skončil */
      written += chunk; need -= chunk;
    }
    if (tick - lastLvl >= 100) { lastLvl = tick; fprintf(stderr, "{\"ev\":\"lvl\",\"v\":%.3f}\n", peak > 1 ? 1.0 : peak); fflush(stderr); peak = 0; }
  }
}
